import assert from "node:assert/strict";
import { test } from "node:test";
import type { Entry } from "../src/glossary.ts";
import { pickCards, priority } from "../src/quiz.ts";

const now = new Date("2026-10-07T12:00:00Z");
const mk = (term: string, over: Partial<Entry> = {}): Entry => ({
	kind: "term",
	term,
	definition: `def of ${term}`,
	firstSeen: "2026-10-01T00:00:00Z",
	lastSeen: "2026-10-06T00:00:00Z",
	count: 1,
	projects: ["/p"],
	related: [],
	lookups: 0,
	quiz: { asked: 0, missed: 0 },
	...over,
});

test("looked-up and missed entries come first", () => {
	const plain = mk("plain");
	const lookedUp = mk("lookedup", { lookups: 3 });
	const missed = mk("missed", { quiz: { asked: 2, missed: 2 } });
	const picked = pickCards([plain, lookedUp, missed], 2, now).map((e) => e.term);
	assert.deepEqual(picked.sort(), ["lookedup", "missed"]);
});

test("entries without a definition are skipped", () => {
	assert.deepEqual(pickCards([mk("a", { definition: "" }), mk("b")], 5, now).map((e) => e.term), ["b"]);
});

test("just asked rests, well known eases off", () => {
	const fresh = mk("fresh");
	const justAsked = mk("just", { quiz: { asked: 1, missed: 0, lastAsked: "2026-10-07T11:50:00Z" } });
	const known = mk("known", { quiz: { asked: 6, missed: 0, lastAsked: "2026-09-01T00:00:00Z" } });
	assert.ok(priority(fresh, now) > priority(justAsked, now));
	assert.ok(priority(fresh, now) > priority(known, now));
});
