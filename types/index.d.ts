/** What the glossary pane and the quiz pane draw from. */
export type VocabQuiz = {
	/** Storage keys of the cards, in order. */
	keys: string[];
	at: number;
	isRevealed: boolean;
	missed: string[];
};

declare module "claude-code" {
	interface PluginState {
		vocab: {
			/** What is typed in the glossary's search field. */
			query: string;
			/** Storage key of the entry the detail panel shows. */
			selected: string | null;
			/** Bumped whenever the glossary changes, so open panes redraw. */
			rev: number;
			quiz: VocabQuiz | null;
		};
	}
}
