/**
 * pi-vocab: numbered jargon hints in replies, with a one-key glossary.
 *
 *   alt+w          open the glossary; 1-9 picks a term from the last reply,
 *                  typing searches everything ever stored
 *   alt+shift+w    look up the text in the input box
 *   /vocab         same as alt+w
 *   /vocab toggle  stop or resume asking the model to mark terms (on by default)
 *   /vocab forget <term>
 *
 * The model writes [[term|definition]]; message_end turns that into **term**¹
 * and stores the definition in ~/.pi/agent/vocab.json.
 */

import { join } from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Glossary } from "./glossary.ts";
import { type Hint, recoverHints, rewrite } from "./markers.ts";
import { VocabOverlay } from "./overlay.ts";
import { PROMPT_SECTION } from "./prompt.ts";

// PI_VOCAB_FILE overrides the location, mostly for tests.
const GLOSSARY_FILE = process.env.PI_VOCAB_FILE || join(getAgentDir(), "vocab.json");

export default function (pi: ExtensionAPI) {
	const glossary = new Glossary(GLOSSARY_FILE);

	/** Hints from the reply currently on screen, in order. */
	let hints: Hint[] = [];
	/** Same hints keyed by normalized term, so a repeat keeps its number. */
	let known = new Map<string, Hint>();

	const resetHints = () => {
		hints = [];
		known = new Map();
	};

	const showStatus = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		if (!glossary.enabled) {
			ctx.ui.setStatus("vocab", ctx.ui.theme.fg("dim", "vocab off"));
			return;
		}
		const n = hints.length;
		ctx.ui.setStatus("vocab", n > 0 ? ctx.ui.theme.fg("accent", `vocab ${n}`) : undefined);
	};

	let overlayOpen = false;
	const openOverlay = async (ctx: ExtensionContext, initialQuery?: string, initialIndex?: number) => {
		if (!ctx.hasUI || overlayOpen) return;
		overlayOpen = true;
		try {
			await ctx.ui.custom<undefined>(
				(_tui, theme, _keys, done) =>
					new VocabOverlay(theme, { hints, glossary: glossary.all(), initialQuery, initialIndex, width: 72 }, done),
				{ overlay: true, overlayOptions: { width: "80%", maxHeight: "80%", anchor: "center", minWidth: 40 } },
			);
		} finally {
			overlayOpen = false;
		}
	};


	// On resume, find the last assistant reply and read its hint numbers back.
	pi.on("session_start", async (_event, ctx) => {
		resetHints();
		const branch = ctx.sessionManager.getBranch();
		for (let i = branch.length - 1; i >= 0; i--) {
			const entry = branch[i]!;
			if (entry.type !== "message" || entry.message.role !== "assistant") continue;
			const text = entry.message.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n");
			const recovered = recoverHints(text);
			if (recovered.length === 0) continue;
			hints = recovered.map((h) => ({ ...h, definition: glossary.get(h.term)?.definition }));
			for (const h of hints) known.set(h.term.toLowerCase(), h);
			break;
		}
		showStatus(ctx);
	});

	pi.on("before_agent_start", async (event) => {
		if (glossary.enabled) event.systemPromptOptions.sections.vocab = PROMPT_SECTION;
		else delete event.systemPromptOptions.sections.vocab;
	});

	// A new user prompt starts a fresh numbering. Tool-call round trips within
	// the same answer keep counting from where the previous message stopped.
	pi.on("agent_start", async (_event, ctx) => {
		resetHints();
		showStatus(ctx);
	});

	pi.on("message_end", async (event, ctx) => {
		const msg = event.message;
		if (msg.role !== "assistant") return;
		let changed = false;
		const content = msg.content.map((block) => {
			if (block.type !== "text" || !block.text.includes("[[")) return block;
			const result = rewrite(block.text, hints.length + 1, known);
			if (result.text === block.text) return block;
			changed = true;
			for (const h of result.hints) {
				hints.push(h);
				const entry = glossary.record(h.term, h.definition, ctx.cwd);
				if (!h.definition) h.definition = entry.definition || undefined;
			}
			return { ...block, text: result.text };
		});
		if (!changed) return;
		glossary.save();
		showStatus(ctx);
		return { message: { ...msg, content } };
	});

	pi.registerShortcut("alt+w", {
		description: "vocab: open the glossary for the last reply",
		handler: (ctx) => openOverlay(ctx),
	});

	// alt+N jumps straight to term N of the last reply. ctrl+N does the same in
	// terminals that speak the kitty keyboard protocol; legacy terminals cannot
	// tell ctrl+1 from a plain 1, so alt is the one that works everywhere.
	for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9] as const) {
		const handler = (ctx: ExtensionContext) => {
			if (!hints.some((h) => h.index === n)) {
				ctx.ui.notify(hints.length ? `no term ${n} in the last reply (only ${hints.length})` : "no terms in the last reply", "info");
				return;
			}
			return openOverlay(ctx, undefined, n);
		};
		pi.registerShortcut(`alt+${n}`, { description: `vocab: show term ${n} of the last reply`, handler });
		pi.registerShortcut(`ctrl+${n}`, { description: `vocab: show term ${n} of the last reply`, handler });
	}

	pi.registerShortcut("alt+shift+w", {
		description: "vocab: look up the word in the input box",
		handler: (ctx) => openOverlay(ctx, ctx.ui.getEditorText().trim() || undefined),
	});

	pi.registerCommand("vocab", {
		description: "Glossary of terms the agent explained. /vocab toggle, /vocab forget <term>",
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
				hints = hints.filter((h) => h.term.toLowerCase() !== term.toLowerCase());
				showStatus(ctx);
				return;
			}
			if (sub === "count") return ctx.ui.notify(`${glossary.size} terms in ${GLOSSARY_FILE}`, "info");
			await openOverlay(ctx, sub ? [sub, ...rest].join(" ") : undefined);
		},
	});
}
