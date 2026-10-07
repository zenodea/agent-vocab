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
 * `[[term]]` with no definition means "already explained before": it still gets
 * a hint, the definition comes from the glossary. Everything renders the same
 * way, **name** plus a superscript digit, so the reply does not get busier.
 */

import { isKind, type Kind } from "./glossary.ts";

export interface Marker {
	kind: Kind;
	term: string;
	definition?: string;
}

export interface Hint {
	/** 1-based, shown as a superscript. Stable within one reply. */
	index: number;
	kind: Kind;
	term: string;
	definition?: string;
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

const SUPERSCRIPT = ["", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];
export const MAX_HINTS = 9;

export const superscript = (n: number): string => SUPERSCRIPT[n] ?? "";

// [[name]], [[name|definition]], [[kind: name|definition]]. No nesting, no newlines.
const MARKER = /\[\[(?:([a-z]+):\s*)?([^\[\]|\n]+?)(?:\|([^\[\]\n]+?))?\]\]/g;

// Fenced code blocks are left alone even when the model slips a marker in.
const FENCE = /(^|\n)(```|~~~)[^\n]*\n[\s\S]*?\n\2[ \t]*(?=\n|$)/g;

// Spans the highlight pass must not touch: inline code, links, existing hints.
const PROTECTED = /`[^`\n]*`|\*\*[^*\n]+\*\*[¹²³⁴⁵⁶⁷⁸⁹]?|\[[^\]\n]*\]\([^)\n]*\)|https?:\/\/\S+/g;

export const normalizeTerm = (term: string): string => term.trim().toLowerCase().replace(/\s+/g, " ");

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
	return { kind, term, definition: rawDef?.trim() || undefined };
}

/** Pull markers out of text without changing it. */
export function findMarkers(text: string): Marker[] {
	const out: Marker[] = [];
	for (const m of text.matchAll(MARKER)) {
		const marker = parseMarker(m[1], m[2]!, m[3]);
		if (marker) out.push(marker);
	}
	return out;
}

/** One regex matching any of the names as whole words, longest first, with an optional plural s. */
function termPattern(terms: string[]): RegExp | undefined {
	const parts = [...new Set(terms.map(normalizeTerm).filter(Boolean))]
		.sort((a, b) => b.length - a.length)
		.map((t) => escapeRegExp(t).replace(/ /g, "\\s+"));
	if (parts.length === 0) return undefined;
	return new RegExp(`(?<![\\w-])(?:${parts.join("|")})(?:e?s)?(?![\\w-])`, "gi");
}

/**
 * Replace markers with bold names carrying a superscript number. `startIndex`
 * lets several messages in the same turn continue the same numbering, and
 * `known` lets a name reuse its number when it shows up again.
 *
 * Afterwards every plain mention of a hinted name, or of a term or concept in
 * `glossary`, gets the same treatment, so a word is never numbered in one
 * sentence and bare in the next. Project kinds (why, where, how, gotcha) are
 * only numbered when marked, since their names are often ordinary words.
 * Code, links and existing hints are left alone.
 */
export function rewrite(
	text: string,
	startIndex = 1,
	known: Map<string, Hint> = new Map(),
	glossary: KnownTerm[] = [],
): Rewrite {
	const hints: Hint[] = [];
	let next = startIndex;
	const byKey = new Map<string, KnownTerm>();
	for (const g of glossary) {
		if (g.kind === "term" || g.kind === "concept") byKey.set(normalizeTerm(g.term), g);
	}

	const transform = (chunk: string): string =>
		chunk.replace(MARKER, (_whole, prefix: string | undefined, rawTerm: string, rawDef?: string) => {
			const marker = parseMarker(prefix, rawTerm, rawDef);
			if (!marker) return "";
			const key = normalizeTerm(marker.term);
			let hint = known.get(key);
			if (!hint) {
				if (next > MAX_HINTS) return `**${marker.term}**`;
				hint = { index: next++, kind: marker.kind, term: marker.term, definition: marker.definition };
				known.set(key, hint);
				hints.push(hint);
			} else if (!hint.definition && marker.definition) {
				hint.definition = marker.definition;
			}
			return `**${marker.term}**${superscript(hint.index)}`;
		});

	// Plain mentions of known or glossary names, outside protected spans.
	const highlight = (chunk: string): string => {
		const pattern = termPattern([...known.keys(), ...byKey.keys()]);
		if (!pattern) return chunk;
		const mark = (plain: string): string =>
			plain.replace(pattern, (word: string) => {
				// Undo the plural we allowed so the lookup key matches.
				const key = normalizeTerm(word);
				const base =
					[key, key.replace(/s$/, ""), key.replace(/es$/, "")].find((k) => known.has(k) || byKey.has(k)) ?? key;
				let hint = known.get(base);
				if (!hint) {
					const g = byKey.get(base);
					if (!g) return word;
					if (next > MAX_HINTS) return `**${word}**`;
					hint = { index: next++, kind: g.kind, term: g.term, definition: g.definition };
					known.set(base, hint);
					hints.push(hint);
				}
				return `**${word}**${superscript(hint.index)}`;
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

	return { text: out, hints };
}

/**
 * Read hints back out of an already rendered reply, for example when a session
 * is resumed and the last reply has to be re-indexed. Definitions and kinds are
 * not in the text any more; the caller fills them from the glossary.
 */
export function recoverHints(text: string): Hint[] {
	const found = new Map<number, Hint>();
	for (const m of text.matchAll(/\*\*([^*\n]+?)\*\*([¹²³⁴⁵⁶⁷⁸⁹])/g)) {
		const index = SUPERSCRIPT.indexOf(m[2]!);
		if (index > 0 && !found.has(index)) found.set(index, { index, kind: "term", term: m[1]!.trim() });
	}
	return [...found.values()].sort((a, b) => a.index - b.index);
}
