/**
 * The glossary overlay. Digits pick a hint from the last reply, typing filters
 * the whole glossary, up/down moves, enter or esc closes.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, fuzzyFilter, matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import type { Entry } from "./glossary.ts";
import type { Hint } from "./markers.ts";
import { superscript } from "./markers.ts";
import { clip, wrap } from "./text.ts";

export interface OverlayItem {
	term: string;
	definition: string;
	/** Set for terms from the last reply. */
	index?: number;
	entry?: Entry;
}

export interface OverlayOptions {
	hints: Hint[];
	glossary: Entry[];
	initialQuery?: string;
	/** Hint number (1-9) to land on when opening. */
	initialIndex?: number;
	/** Columns the overlay may use. */
	width?: number;
}

const MAX_ROWS = 9;

export class VocabOverlay implements Component {
	focused = false;
	private query: string;
	private selected = 0;
	private readonly width: number;
	private readonly byTerm = new Map<string, Entry>();

	private readonly theme: Theme;
	private readonly opts: OverlayOptions;
	private readonly done: (result: undefined) => void;

	constructor(theme: Theme, opts: OverlayOptions, done: (result: undefined) => void) {
		this.theme = theme;
		this.opts = opts;
		this.done = done;
		this.query = opts.initialQuery ?? "";
		this.width = opts.width ?? 72;
		if (opts.initialIndex) {
			const i = opts.hints.findIndex((h) => h.index === opts.initialIndex);
			if (i >= 0) this.selected = i;
		}
		for (const e of opts.glossary) this.byTerm.set(e.term.toLowerCase(), e);
	}

	/** What the list shows right now: last-reply hints, or glossary matches when filtering. */
	items(): OverlayItem[] {
		if (this.query.trim()) {
			const matches = fuzzyFilter(this.opts.glossary, this.query.trim(), (e) => e.term);
			return matches.slice(0, MAX_ROWS).map((entry) => ({ term: entry.term, definition: entry.definition, entry }));
		}
		return this.opts.hints.map((h) => {
			const entry = this.byTerm.get(h.term.toLowerCase());
			return {
				index: h.index,
				term: h.term,
				definition: h.definition ?? entry?.definition ?? "",
				entry,
			};
		});
	}

	/** Pi calls this when cached output must be dropped. Nothing is cached here. */
	invalidate(): void {}

	private clampSelection(items: OverlayItem[]): void {
		if (items.length === 0) this.selected = 0;
		else this.selected = Math.min(Math.max(0, this.selected), items.length - 1);
	}

	handleInput(data: string): void {
		// The key that opened the overlay closes it too, so alt+w is a toggle.
		if (
			matchesKey(data, "escape") ||
			matchesKey(data, "return") ||
			matchesKey(data, "ctrl+c") ||
			matchesKey(data, "alt+w")
		) {
			this.done(undefined);
			return;
		}
		if (matchesKey(data, "up") || matchesKey(data, "ctrl+p") || matchesKey(data, "ctrl+k")) {
			this.selected -= 1;
			return;
		}
		if (matchesKey(data, "down") || matchesKey(data, "ctrl+n") || matchesKey(data, "ctrl+j")) {
			this.selected += 1;
			return;
		}
		if (matchesKey(data, "backspace")) {
			this.query = this.query.slice(0, -1);
			this.selected = 0;
			return;
		}
		if (matchesKey(data, "ctrl+u")) {
			this.query = "";
			this.selected = 0;
			return;
		}
		// A digit picks a hint while the query is empty; otherwise it is typed.
		if (!this.query && /^[1-9]$/.test(data)) {
			const n = Number(data);
			const i = this.opts.hints.findIndex((h) => h.index === n);
			if (i >= 0) this.selected = i;
			return;
		}
		if (data.length >= 1 && !/[\x00-\x1f\x7f]/.test(data)) {
			this.query += data;
			this.selected = 0;
		}
	}

	render(width: number): string[] {
		const t = this.theme;
		const w = Math.max(30, Math.min(this.width, width));
		const inner = w - 4; // "│ " ... " │"
		const items = this.items();
		this.clampSelection(items);

		const border = (s: string) => t.fg("border", s);
		const row = (s: string) => `${border("│")} ${s}${" ".repeat(Math.max(0, inner - visibleWidth(s)))} ${border("│")}`;
		const blank = row("");
		const lines: string[] = [];

		const title = t.bold(t.fg("accent", " vocab "));
		const pad = w - 2 - visibleWidth(title);
		lines.push(border("╭") + border("─") + title + border("─".repeat(Math.max(0, pad - 1))) + border("╮"));

		const filtering = this.query.trim().length > 0;
		const prompt = filtering ? this.query : t.fg("dim", "type to search the whole glossary");
		lines.push(row(`${t.fg("accent", ">")} ${prompt}${t.fg("accent", "▏")}`));
		lines.push(border("├") + border("─".repeat(w - 2)) + border("┤"));

		if (items.length === 0) {
			const msg = filtering
				? "no term matches"
				: this.opts.glossary.length === 0
					? "nothing yet: terms appear here as the agent explains them"
					: "no new terms in the last reply";
			lines.push(row(t.fg("muted", msg)));
		} else {
			if (!filtering) lines.push(row(t.fg("muted", "this reply")));
			items.forEach((item, i) => {
				const sel = i === this.selected;
				const label = item.index ? `${item.index} ` : "· ";
				const term = sel ? t.bold(t.fg("accent", item.term)) : t.bold(item.term);
				const used = visibleWidth(label) + visibleWidth(item.term) + 3;
				const def = t.fg(sel ? "text" : "muted", clip(item.definition || "(no definition stored)", inner - used));
				const text = `${t.fg(sel ? "accent" : "dim", label)}${term}  ${def}`;
				const padded = text + " ".repeat(Math.max(0, inner - visibleWidth(text)));
				lines.push(row(sel ? t.bg("selectedBg", padded) : padded));
			});
		}

		const current = items[this.selected];
		if (current) {
			lines.push(border("├") + border("─".repeat(w - 2)) + border("┤"));
			const head = `${t.bold(t.fg("accent", current.term))}${current.index ? t.fg("dim", superscript(current.index)) : ""}`;
			lines.push(row(head));
			const def = current.definition || "No definition stored. Ask the agent what it means.";
			for (const l of wrap(def, inner)) lines.push(row(l));
			if (current.entry) {
				const e = current.entry;
				const times = e.count === 1 ? "seen once" : `seen ${e.count} times`;
				const where = e.projects.length ? `, first in ${e.projects[0]!.split("/").pop() ?? e.projects[0]}` : "";
				lines.push(row(t.fg("dim", `${times}${where}`)));
			}
		}

		lines.push(blank);
		lines.push(row(t.fg("dim", filtering ? "↑↓ move · backspace edit · esc close" : "1-9 pick · ↑↓ move · type to search · esc close")));
		lines.push(border("╰") + border("─".repeat(w - 2)) + border("╯"));
		return lines;
	}
}
