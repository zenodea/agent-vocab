/**
 * The glossary overlay. A number picks a hint of this session, a word searches
 * the glossary, arrows and ctrl+d/ctrl+u scroll, ctrl+e asks the agent to
 * explain again, esc closes. The search line and the list window never move;
 * only the detail panel below them grows.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, fuzzyFilter, matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import { Box, BOX_WIDTH } from "./box.ts";
import { type Entry, KIND_GLYPH, KIND_LABEL, type Kind } from "./glossary.ts";
import { type Hint, superscript } from "./markers.ts";
import { clip, wrap } from "./text.ts";

export interface OverlayItem {
	kind: Kind;
	term: string;
	definition: string;
	related: string[];
	/** The session number, when the item is a hint of this session. */
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

/** Rows the list always occupies, so the search box and list never move. */
export const LIST_ROWS = 8;
/** Rows a ctrl+d / ctrl+u jump moves, vim style. */
const HALF_PAGE = Math.ceil(LIST_ROWS / 2);

export class VocabOverlay implements Component {
	focused = false;
	private query: string;
	private selected = 0;
	/** Index of the first visible list row. */
	private scroll = 0;
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
		this.width = opts.width ?? BOX_WIDTH;
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
			return [...exact, ...rest.sort((a, b) => b.index - a.index)].map((h) => this.hintItem(h));
		}
		if (q) {
			const matches = fuzzyFilter(this.opts.glossary, q, (e) => e.term);
			return matches.map((entry) => ({ kind: entry.kind, term: entry.term, definition: entry.definition, related: entry.related, entry }));
		}
		return [...this.opts.hints].sort((a, b) => b.index - a.index).map((h) => this.hintItem(h));
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
		// Keep the selection inside the visible window.
		if (this.selected < this.scroll) this.scroll = this.selected;
		if (this.selected >= this.scroll + LIST_ROWS) this.scroll = this.selected - LIST_ROWS + 1;
		this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, items.length - LIST_ROWS)));
	}

	private move(delta: number): void {
		this.selected += delta;
		this.clampSelection(this.items());
		this.markViewed();
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
		if (matchesKey(data, "up") || matchesKey(data, "ctrl+p") || matchesKey(data, "ctrl+k")) return this.move(-1);
		if (matchesKey(data, "down") || matchesKey(data, "ctrl+n") || matchesKey(data, "ctrl+j")) return this.move(1);
		if (matchesKey(data, "ctrl+u")) return this.move(-HALF_PAGE);
		if (matchesKey(data, "ctrl+d")) return this.move(HALF_PAGE);
		if (matchesKey(data, "pageUp")) return this.move(-LIST_ROWS);
		if (matchesKey(data, "pageDown")) return this.move(LIST_ROWS);
		if (matchesKey(data, "home")) return this.move(-Infinity);
		if (matchesKey(data, "end")) return this.move(Infinity);
		// tab follows the first link of the selected entry.
		if (matchesKey(data, "tab")) {
			const current = this.items()[this.selected];
			const target = current?.related[0];
			if (target) {
				this.query = target;
				this.selected = 0;
				this.scroll = 0;
				this.markViewed();
			}
			return;
		}
		if (matchesKey(data, "backspace")) {
			this.query = this.query.slice(0, -1);
			this.selected = 0;
			this.scroll = 0;
			return;
		}
		if (data.length >= 1 && !/[\x00-\x1f\x7f]/.test(data)) {
			this.query += data;
			this.selected = 0;
			this.scroll = 0;
			// A number that lands on a hint, or a filter down to one hit, counts as finding it.
			const items = this.items();
			if ((this.numberMode() && items[0] && String(items[0].index) === this.query.trim()) || items.length === 1) {
				this.markViewed();
			}
		}
	}

	render(width: number): string[] {
		const t = this.theme;
		const box = new Box(t, width, this.width);
		const inner = box.inner;
		const items = this.items();
		this.clampSelection(items);
		const filtering = this.query.trim().length > 0;
		const lines: string[] = [box.top("vocab")];

		const prompt = filtering ? this.query : t.fg("dim", "number picks a hint · word searches the glossary");
		lines.push(box.row(`${t.fg("accent", ">")} ${prompt}${t.fg("accent", "▏")}`));
		lines.push(box.divider());

		// The list window: always LIST_ROWS tall, so nothing above or below it moves.
		const total = items.length;
		const first = this.scroll;
		const last = Math.min(total, first + LIST_ROWS);
		const range = total > LIST_ROWS ? `  ${first + 1}-${last} of ${total}` : total > 0 ? `  ${total}` : "";
		const heading = !filtering ? "this session, newest first" : this.numberMode() ? `hint ${this.query.trim()}` : "glossary matches";
		lines.push(box.row(t.fg("muted", heading) + t.fg("dim", range)));
		if (total === 0) {
			const msg = !filtering
				? this.opts.glossary.length === 0
					? "nothing yet: terms appear here as the agent explains them"
					: "no terms in this session yet"
				: this.numberMode()
					? `no hint ${this.query.trim()} in this session`
					: "no term matches";
			lines.push(box.row(t.fg("muted", msg)));
		}
		for (let i = first; i < last; i++) {
			const item = items[i]!;
			const sel = i === this.selected;
			const label = t.fg(sel ? "accent" : "dim", item.index ? `${item.index} `.padStart(3) : " · ");
			const glyph = KIND_GLYPH[item.kind] ? t.fg("warning", `${KIND_GLYPH[item.kind]} `) : "";
			const term = sel ? t.bold(t.fg("accent", item.term)) : t.bold(item.term);
			const used = visibleWidth(label) + visibleWidth(glyph) + visibleWidth(item.term) + 3;
			const def = t.fg(sel ? "text" : "muted", clip(item.definition || "(no definition stored)", inner - used));
			const text = `${label}${glyph}${term}  ${def}`;
			lines.push(sel ? box.selectedRow(text) : box.row(text));
		}
		for (let i = Math.max(last - first, total === 0 ? 1 : 0); i < LIST_ROWS; i++) lines.push(box.row());

		const current = items[this.selected];
		if (current) {
			lines.push(box.divider());
			const number = current.index ? t.fg("dim", superscript(current.index)) : "";
			const kind = current.kind === "term" ? "" : t.fg("warning", `  ${KIND_GLYPH[current.kind]} ${KIND_LABEL[current.kind]}`);
			lines.push(box.row(t.bold(t.fg("accent", current.term)) + number + kind));
			for (const l of wrap(current.definition || "No definition stored. Ask the agent what it means.", inner)) lines.push(box.row(l));
			if (current.related.length) lines.push(box.row(t.fg("dim", "see: ") + t.fg("accent", clip(current.related.join(", "), inner - 5))));
		}

		lines.push(box.row());
		const tabHint = current?.related.length ? " · tab link" : "";
		const explain = current ? " · ^e explain again" : "";
		const keys = filtering ? `↑↓ ^d ^u scroll · backspace${tabHint}${explain} · esc` : `number or word · ↑↓ ^d ^u scroll${tabHint}${explain} · esc`;
		lines.push(box.row(t.fg("dim", keys)));
		lines.push(box.bottom());
		return lines;
	}
}
