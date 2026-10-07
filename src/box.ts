/** The bordered box both overlays draw: title bar, rows, dividers, bottom. */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

/** Columns a box takes when the terminal allows it. */
export const BOX_WIDTH = 72;

export class Box {
	readonly inner: number;
	private readonly w: number;
	private readonly t: Theme;

	constructor(theme: Theme, available: number, width = BOX_WIDTH) {
		this.t = theme;
		this.w = Math.max(30, Math.min(width, available));
		this.inner = this.w - 4; // "│ " ... " │"
	}

	private border(s: string): string {
		return this.t.fg("border", s);
	}

	top(title: string): string {
		const label = this.t.bold(this.t.fg("accent", ` ${title} `));
		const fill = Math.max(0, this.w - 3 - visibleWidth(label));
		return this.border("╭─") + label + this.border("─".repeat(fill)) + this.border("╮");
	}

	/** One content row, padded to the inner width. */
	row(s = ""): string {
		const pad = " ".repeat(Math.max(0, this.inner - visibleWidth(s)));
		return `${this.border("│")} ${s}${pad} ${this.border("│")}`;
	}

	/** A row with a highlighted background across its whole width. */
	selectedRow(s: string): string {
		const pad = " ".repeat(Math.max(0, this.inner - visibleWidth(s)));
		return `${this.border("│")} ${this.t.bg("selectedBg", s + pad)} ${this.border("│")}`;
	}

	divider(): string {
		return this.border("├") + this.border("─".repeat(this.w - 2)) + this.border("┤");
	}

	bottom(): string {
		return this.border("╰") + this.border("─".repeat(this.w - 2)) + this.border("╯");
	}
}
