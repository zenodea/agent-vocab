/**
 * The footnote strip: one line per term from the last reply, sitting above the
 * editor so the definitions are on screen without pressing anything.
 *
 *   ¹ mutex  a lock so only one thread touches shared data at a time
 *   ² race condition  a bug where two threads change the same data at once
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, visibleWidth } from "@earendil-works/pi-tui";
import { type Hint, superscript } from "./markers.ts";
import { clip } from "./text.ts";

export class Footnotes implements Component {
	private readonly theme: Theme;
	private readonly hints: Hint[];

	constructor(theme: Theme, hints: Hint[]) {
		this.theme = theme;
		this.hints = hints;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const t = this.theme;
		return this.hints.map((h) => {
			const head = `${t.fg("accent", superscript(h.index))} ${t.bold(h.term)}  `;
			const room = width - visibleWidth(head) - 1;
			const def = h.definition ? clip(h.definition, room) : "(no definition stored)";
			return ` ${head}${t.fg("muted", def)}`;
		});
	}
}
