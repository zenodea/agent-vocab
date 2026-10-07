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
 * message_end the stored message is rewritten the same way and definitions go
 * to ~/.pi/agent/vocab.json. Numbers are per session: closure stays ¹² until
 * you start a new session. Terms and concepts are global; the other kinds only
 * show inside the project they came from.
 */

import { join } from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Glossary } from "./glossary.ts";
import { type Hint, type KnownTerm, normalizeTerm, recoverHints, rewrite } from "./markers.ts";
import { KIND_LABEL, type OverlayResult, VocabOverlay } from "./overlay.ts";
import { PROMPT_SECTION } from "./prompt.ts";
import { pickCards, QuizOverlay, type QuizResult } from "./quiz.ts";

// PI_VOCAB_FILE overrides the location, mostly for tests.
const GLOSSARY_FILE = process.env.PI_VOCAB_FILE || join(getAgentDir(), "vocab.json");

type TextBlock = { type: "text"; text: string };
const isText = (c: { type: string }): c is TextBlock => c.type === "text";

export default function (pi: ExtensionAPI) {
	const glossary = new Glossary(GLOSSARY_FILE);

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
		if (!glossary.enabled) {
			ctx.ui.setStatus("vocab", ctx.ui.theme.fg("dim", "vocab off"));
			return;
		}
		const n = known.size;
		ctx.ui.setStatus("vocab", n > 0 ? ctx.ui.theme.fg("accent", `vocab ${n}`) : undefined);
	};

	const candidates = (ctx: ExtensionContext): KnownTerm[] =>
		glossary.all(ctx.cwd).map((e) => ({ kind: e.kind, term: e.term, definition: e.definition || undefined }));

	/** Rewrite the text blocks of an assistant message. Returns undefined when nothing changed. */
	const rewriteBlocks = (content: readonly { type: string }[], ctx: ExtensionContext, streaming: boolean) => {
		let changed = false;
		const cands = candidates(ctx);
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
					new VocabOverlay(theme, { hints: hints(), glossary: glossary.all(ctx.cwd), initialQuery, width: 72 }, done),
				{ overlay: true, overlayOptions: { width: "80%", maxHeight: "80%", anchor: "center", minWidth: 40 } },
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
		const cards = pickCards(glossary.all(ctx.cwd), n);
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

	// On resume, read every number back out of the branch so they stay stable.
	pi.on("session_start", async (_event, ctx) => {
		resetSession();
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message" || entry.message.role !== "assistant") continue;
			const text = entry.message.content.filter(isText).map((c) => c.text).join("\n");
			for (const h of recoverHints(text)) {
				const key = normalizeTerm(h.term);
				if (known.has(key)) continue;
				const stored = glossary.get(h.term);
				known.set(key, { ...h, kind: stored?.kind ?? "term", definition: stored?.definition, related: stored?.related });
				recorded.add(key);
			}
		}
		showStatus(ctx);
	});

	pi.on("before_agent_start", async (event) => {
		if (glossary.enabled) event.systemPromptOptions.sections.vocab = PROMPT_SECTION;
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
				const next = sub === "toggle" ? !glossary.enabled : sub === "on";
				glossary.setEnabled(next);
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
			if (sub === "count") return ctx.ui.notify(`${glossary.size} terms in ${GLOSSARY_FILE}`, "info");
			await openOverlay(ctx, sub ? [sub, ...rest].join(" ") : undefined);
		},
	});
}
