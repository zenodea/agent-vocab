import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Glossary, normalize } from "../src/glossary.ts";

const fresh = () => new Glossary(join(mkdtempSync(join(tmpdir(), "vocab-")), "vocab.json"));

test("normalize folds case and whitespace", () => {
	assert.equal(normalize("  Dependency   Injection "), "dependency injection");
});

test("record creates, then counts repeat sightings", () => {
	const g = fresh();
	const a = g.record("Closure", "a function that remembers its surroundings", "/p1", new Date("2026-01-01"));
	const b = g.record("closure", undefined, "/p2", new Date("2026-01-02"));
	assert.equal(a, b);
	assert.equal(b.count, 2);
	assert.equal(b.term, "Closure");
	assert.deepEqual(b.projects, ["/p1", "/p2"]);
	assert.equal(b.firstSeen, "2026-01-01T00:00:00.000Z");
	assert.equal(b.lastSeen, "2026-01-02T00:00:00.000Z");
});

test("first definition sticks, missing one gets filled", () => {
	const g = fresh();
	g.record("Scope", undefined, "/p");
	g.record("Scope", "where a name is visible", "/p");
	g.record("Scope", "something else", "/p");
	assert.equal(g.get("scope")?.definition, "where a name is visible");
});

test("save round-trips through disk and keeps enabled flag", () => {
	const dir = mkdtempSync(join(tmpdir(), "vocab-"));
	const path = join(dir, "vocab.json");
	const g = new Glossary(path);
	g.record("Mutex", "a lock so only one thing touches shared data at a time", "/p");
	g.setEnabled(false);
	const again = new Glossary(path);
	assert.equal(again.enabled, false);
	assert.equal(again.get("MUTEX")?.definition, "a lock so only one thing touches shared data at a time");
	assert.ok(readFileSync(path, "utf8").includes('"version": 1'));
});

test("forget removes and reports", () => {
	const g = fresh();
	g.record("Thunk", "a function wrapped around a value so it runs later", "/p");
	assert.equal(g.forget("thunk"), true);
	assert.equal(g.forget("thunk"), false);
	assert.equal(g.size, 0);
});

test("all sorts most recent first", () => {
	const g = fresh();
	g.record("A", "a", "/p", new Date("2026-01-01"));
	g.record("B", "b", "/p", new Date("2026-01-03"));
	g.record("C", "c", "/p", new Date("2026-01-02"));
	assert.deepEqual(g.all().map((e) => e.term), ["B", "C", "A"]);
});
