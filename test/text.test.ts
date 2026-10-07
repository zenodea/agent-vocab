import assert from "node:assert/strict";
import { test } from "node:test";
import { clip, plainWidth, wrap } from "../src/text.ts";

test("wrap breaks on words and respects width", () => {
	const lines = wrap("a function that remembers the variables around it", 20);
	assert.ok(lines.every((l) => l.length <= 20), lines.join("|"));
	assert.equal(lines.join(" "), "a function that remembers the variables around it");
});

test("wrap keeps paragraph breaks", () => {
	assert.deepEqual(wrap("one\ntwo", 10), ["one", "two"]);
});

test("clip shortens with an ellipsis", () => {
	assert.equal(clip("hello world", 20), "hello world");
	assert.equal(clip("hello world", 8), "hello w…");
	assert.equal(clip("x", 0), "");
});

test("plainWidth counts wide glyphs twice", () => {
	assert.equal(plainWidth("abc"), 3);
	assert.equal(plainWidth("日本"), 4);
});
