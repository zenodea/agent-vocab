/**
 * vocab for Claude Code: the same jargon hints as the pi extension.
 *
 *   /vocab                 open the glossary pane; a number picks a hint,
 *                          typing searches everything ever stored
 *   /vocab <word or n>     open it already searching
 *   /vocab quiz [n]        flashcards for the entries most likely to have slipped
 *   /vocab export [path] [--force]  write GLOSSARY.md in the project
 *   /vocab toggle | on | off        stop or resume asking the model to mark terms
 *   /vocab forget <term>
 *
 * The model writes [[term|definition]]. While a reply streams, the
 * AssistantMessage drawing swaps each marker for **term**¹; when the reply's
 * block is stored (session.append) it is rewritten the same way, so the model
 * never reads the markers back. Numbers are per session and recovered from
 * the stored replies when a session resumes or the mod reloads. The glossary
 * is global, in the plugin store, so the pane and the quiz span sessions.
 */

import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";

import { isOurs, renderGlossary } from "../src/export.ts";
import { type Entry, Glossary, type GlossaryData, isKind, KIND_GLYPH, KIND_LABEL, keyOf, normalize } from "../src/glossary.ts";
import { type Hint, recoverHints, rewrite, superscript } from "../src/markers.ts";
import { PROMPT_SECTION } from "../src/prompt.ts";
import { pickCards } from "../src/cards.ts";

const PANE = "vocab";
const QUIZ = "vocab-quiz";
const STORE_GLOSSARY = "glossary";
const STORE_ENABLED = "enabled";

const query = atom({ plugin: "vocab", key: "query" } as const, "");
const selected = atom({ plugin: "vocab", key: "selected" } as const, null);
const rev = atom({ plugin: "vocab", key: "rev" } as const, 0);
const quiz = atom({ plugin: "vocab", key: "quiz" } as const, null);

type TextBlock = { type: "text"; text: string };
const isText = (block: { type: string }): block is TextBlock => block.type === "text" && typeof (block as TextBlock).text === "string";

/** Module state. A reload starts it over; session.start fills it again. */
const glossary = new Glossary();
let enabled = true;
/** Every hint of this session, keyed by normalized name. Numbers never change. */
let known = new Map<string, Hint>();

const hints = (): Hint[] => [...known.values()].sort((a, b) => a.index - b.index);
const entryOf = (h: Hint): Entry | undefined => glossary.get(h.term, h.kind) ?? glossary.get(h.term);
const keyOfEntry = (e: Entry): string => keyOf(e.kind, e.term);
const byKey = (key: string | null): Entry | undefined => (key ? glossary.all().find((e) => keyOfEntry(e) === key) : undefined);

async function save($: EngineInterface) {
	await $.store.set(STORE_GLOSSARY, glossary.snapshot());
	await update($, rev, (n) => n + 1);
}

function showStatus($: EngineInterface) {
	if (!enabled) return $.ui.status("vocab off");
	$.ui.status(known.size > 0 ? `vocab ${known.size}` : undefined);
}

/** The pi extension's old global file kept a few definitions; take them once. */
async function importLegacy($: EngineInterface) {
	const home = await $.env.get("HOME");
	if (!home) return false;
	try {
		const parsed = JSON.parse(await $.fs.read(`${home}/.pi/agent/vocab.json`)) as {
			terms?: Record<string, { term?: string; definition?: string; kind?: string }>;
		};
		let added = false;
		for (const t of Object.values(parsed.terms ?? {})) {
			if (!t.term || !t.definition) continue;
			glossary.record(t.term, t.definition, { kind: t.kind && isKind(t.kind) ? t.kind : "term" });
			added = true;
		}
		return added;
	} catch {
		return false;
	}
}

async function openGlossary($: EngineInterface, initial: string) {
	await update($, query, () => initial);
	await update($, selected, () => null);
	return $.ui.open({ id: PANE, title: "Glossary", focus: true, closeOnEscape: true });
}

async function startQuiz($: EngineInterface, n: number) {
	const cards = pickCards(glossary.all(), n);
	if (cards.length === 0) return false;
	await update($, quiz, () => ({ keys: cards.map(keyOfEntry), at: 0, isRevealed: false, missed: [] }));
	await $.ui.open({ id: QUIZ, title: "Quiz", focus: true, closeOnEscape: true });
	return true;
}

async function pick($: EngineInterface, entry: Entry) {
	await update($, selected, () => keyOfEntry(entry));
	if (glossary.lookup(entry.term, entry.kind)) await save($);
}

async function forget($: EngineInterface, entry: Entry) {
	glossary.forget(entry.term, entry.kind);
	known.delete(normalize(entry.term));
	await update($, selected, () => null);
	await save($);
	showStatus($);
}

async function explainAgain($: EngineInterface, entry: Entry) {
	const label = entry.kind === "term" ? "" : ` (${KIND_LABEL[entry.kind]})`;
	const marker = `${entry.kind === "term" ? "" : `${entry.kind}: `}${entry.term}`;
	await $.ui.close({ id: PANE });
	await $.prompt.submit({
		text: `Explain [[${marker}]] again${label}. Plain words, under 80 words, one concrete example from this project. Keep the [[...]] marker so it keeps its number.`,
	});
}

async function answerCard($: EngineInterface, card: Entry | undefined, missed: boolean) {
	if (card) {
		glossary.recordQuiz(card, missed);
		await save($);
	}
	await update($, quiz, (s) =>
		s ? { ...s, at: s.at + 1, isRevealed: false, missed: missed ? [...s.missed, s.keys[s.at]!] : s.missed } : s,
	);
}

/** Rows for the list: this session's hints first, then the rest of the glossary. */
function matches(q: string): { entry: Entry; hint?: Hint }[] {
	const wanted = normalize(q);
	const n = /^\d+$/.test(wanted) ? Number(wanted) : 0;
	const rows: { entry: Entry; hint?: Hint }[] = [];
	const seen = new Set<string>();
	for (const h of hints()) {
		const entry = entryOf(h);
		if (!entry) continue;
		if (n ? h.index !== n : wanted && !normalize(entry.term).includes(wanted)) continue;
		rows.push({ entry, hint: h });
		seen.add(keyOfEntry(entry));
	}
	if (n) return rows;
	for (const entry of glossary.all()) {
		if (seen.has(keyOfEntry(entry))) continue;
		const haystack = normalize(`${entry.term} ${entry.definition}`);
		if (wanted && !haystack.includes(wanted)) continue;
		rows.push({ entry });
	}
	return rows;
}

export const register: Register = (on) => {
	on("session.start", async ($, e, next) => {
		known = new Map();
		const stored = (await $.store.get(STORE_GLOSSARY)) as GlossaryData | undefined;
		glossary.load(stored);
		enabled = (await $.store.get(STORE_ENABLED)) !== false;
		if (!stored && (await importLegacy($))) await save($);

		// Resumed session or a reload: read the numbers back out of the stored replies.
		for (const message of await $.session.messages()) {
			if (message.role !== "assistant") continue;
			for (const h of recoverHints(message.text)) {
				const key = normalize(h.term);
				if (known.has(key)) continue;
				const entry = glossary.get(h.term);
				known.set(key, { ...h, kind: entry?.kind ?? "term", definition: entry?.definition || undefined, related: entry?.related });
			}
		}

		await $.command.register({
			name: "vocab",
			description: "Glossary of terms Claude explained",
			argumentHint: "[word | n | quiz [n] | export [path] | toggle | forget <term>]",
		});
		showStatus($);
		return next(e);
	});

	on("session.end", ($, e, next) => {
		if (e.reason === "clear") known = new Map();
		return next(e);
	});

	on("prompt.compose", async ($, e, next) => {
		const composed = await next(e);
		if (!enabled || e.traits.includes("bare")) return composed;
		return { ...composed, sections: [...composed.sections, { id: "vocab:markers", text: PROMPT_SECTION, scope: "session" }] };
	});

	// The stored reply: markers become **name**¹ and new entries land in the glossary.
	on("session.append", async ($, e, next) => {
		if (e.door !== "response" || e.agentId || e.message.role !== "assistant") return next(e);
		if (!e.message.content.some((b) => isText(b) && b.text.includes("[["))) return next(e);
		const before = new Set(known.keys());
		const content = e.message.content.map((block) => {
			if (!isText(block)) return block;
			return { ...block, text: rewrite(block.text, { known, ansi: false }).text };
		});
		for (const [key, h] of known) {
			if (before.has(key)) continue;
			const entry = glossary.record(h.term, h.definition, { kind: h.kind, related: h.related });
			if (!h.definition) h.definition = entry.definition || undefined;
			h.related = entry.related;
		}
		if (known.size > before.size) {
			await save($);
			showStatus($);
		}
		return next({ ...e, message: { ...e.message, content } });
	});

	// While the reply streams, show what the stored text will be. A copy of the
	// numbers, so the stored rewrite hands out the same ones.
	on("ui.render", { component: "AssistantMessage" }, ($, e, next) => {
		if (!e.props.text.includes("[[")) return next(e);
		const text = rewrite(e.props.text, { known: new Map(known), ansi: false, streaming: true }).text;
		return next({ ...e, props: { ...e.props, text } });
	});

	on("command.run", { command: "vocab" }, async ($, e) => {
		const [sub, ...rest] = e.args.trim().split(/\s+/).filter(Boolean);
		if (sub === "toggle" || sub === "on" || sub === "off") {
			enabled = sub === "toggle" ? !enabled : sub === "on";
			await $.store.set(STORE_ENABLED, enabled);
			showStatus($);
			return { text: enabled ? "vocab on: new terms get marked from the next reply" : "vocab off: no more marking" };
		}
		if (sub === "forget") {
			const term = rest.join(" ");
			if (!term) return { text: "usage: /vocab forget <term>" };
			const removed = glossary.forget(term);
			known.delete(normalize(term));
			if (removed) await save($);
			showStatus($);
			return { text: removed ? `forgot "${term}"` : `"${term}" is not in the glossary` };
		}
		if (sub === "quiz") {
			const n = Number.parseInt(rest[0] ?? "", 10);
			const started = await startQuiz($, Number.isFinite(n) && n > 0 ? Math.min(n, 20) : 5);
			return { text: started ? "Quiz opened." : "Nothing to quiz on yet." };
		}
		if (sub === "export") {
			// GLOSSARY.md in the project, or the given path. Never clobbers a file vocab did not write.
			const target = rest.find((a) => a !== "--force") ?? "GLOSSARY.md";
			const force = rest.includes("--force");
			if (glossary.size === 0) return { text: "nothing to export yet" };
			if (!force && (await $.fs.exists(target)) && !isOurs(await $.fs.read(target))) {
				return { text: `${target} exists and was not written by vocab. Add --force to overwrite.` };
			}
			await $.fs.write(target, renderGlossary(glossary.all()));
			return { text: `wrote ${glossary.size} entries to ${target}` };
		}
		if (sub === "count") return { text: `${known.size} hints this session, ${glossary.size} in the glossary` };
		const opened = await openGlossary($, sub ? [sub, ...rest].join(" ") : "");
		return { text: opened.isPlaced ? "Glossary opened." : `Glossary could not open: ${opened.reason}` };
	});

	on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
		const elements = $.ui.resolve(e);
		const { Box, Button, Text } = elements;
		// Every surface but mobile has a text field; there the list is the whole pane.
		const Input = "Input" in elements ? elements.Input : undefined;
		await read($, rev);
		const q = await read($, query);
		const current = byKey(await read($, selected));
		const rows = matches(q);
		const room = Math.max(3, Math.min(12, (e.viewport?.rows ?? 24) - 14));
		const hintOf = (entry: Entry) => hints().find((h) => entryOf(h) === entry);

		return (
			<Box flexDirection="column">
				{Input && (
					<Input
						key="q"
						placeholder="a number, or a word to search"
						value={q}
						autoFocus
						onInput={(value: string) => update($, query, () => value)}
						onSubmit={(value: string) => {
							const first = matches(value)[0];
							return first ? pick($, first.entry) : undefined;
						}}
					/>
				)}
				{rows.length === 0 && (
					<Text dimColor italic>
						{glossary.size === 0 ? "Nothing explained yet." : "No match."}
					</Text>
				)}
				{rows.slice(0, room).map(({ entry, hint }) => (
					<Button key={`row:${keyOfEntry(entry)}`} plain onPress={() => pick($, entry)}>
						<Text dimColor>{hint ? `${superscript(hint.index)} `.padStart(4) : "    "}</Text>
						<Text bold italic={entry.kind === "concept"}>
							{entry.term}
						</Text>
						<Text dimColor> {KIND_GLYPH[entry.kind]}</Text>
					</Button>
				))}
				{rows.length > room && <Text dimColor italic>{`${rows.length - room} more, type to narrow`}</Text>}
				{current && (
					<Box flexDirection="column" marginTop={1}>
						<Text>
							<Text bold italic={current.kind === "concept"}>
								{current.term}
							</Text>
							<Text dimColor italic>
								{"  "}
								{KIND_LABEL[current.kind]}
								{hintOf(current) ? `, ${superscript(hintOf(current)!.index)} this session` : ""}
							</Text>
						</Text>
						<Text>{current.definition || "No definition stored yet."}</Text>
						{current.related.length > 0 && (
							<Box>
								<Text dimColor italic>
									see:{" "}
								</Text>
								{current.related.map((name) => {
									const other = glossary.get(name);
									return other ? (
										<Button key={`see:${keyOfEntry(other)}`} plain onPress={() => pick($, other)}>
											{name}{" "}
										</Button>
									) : (
										<Text dimColor>{name} </Text>
									);
								})}
							</Box>
						)}
						<Box marginTop={1}>
							<Button
								key="explain"
								label="explain again"
								hotkey="e"
								onPress={() => explainAgain($, current)}
							/>
							<Text> </Text>
							<Button
								key="forget"
								label="forget"
								onPress={() => forget($, current)}
							/>
						</Box>
					</Box>
				)}
			</Box>
		);
	});

	on("ui.render", { component: "Pane", requestId: QUIZ }, async ($, e) => {
		const { Box, Button, Text } = $.ui.resolve(e);
		await read($, rev);
		const state = await read($, quiz);
		if (!state) return <Text dimColor italic>No quiz running. /vocab quiz starts one.</Text>;

		if (state.at >= state.keys.length) {
			const got = state.keys.length - state.missed.length;
			return (
				<Box flexDirection="column">
					<Text bold>{`${got} of ${state.keys.length} remembered.`}</Text>
					{state.missed.length > 0 && (
						<Text dimColor italic>{`Worth another look: ${state.missed.map((k) => byKey(k)?.term ?? k).join(", ")}`}</Text>
					)}
					<Button key="close" label="close" hotkey="q" role="dismiss" onPress={() => $.ui.close({ id: QUIZ })} />
				</Box>
			);
		}

		const card = byKey(state.keys[state.at] ?? null);
		if (!card) {
			void answerCard($, card, false);
			return <Text dimColor>…</Text>;
		}
		// Terms show the definition and ask for the name; other kinds ask the other way round.
		const asksForName = card.kind === "term";
		return (
			<Box flexDirection="column">
				<Text dimColor italic>{`card ${state.at + 1} of ${state.keys.length}, ${KIND_LABEL[card.kind]}`}</Text>
				<Box marginTop={1}>
					{asksForName ? <Text>{card.definition}</Text> : <Text bold italic={card.kind === "concept"}>{card.term}</Text>}
				</Box>
				<Box marginTop={1}>
					{state.isRevealed ? (
						asksForName ? <Text bold>{card.term}</Text> : <Text>{card.definition}</Text>
					) : (
						<Text dimColor italic>
							{asksForName ? "What is it called?" : "Say it in your own words."}
						</Text>
					)}
				</Box>
				<Box marginTop={1}>
					{state.isRevealed ? (
						<>
							<Button key="got" label="got it" hotkey="y" variant="primary" onPress={() => answerCard($, card, false)} />
							<Text> </Text>
							<Button key="missed" label="missed" hotkey="n" onPress={() => answerCard($, card, true)} />
						</>
					) : (
						<Button
							key="reveal"
							label="reveal"
							hotkey="r"
							variant="primary"
							autoFocus
							onPress={() => update($, quiz, (s) => (s ? { ...s, isRevealed: true } : s))}
						/>
					)}
				</Box>
			</Box>
		);
	});
};
