import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Settings } from "../src/settings.ts";

test("old global glossary files still yield definitions, and toggling keeps them", () => {
	const path = join(mkdtempSync(join(tmpdir(), "vocab-")), "vocab.json");
	writeFileSync(path, JSON.stringify({ version: 2, enabled: true, terms: { closure: { term: "Closure", definition: "keeps scope", kind: "term" } } }));
	const s = new Settings(path);
	assert.equal(s.enabled, true);
	assert.deepEqual(s.legacyDefinition("closure"), { kind: "term", definition: "keeps scope" });
	assert.equal(s.legacyDefinition("nope"), undefined);
	s.setEnabled(false);
	assert.equal(new Settings(path).enabled, false);
	assert.ok(readFileSync(path, "utf8").includes("keeps scope"));
});

test("a missing file means enabled", () => {
	const s = new Settings(join(mkdtempSync(join(tmpdir(), "vocab-")), "none.json"));
	assert.equal(s.enabled, true);
});
