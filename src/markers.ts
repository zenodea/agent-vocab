/**
 * Markers are what the model writes; hints are what the user sees.
 *
 *   model:  A [[closure|a function that remembers its surroundings]] is handy.
 *   shown:  A **closure**¹ is handy.
 *
 * `[[term]]` with no definition means "already explained before": it still gets
 * a hint, the definition comes from the glossary.
 */

export interface Marker {
	term: string;
	definition?: string;
}

export interface Hint {
	/** 1-based, shown as a superscript. Stable within one reply. */
	index: number;
	term: string;
	definition?: string;
}

export interface Rewrite {
	text: string;
	hints: Hint[];
}

const SUPERSCRIPT = ["", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];
export const MAX_HINTS = 9;

/** Pick the number back out of a rendered hint. */
export const superscript = (n: number): string => SUPERSCRIPT[n] ?? "";

// [[term]] or [[term|definition]]. No nesting, no newlines inside.
const MARKER = /\[\[([^\[\]|\n]+?)(?:\|([^\[\]\n]+?))?\]\]/g;

// Fenced code blocks are left alone even when the model slips a marker in.
const FENCE = /(^|\n)(```|~~~)[^\n]*\n[\s\S]*?\n\2[ \t]*(?=\n|$)/g;

export const normalizeTerm = (term: string): string => term.trim().toLowerCase().replace(/\s+/g, " ");

/** Pull markers out of text without changing it. */
export function findMarkers(text: string): Marker[] {
	const out: Marker[] = [];
	for (const m of text.matchAll(MARKER)) {
		const term = m[1]!.trim();
		if (!term) continue;
		out.push({ term, definition: m[2]?.trim() || undefined });
	}
	return out;
}

/**
 * Replace markers with bold terms carrying a superscript number. `startIndex`
 * lets several messages in the same turn continue the same numbering, and
 * `known` lets a term reuse its number when it shows up again.
 */
export function rewrite(text: string, startIndex = 1, known: Map<string, Hint> = new Map()): Rewrite {
	const hints: Hint[] = [];
	let next = startIndex;

	const transform = (chunk: string): string =>
		chunk.replace(MARKER, (_whole, rawTerm: string, rawDef?: string) => {
			const term = rawTerm.trim();
			if (!term) return "";
			const definition = rawDef?.trim() || undefined;
			const key = normalizeTerm(term);
			let hint = known.get(key);
			if (!hint) {
				if (next > MAX_HINTS) return `**${term}**`;
				hint = { index: next++, term, definition };
				known.set(key, hint);
				hints.push(hint);
			} else if (!hint.definition && definition) {
				hint.definition = definition;
			}
			return `**${term}**${superscript(hint.index)}`;
		});

	// Walk the text, leaving fenced blocks untouched.
	let out = "";
	let last = 0;
	for (const fence of text.matchAll(FENCE)) {
		const start = fence.index!;
		out += transform(text.slice(last, start));
		out += fence[0];
		last = start + fence[0].length;
	}
	out += transform(text.slice(last));

	return { text: out, hints };
}

/**
 * Read hints back out of an already rendered reply, for example when a session
 * is resumed and the last reply has to be re-indexed. Definitions are not in
 * the text any more; the caller fills them from the glossary.
 */
export function recoverHints(text: string): Hint[] {
	const found = new Map<number, Hint>();
	for (const m of text.matchAll(/\*\*([^*\n]+?)\*\*([¹²³⁴⁵⁶⁷⁸⁹])/g)) {
		const index = SUPERSCRIPT.indexOf(m[2]!);
		if (index > 0 && !found.has(index)) found.set(index, { index, term: m[1]!.trim() });
	}
	return [...found.values()].sort((a, b) => a.index - b.index);
}
