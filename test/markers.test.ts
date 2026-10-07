import assert from "node:assert/strict";
import { test } from "node:test";
import { fromSuperscript, recoverHints, rewrite, stripAnsi, styleName, superscript } from "../src/markers.ts";

test("rewrite turns markers into numbered bold terms", () => {
	const r = rewrite("A [[closure|a function that remembers its surroundings]] uses [[scope|where names are visible]].");
	assert.equal(r.text, "A **closure**¹ uses **scope**².");
	assert.deepEqual(r.hints, [
		{ index: 1, kind: "term", term: "closure", definition: "a function that remembers its surroundings" },
		{ index: 2, kind: "term", term: "scope", definition: "where names are visible" },
	]);
});

test("a term seen twice keeps one number", () => {
	const r = rewrite("[[Mutex|a lock]] here, and the [[mutex]] again.");
	assert.equal(r.text, "**Mutex**¹ here, and the **mutex**¹ again.");
	assert.equal(r.hints.length, 1);
});

test("bare marker without definition still gets a hint", () => {
	const r = rewrite("Use a [[thunk]].");
	assert.equal(r.text, "Use a **thunk**¹.");
	assert.deepEqual(r.hints, [{ index: 1, kind: "term", term: "thunk", definition: undefined }]);
});

test("numbering continues across messages and known terms reuse numbers", () => {
	const known = new Map();
	const a = rewrite("[[A|first]]", { known });
	const b = rewrite("[[B|second]] and [[A]]", { known });
	assert.equal(a.text, "**A**¹");
	assert.equal(b.text, "**B**² and **A**¹");
	assert.deepEqual(b.hints.map((h) => h.index), [2]);
});

test("numbers go past nine with multi-digit superscripts", () => {
	const src = Array.from({ length: 12 }, (_, i) => `[[t${i}|d${i}]]`).join(" ");
	const r = rewrite(src);
	assert.equal(r.hints.length, 12);
	assert.ok(r.text.endsWith("**t9**¹⁰ **t10**¹¹ **t11**¹²"), r.text);
	assert.deepEqual(recoverHints(r.text).map((h) => h.index), Array.from({ length: 12 }, (_, i) => i + 1));
});

test("numbering continues from the highest number already known", () => {
	const known = new Map();
	rewrite("[[a|1]] [[b|2]]", { known });
	const r = rewrite("[[c|3]] and [[a]]", { known });
	assert.equal(r.text, "**c**³ and **a**¹");
});

test("streaming hides an unfinished marker until its name is complete", () => {
	const known = new Map();
	assert.equal(rewrite("A [[clo", { known, streaming: true }).text, "A ");
	assert.equal(rewrite("A [[closure|a func", { known, streaming: true }).text, "A **closure**");
	assert.equal(rewrite("A [[concept: auth here|a tok", { known, streaming: true }).text, "A ***auth here***");
	assert.equal(rewrite("A [[closure|a function]] is", { known, streaming: true }).text, "A **closure**¹ is");
	assert.equal(known.size, 1);
});

test("streaming leaves finished text alone", () => {
	assert.equal(rewrite("plain [[x|y]] text.", { known: new Map(), streaming: true }).text, "plain **x**¹ text.");
});

test("fenced code blocks are left alone", () => {
	const src = "Before [[x|ex]].\n```ts\nconst a = [[notaterm|nope]];\n```\nAfter [[y|why]].";
	const r = rewrite(src);
	assert.equal(r.text, "Before **x**¹.\n```ts\nconst a = [[notaterm|nope]];\n```\nAfter **y**².");
	assert.equal(r.hints.length, 2);
});

test("a late definition fills a term first seen bare", () => {
	const r = rewrite("[[cache]] then [[cache|a copy kept close so it is fast to reach]]");
	assert.equal(r.hints[0]!.definition, "a copy kept close so it is fast to reach");
});

test("recoverHints reads numbers back out of rendered text", () => {
	const r = rewrite("[[alpha|one]] [[beta|two]] [[alpha]]");
	assert.deepEqual(recoverHints(r.text), [
		{ index: 1, kind: "term", term: "alpha" },
		{ index: 2, kind: "term", term: "beta" },
	]);
});

test("plain bold without a superscript is not a hint", () => {
	assert.deepEqual(recoverHints("**just bold** and **more**"), []);
});

test("every plain repeat of a marked term gets the same number", () => {
	const r = rewrite("A [[closure|keeps its scope]] is handy. Closures are everywhere, and a closure is cheap.");
	assert.equal(r.text, "A **closure**¹ is handy. **Closures**¹ are everywhere, and a **closure**¹ is cheap.");
	assert.equal(r.hints.length, 1);
});

test("glossary terms mentioned without markers get numbered too", () => {
	const r = rewrite("Guard it with a mutex, or you get a race condition.", {
		glossary: [
			{ kind: "term", term: "race condition", definition: "two threads racing" },
			{ kind: "term", term: "mutex", definition: "a lock" },
		],
	});
	assert.equal(r.text, "Guard it with a **mutex**¹, or you get a **race condition**².");
	assert.deepEqual(r.hints.map((h) => [h.index, h.term, h.definition]), [
		[1, "mutex", "a lock"],
		[2, "race condition", "two threads racing"],
	]);
});

test("highlight pass skips inline code, links, urls and partial words", () => {
	const r = rewrite("The [[cache|a fast copy]] helps. See `cache.ts`, [cache docs](https://x/cache), https://x/cache and cachedValue.");
	assert.equal(
		r.text,
		"The **cache**¹ helps. See `cache.ts`, [cache docs](https://x/cache), https://x/cache and cachedValue.",
	);
});

test("marker terms take the low numbers, glossary mentions follow", () => {
	const r = rewrite("scope first, then [[closure|c]].", { glossary: [{ kind: "term", term: "scope", definition: "s" }] });
	assert.equal(r.text, "**scope**² first, then **closure**¹.");
});

test("kind prefixes are parsed and rendered like terms", () => {
	const r = rewrite("[[why: SQLite|single-user app]] and [[gotcha: seeding|migrate first]] and [[concept: auth here|cookie token]].");
	assert.equal(r.text, `${styleName("why", "SQLite")}¹ and ${styleName("gotcha", "seeding")}² and ***auth here***³.`);
	assert.equal(stripAnsi(r.text), "**SQLite**¹ and **seeding**² and ***auth here***³.");
	assert.deepEqual(r.hints.map((h) => [h.kind, h.term, h.definition]), [
		["why", "SQLite", "single-user app"],
		["gotcha", "seeding", "migrate first"],
		["concept", "auth here", "cookie token"],
	]);
});

test("an unknown prefix stays part of the name", () => {
	const r = rewrite("[[note: thing|d]]");
	assert.equal(r.text, "**note: thing**¹");
	assert.equal(r.hints[0]!.kind, "term");
});

test("project kinds in the glossary are not auto-numbered, concepts are", () => {
	const r = rewrite("Run the tests after auth here is set up.", {
		glossary: [
			{ kind: "how", term: "tests", definition: "make test" },
			{ kind: "concept", term: "auth here", definition: "cookie token" },
		],
	});
	assert.equal(r.text, "Run the tests after ***auth here***¹ is set up.");
});

test("a see: segment becomes related links and stays out of the definition", () => {
	const r = rewrite("[[closure|keeps scope alive|see: scope, callback]] and [[scope|where names live]]");
	assert.equal(r.text, "**closure**¹ and **scope**²");
	assert.deepEqual(r.hints[0]!.related, ["scope", "callback"]);
	assert.equal(r.hints[0]!.definition, "keeps scope alive");
	assert.equal(r.hints[1]!.related, undefined);
});

test("superscript round-trips", () => {
	assert.equal(superscript(7), "⁷");
	assert.equal(superscript(23), "²³");
	assert.equal(fromSuperscript("²³"), 23);
	assert.equal(fromSuperscript("x"), 0);
});

test("styled hints are recovered and protected from re-marking", () => {
	const r = rewrite("[[gotcha: seeding|migrate first]] then [[concept: auth|token]] then seeding again.");
	assert.deepEqual(recoverHints(r.text), [
		{ index: 1, kind: "term", term: "seeding" },
		{ index: 2, kind: "term", term: "auth" },
	]);
	// A second pass over already-styled text changes nothing.
	const again = rewrite(r.text, { glossary: [{ kind: "gotcha", term: "seeding", definition: "x" }] });
	assert.equal(again.text, r.text);
});
