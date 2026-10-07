/**
 * Flashcards. Picks the entries most likely to have slipped: looked up often,
 * missed before, not seen for a while, never asked. Self-graded, like Anki:
 * reveal, then "got it" or "missed". Terms show the definition and ask for the
 * name; everything else shows the name and asks you to say it in your own words.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, matchesKey } from "@earendil-works/pi-tui";
import { type Entry, KIND_GLYPH, KIND_LABEL } from "./glossary.ts";
import { clip, wrap } from "./text.ts";

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

export interface QuizResult {
	asked: Entry[];
	missed: Entry[];
}

type Phase = "front" | "back" | "done";

export class QuizOverlay implements Component {
	focused = false;
	private i = 0;
	private phase: Phase = "front";
	private readonly asked: Entry[] = [];
	private readonly missed: Entry[] = [];
	private readonly theme: Theme;
	private readonly cards: Entry[];
	private readonly done: (result: QuizResult) => void;
	private readonly width: number;

	constructor(theme: Theme, cards: Entry[], done: (result: QuizResult) => void, width = 72) {
		this.theme = theme;
		this.cards = cards;
		this.done = done;
		this.width = width;
		if (cards.length === 0) this.phase = "done";
	}

	invalidate(): void {}

	private finish(): void {
		this.done({ asked: this.asked, missed: this.missed });
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.finish();
			return;
		}
		const card = this.cards[this.i];
		if (this.phase === "done" || !card) {
			if (matchesKey(data, "return") || matchesKey(data, "space")) this.finish();
			return;
		}
		if (this.phase === "front") {
			if (matchesKey(data, "space") || matchesKey(data, "return")) this.phase = "back";
			return;
		}
		// back: grade it
		const got = data === "y" || data === "1" || matchesKey(data, "return");
		const miss = data === "n" || data === "2";
		if (!got && !miss) return;
		this.asked.push(card);
		if (miss) this.missed.push(card);
		this.i += 1;
		this.phase = this.i < this.cards.length ? "front" : "done";
	}

	render(width: number): string[] {
		const t = this.theme;
		const w = Math.max(30, Math.min(this.width, width));
		const inner = w - 4;
		const border = (s: string) => t.fg("border", s);
		const row = (s: string) => `${border("│")} ${s}${" ".repeat(Math.max(0, inner - visibleLen(s)))} ${border("│")}`;
		const lines: string[] = [];
		const title = t.bold(t.fg("accent", ` vocab quiz ${this.phase === "done" ? "" : `${this.i + 1}/${this.cards.length} `}`));
		lines.push(border("╭─") + title + border("─".repeat(Math.max(0, w - 3 - visibleLen(title)))) + border("╮"));

		const card = this.cards[this.i];
		if (this.phase === "done" || !card) {
			const n = this.asked.length;
			const right = n - this.missed.length;
			lines.push(row(n === 0 ? t.fg("muted", "nothing to quiz yet: terms appear as the agent explains them") : `${t.bold(`${right}/${n}`)} ${t.fg("muted", "right")}`));
			if (this.missed.length) {
				lines.push(row(t.fg("dim", "missed: ") + t.fg("warning", clip(this.missed.map((e) => e.term).join(", "), inner - 8))));
			}
			lines.push(row(t.fg("dim", "enter close")));
		} else {
			const kind = card.kind === "term" ? "" : t.fg("warning", ` ${KIND_GLYPH[card.kind]} ${KIND_LABEL[card.kind]}`);
			if (this.phase === "front") {
				if (card.kind === "term") {
					lines.push(row(t.fg("muted", "what is this called?")));
					for (const l of wrap(card.definition, inner)) lines.push(row(l));
				} else {
					lines.push(row(t.fg("muted", "say it in your own words:")));
					lines.push(row(t.bold(t.fg("accent", card.term)) + kind));
				}
				lines.push(row(""));
				lines.push(row(t.fg("dim", "space reveal · esc quit")));
			} else {
				lines.push(row(t.bold(t.fg("accent", card.term)) + kind));
				for (const l of wrap(card.definition, inner)) lines.push(row(l));
				if (card.related.length) lines.push(row(t.fg("dim", "see: ") + t.fg("accent", clip(card.related.join(", "), inner - 5))));
				lines.push(row(""));
				lines.push(row(t.fg("dim", "y got it · n missed · esc quit")));
			}
		}
		lines.push(border("╰") + border("─".repeat(w - 2)) + border("╯"));
		return lines;
	}
}

/** Width of a styled string without its ANSI codes. */
function visibleLen(s: string): number {
	// eslint-disable-next-line no-control-regex
	return [...s.replace(/\x1b\[[0-9;]*m/g, "")].length;
}
