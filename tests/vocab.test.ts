import type { EventCalls, On } from "claude-code";
import { expect, mock, test } from "claude-code/testing";

type Engine = { [N in keyof EventCalls]: EventCalls[N] } & Record<string, any>;

/** The session around the mod: an empty store, no earlier replies, a terminal. */
function session(on: On, store: Record<string, unknown> = {}) {
	mock.store(on, store);
	mock.env(on, {});
	on("session.messages", () => ({ value: [] }));
	on("command.register", () => ({ value: { command: "vocab" } }));
	on("ui.status", () => ({ value: undefined }));
	on("session.start", (_$, e) => ({ cwd: e.cwd }));
}

const start = ($: Engine) => $.session.start({ cwd: "/tmp/project", surface: "terminal", isInteractive: true });

const reply = ($: Engine, text: string, uuid: string) =>
	$.session.append({
		message: { type: "assistant", role: "assistant", content: [{ type: "text", text }] },
		door: "response",
		origin: { kind: "model", model: "claude-opus-5-5" },
		uuid,
	});

const textOf = (result: { message?: { content: { type: string; text?: unknown }[] } }) => result.message?.content[0]?.text;

test("the system prompt asks for markers, and stops when toggled off", async ($, on) => {
	session(on);
	on("prompt.compose", () => ({ sections: [{ id: "intro", text: "You are Claude.", scope: "shared" }] }));
	on("command.run", () => ({ text: "not ours" }));
	await start($);

	const composed = await $.prompt.compose({
		model: "claude-opus-5-5",
		promptModel: "claude-opus-5-5",
		surfaces: ["terminal"],
		tools: [],
		outputStyle: null,
		traits: [],
	});
	expect(composed.sections.map((s) => s.id)).toEqual(["intro", "vocab:markers"]);
	expect(composed.sections[1]?.text).toContain("[[term|definition]]");

	await $.command.run({ command: "vocab", args: "off", origin: { kind: "composer" }, presentation: { isFullscreen: false, columns: 100 } });
	const off = await $.prompt.compose({
		model: "claude-opus-5-5",
		promptModel: "claude-opus-5-5",
		surfaces: ["terminal"],
		tools: [],
		outputStyle: null,
		traits: [],
	});
	expect(off.sections.map((s) => s.id)).toEqual(["intro"]);
});

test("stored replies lose their markers and keep numbering across replies", async ($, on) => {
	session(on);
	await start($);

	const first = await reply($, "A [[closure|a function that remembers its surroundings]] keeps [[scope|where names are visible]] alive.", "u1");
	expect(textOf(first)).toBe("A **closure**¹ keeps **scope**² alive.");

	const second = await reply($, "Every closure has a scope. A [[concept: thunk|a function that delays work]] too.", "u2");
	expect(textOf(second)).toBe("Every **closure**¹ has a **scope**². A ***thunk***³ too.");

	const count = await $.command.run({ command: "vocab", args: "count", origin: { kind: "composer" }, presentation: { isFullscreen: false, columns: 100 } });
	expect(count.text).toBe("3 hints this session, 3 in the glossary");
});

test("a subagent's reply and a reply without markers pass through untouched", async ($, on) => {
	session(on);
	await start($);

	const plain = await reply($, "Nothing to mark here.", "u1");
	expect(textOf(plain)).toBe("Nothing to mark here.");

	const sub = await $.session.append({
		message: { type: "assistant", role: "assistant", content: [{ type: "text", text: "A [[closure|x]]." }] },
		door: "response",
		origin: { kind: "model", model: "claude-haiku-5-5" },
		uuid: "u2",
		agentId: "agent-1",
	});
	expect(textOf(sub)).toBe("A [[closure|x]].");
});

test("the glossary survives a new session through the store", async ($, on) => {
	session(on);
	await start($);
	await reply($, "Use a [[mutex|a lock only one thread holds at a time]].", "u1");

	// A new session starts its numbers over but reads the glossary back from the store.
	await start($);
	const count = await $.command.run({ command: "vocab", args: "count", origin: { kind: "composer" }, presentation: { isFullscreen: false, columns: 100 } });
	expect(count.text).toBe("0 hints this session, 1 in the glossary");
});

test("the glossary pane finds a hint by its number", async ($, on) => {
	session(on);
	on("ui.open", () => ({ value: { isPlaced: true } }));
	await start($);
	await reply($, "A [[closure|a function that remembers]] and a [[thunk|a delayed call]].", "u1");
	await $.command.run({ command: "vocab", args: "2", origin: { kind: "composer" }, presentation: { isFullscreen: false, columns: 100 } });

	for (const surface of ["terminal", "desktop"] as const) {
		const ui = await $.ui.mount({
			plugin: "vocab",
			surface,
			component: "Pane",
			requestId: "vocab",
			props: { title: "Glossary", isFocused: true, bodyColumns: 80 },
		} as never);
		expect(await ui.find({ key: "row:thunk" })).toBeDefined();
		expect(await ui.find({ key: "row:closure" })).toBeUndefined();
		await ui.press({ key: "row:thunk" });
		expect(await ui.find({ type: "Text", text: "a delayed call" })).toBeDefined();
		await ui.unmount();
	}
});

test("a streaming reply shows names, never raw markers, and hands out no numbers early", async ($, on) => {
	session(on);
	let drawn = "";
	on("ui.render", { component: "AssistantMessage" }, (_$, e) => {
		drawn = (e.props as { text: string }).text;
		return { type: "Text", props: {}, children: [drawn] } as never;
	});
	await start($);

	const draw = (text: string) =>
		$.ui.render({ component: "AssistantMessage", surface: "terminal", requestId: "m1", props: { text, isFirstOfReply: true } } as never);

	await draw("A [[closure|a function that rem");
	expect(drawn).toBe("A **closure**");
	await draw("A [[closure|a function that remembers]] and [[sco");
	expect(drawn).toBe("A **closure**¹ and ");

	// The stored reply still gets number 1: the drawing only borrowed it.
	const stored = await reply($, "A [[closure|a function that remembers]].", "u1");
	expect(textOf(stored)).toBe("A **closure**¹.");
});
