/**
 * The glossary: everything the agent has explained in this session, with its
 * plain definition. State lives in memory; whoever owns it decides where it is
 * persisted (pi-vocab stores a snapshot in the pi session, so it follows the
 * session and its branches, and a new session starts empty).
 */

export const KINDS = ["term", "concept", "why", "where", "how", "gotcha"] as const;
export type Kind = (typeof KINDS)[number];

export const isKind = (s: string): s is Kind => (KINDS as readonly string[]).includes(s);

/** One character per kind for list rows. Terms get none. */
export const KIND_GLYPH: Record<Kind, string> = {
	term: "",
	concept: "◇",
	why: "?",
	where: "@",
	how: "›",
	gotcha: "!",
};

export const KIND_LABEL: Record<Kind, string> = {
	term: "term",
	concept: "concept",
	why: "why we do it this way",
	where: "where it lives",
	how: "how to do it",
	gotcha: "gotcha",
};

export interface Entry {
	kind: Kind;
	/** Display spelling, as the model first wrote it. */
	term: string;
	definition: string;
	/** ISO timestamps. */
	firstSeen: string;
	lastSeen: string;
	/** How many replies have marked this entry. */
	count: number;
	/** Working directories the entry was seen in. */
	projects: string[];
	/** Names of entries this one connects to, as written. */
	related: string[];
	/** How often the user opened this entry in the overlay. High means not sticking. */
	lookups: number;
	/** Flashcard history. */
	quiz: { asked: number; missed: number; lastAsked?: string };
}

export interface GlossaryData {
	version: 3;
	terms: Record<string, Entry>;
}

export const normalize = (term: string): string => term.trim().toLowerCase().replace(/\s+/g, " ");

/** Storage key. Terms keep their bare name so version 1 files load unchanged. */
export const keyOf = (kind: Kind, term: string): string => (kind === "term" ? normalize(term) : `${kind}:${normalize(term)}`);

export type Persist = (data: GlossaryData) => void;

export class Glossary {
	private data: GlossaryData = { version: 3, terms: {} };
	private readonly persist: Persist;

	constructor(persist: Persist = () => {}) {
		this.persist = persist;
	}

	/** Replace the contents with a stored snapshot, tolerating older shapes. */
	load(snapshot: unknown): void {
		const parsed = (snapshot ?? {}) as Partial<GlossaryData>;
		const terms: Record<string, Entry> = {};
		for (const [key, raw] of Object.entries(parsed.terms ?? {})) {
			const entry = raw as Partial<Entry>;
			if (!entry.term) continue;
			terms[key] = {
				...entry,
				kind: entry.kind && isKind(entry.kind) ? entry.kind : "term",
				related: Array.isArray(entry.related) ? entry.related : [],
				lookups: typeof entry.lookups === "number" ? entry.lookups : 0,
				quiz: {
					asked: entry.quiz?.asked ?? 0,
					missed: entry.quiz?.missed ?? 0,
					...(entry.quiz?.lastAsked ? { lastAsked: entry.quiz.lastAsked } : {}),
				},
			} as Entry;
		}
		this.data = { version: 3, terms };
	}

	/** A copy safe to store. */
	snapshot(): GlossaryData {
		return JSON.parse(JSON.stringify(this.data)) as GlossaryData;
	}

	get size(): number {
		return Object.keys(this.data.terms).length;
	}

	/** Exact kind when given; otherwise the term, then any other kind with that name. */
	get(term: string, kind?: Kind): Entry | undefined {
		if (kind) return this.data.terms[keyOf(kind, term)];
		return this.data.terms[keyOf("term", term)] ?? KINDS.map((k) => this.data.terms[keyOf(k, term)]).find(Boolean);
	}

	/** Every entry, most recent first. */
	all(): Entry[] {
		return Object.values(this.data.terms).sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
	}

	/**
	 * Record a sighting. A new definition replaces the old one only when the old
	 * one is missing, so the first good explanation sticks.
	 */
	record(
		term: string,
		definition: string | undefined,
		project: string,
		kind: Kind = "term",
		now = new Date(),
		related: string[] = [],
	): Entry {
		const key = keyOf(kind, term);
		const iso = now.toISOString();
		const existing = this.data.terms[key];
		if (existing) {
			existing.count += 1;
			existing.lastSeen = iso;
			if (!existing.definition && definition) existing.definition = definition;
			if (!existing.projects.includes(project)) existing.projects.push(project);
			this.link(existing, related);
			return existing;
		}
		const entry: Entry = {
			kind,
			term: term.trim(),
			definition: definition ?? "",
			firstSeen: iso,
			lastSeen: iso,
			count: 1,
			projects: [project],
			related: [],
			lookups: 0,
			quiz: { asked: 0, missed: 0 },
		};
		this.data.terms[key] = entry;
		this.link(entry, related);
		return entry;
	}

	/** Connect both ways, skipping self and duplicates. The other side need not exist yet. */
	private link(entry: Entry, related: string[]): void {
		for (const name of related) {
			if (normalize(name) === normalize(entry.term)) continue;
			if (!entry.related.some((r) => normalize(r) === normalize(name))) entry.related.push(name.trim());
			const other = this.get(name);
			if (other && !other.related.some((r) => normalize(r) === normalize(entry.term))) other.related.push(entry.term);
		}
	}

	/** Count a lookup. Returns false when the entry is unknown. */
	lookup(term: string, kind?: Kind): boolean {
		const entry = this.get(term, kind);
		if (!entry) return false;
		entry.lookups += 1;
		return true;
	}

	/** Record a flashcard answer. */
	recordQuiz(entry: Entry, missed: boolean, now = new Date()): void {
		entry.quiz.asked += 1;
		if (missed) entry.quiz.missed += 1;
		entry.quiz.lastAsked = now.toISOString();
	}

	/** Remove an entry. Without a kind, removes every kind with that name. */
	forget(term: string, kind?: Kind): boolean {
		const keys = kind ? [keyOf(kind, term)] : KINDS.map((k) => keyOf(k, term));
		let removed = false;
		for (const key of keys) {
			if (key in this.data.terms) {
				delete this.data.terms[key];
				removed = true;
			}
		}
		if (removed) this.save();
		return removed;
	}

	save(): void {
		try {
			this.persist(this.snapshot());
		} catch {
			// Losing persistence is not worth breaking the reply.
		}
	}
}
