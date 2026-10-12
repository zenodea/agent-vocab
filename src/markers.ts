/**
 * Markers are what the model writes; hints are what the user sees.
 *
 *   model:  A [[closure|a function that remembers its surroundings]] is handy.
 *   shown:  A **closure**¹ is handy.
 *
 * A kind prefix makes it something other than a term:
 *
 *   [[concept: auth here|a token in a cookie, checked by middleware]]
 *   [[why: SQLite|single-user app, nothing to host]]
 *   [[where: scheduler|internal/sched owns every timer]]
 *   [[how: run tests|make test, with the db container up]]
 *   [[gotcha: seeding|run migrations first or seeding silently fails]]
 *
 * A third segment links entries: [[closure|def|see: scope, callback]].
 *
 * `[[term]]` with no definition means "already explained before": it still gets
 * a hint, the definition comes from the glossary. Everything renders the same
 * way, **name** plus a superscript digit, so the reply does not get busier.
 */

import { isKind, type Kind, normalize } from "./glossary.ts";

export interface Marker {
	kind: Kind;
	term: string;
	definition?: string;
	/** Names of entries this one connects to. */
	related?: string[];
}

export interface Hint {
	/** 1-based, shown as a superscript. Stable for the whole session. */
	index: number;
	kind: Kind;
	term: string;
	definition?: string;
	related?: string[];
}

export interface Rewrite {
	text: string;
	hints: Hint[];
}

/** An entry the glossary already knows; plain mentions of it get numbered too. */
export interface KnownTerm {
	kind: Kind;
	term: string;
	definition?: string;
}

const SUPERSCRIPT_DIGITS = ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];

// Raw ANSI that pi's markdown renderer passes through untouched.
const UNDERLINE = "\x1b[4m";
const CURLY = "\x1b[4:3m";
const UNDERLINE_OFF = "\x1b[24m";

/** Any SGR sequence, for stripping before text reaches the model. */
export const ANSI = /\x1b\[[0-9;:]*m/g;
export const stripAnsi = (s: string): string => s.replace(ANSI, "");

/**
 * How a hinted name looks in the reply, per kind. Bold is markdown; the
 * underlines are raw ANSI, stripped again before the model sees the text.
 *
 *   term     **name**
 *   concept  ***name***            bold italic
 *   why/where/how  **name** underlined
 *   gotcha   **name** curly underline
 *
 * Without `ansi` (hosts that refuse control characters in reply text) the
 * underlined kinds fall back to plain bold.
 */
export function styleName(kind: Kind, name: string, ansi = true): string {
	if (!ansi && kind !== "concept") return `**${name}**`;
	switch (kind) {
		case "concept":
			return `***${name}***`;
		case "gotcha":
			return `**${CURLY}${name}${UNDERLINE_OFF}**`;
		case "why":
		case "where":
		case "how":
			return `**${UNDERLINE}${name}${UNDERLINE_OFF}**`;
		default:
			return `**${name}**`;
	}
}

/** 12 → ¹². Numbers are per session, so they can grow past nine. */
export const superscript = (n: number): string =>
	n > 0 ? String(n).split("").map((d) => SUPERSCRIPT_DIGITS[Number(d)] ?? "").join("") : "";

/** ¹² → 12, or 0 when the text is not a superscript number. */
export const fromSuperscript = (s: string): number => {
	let out = "";
	for (const ch of s) {
		const d = SUPERSCRIPT_DIGITS.indexOf(ch);
		if (d < 0) return 0;
		out += d;
	}
	return out ? Number(out) : 0;
};

// [[name]], [[name|definition]], [[kind: name|definition]]. No nesting, no newlines.
const MARKER = /\[\[(?:([a-z]+):\s*)?([^\[\]|\n]+?)(?:\|([^\[\]\n]+?))?\]\]/g;

// Fenced code blocks are left alone even when the model slips a marker in.
const FENCE = /(^|\n)(```|~~~)[^\n]*\n[\s\S]*?\n\2[ \t]*(?=\n|$)/g;

// Spans the highlight pass must not touch: inline code, links, existing hints.
const PROTECTED = /`[^`\n]*`|\*{2,3}[^*\n]+\*{2,3}[⁰¹²³⁴⁵⁶⁷⁸⁹]*|\[[^\]\n]*\]\([^)\n]*\)|https?:\/\/\S+/g;

// While streaming, an unfinished marker at the very end of the text.
const OPEN_MARKER = /\[\[(?:([a-z]+):\s*)?([^\[\]|\n]*)(?:\|([^\[\]\n]*))?$/;

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Parse a marker's pieces. An unknown prefix is kept as part of the name. */
function parseMarker(prefix: string | undefined, rawTerm: string, rawDef: string | undefined): Marker | undefined {
	let kind: Kind = "term";
	let term = rawTerm.trim();
	if (prefix) {
		if (isKind(prefix)) kind = prefix;
		else term = `${prefix}: ${term}`;
	}
	if (!term) return undefined;
	// The definition may carry a trailing "|see: a, b" segment.
	let definition: string | undefined;
	let related: string[] | undefined;
	for (const part of (rawDef ?? "").split("|")) {
		const seg = part.trim();
		if (!seg) continue;
		const link = /^(?:see|related|links?)\s*:\s*(.+)$/i.exec(seg);
		if (link) {
			related = [...(related ?? []), ...link[1]!.split(/\s*,\s*/).map((r) => r.trim()).filter(Boolean)];
		} else if (!definition) {
			definition = seg;
		}
	}
	const marker: Marker = { kind, term, definition };
	if (related) marker.related = related;
	return marker;
}

/** One regex matching any of the names as whole words, longest first, with an optional plural s. */
function termPattern(terms: string[]): RegExp | undefined {
	const parts = [...new Set(terms.map(normalize).filter(Boolean))]
		.sort((a, b) => b.length - a.length)
		.map((t) => escapeRegExp(t).replace(/ /g, "\\s+"));
	if (parts.length === 0) return undefined;
	return new RegExp(`(?<![\\w-])(?:${parts.join("|")})(?:e?s)?(?![\\w-])`, "gi");
}

export interface RewriteOptions {
	/** Entries already numbered, keyed by normalized name. New ones are added here. */
	known?: Map<string, Hint>;
	/** Entries the glossary knows; plain mentions of terms and concepts get numbered too. */
	glossary?: KnownTerm[];
	/**
	 * The text is still arriving. An unfinished marker at the end is shown as
	 * its bold name once the name is complete, and hidden before that.
	 */
	streaming?: boolean;
	/** Underline the project kinds with raw ANSI. On by default. */
	ansi?: boolean;
}

/**
 * Replace markers with styled names carrying a superscript number. Numbers
 * continue from the highest one in `known`, and a name that is already known
 * keeps its number.
 *
 * Afterwards every plain mention of a hinted name, or of a term or concept in
 * `glossary`, gets the same treatment, so a word is never numbered in one
 * sentence and bare in the next. Project kinds (why, where, how, gotcha) are
 * only numbered when marked, since their names are often ordinary words.
 * Code, links and existing hints are left alone.
 */
export function rewrite(text: string, options: RewriteOptions = {}): Rewrite {
	const known = options.known ?? new Map<string, Hint>();
	const ansi = options.ansi ?? true;
	const hints: Hint[] = [];
	let next = 1;
	for (const h of known.values()) if (h.index >= next) next = h.index + 1;

	// Hold back an unfinished trailing marker so it never shows raw.
	let tail = "";
	if (options.streaming) {
		const open = OPEN_MARKER.exec(text);
		if (open && !text.slice(open.index).includes("]]")) {
			const name = open[2]?.trim();
			// Name complete once the "|" has arrived; before that show nothing.
			const kind = open[1] && isKind(open[1]) ? open[1] : "term";
			tail = open[3] !== undefined && name ? styleName(kind, name, ansi) : "";
			text = text.slice(0, open.index);
		}
	}
	const byKey = new Map<string, KnownTerm>();
	for (const g of options.glossary ?? []) {
		if (g.kind === "term" || g.kind === "concept") byKey.set(normalize(g.term), g);
	}

	/** Give a name the next number and remember it. */
	const add = (key: string, kind: Kind, term: string, definition?: string): Hint => {
		const hint: Hint = { index: next++, kind, term, definition };
		known.set(key, hint);
		hints.push(hint);
		return hint;
	};

	const transform = (chunk: string): string =>
		chunk.replace(MARKER, (_whole, prefix: string | undefined, rawTerm: string, rawDef?: string) => {
			const marker = parseMarker(prefix, rawTerm, rawDef);
			if (!marker) return "";
			const key = normalize(marker.term);
			let hint = known.get(key);
			if (!hint) {
				hint = add(key, marker.kind, marker.term, marker.definition);
				if (marker.related) hint.related = marker.related;
			} else {
				if (!hint.definition && marker.definition) hint.definition = marker.definition;
				if (marker.related) hint.related = [...new Set([...(hint.related ?? []), ...marker.related])];
			}
			return `${styleName(hint.kind, marker.term, ansi)}${superscript(hint.index)}`;
		});

	// Plain mentions of known or glossary names, outside protected spans.
	const highlight = (chunk: string): string => {
		const pattern = termPattern([...known.keys(), ...byKey.keys()]);
		if (!pattern) return chunk;
		const mark = (plain: string): string =>
			plain.replace(pattern, (word: string) => {
				// Undo the plural we allowed so the lookup key matches.
				const key = normalize(word);
				const base =
					[key, key.replace(/s$/, ""), key.replace(/es$/, "")].find((k) => known.has(k) || byKey.has(k)) ?? key;
				let hint = known.get(base);
				if (!hint) {
					const g = byKey.get(base);
					if (!g) return word;
					hint = add(base, g.kind, g.term, g.definition);
				}
				return `${styleName(hint.kind, word, ansi)}${superscript(hint.index)}`;
			});
		let out = "";
		let last = 0;
		for (const m of chunk.matchAll(PROTECTED)) {
			out += mark(chunk.slice(last, m.index!));
			out += m[0];
			last = m.index! + m[0].length;
		}
		return out + mark(chunk.slice(last));
	};

	// Walk the text, leaving fenced blocks untouched.
	let out = "";
	let last = 0;
	for (const fence of text.matchAll(FENCE)) {
		const start = fence.index!;
		out += highlight(transform(text.slice(last, start)));
		out += fence[0];
		last = start + fence[0].length;
	}
	out += highlight(transform(text.slice(last)));

	return { text: out + tail, hints };
}

/**
 * Read hints back out of an already rendered reply, for example when a session
 * is resumed and the last reply has to be re-indexed. Definitions and kinds are
 * not in the text any more; the caller fills them from the glossary.
 */
export function recoverHints(text: string): Hint[] {
	const found = new Map<number, Hint>();
	for (const m of text.matchAll(/\*{2,3}([^*\n]+?)\*{2,3}([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g)) {
		const index = fromSuperscript(m[2]!);
		if (index > 0 && !found.has(index)) found.set(index, { index, kind: "term", term: stripAnsi(m[1]!).trim() });
	}
	return [...found.values()].sort((a, b) => a.index - b.index);
}
