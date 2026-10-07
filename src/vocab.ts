/**
 * pi-vocab: numbered jargon hints in replies, with a one-key glossary.
 *
 *   alt+w          open the glossary; a number picks a hint, typing searches
 *                  everything ever stored
 *   alt+shift+w    look up the text in the input box
 *   /vocab         same as alt+w
 *   /vocab toggle  stop or resume asking the model to mark terms (on by default)
 *   /vocab forget <term>
 *   /vocab quiz [n]  flashcards for the entries most likely to have slipped
 *
 * The model writes [[term|definition]] or [[kind: name|definition]] for a
 * concept, why, where, how or gotcha. While the reply streams, the text shown
 * on screen is rewritten to **name**¹ as soon as each marker is complete; at
 * message_end the stored message is rewritten the same way. The glossary lives
 * inside the pi session as a custom entry, so it follows the session and its
 * branches, and a new session starts empty. Numbers are per session too:
 * closure stays ¹² until you start a new session. Only the on/off flag is
 * global, in ~/.pi/agent/vocab.json.
 */

import { join } from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Glossary, type GlossaryData, isKind } from "./glossary.ts";
import { type Hint, type KnownTerm, normalizeTerm, recoverHints, rewrite, stripAnsi } from "./markers.ts";
import { KIND_LABEL, type OverlayResult, VocabOverlay } from "./overlay.ts";
import { PROMPT_SECTION } from "./prompt.ts";
import { pickCards, QuizOverlay, type QuizResult } from "./quiz.ts";
import { Settings } from "./settings.ts";

// PI_VOCAB_FILE overrides the location of the on/off flag, mostly for tests.
const SETTINGS_FILE = process.env.PI_VOCAB_FILE || join(getAgentDir(), "vocab.json");
/** customType of the session entry that holds the glossary snapshot. */
const ENTRY_TYPE = "vocab";

type TextBlock = { type: "text"; text: string };
const isText = (c: { type: string }): c is TextBlock => c.type === "text";

export default function (pi: ExtensionAPI) {
	const settings = new Settings(SETTINGS_FILE);
	// Each save appends a fresh snapshot to the session; session_start reads the last one back.
	const glossary = new Glossary((data) => pi.appendEntry<GlossaryData>(ENTRY_TYPE, data));

	/** Every hint of this session, keyed by normalized name. Numbers never change. */
	let known = new Map<string, Hint>();
	/** Hints already written to the glossary, so streaming never double counts. */
	let recorded = new Set<string>();

	const hints = (): Hint[] => [...known.values()].sort((a, b) => a.index - b.index);

	const resetSession = () => {
		known = new Map();
		recorded = new Set();
	};

	const showStatus = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		if (!settings.enabled) {
			ctx.ui.setStatus("vocab", ctx.ui.theme.fg("dim", "vocab off"));
			return;
		}
		const n = known.size;
		ctx.ui.setStatus("vocab", n > 0 ? ctx.ui.theme.fg("accent", `vocab ${n}`) : undefined);
	};

	const candidates = (): KnownTerm[] =>
		glossary.all().map((e) => ({ kind: e.kind, term: e.term, definition: e.definition || undefined }));

	/** Rewrite the text blocks of an assistant message. Returns undefined when nothing changed. */
	const rewriteBlocks = (content: readonly { type: string }[], ctx: ExtensionContext, streaming: boolean) => {
		let changed = false;
		const cands = candidates();
		const out = content.map((block) => {
			if (!isText(block) || !block.text.trim()) return block;
			const result = rewrite(block.text, 1, known, cands, { streaming });
			if (result.text === block.text) return block;
			changed = true;
			return { ...block, text: result.text };
		});
		return changed ? out : undefined;
	};

	let overlayOpen = false;
	const openOverlay = async (ctx: ExtensionContext, initialQuery?: string) => {
		if (!ctx.hasUI || overlayOpen) return;
		overlayOpen = true;
		let result: OverlayResult | undefined;
		try {
			result = await ctx.ui.custom<OverlayResult>(
				(_tui, theme, _keys, done) =>
					new VocabOverlay(theme, { hints: hints(), glossary: glossary.all(), initialQuery, width: 72 }, done),
				// Anchored at the top: the search box and list stay put, details grow downward.
				{ overlay: true, overlayOptions: { width: "80%", maxHeight: "90%", anchor: "top-center", row: 2, minWidth: 40 } },
			);
		} finally {
			overlayOpen = false;
		}
		if (!result) return;
		// Every entry the user deliberately landed on counts as a lookup.
		let counted = false;
		for (const item of result.viewed) counted = glossary.lookup(item.term, item.kind) || counted;
		if (counted) glossary.save();
		if (result.action === "explain" && result.item) {
			const { kind, term } = result.item;
			const label = kind === "term" ? "" : ` (${KIND_LABEL[kind]})`;
			pi.sendUserMessage(
				`Explain [[${kind === "term" ? "" : `${kind}: `}${term}]] again${label}. Plain words, under 80 words, one concrete example from this project. Keep the [[...]] marker so it keeps its number.`,
			);
		}
	};

	/** Five flashcards from the entries most likely to have slipped. */
	const runQuiz = async (ctx: ExtensionContext, n: number) => {
		if (!ctx.hasUI || overlayOpen) return;
		const cards = pickCards(glossary.all(), n);
		overlayOpen = true;
		let result: QuizResult | undefined;
		try {
			result = await ctx.ui.custom<QuizResult>((_tui, theme, _keys, done) => new QuizOverlay(theme, cards, done), {
				overlay: true,
				overlayOptions: { width: "80%", maxHeight: "80%", anchor: "center", minWidth: 40 },
			});
		} finally {
			overlayOpen = false;
		}
		if (!result || result.asked.length === 0) return;
		for (const e of result.asked) glossary.recordQuiz(e, result.missed.includes(e));
		glossary.save();
	};

	// On resume, load the last glossary snapshot on this branch, then read every
	// number back out of the replies so they stay stable.
	pi.on("session_start", async (_event, ctx) => {
		resetSession();
		const branch = ctx.sessionManager.getBranch();
		const last = [...branch].reverse().find((e) => e.type === "custom" && e.customType === ENTRY_TYPE);
		glossary.load(last && last.type === "custom" ? last.data : undefined);
		let migrated = false;
		for (const entry of branch) {
			if (entry.type !== "message" || entry.message.role !== "assistant") continue;
			const text = entry.message.content.filter(isText).map((c) => c.text).join("\n");
			for (const h of recoverHints(text)) {
				const key = normalizeTerm(h.term);
				if (known.has(key)) continue;
				let stored = glossary.get(h.term);
				if (!stored) {
					// Sessions from before the glossary moved into the session file: pull the
					// definition out of the old global file, once, and keep it here from now on.
					const old = settings.legacyDefinition(h.term);
					if (old) {
						stored = glossary.record(h.term, old.definition, ctx.cwd, isKind(old.kind) ? old.kind : "term");
						migrated = true;
					}
				}
				known.set(key, { ...h, kind: stored?.kind ?? "term", definition: stored?.definition, related: stored?.related });
				recorded.add(key);
			}
		}
		if (migrated) glossary.save();
		showStatus(ctx);
	});

	// The underline styling is raw ANSI. The screen keeps it; the model gets clean text.
	pi.on("context", async (event) => {
		let changed = false;
		const messages = event.messages.map((m) => {
			if (m.role !== "assistant") return m;
			if (!m.content.some((c) => isText(c) && c.text.includes("\x1b["))) return m;
			changed = true;
			return { ...m, content: m.content.map((c) => (isText(c) ? { ...c, text: stripAnsi(c.text) } : c)) };
		});
		return changed ? { messages } : undefined;
	});

	pi.on("before_agent_start", async (event) => {
		if (settings.enabled) event.systemPromptOptions.sections.vocab = PROMPT_SECTION;
		else delete event.systemPromptOptions.sections.vocab;
	});

	// While streaming, swap the text the screen shows. The event's message is the
	// object the TUI renders next, and a copy of the model's own buffer, so this
	// changes the display only.
	pi.on("message_update", async (event, ctx) => {
		if (event.message.role !== "assistant" || !ctx.hasUI) return;
		if (!event.message.content.some((c) => isText(c) && c.text.includes("[["))) return;
		const content = rewriteBlocks(event.message.content, ctx, true);
		if (content) {
			event.message.content = content as typeof event.message.content;
			showStatus(ctx);
		}
	});

	pi.on("message_end", async (event, ctx) => {
		const msg = event.message;
		if (msg.role !== "assistant") return;
		const content = rewriteBlocks(msg.content, ctx, false);
		// Record whatever is new, whether it was first seen streaming or just now.
		let saved = false;
		for (const [key, h] of known) {
			if (recorded.has(key)) continue;
			recorded.add(key);
			const entry = glossary.record(h.term, h.definition, ctx.cwd, h.kind, new Date(), h.related ?? []);
			if (!h.definition) h.definition = entry.definition || undefined;
			h.related = entry.related;
			saved = true;
		}
		if (saved) glossary.save();
		showStatus(ctx);
		if (!content) return;
		return { message: { ...msg, content: content as typeof msg.content } };
	});

	pi.registerShortcut("alt+w", {
		description: "vocab: open the glossary",
		handler: (ctx) => openOverlay(ctx),
	});

	pi.registerShortcut("alt+shift+w", {
		description: "vocab: look up the word in the input box",
		handler: (ctx) => openOverlay(ctx, ctx.ui.getEditorText().trim() || undefined),
	});

	pi.registerCommand("vocab", {
		description: "Glossary of terms the agent explained. /vocab quiz [n] | toggle | forget <term>",
		handler: async (args, ctx) => {
			const [sub, ...rest] = args.trim().split(/\s+/).filter(Boolean);
			if (sub === "toggle" || sub === "on" || sub === "off") {
				const next = sub === "toggle" ? !settings.enabled : sub === "on";
				settings.setEnabled(next);
				showStatus(ctx);
				ctx.ui.notify(next ? "vocab on: new terms get marked from your next message" : "vocab off: no more marking", "info");
				return;
			}
			if (sub === "forget") {
				const term = rest.join(" ");
				if (!term) return ctx.ui.notify("usage: /vocab forget <term>", "warning");
				ctx.ui.notify(glossary.forget(term) ? `forgot "${term}"` : `"${term}" is not in the glossary`, "info");
				known.delete(normalizeTerm(term));
				showStatus(ctx);
				return;
			}
			if (sub === "quiz") {
				const n = Number.parseInt(rest[0] ?? "", 10);
				return runQuiz(ctx, Number.isFinite(n) && n > 0 ? Math.min(n, 20) : 5);
			}
			if (sub === "count") return ctx.ui.notify(`${glossary.size} terms in this session`, "info");
			await openOverlay(ctx, sub ? [sub, ...rest].join(" ") : undefined);
		},
	});
}
