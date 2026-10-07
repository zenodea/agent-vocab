/** The one thing that outlives a session: whether marking is on. */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export class Settings {
	private readonly path: string;
	private data: { enabled: boolean };

	constructor(path: string) {
		this.path = path;
		try {
			const parsed = JSON.parse(readFileSync(path, "utf8")) as { enabled?: boolean };
			this.data = { enabled: parsed.enabled !== false };
		} catch {
			this.data = { enabled: true };
		}
	}

	get enabled(): boolean {
		return this.data.enabled;
	}

	setEnabled(on: boolean): void {
		this.data.enabled = on;
		try {
			mkdirSync(dirname(this.path), { recursive: true });
			writeFileSync(this.path, `${JSON.stringify(this.data, null, "\t")}\n`);
		} catch {
			// Still applies to this session; it just won't be remembered.
		}
	}
}
