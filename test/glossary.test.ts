import assert from "node:assert/strict";
import { test } from "node:test";
import { Glossary, type GlossaryData, normalize } from "../src/glossary.ts";

const fresh = () => new Glossary();

/** A glossary wired to a fake store, plus a way to reopen it from that store. */
const stored = () => {
	const store: { last?: GlossaryData } = {};
	const g = new Glossary((d) => (store.last = d));
	const reopen = () => {
		const again = new Glossary();
		again.load(store.last);
		return again;
	};
	return { g, reopen, store };
};

test("normalize folds case and whitespace", () => {
	assert.equal(normalize("  Dependency   Injection "), "dependency injection");
});

test("record creates, then counts repeat sightings", () => {
	const g = fresh();
	const a = g.record("Closure", "a function that remembers its surroundings", { now: new Date("2026-01-01") });
	const b = g.record("closure", undefined, { now: new Date("2026-01-02") });
	assert.equal(a, b);
	assert.equal(b.count, 2);
	assert.equal(b.term, "Closure");
	assert.equal(b.firstSeen, "2026-01-01T00:00:00.000Z");
	assert.equal(b.lastSeen, "2026-01-02T00:00:00.000Z");
});

test("first definition sticks, missing one gets filled", () => {
	const g = fresh();
	g.record("Scope", undefined);
	g.record("Scope", "where a name is visible");
	g.record("Scope", "something else");
	assert.equal(g.get("scope")?.definition, "where a name is visible");
});

test("save snapshots and load restores", () => {
	const { g, reopen, store } = stored();
	g.record("Mutex", "a lock so only one thing touches shared data at a time");
	g.save();
	assert.equal(store.last?.version, 3);
	assert.equal(reopen().get("MUTEX")?.definition, "a lock so only one thing touches shared data at a time");
});

test("forget removes and reports", () => {
	const g = fresh();
	g.record("Thunk", "a function wrapped around a value so it runs later");
	assert.equal(g.forget("thunk"), true);
	assert.equal(g.forget("thunk"), false);
	assert.equal(g.size, 0);
});

test("all sorts most recent first", () => {
	const g = fresh();
	g.record("A", "a", { now: new Date("2026-01-01") });
	g.record("B", "b", { now: new Date("2026-01-03") });
	g.record("C", "c", { now: new Date("2026-01-02") });
	assert.deepEqual(g.all().map((e) => e.term), ["B", "C", "A"]);
});

test("kinds are stored apart", () => {
	const g = fresh();
	g.record("SQLite", "a file database");
	g.record("SQLite", "single-user app", { kind: "why" });
	g.record("tests", "make test", { kind: "how" });
	assert.equal(g.get("sqlite")?.kind, "term");
	assert.equal(g.get("sqlite", "why")?.definition, "single-user app");
	assert.equal(g.all().length, 3);
	assert.equal(g.forget("sqlite"), true);
	assert.equal(g.all().length, 1);
});

test("older snapshots load as terms", () => {
	const g = fresh();
	g.load({ version: 1, terms: { closure: { term: "closure", definition: "d", firstSeen: "x", lastSeen: "x", count: 1 } } });
	assert.equal(g.get("closure")?.kind, "term");
	assert.equal(g.get("closure")?.lookups, 0);
});

test("links go both ways and never to self", () => {
	const g = fresh();
	g.record("scope", "where names live");
	g.record("closure", "keeps scope alive", { related: ["scope", "closure", "callback"] });
	assert.deepEqual(g.get("closure")?.related, ["scope", "callback"]);
	assert.deepEqual(g.get("scope")?.related, ["closure"]);
	g.record("callback", "a function handed over to be called later", { related: ["closure"] });
	assert.deepEqual(g.get("closure")?.related, ["scope", "callback"]);
});

test("lookups count and survive a save", () => {
	const { g, reopen } = stored();
	g.record("Thunk", "a wrapped value that runs later");
	assert.equal(g.lookup("thunk"), true);
	assert.equal(g.lookup("thunk"), true);
	assert.equal(g.lookup("nope"), false);
	g.save();
	assert.equal(reopen().get("thunk")?.lookups, 2);
});
