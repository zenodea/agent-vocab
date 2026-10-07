import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
	const a = g.record("Closure", "a function that remembers its surroundings", "/p1", "term", new Date("2026-01-01"));
	const b = g.record("closure", undefined, "/p2", "term", new Date("2026-01-02"));
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
	assert.ok(readFileSync(path, "utf8").includes('"version": 2'));
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
	g.record("A", "a", "/p", "term", new Date("2026-01-01"));
	g.record("B", "b", "/p", "term", new Date("2026-01-03"));
	g.record("C", "c", "/p", "term", new Date("2026-01-02"));
	assert.deepEqual(g.all().map((e) => e.term), ["B", "C", "A"]);
});

test("kinds are stored apart and project kinds are scoped", () => {
	const g = fresh();
	g.record("SQLite", "a file database", "/p1");
	g.record("SQLite", "single-user app", "/p1", "why");
	g.record("tests", "make test", "/p2", "how");
	assert.equal(g.get("sqlite")?.kind, "term");
	assert.equal(g.get("sqlite", "why")?.definition, "single-user app");
	assert.deepEqual(g.all("/p1").map((e) => e.term).sort(), ["SQLite", "SQLite"]);
	assert.deepEqual(g.all("/p2").map((e) => e.term).sort(), ["SQLite", "tests"]);
	assert.equal(g.all().length, 3);
	assert.equal(g.forget("sqlite"), true);
	assert.equal(g.all().length, 1);
});

test("version 1 files load as terms", () => {
	const dir = mkdtempSync(join(tmpdir(), "vocab-"));
	const path = join(dir, "vocab.json");
	writeFileSync(path, JSON.stringify({ version: 1, enabled: true, terms: { closure: { term: "closure", definition: "d", firstSeen: "x", lastSeen: "x", count: 1, projects: [] } } }));
	const g = new Glossary(path);
	assert.equal(g.get("closure")?.kind, "term");
});

test("links go both ways and never to self", () => {
	const g = fresh();
	g.record("scope", "where names live", "/p");
	g.record("closure", "keeps scope alive", "/p", "term", new Date(), ["scope", "closure", "callback"]);
	assert.deepEqual(g.get("closure")?.related, ["scope", "callback"]);
	assert.deepEqual(g.get("scope")?.related, ["closure"]);
	g.record("callback", "a function handed over to be called later", "/p", "term", new Date(), ["closure"]);
	assert.deepEqual(g.get("closure")?.related, ["scope", "callback"]);
});

test("lookups count and survive a save", () => {
	const dir = mkdtempSync(join(tmpdir(), "vocab-"));
	const path = join(dir, "vocab.json");
	const g = new Glossary(path);
	g.record("Thunk", "a wrapped value that runs later", "/p");
	assert.equal(g.lookup("thunk"), true);
	assert.equal(g.lookup("thunk"), true);
	assert.equal(g.lookup("nope"), false);
	g.save();
	assert.equal(new Glossary(path).get("thunk")?.lookups, 2);
});
