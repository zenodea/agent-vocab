#!/usr/bin/env node
/**
 * vocab for Codex: the hooks Codex runs, and the command you run beside it.
 *
 *   vocab hook start|prompt|stop   Codex hooks (stdin: the hook's JSON)
 *   vocab                          this session's hints
 *   vocab 3 | vocab closure        one hint by number, or search the glossary
 *   vocab quiz [n]                 flashcards in the terminal
 *   vocab export [path] [--force]  GLOSSARY.md for the project
 *   vocab on|off|toggle|count      marking switch and numbers
 *   vocab forget <term>
 *   vocab install|uninstall        add or remove the hooks in ~/.codex/hooks.json
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { pickCards } from "../src/cards.ts";
import { isOurs, renderGlossary } from "../src/export.ts";
import { type Entry, KIND_GLYPH, KIND_LABEL, keyOf } from "../src/glossary.ts";
import { fromSuperscript, superscript } from "../src/markers.ts";
import { clip, wrap } from "../src/text.ts";
import { CODEX_PROMPT, numbersSoFar, OFF_NOTE, readReply } from "./notes.ts";
import { Store } from "./store.ts";

export interface Io {
	store: Store;
	out: (text: string) => void;
	/** The hook's JSON, for `vocab hook ...`. */
	stdin?: string;
	cwd?: string;
	color?: boolean;
	columns?: number;
	hooksFile?: string;
	script?: string;
}

interface HookInput {
	session_id?: string;
	cwd?: string;
	source?: string;
	last_assistant_message?: string | null;
}

// ── hooks ───────────────────────────────────────────────────────────────

/** Session start, every source: compact and clear lose the instructions, so give them again. */
function hookStart(io: Io, input: HookInput): string {
	const { store } = io;
	const s = store.session(input.session_id ?? "unknown", input.cwd);
	s.prompted = store.enabled;
	store.save();
	if (!store.enabled) return "";
	const numbers = numbersSoFar(store.hintsOf(s).map((h) => ({ index: h.index, term: h.entry.term })));
	return numbers ? `${CODEX_PROMPT}\n\n${numbers}` : CODEX_PROMPT;
}

/** Every prompt: keep the numbering continuous, and catch a toggle made since the last one. */
function hookPrompt(io: Io, input: HookInput): string {
	const { store } = io;
	const s = store.session(input.session_id ?? "unknown", input.cwd);
	const numbers = numbersSoFar(store.hintsOf(s).map((h) => ({ index: h.index, term: h.entry.term })));
	let text = "";
	if (store.enabled && !s.prompted) {
		text = numbers ? `${CODEX_PROMPT}\n\n${numbers}` : CODEX_PROMPT;
		s.prompted = true;
	} else if (store.enabled) {
		text = numbers ?? "";
	} else if (s.prompted) {
		text = OFF_NOTE;
		s.prompted = false;
	}
	store.save();
	return text;
}

/** The reply is finished: file what it numbered. Stop hooks must answer with JSON. */
function hookStop(io: Io, input: HookInput): string {
	const { store } = io;
	const text = input.last_assistant_message ?? "";
	if (!text.includes("[vocab-") && !/\*\*[⁰¹²³⁴⁵⁶⁷⁸⁹]/.test(text)) return "{}";
	const s = store.session(input.session_id ?? "unknown", input.cwd);
	for (const note of readReply(text)) {
		const taken = s.hints[note.index];
		// A number the session already has, mentioned again without a line: nothing new.
		if (taken && !note.definition) continue;
		const entry = store.glossary.record(note.term, note.definition, { kind: note.kind, related: note.related });
		s.hints[note.index] = keyOf(entry.kind, entry.term);
	}
	store.save();
	return "{}";
}

// ── drawing ─────────────────────────────────────────────────────────────

function paint(io: Io) {
	const on = io.color ?? false;
	const sgr = (open: string, close: string) => (s: string) => (on ? `\x1b[${open}m${s}\x1b[${close}m` : s);
	return { bold: sgr("1", "22"), italic: sgr("3", "23"), dim: sgr("2", "22") };
}

/** The name as the reply showed it: concepts in bold italic. */
function name(io: Io, e: Entry): string {
	const p = paint(io);
	return e.kind === "concept" ? p.italic(p.bold(e.term)) : p.bold(e.term);
}

function detail(io: Io, e: Entry, index?: number): string {
	const p = paint(io);
	const width = Math.min(io.columns ?? 80, 100) - 2;
	const head = `${index ? `${superscript(index)} ` : ""}${name(io, e)}  ${p.italic(p.dim(KIND_LABEL[e.kind]))}`;
	const body = e.definition ? wrap(e.definition, width).map((l) => `  ${l}`) : [p.italic(p.dim("  no definition yet"))];
	const see = e.related.length ? [`  ${p.dim("see:")} ${e.related.join(", ")}`] : [];
	return [head, ...body, ...see].join("\n");
}

function row(io: Io, e: Entry, label: string, termWidth = 0): string {
	const p = paint(io);
	const glyph = KIND_GLYPH[e.kind] || " ";
	const pad = " ".repeat(Math.max(0, termWidth - e.term.length));
	const room = (io.columns ?? 80) - 8 - Math.max(termWidth, e.term.length);
	const def = room > 8 && e.definition ? `  ${p.dim(clip(e.definition, room))}` : "";
	return `${label.padStart(3)} ${glyph} ${name(io, e)}${pad}${def}`;
}

/** Rows lined up on the longest name, within reason. */
const rows = (io: Io, items: { entry: Entry; label: string }[]): string[] => {
	const width = Math.min(24, Math.max(0, ...items.map((i) => i.entry.term.length)));
	return items.map((i) => row(io, i.entry, i.label, width));
};

// ── commands ────────────────────────────────────────────────────────────

function list(io: Io): string {
	const { store } = io;
	const p = paint(io);
	const latest = store.latest();
	const hints = latest ? store.hintsOf(latest[1]) : [];
	if (hints.length > 0) {
		const where = latest![1].cwd ? ` in ${latest![1].cwd.replace(homedir(), "~")}` : "";
		return [p.italic(p.dim(`latest Codex session${where}, ${hints.length} hints`)), ...rows(io, hints.map((h) => ({ entry: h.entry, label: superscript(h.index) })))].join("\n");
	}
	const recent = store.glossary.all().slice(0, 15);
	if (recent.length === 0) return p.italic("The glossary is empty. Hints appear after Codex's next reply that numbers a term.");
	return [p.italic(p.dim(`no hints this session yet; the ${recent.length} newest glossary entries`)), ...rows(io, recent.map((entry) => ({ entry, label: "" })))].join("\n");
}

/** A number picks this session's hint; a word looks the glossary up. Opening an entry counts as a lookup. */
function lookup(io: Io, query: string): string {
	const { store } = io;
	const n = /^\d+$/.test(query) ? Number(query) : fromSuperscript(query);
	if (n > 0) {
		const latest = store.latest();
		const hint = latest ? store.hintsOf(latest[1]).find((h) => h.index === n) : undefined;
		if (!hint) return `No hint ${superscript(n)} in the latest Codex session.`;
		store.glossary.lookup(hint.entry.term, hint.entry.kind);
		store.save();
		return detail(io, hint.entry, n);
	}
	const exact = store.glossary.get(query);
	const q = query.toLowerCase();
	const found = exact ? [exact] : store.glossary.all().filter((e) => e.term.toLowerCase().includes(q) || e.definition.toLowerCase().includes(q));
	if (found.length === 0) return `Nothing in the glossary matches "${query}".`;
	if (found.length > 1) return rows(io, found.slice(0, 20).map((entry) => ({ entry, label: "" }))).join("\n");
	const e = found[0]!;
	store.glossary.lookup(e.term, e.kind);
	store.save();
	return detail(io, e);
}

function exportGlossary(io: Io, args: string[]): string {
	const force = args.includes("--force");
	const target = resolve(io.cwd ?? process.cwd(), args.find((a) => a !== "--force") ?? "GLOSSARY.md");
	if (existsSync(target) && !force && !isOurs(readFileSync(target, "utf8"))) {
		return `${target} exists and was not written by vocab. Add --force to overwrite it.`;
	}
	const entries = io.store.glossary.all();
	writeFileSync(target, renderGlossary(entries));
	return `Wrote ${entries.length} entries to ${target}.`;
}

function count(io: Io): string {
	const latest = io.store.latest();
	const n = latest ? io.store.hintsOf(latest[1]).length : 0;
	return `${n} hints in the latest session, ${io.store.glossary.size} in the glossary${io.store.enabled ? "" : " (marking is off)"}`;
}

// ── install ─────────────────────────────────────────────────────────────

type HookGroup = { matcher?: string; hooks: { type: string; command: string; timeout?: number }[] };
const EVENTS = { SessionStart: "start", UserPromptSubmit: "prompt", Stop: "stop" } as const;
const ours = (g: HookGroup) => g.hooks.some((h) => /vocab\.ts['"]? hook /.test(h.command));

function install(io: Io, add: boolean): string {
	const file = io.hooksFile ?? join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "hooks.json");
	const raw = existsSync(file) ? readFileSync(file, "utf8") : "";
	const data = (raw ? JSON.parse(raw) : {}) as { hooks?: Record<string, HookGroup[]> };
	const hooks = (data.hooks ??= {});
	for (const [event, arg] of Object.entries(EVENTS)) {
		const kept = (hooks[event] ?? []).filter((g) => !ours(g));
		if (add) kept.push({ hooks: [{ type: "command", command: `node '${io.script}' hook ${arg}`, timeout: 10 }] });
		if (kept.length) hooks[event] = kept;
		else delete hooks[event];
	}
	const next = `${JSON.stringify(data, null, 2)}\n`;
	if (next === raw) return add ? "The vocab hooks are already installed." : "No vocab hooks to remove.";
	if (raw) writeFileSync(`${file}.bak-vocab`, raw);
	writeFileSync(file, next);
	return add
		? `Added the vocab hooks to ${file}. In Codex, run /hooks and trust them: Codex skips new hooks until you do.`
		: `Removed the vocab hooks from ${file}.`;
}

// ── quiz ────────────────────────────────────────────────────────────────

async function quiz(io: Io, n: number): Promise<string> {
	const { store } = io;
	const p = paint(io);
	const cards = pickCards(store.glossary.all(), n);
	if (cards.length === 0) return "No entries with definitions to quiz on yet.";
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	let missed = 0;
	try {
		for (const [i, card] of cards.entries()) {
			io.out(`\n${p.italic(p.dim(`card ${i + 1} of ${cards.length}`))}`);
			// Terms: the definition asks for the name. Everything else: the name asks for the idea.
			io.out(card.kind === "term" ? `  ${card.definition}\n  ${p.italic("what is it called?")}` : `  ${name(io, card)}  ${p.italic(p.dim(KIND_LABEL[card.kind]))}\n  ${p.italic("say it in your own words")}`);
			await rl.question(p.dim("  enter to reveal "));
			io.out(card.kind === "term" ? `  ${name(io, card)}` : wrap(card.definition, 76).map((l) => `  ${l}`).join("\n"));
			const answer = (await rl.question(p.dim("  got it? [y/n] "))).trim().toLowerCase();
			const miss = answer.startsWith("n");
			if (miss) missed += 1;
			store.glossary.recordQuiz(card, miss);
			store.save();
		}
	} finally {
		rl.close();
	}
	return `\n${p.italic(`${cards.length - missed} of ${cards.length} stuck.`)}`;
}

// ── entry ───────────────────────────────────────────────────────────────

export async function main(argv: string[], io: Io): Promise<string> {
	const [cmd = "", ...rest] = argv;
	const { store } = io;
	switch (cmd) {
		case "hook": {
			let input: HookInput = {};
			try {
				input = JSON.parse(io.stdin || "{}") as HookInput;
			} catch {
				// Codex sent something unexpected; answer harmlessly.
			}
			try {
				if (rest[0] === "start") return hookStart(io, input);
				if (rest[0] === "prompt") return hookPrompt(io, input);
				if (rest[0] === "stop") return hookStop(io, input);
			} catch {
				// A broken glossary must never break the turn.
			}
			return rest[0] === "stop" ? "{}" : "";
		}
		case "":
			return list(io);
		case "on":
		case "off":
		case "toggle":
			store.enabled = cmd === "toggle" ? !store.enabled : cmd === "on";
			store.save();
			return `Jargon markers ${store.enabled ? "on" : "off"}. Codex picks this up at your next prompt.`;
		case "count":
			return count(io);
		case "forget": {
			const term = rest.join(" ").trim();
			if (!term) return "Usage: vocab forget <term>";
			const removed = store.glossary.forget(term);
			if (removed) store.save();
			return removed ? `Forgot "${term}".` : `"${term}" is not in the glossary.`;
		}
		case "export":
			return exportGlossary(io, rest);
		case "install":
		case "uninstall":
			return install(io, cmd === "install");
		case "quiz":
			return quiz(io, Number(rest[0]) || 5);
		case "help":
		case "--help":
		case "-h":
			return readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]!.replace(/^#!.*\n\/\*\*\n/, "").replace(/^ \* ?/gm, "");
		default:
			return lookup(io, argv.join(" ").trim());
	}
}

async function readStdin(): Promise<string> {
	if (process.stdin.isTTY) return "";
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString("utf8");
}

if (import.meta.main) {
	const argv = process.argv.slice(2);
	const io: Io = {
		store: new Store(),
		out: (text) => process.stdout.write(`${text}\n`),
		stdin: argv[0] === "hook" ? await readStdin() : "",
		cwd: process.cwd(),
		color: process.stdout.isTTY && !process.env.NO_COLOR,
		columns: process.stdout.columns,
		script: import.meta.filename,
	};
	const text = await main(argv, io);
	if (text) io.out(text);
}
