/** The one thing that outlives a session: whether marking is on. */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Shape of the pre-session-glossary file, kept only to recover old definitions. */
interface LegacyTerm {
	term?: string;
	definition?: string;
	kind?: string;
}

export class Settings {
	private readonly path: string;
	private data: { enabled: boolean };
	/** Definitions left behind by versions that kept one global glossary file. */
	private readonly legacy = new Map<string, { kind: string; definition: string }>();

	constructor(path: string) {
		this.path = path;
		try {
			const parsed = JSON.parse(readFileSync(path, "utf8")) as { enabled?: boolean; terms?: Record<string, LegacyTerm> };
			this.data = { enabled: parsed.enabled !== false };
			for (const t of Object.values(parsed.terms ?? {})) {
				if (t.term && t.definition) this.legacy.set(t.term.trim().toLowerCase(), { kind: t.kind ?? "term", definition: t.definition });
			}
		} catch {
			this.data = { enabled: true };
		}
	}

	/** A definition from the old global file, if that term was ever explained before. */
	legacyDefinition(term: string): { kind: string; definition: string } | undefined {
		return this.legacy.get(term.trim().toLowerCase());
	}

	get enabled(): boolean {
		return this.data.enabled;
	}

	setEnabled(on: boolean): void {
		this.data.enabled = on;
		try {
			mkdirSync(dirname(this.path), { recursive: true });
			let existing: Record<string, unknown> = {};
			try {
				existing = JSON.parse(readFileSync(this.path, "utf8")) as Record<string, unknown>;
			} catch {
				// Nothing to keep.
			}
			writeFileSync(this.path, `${JSON.stringify({ ...existing, enabled: on }, null, "\t")}\n`);
		} catch {
			// Still applies to this session; it just won't be remembered.
		}
	}
}
