/**
 * Codex's glossary file. Hooks run as separate short-lived processes, so
 * every one loads the file, changes it and writes it back whole.
 *
 * One file holds the glossary (shared by every Codex session, like the Claude
 * Code store), whether marking is on, and per session which number went to
 * which entry, so `vocab 3` finds hint 3 of the session you are looking at.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Glossary, type Entry, isKind, keyOf } from "../src/glossary.ts";

export interface SessionHints {
	/** ISO time of the last hook that touched this session. */
	updated: string;
	cwd?: string;
	/** Hint number → glossary key. */
	hints: Record<string, string>;
	/** Whether the model currently holds the marking instructions. */
	prompted?: boolean;
}

interface FileShape {
	version: 3;
	enabled: boolean;
	terms: Record<string, Entry>;
	sessions: Record<string, SessionHints>;
}

/** Sessions kept for lookups; older ones only cost file size. */
const KEEP_SESSIONS = 30;

export const defaultPath = (): string => process.env.VOCAB_CODEX_FILE ?? join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "vocab.json");

/** Where pi's older global glossary lives, imported once into an empty file. */
const piLegacyPath = (): string => join(homedir(), ".pi", "agent", "vocab.json");

export class Store {
	readonly glossary = new Glossary();
	enabled = true;
	sessions: Record<string, SessionHints> = {};
	private readonly path: string;

	constructor(path = defaultPath(), legacyPath = piLegacyPath()) {
		this.path = path;
		if (existsSync(path)) {
			try {
				const data = JSON.parse(readFileSync(path, "utf8")) as Partial<FileShape>;
				this.glossary.load(data);
				this.enabled = data.enabled !== false;
				this.sessions = data.sessions ?? {};
			} catch {
				// A broken file starts over rather than breaking every hook.
			}
		} else {
			this.importLegacy(legacyPath);
		}
	}

	private importLegacy(path: string): void {
		try {
			const old = JSON.parse(readFileSync(path, "utf8")) as { terms?: Record<string, { term?: string; definition?: string; kind?: string }> };
			for (const t of Object.values(old.terms ?? {})) {
				if (t.term && t.definition) this.glossary.record(t.term, t.definition, { kind: t.kind && isKind(t.kind) ? t.kind : "term" });
			}
		} catch {
			// Nothing to import.
		}
	}

	/** The session's numbers, created on first use. */
	session(id: string, cwd?: string): SessionHints {
		const s = (this.sessions[id] ??= { updated: new Date().toISOString(), hints: {} });
		s.updated = new Date().toISOString();
		if (cwd) s.cwd = cwd;
		return s;
	}

	/** The session a lookup means: the one named, else the one touched last. */
	latest(id?: string): [string, SessionHints] | undefined {
		if (id) return this.sessions[id] ? [id, this.sessions[id]] : undefined;
		return Object.entries(this.sessions).sort(([, a], [, b]) => (a.updated < b.updated ? 1 : -1))[0];
	}

	/** A session's hints with their entries, in number order. Entries forgotten since are skipped. */
	hintsOf(s: SessionHints): { index: number; key: string; entry: Entry }[] {
		const all = new Map(this.glossary.all().map((e) => [keyOf(e.kind, e.term), e]));
		return Object.entries(s.hints)
			.map(([n, key]) => ({ index: Number(n), key, entry: all.get(key)! }))
			.filter((h) => h.entry)
			.sort((a, b) => a.index - b.index);
	}

	save(): void {
		const sessions = Object.fromEntries(
			Object.entries(this.sessions)
				.sort(([, a], [, b]) => (a.updated < b.updated ? 1 : -1))
				.slice(0, KEEP_SESSIONS),
		);
		const data: FileShape = { ...this.glossary.snapshot(), enabled: this.enabled, sessions };
		mkdirSync(dirname(this.path), { recursive: true });
		// Write then rename, so a hook killed halfway never leaves half a file.
		const tmp = `${this.path}.${process.pid}.tmp`;
		writeFileSync(tmp, `${JSON.stringify(data, null, "\t")}\n`);
		renameSync(tmp, this.path);
	}
}
