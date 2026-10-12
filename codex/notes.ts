/**
 * Codex shows replies exactly as the model wrote them: no hook can rewrite
 * the text on screen. So in Codex the model writes the finished form itself,
 *
 *   A **closure**¹ keeps **scope**² alive.
 *
 *   [vocab-1]: # "closure | a function that remembers its surroundings"
 *   [vocab-2]: # "scope | where names are visible"
 *
 * and the definitions ride along as markdown link reference definitions,
 * which the Codex TUI does not draw. The Stop hook reads them back out of the
 * finished reply and files them in the glossary.
 */

import { isKind, type Kind } from "../src/glossary.ts";
import { recoverHints, superscript } from "../src/markers.ts";

/** The system-prompt section for Codex. Same rules as pi's, different output shape. */
export const CODEX_PROMPT = `## Jargon markers

The user has ADHD and forgets terminology, both programming concepts and names specific to this project. Help them by numbering terms:

- The first time a reply uses a term with a specific technical meaning, write it in bold followed by a superscript number: **closure**¹. Numbers run through the whole session: each new term takes the next number, and a term numbered before keeps its number whenever you bold it again.
- For every number that is new in this reply, add one line at the very end of the reply, after a blank line:
  [vocab-1]: # "closure | a function that remembers the variables around it after that code has finished"
  These are markdown link reference definitions: the user's screen does not show them, a lookup tool reads them. The definition is one plain sentence, at most 15 words, with no jargon and no double quotes inside it.
- Mark: programming concepts, even basic ones (variable, inheritance, recursion), design patterns, tools and libraries, acronyms, and names specific to this project (modules, services, internal nicknames).
- Other things worth remembering take a kind prefix inside the quotes, same shape, same limits:
  "concept: name | how it works, two short sentences with a tiny example, under 40 words" for a mechanism rather than a word, written in the reply as ***name***¹;
  "why: name | the reason" when a design or tool choice is explained;
  "where: name | path or module, and what it owns" when you say where something lives;
  "how: name | the steps or command" for a procedure the user will need again;
  "gotcha: name | what goes wrong and how to avoid it" for a trap worth remembering.
- When an entry is closely tied to another one you have numbered, add a link segment: "closure | definition | see: scope, callback". One or two links, only when the connection helps understanding.
- Do not mark: ordinary English, generic verbs (run, save, build), file paths, or a word whose meaning is obvious from the sentence it sits in.
- Aim for roughly 2 to 6 numbered terms in a typical reply. A long explanation may need 9; a one-line answer may need none. Never number inside code blocks, inline code or commands.
- The reader sees only the name and its number; the definition is hidden. So the sentence must still make sense on its own. Wrong: "**goroutines**¹." Right: "Goroutines do not wait for each other, so **goroutine cleanup**¹ matters."
- Never explain the numbering or the definition lines to the user.`;

/** Turned off mid-session: the model was told to number terms and should stop. */
export const OFF_NOTE = "Jargon markers are off for now: stop numbering terms and stop adding [vocab-N] lines.";

/** One line a reply carried for a new number. */
export interface Note {
	index: number;
	kind: Kind;
	term: string;
	definition?: string;
	related?: string[];
}

// [vocab-3]: # "kind: name | definition | see: a, b", with "…", '…' or (…) as the title.
const NOTE_LINE = /^[ \t]{0,3}\[vocab-(\d+)\]:[ \t]+\S+[ \t]+(?:"([^"\n]*)"|'([^'\n]*)'|\(([^()\n]*)\))[ \t]*$/gm;

/** Split `kind: name | definition | see: a, b`. An unknown prefix stays part of the name. */
export function parseNote(index: number, body: string): Note | undefined {
	const [head = "", ...rest] = body.split("|").map((s) => s.trim());
	let kind: Kind = "term";
	let term = head;
	const prefix = /^([a-z]+):\s*(.+)$/.exec(head);
	if (prefix && isKind(prefix[1]!)) {
		kind = prefix[1];
		term = prefix[2]!.trim();
	}
	if (!term) return undefined;
	const note: Note = { index, kind, term };
	for (const seg of rest) {
		if (!seg) continue;
		const link = /^(?:see|related|links?)\s*:\s*(.+)$/i.exec(seg);
		if (link) note.related = [...(note.related ?? []), ...link[1]!.split(/\s*,\s*/).filter(Boolean)];
		else note.definition ??= seg;
	}
	return note;
}

/**
 * Everything a finished reply numbered: its definition lines first, then any
 * bold name with a number but no line (a term numbered in an earlier reply,
 * or one the model forgot to define). One entry per number.
 */
export function readReply(text: string): Note[] {
	const notes = new Map<number, Note>();
	for (const m of text.matchAll(NOTE_LINE)) {
		const index = Number(m[1]);
		const note = parseNote(index, m[2] ?? m[3] ?? m[4] ?? "");
		if (index > 0 && note && !notes.has(index)) notes.set(index, note);
	}
	// Bold italic in the reply means a concept even without a line saying so.
	const concepts = new Set([...text.matchAll(/\*{3}[^*\n]+?\*{3}([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g)].map((m) => m[1]));
	for (const hint of recoverHints(text)) {
		if (notes.has(hint.index)) continue;
		const kind: Kind = concepts.has(superscript(hint.index)) ? "concept" : "term";
		notes.set(hint.index, { index: hint.index, kind, term: hint.term });
	}
	return [...notes.values()].sort((a, b) => a.index - b.index);
}

/** The per-turn reminder that keeps numbers continuous: what is taken, what comes next. */
export function numbersSoFar(hints: { index: number; term: string }[]): string | undefined {
	if (hints.length === 0) return undefined;
	const sorted = [...hints].sort((a, b) => a.index - b.index);
	const next = sorted[sorted.length - 1]!.index + 1;
	// The newest ones are the likeliest to come up again; keep the line short.
	const shown = sorted.slice(-40).map((h) => `${superscript(h.index)} ${h.term}`);
	return `Jargon numbers taken this session: ${shown.join(", ")}. Reuse these numbers for these terms; the next new term is ${superscript(next)}.`;
}
