/**
 * The glossary: everything the agent has explained, with its plain definition.
 * One JSON file per user, shared across projects, so a term explained once in
 * one repo is still there when it shows up in another.
 *
 * Entries come in kinds. Terms and concepts are universal; why, where, how and
 * gotcha belong to the project they were seen in.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const KINDS = ["term", "concept", "why", "where", "how", "gotcha"] as const;
export type Kind = (typeof KINDS)[number];

/** Kinds that only make sense inside the project they came from. */
export const PROJECT_KINDS: ReadonlySet<Kind> = new Set<Kind>(["why", "where", "how", "gotcha"]);

export const isKind = (s: string): s is Kind => (KINDS as readonly string[]).includes(s);

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
}

export interface GlossaryFile {
	version: 2;
	/** Whether the model is asked to mark terms at all. */
	enabled: boolean;
	terms: Record<string, Entry>;
}

export const normalize = (term: string): string => term.trim().toLowerCase().replace(/\s+/g, " ");

/** Storage key. Terms keep their bare name so version 1 files load unchanged. */
export const keyOf = (kind: Kind, term: string): string => (kind === "term" ? normalize(term) : `${kind}:${normalize(term)}`);

const empty = (): GlossaryFile => ({ version: 2, enabled: true, terms: {} });

export class Glossary {
	private data: GlossaryFile;
	private readonly path: string;

	constructor(path: string) {
		this.path = path;
		this.data = Glossary.read(path);
	}

	private static read(path: string): GlossaryFile {
		try {
			const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<GlossaryFile>;
			const terms: Record<string, Entry> = {};
			for (const [key, raw] of Object.entries(parsed.terms ?? {})) {
				const entry = raw as Partial<Entry>;
				if (!entry.term) continue;
				terms[key] = {
					...entry,
					kind: entry.kind && isKind(entry.kind) ? entry.kind : "term",
					related: Array.isArray(entry.related) ? entry.related : [],
				} as Entry;
			}
			return { version: 2, enabled: parsed.enabled !== false, terms };
		} catch {
			return empty();
		}
	}

	get enabled(): boolean {
		return this.data.enabled;
	}

	setEnabled(enabled: boolean): void {
		this.data.enabled = enabled;
		this.save();
	}

	get size(): number {
		return Object.keys(this.data.terms).length;
	}

	/** Exact kind when given; otherwise the term, then any other kind with that name. */
	get(term: string, kind?: Kind): Entry | undefined {
		if (kind) return this.data.terms[keyOf(kind, term)];
		return this.data.terms[keyOf("term", term)] ?? KINDS.map((k) => this.data.terms[keyOf(k, term)]).find(Boolean);
	}

	/** Every entry, most recent first. With `project`, project-scoped kinds are limited to it. */
	all(project?: string): Entry[] {
		return Object.values(this.data.terms)
			.filter((e) => !project || !PROJECT_KINDS.has(e.kind) || e.projects.includes(project))
			.sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
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
			mkdirSync(dirname(this.path), { recursive: true });
			const tmp = `${this.path}.tmp`;
			writeFileSync(tmp, `${JSON.stringify(this.data, null, "\t")}\n`);
			renameSync(tmp, this.path);
		} catch {
			// Losing persistence is not worth breaking the reply.
		}
	}
}
