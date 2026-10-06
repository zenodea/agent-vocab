import assert from "node:assert/strict";
import { test } from "node:test";
import { findMarkers, recoverHints, rewrite } from "../src/markers.ts";

test("rewrite turns markers into numbered bold terms", () => {
	const r = rewrite("A [[closure|a function that remembers its surroundings]] uses [[scope|where names are visible]].");
	assert.equal(r.text, "A **closure**¹ uses **scope**².");
	assert.deepEqual(r.hints, [
		{ index: 1, term: "closure", definition: "a function that remembers its surroundings" },
		{ index: 2, term: "scope", definition: "where names are visible" },
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
	assert.deepEqual(r.hints, [{ index: 1, term: "thunk", definition: undefined }]);
});

test("numbering continues across messages and known terms reuse numbers", () => {
	const known = new Map();
	const a = rewrite("[[A|first]]", 1, known);
	const b = rewrite("[[B|second]] and [[A]]", a.hints.length + 1, known);
	assert.equal(a.text, "**A**¹");
	assert.equal(b.text, "**B**² and **A**¹");
	assert.deepEqual(b.hints.map((h) => h.index), [2]);
});

test("beyond nine, terms are bold without a number", () => {
	const src = Array.from({ length: 11 }, (_, i) => `[[t${i}|d${i}]]`).join(" ");
	const r = rewrite(src);
	assert.equal(r.hints.length, 9);
	assert.ok(r.text.endsWith("**t8**⁹ **t9** **t10**"), r.text);
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

test("findMarkers reads without rewriting", () => {
	assert.deepEqual(findMarkers("x [[a|b]] y [[c]]"), [{ term: "a", definition: "b" }, { term: "c", definition: undefined }]);
});

test("recoverHints reads numbers back out of rendered text", () => {
	const r = rewrite("[[alpha|one]] [[beta|two]] [[alpha]]");
	assert.deepEqual(recoverHints(r.text), [
		{ index: 1, term: "alpha" },
		{ index: 2, term: "beta" },
	]);
});

test("plain bold without a superscript is not a hint", () => {
	assert.deepEqual(recoverHints("**just bold** and **more**"), []);
});
