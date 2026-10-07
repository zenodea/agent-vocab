/** Plain-text helpers with no terminal dependency, so they stay unit-testable. */

/** Width of plain text in cells. Definitions carry no ANSI; wide glyphs count double. */
export function plainWidth(text: string): number {
	let w = 0;
	for (const ch of text) {
		const cp = ch.codePointAt(0)!;
		if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0) || (cp >= 0x300 && cp <= 0x36f)) continue;
		w += isWide(cp) ? 2 : 1;
	}
	return w;
}

function isWide(cp: number): boolean {
	return (
		(cp >= 0x1100 && cp <= 0x115f) ||
		(cp >= 0x2e80 && cp <= 0xa4cf) ||
		(cp >= 0xac00 && cp <= 0xd7a3) ||
		(cp >= 0xf900 && cp <= 0xfaff) ||
		(cp >= 0xfe30 && cp <= 0xfe4f) ||
		(cp >= 0xff00 && cp <= 0xff60) ||
		(cp >= 0xffe0 && cp <= 0xffe6) ||
		(cp >= 0x1f300 && cp <= 0x1faff) ||
		(cp >= 0x20000 && cp <= 0x3fffd)
	);
}

/** Wrap plain text to a width, breaking on spaces and keeping paragraph breaks. */
export function wrap(text: string, width: number): string[] {
	const lines: string[] = [];
	for (const para of text.split("\n")) {
		let line = "";
		for (const word of para.split(/\s+/).filter(Boolean)) {
			if (line && plainWidth(`${line} ${word}`) > width) {
				lines.push(line);
				line = word;
			} else {
				line = line ? `${line} ${word}` : word;
			}
		}
		lines.push(line);
	}
	return lines;
}

/** Cut plain text to a width, with an ellipsis. */
export function clip(text: string, width: number): string {
	if (width <= 0) return "";
	if (plainWidth(text) <= width) return text;
	let out = "";
	for (const ch of text) {
		if (plainWidth(out + ch) > width - 1) break;
		out += ch;
	}
	return `${out}…`;
}
