/**
 * The glossary: every term the agent has ever marked, with its plain definition.
 * One JSON file per user, shared across projects, so a term explained once in
 * one repo is still there when it shows up in another.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface Entry {
	/** Display spelling, as the model first wrote it. */
	term: string;
	definition: string;
	/** ISO timestamps. */
	firstSeen: string;
	lastSeen: string;
	/** How many replies have marked this term. */
	count: number;
	/** Working directories the term was seen in. */
	projects: string[];
}

export interface GlossaryFile {
	version: 1;
	/** Whether the model is asked to mark terms at all. */
	enabled: boolean;
	/** Whether the last reply's terms are listed above the editor. */
	footnotes: boolean;
	terms: Record<string, Entry>;
}

export const normalize = (term: string): string => term.trim().toLowerCase().replace(/\s+/g, " ");

const empty = (): GlossaryFile => ({ version: 1, enabled: true, footnotes: true, terms: {} });

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
			return {
				version: 1,
				enabled: parsed.enabled !== false,
				footnotes: parsed.footnotes !== false,
				terms: parsed.terms && typeof parsed.terms === "object" ? parsed.terms : {},
			};
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

	get footnotes(): boolean {
		return this.data.footnotes;
	}

	setFootnotes(on: boolean): void {
		this.data.footnotes = on;
		this.save();
	}

	get size(): number {
		return Object.keys(this.data.terms).length;
	}

	get(term: string): Entry | undefined {
		return this.data.terms[normalize(term)];
	}

	all(): Entry[] {
		return Object.values(this.data.terms).sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
	}

	/**
	 * Record a sighting. A new definition replaces the old one only when the old
	 * one is missing, so the first good explanation sticks.
	 */
	record(term: string, definition: string | undefined, project: string, now = new Date()): Entry {
		const key = normalize(term);
		const iso = now.toISOString();
		const existing = this.data.terms[key];
		if (existing) {
			existing.count += 1;
			existing.lastSeen = iso;
			if (!existing.definition && definition) existing.definition = definition;
			if (!existing.projects.includes(project)) existing.projects.push(project);
			return existing;
		}
		const entry: Entry = {
			term: term.trim(),
			definition: definition ?? "",
			firstSeen: iso,
			lastSeen: iso,
			count: 1,
			projects: [project],
		};
		this.data.terms[key] = entry;
		return entry;
	}

	forget(term: string): boolean {
		const key = normalize(term);
		if (!(key in this.data.terms)) return false;
		delete this.data.terms[key];
		this.save();
		return true;
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
