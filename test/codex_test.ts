import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CODEX_PROMPT, numbersSoFar, OFF_NOTE, readReply } from "../codex/notes.ts";
import { Store } from "../codex/store.ts";
import { type Io, main } from "../codex/vocab.ts";

const scratch = () => mkdtempSync(join(tmpdir(), "vocab-codex-"));

/** A fresh glossary file and no pi file to import from. */
function setup(dir = scratch()) {
	const file = join(dir, "vocab.json");
	const io = (stdin = ""): Io => ({ store: new Store(file, join(dir, "no-pi.json")), out: () => {}, stdin, cwd: dir, script: "/x/codex/vocab.ts", hooksFile: join(dir, "hooks.json") });
	const run = (args: string[], stdin?: object) => main(args, io(stdin ? JSON.stringify(stdin) : ""));
	return { dir, file, run };
}

const REPLY = `A **closure**¹ keeps **scope**² alive, and a ***thunk***³ waits.

[vocab-1]: # "closure | a function that remembers its surroundings"
[vocab-2]: # 'scope | where names are visible | see: closure'
[vocab-3]: # (concept: thunk | a function that delays work until asked)`;

test("readReply takes the hidden lines in every title style, with kinds and links", () => {
	const notes = readReply(REPLY);
	assert.deepEqual(
		notes.map((n) => [n.index, n.kind, n.term, n.definition, n.related]),
		[
			[1, "term", "closure", "a function that remembers its surroundings", undefined],
			[2, "term", "scope", "where names are visible", ["closure"]],
			[3, "concept", "thunk", "a function that delays work until asked", undefined],
		],
	);
});

test("readReply picks up numbers without a line, as terms or bold-italic concepts", () => {
	const notes = readReply("Every **closure**¹ and ***thunk***³, no lines.");
	assert.deepEqual(notes.map((n) => [n.index, n.kind, n.term, n.definition]), [
		[1, "term", "closure", undefined],
		[3, "concept", "thunk", undefined],
	]);
});

test("numbersSoFar names what is taken and what comes next", () => {
	assert.equal(numbersSoFar([]), undefined);
	assert.equal(
		numbersSoFar([{ index: 2, term: "scope" }, { index: 1, term: "closure" }]),
		"Jargon numbers taken this session: ¹ closure, ² scope. Reuse these numbers for these terms; the next new term is ³.",
	);
});

test("hooks: start gives the instructions, stop files the reply, prompt carries the numbers on", async () => {
	const { run, file } = setup();
	assert.equal(await run(["hook", "start"], { session_id: "s1", source: "startup" }), CODEX_PROMPT);
	assert.equal(await run(["hook", "stop"], { session_id: "s1", last_assistant_message: REPLY }), "{}");
	assert.match(await run(["hook", "prompt"], { session_id: "s1" }), /taken this session: ¹ closure, ² scope, ³ thunk\. .* next new term is ⁴\.$/);
	assert.equal(await run(["count"]), "3 hints in the latest session, 3 in the glossary");

	// A later reply mentioning number 1 again does not count it twice.
	await run(["hook", "stop"], { session_id: "s1", last_assistant_message: "Back to **closure**¹." });
	assert.equal(JSON.parse(readFileSync(file, "utf8")).terms.closure.count, 1);
});

test("lookups by number, superscript and word; a lookup is counted", async () => {
	const { run, file } = setup();
	await run(["hook", "stop"], { session_id: "s1", cwd: "/p", last_assistant_message: REPLY });
	assert.match(await run(["2"]), /^² scope {2}term\n {2}where names are visible\n {2}see: closure$/);
	assert.match(await run(["³"]), /thunk {2}concept/);
	assert.match(await run(["closure"]), /a function that remembers/);
	assert.equal(await run(["9"]), "No hint ⁹ in the latest Codex session.");
	const data = JSON.parse(readFileSync(file, "utf8"));
	assert.equal(data.terms.scope.lookups, 1);
	assert.equal(data.terms.closure.lookups, 1);
	assert.equal(data.terms.closure.count, 1);
});

test("toggling off tells a prompted session once, toggling on gives the instructions back", async () => {
	const { run } = setup();
	await run(["hook", "start"], { session_id: "s1" });
	await run(["off"]);
	assert.equal(await run(["hook", "prompt"], { session_id: "s1" }), OFF_NOTE);
	assert.equal(await run(["hook", "prompt"], { session_id: "s1" }), "");
	assert.equal(await run(["hook", "start"], { session_id: "s2" }), "");
	await run(["on"]);
	assert.equal(await run(["hook", "prompt"], { session_id: "s1" }), CODEX_PROMPT);
});

test("a stop hook with broken input still answers JSON", async () => {
	const { dir } = setup();
	const io: Io = { store: new Store(join(dir, "v.json"), join(dir, "none")), out: () => {}, stdin: "not json" };
	assert.equal(await main(["hook", "stop"], io), "{}");
});

test("install adds the three hooks once, keeps other hooks, and uninstall takes only ours away", async () => {
	const { run, dir } = setup();
	const hooks = join(dir, "hooks.json");
	writeFileSync(hooks, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "other" }] }] } }));
	await run(["install"]);
	assert.equal(await run(["install"]), "The vocab hooks are already installed.");
	const installed = JSON.parse(readFileSync(hooks, "utf8")).hooks;
	assert.deepEqual(Object.keys(installed).sort(), ["SessionStart", "Stop", "UserPromptSubmit"]);
	assert.equal(installed.Stop.length, 2);
	assert.equal(installed.Stop[1].hooks[0].command, "node '/x/codex/vocab.ts' hook stop");
	await run(["uninstall"]);
	assert.deepEqual(JSON.parse(readFileSync(hooks, "utf8")), { hooks: { Stop: [{ hooks: [{ type: "command", command: "other" }] }] } });
});

test("the glossary starts from pi's old global file when there is no Codex file yet", () => {
	const dir = scratch();
	const pi = join(dir, "pi.json");
	writeFileSync(pi, JSON.stringify({ terms: { oop: { term: "OOP", definition: "objects bundle data and functions" } } }));
	const store = new Store(join(dir, "vocab.json"), pi);
	assert.equal(store.glossary.get("oop")?.definition, "objects bundle data and functions");
});

test("export writes GLOSSARY.md and refuses a file it did not write", async () => {
	const { run, dir } = setup();
	await run(["hook", "stop"], { session_id: "s1", last_assistant_message: REPLY });
	writeFileSync(join(dir, "GLOSSARY.md"), "# mine\n");
	assert.match(await run(["export"]), /--force/);
	assert.match(await run(["export", "--force"]), /Wrote 3 entries/);
	assert.match(readFileSync(join(dir, "GLOSSARY.md"), "utf8"), /\*\*thunk\*\*: a function that delays work/);
});
