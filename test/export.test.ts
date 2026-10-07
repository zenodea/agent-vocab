import assert from "node:assert/strict";
import { test } from "node:test";
import { Glossary } from "../src/glossary.ts";
import { EXPORT_MARKER, isOurs, renderGlossary } from "../src/export.ts";

test("renderGlossary groups by kind, sorts, and skips empty definitions", () => {
	const g = new Glossary();
	g.record("scope", "where names live", "/p");
	g.record("closure", "keeps scope alive", "/p", "term", new Date(), ["scope"]);
	g.record("seeding", "migrate first", "/p", "gotcha");
	g.record("bare", undefined, "/p");
	const md = renderGlossary(g.all(), new Date("2026-10-07T00:00:00Z"));
	assert.ok(md.startsWith(EXPORT_MARKER));
	assert.ok(md.includes("Exported 2026-10-07. 4 entries."));
	const terms = md.indexOf("## Terms");
	const gotchas = md.indexOf("## Gotchas");
	assert.ok(terms > 0 && gotchas > terms);
	assert.ok(md.indexOf("- **closure**: keeps scope alive (see: scope)") < md.indexOf("- **scope**: where names live"));
	assert.ok(!md.includes("bare"));
	assert.ok(md.endsWith("\n"));
});

test("isOurs recognises only our own files", () => {
	assert.equal(isOurs(`${EXPORT_MARKER}\n# Glossary`), true);
	assert.equal(isOurs("# Someone's glossary"), false);
});
