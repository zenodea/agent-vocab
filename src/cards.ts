/**
 * Which flashcards to ask: the entries most likely to have slipped. Kept free
 * of any terminal code so both the pi overlay and the Claude Code pane use it.
 */

import type { Entry } from "./glossary.ts";

const DAY = 86_400_000;

/** Higher means more worth asking. Exported for tests. */
export function priority(e: Entry, now: Date): number {
	const daysSinceSeen = Math.min(60, (now.getTime() - Date.parse(e.lastSeen)) / DAY);
	const daysSinceAsked = e.quiz.lastAsked ? Math.min(60, (now.getTime() - Date.parse(e.quiz.lastAsked)) / DAY) : 60;
	let score = e.lookups * 3 + e.quiz.missed * 4 + daysSinceSeen * 0.3 + (e.quiz.asked === 0 ? 3 : 0);
	// Asked very recently: let it rest.
	if (daysSinceAsked < 0.5) score -= 20;
	// Answered right more than missed: ease off.
	score -= Math.max(0, e.quiz.asked - e.quiz.missed) * 1.5;
	return score;
}

export function pickCards(entries: Entry[], n: number, now = new Date()): Entry[] {
	return entries
		.filter((e) => e.definition)
		.map((e) => ({ e, score: priority(e, now) }))
		.sort((a, b) => b.score - a.score)
		.slice(0, n)
		.map(({ e }) => e);
}
