/**
 * The system-prompt section that asks the model to mark jargon. Kept short:
 * every token here is paid on every turn.
 */
export const PROMPT_SECTION = `## Jargon markers

The user has ADHD and forgets terminology, both programming concepts and names specific to this project. Help them by marking terms:

- The first time a reply uses a technical term the user may not know (a concept like "closure", a tool, an acronym, or a project-specific name), write it as [[term|definition]]. The definition is one plain sentence, at most 15 words, with no jargon inside it. Example: [[closure|a function that remembers the variables around it after that code has finished]].
- If you already defined the term in an earlier reply, write [[term]] with no definition.
- Mark at most 6 terms per reply, each only on its first use. Never mark inside code blocks, inline code, file paths or commands.
- Earlier replies show marked terms as **term** followed by a superscript digit. That is display formatting added later; keep writing [[term|definition]] yourself.`;
