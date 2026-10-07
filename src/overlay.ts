/**
 * The glossary overlay. Digits pick a hint from the last reply, typing filters
 * the whole glossary, up/down moves, enter or esc closes.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, fuzzyFilter, matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import type { Entry, Kind } from "./glossary.ts";
import type { Hint } from "./markers.ts";
import { superscript } from "./markers.ts";
import { clip, wrap } from "./text.ts";

/** One character per kind, so a row stays one line. Terms get none. */
export const KIND_GLYPH: Record<Kind, string> = {
	term: "",
	concept: "◇",
	why: "?",
	where: "@",
	how: "›",
	gotcha: "!",
};

export const KIND_LABEL: Record<Kind, string> = {
	term: "term",
	concept: "concept",
	why: "why we do it this way",
	where: "where it lives",
	how: "how to do it",
	gotcha: "gotcha",
};

export interface OverlayItem {
	kind: Kind;
	term: string;
	definition: string;
	related: string[];
	/** Set for terms from the last reply. */
	index?: number;
	entry?: Entry;
}

/** What the overlay hands back when it closes. */
export interface OverlayResult {
	action: "close" | "explain";
	/** The entry selected when the overlay closed or ctrl+e was pressed. */
	item?: OverlayItem;
	/** Entries the user deliberately landed on, for lookup counting. */
	viewed: OverlayItem[];
}

export interface OverlayOptions {
	hints: Hint[];
	glossary: Entry[];
	initialQuery?: string;
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
	private readonly done: (result: OverlayResult) => void;
	private readonly viewed = new Map<string, OverlayItem>();

	constructor(theme: Theme, opts: OverlayOptions, done: (result: OverlayResult) => void) {
		this.theme = theme;
		this.opts = opts;
		this.done = done;
		this.query = opts.initialQuery ?? "";
		this.width = opts.width ?? 72;
		for (const e of opts.glossary) this.byTerm.set(`${e.kind}:${e.term.toLowerCase()}`, e);
		if (this.query) this.markViewed();
	}

	/** Digits only: the user is typing a hint number. */
	private numberMode(): boolean {
		return /^\d+$/.test(this.query);
	}

	private hintItem(h: Hint): OverlayItem {
		const entry = this.byTerm.get(`${h.kind}:${h.term.toLowerCase()}`) ?? this.byTerm.get(`term:${h.term.toLowerCase()}`);
		return {
			index: h.index,
			kind: entry?.kind ?? h.kind,
			term: h.term,
			related: entry?.related ?? h.related ?? [],
			definition: h.definition ?? entry?.definition ?? "",
			entry,
		};
	}

	/**
	 * What the list shows right now. Empty query: the newest hints of this
	 * session. Digits: hints whose number starts with them, exact match first.
	 * Anything else: fuzzy matches over the whole glossary.
	 */
	items(): OverlayItem[] {
		const q = this.query.trim();
		if (q && this.numberMode()) {
			const exact = this.opts.hints.filter((h) => String(h.index) === q);
			const rest = this.opts.hints.filter((h) => String(h.index) !== q && String(h.index).startsWith(q));
			return [...exact, ...rest.sort((a, b) => b.index - a.index)].slice(0, MAX_ROWS).map((h) => this.hintItem(h));
		}
		if (q) {
			const matches = fuzzyFilter(this.opts.glossary, q, (e) => e.term);
			return matches
				.slice(0, MAX_ROWS)
				.map((entry) => ({ kind: entry.kind, term: entry.term, definition: entry.definition, related: entry.related, entry }));
		}
		return [...this.opts.hints]
			.sort((a, b) => b.index - a.index)
			.slice(0, MAX_ROWS)
			.map((h) => this.hintItem(h));
	}

	/** Remember that the user deliberately landed on the current item. */
	private markViewed(): void {
		const item = this.items()[this.selected];
		if (item) this.viewed.set(`${item.kind}:${item.term.toLowerCase()}`, item);
	}

	private finish(action: OverlayResult["action"]): void {
		const item = this.items()[this.selected];
		this.done({ action, item, viewed: [...this.viewed.values()] });
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
			this.finish("close");
			return;
		}
		// ctrl+e asks the agent to explain the selected entry again.
		if (matchesKey(data, "ctrl+e")) {
			this.markViewed();
			this.finish("explain");
			return;
		}
		if (matchesKey(data, "up") || matchesKey(data, "ctrl+p") || matchesKey(data, "ctrl+k")) {
			this.selected -= 1;
			this.clampSelection(this.items());
			this.markViewed();
			return;
		}
		if (matchesKey(data, "down") || matchesKey(data, "ctrl+n") || matchesKey(data, "ctrl+j")) {
			this.selected += 1;
			this.clampSelection(this.items());
			this.markViewed();
			return;
		}
		// tab follows the first link of the selected entry.
		if (matchesKey(data, "tab")) {
			const current = this.items()[this.selected];
			const target = current?.related[0];
			if (target) {
				this.query = target;
				this.selected = 0;
				this.markViewed();
			}
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
		if (data.length >= 1 && !/[\x00-\x1f\x7f]/.test(data)) {
			this.query += data;
			this.selected = 0;
			// A number that lands on a hint, or a filter down to one hit, counts as finding it.
			const items = this.items();
			if ((this.numberMode() && items[0] && String(items[0].index) === this.query.trim()) || items.length === 1) {
				this.markViewed();
			}
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
		const prompt = filtering ? this.query : t.fg("dim", "number picks a hint · word searches the glossary");
		lines.push(row(`${t.fg("accent", ">")} ${prompt}${t.fg("accent", "▏")}`));
		lines.push(border("├") + border("─".repeat(w - 2)) + border("┤"));

		if (items.length === 0) {
			const msg = filtering
				? this.numberMode()
					? `no hint ${this.query.trim()} in this session`
					: "no term matches"
				: this.opts.glossary.length === 0
					? "nothing yet: terms appear here as the agent explains them"
					: "no terms in this session yet";
			lines.push(row(t.fg("muted", msg)));
		} else {
			if (!filtering) {
				const total = this.opts.hints.length;
				const more = total > items.length ? t.fg("dim", `  ${total - items.length} more, type a number`) : "";
				lines.push(row(t.fg("muted", "this session, newest first") + more));
			}
			items.forEach((item, i) => {
				const sel = i === this.selected;
				const label = item.index ? `${item.index} `.padStart(3) : " · ";
				const glyph = KIND_GLYPH[item.kind] ? t.fg("warning", `${KIND_GLYPH[item.kind]} `) : "";
				const term = sel ? t.bold(t.fg("accent", item.term)) : t.bold(item.term);
				const used = visibleWidth(label) + visibleWidth(glyph) + visibleWidth(item.term) + 3;
				const def = t.fg(sel ? "text" : "muted", clip(item.definition || "(no definition stored)", inner - used));
				const text = `${t.fg(sel ? "accent" : "dim", label)}${glyph}${term}  ${def}`;
				const padded = text + " ".repeat(Math.max(0, inner - visibleWidth(text)));
				lines.push(row(sel ? t.bg("selectedBg", padded) : padded));
			});
		}

		const current = items[this.selected];
		if (current) {
			lines.push(border("├") + border("─".repeat(w - 2)) + border("┤"));
			const head = `${t.bold(t.fg("accent", current.term))}${current.index ? t.fg("dim", superscript(current.index)) : ""}`;
			const kind = current.kind === "term" ? "" : t.fg("warning", `  ${KIND_GLYPH[current.kind]} ${KIND_LABEL[current.kind]}`);
			lines.push(row(head + kind));
			const def = current.definition || "No definition stored. Ask the agent what it means.";
			for (const l of wrap(def, inner)) lines.push(row(l));
			if (current.related.length) {
				lines.push(row(t.fg("dim", "see: ") + t.fg("accent", clip(current.related.join(", "), inner - 5))));
			}
		}

		lines.push(blank);
		const hasLink = (current?.related.length ?? 0) > 0;
		const tabHint = hasLink ? " · tab link" : "";
		const explain = current ? " · ^e explain again" : "";
		lines.push(row(t.fg("dim", filtering ? `↑↓ move · backspace edit${tabHint}${explain} · esc` : `number pick · ↑↓ · type to search${tabHint}${explain} · esc`)));
		lines.push(border("╰") + border("─".repeat(w - 2)) + border("╯"));
		return lines;
	}
}
