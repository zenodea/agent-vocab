# vocab

Jargon hints for coding agents. Works in **[pi](https://pi.dev)**,
**[Claude Code](https://claude.com/claude-code)** and
**[Codex](https://github.com/openai/codex)**, from one repo. Every time the
agent introduces a term you might not know, the reply shows it in bold with a
superscript number:

    A **closure**¹ keeps the surrounding **scope**² alive.

Look the number up and a short plain definition comes back. Search to find
every term the glossary has ever stored, and quiz yourself on the ones that
did not stick.

| | pi | Claude Code | Codex |
|---|---|---|---|
| Entry point | `src/vocab.ts` (pi extension) | `hooks/register.tsx` (Claude Code mod) | `codex/vocab.ts` (Codex hooks plus a `vocab` command) |
| Open the glossary | `alt+w` or `/vocab` | `/vocab` (opens a pane) | `vocab` in another terminal pane |
| Look up hint 3 | `alt+w`, then `3` | `/vocab 3` | `vocab 3` |
| Search | type in the overlay | `/vocab closure`, or type in the pane | `vocab closure` |
| Quiz, export, toggle, forget | `/vocab quiz`, `export`, `toggle`, `forget` | same commands | `vocab quiz`, `export`, `toggle`, `forget` |
| Glossary lives | in the pi session (follows branches, new session starts empty) | in the plugin store (shared by every session) | `~/.codex/vocab.json` (shared by every session) |
| Who writes `**closure**¹` | the extension, from the model's marker | the mod, from the model's marker | the model itself (Codex cannot rewrite a reply) |
| Project kinds (why, where, how) | bold, underlined | bold (Claude Code refuses raw ANSI in replies) | bold |

All hosts share the glossary model, the quiz scoring and the export
(`src/glossary.ts`, `src/cards.ts`, `src/export.ts`). pi and Claude Code also
share the marker format, its prompt section and the rewriting (`src/markers.ts`,
`src/prompt.ts`). Only the host glue differs.

## Install

### pi

    pi install /path/to/vocab

Or for a checkout you want to hack on:

    ln -s /path/to/vocab/src/vocab.ts ~/.pi/agent/extensions/vocab.ts

### Claude Code

The repo root is also a Claude Code plugin (`.claude-plugin/plugin.json`).
Load it from a checkout:

    claude --plugin-dir /path/to/vocab

To load it in every session, add the folder to `CLAUDE_CODE_PLUGIN_DIRS` in
the `env` block of `~/.claude/settings.json`. Claude Code watches that folder
and reloads the mod on save.

### Codex

    ln -s /path/to/vocab/codex/vocab.ts ~/.local/bin/vocab
    vocab install

`vocab install` adds three hooks to `~/.codex/hooks.json` (a backup goes to
`hooks.json.bak-vocab`) and leaves every other hook alone. Then open Codex,
run `/hooks` and trust the three vocab hooks: Codex skips a new or changed
hook until you do. `vocab uninstall` takes them out again. Needs Node 24 or
newer, which runs the TypeScript directly.

The first time it runs, the Codex glossary starts from the terms in pi's old
global file (`~/.pi/agent/vocab.json`), if there is one.

## pi keys

| Key | Does |
|---|---|
| `alt+w` | Open or close the glossary. Typing a number picks that hint. Typing a word filters the whole glossary. `esc` closes. |
| `alt+shift+w` | Look up whatever is typed in the input box, without sending it. |

Inside the glossary. The box sits at the top of the screen; the search line
and the eight-row list never move, only the detail panel below grows.

| Key | Does |
|---|---|
| `↑` `↓` | Move one entry. |
| `ctrl+d` `ctrl+u` | Half a page down or up. `pageDown` `pageUp` a full page, `home` `end` to the ends. |
| `ctrl+e` | Ask the agent to explain the selected entry again, plainly, with an example from this project. |
| `tab` | Follow the first link of the selected entry (see: ...). |

## Claude Code pane

`/vocab` opens the glossary as a pane with the keyboard. Type in the search
field (a number picks that hint), `tab` and the arrows walk the list, `enter`
opens an entry. In an entry, `e` asks Claude to explain it again with an
example from this project, and the `see:` names jump to linked entries. `esc`
closes. `/vocab quiz` opens the flashcards in a pane: `r` reveals, `y` got it,
`n` missed.

The mod's status entry shows `vocab N` (hints this session) or `vocab off`.

## Codex

Codex shows a reply exactly as the model wrote it, and no hook can change the
text on screen. So the model writes the finished form, `**closure**¹`, and puts
each definition in a markdown link reference definition at the end of the
reply:

    [vocab-1]: # "closure | a function that remembers its surroundings"

Markdown does not draw those lines, so the Codex screen shows only the
numbered names, as pi and Claude Code do. When the reply finishes, the `Stop`
hook reads the lines back out and files them in the glossary.

Look things up from a second terminal pane next to Codex:

    vocab              # the latest session's hints, one per line
    vocab 3            # hint 3 in full
    vocab closure      # search the glossary
    vocab quiz         # flashcards right in the terminal

`vocab` means the Codex session that ran a hook most recently. A per-turn
hook reminds the model which numbers are taken, so numbering survives long
sessions and compaction.

## Commands

The same in every host. In Codex they are the `vocab` command's arguments
(`vocab quiz`, not `/vocab quiz`).

| Command | Does |
|---|---|
| `/vocab` | Open the glossary. `/vocab <word or number>` opens it already searching. |
| `/vocab quiz [n]` | Five flashcards (or `n`) from the entries most likely to have slipped: looked up often, missed before, not seen for a while. Self-graded. |
| `/vocab export [path] [--force]` | Write the glossary as `GLOSSARY.md` in the project, grouped by kind, so other agents and teammates share the names. Refuses to overwrite a file it did not write unless `--force`. |
| `/vocab toggle` | Stop or resume asking the model to mark terms. On by default. `/vocab on` and `/vocab off` too. |
| `/vocab forget <term>` | Remove a term from the glossary. |

## Kinds

Every kind renders as the name plus a number, so the reply does not get
busier, but the name's style says which kind it is. The glossary adds a glyph.

| Kind | Answers | In the reply | Glyph |
|---|---|---|---|
| term | what is this called | **bold** | |
| concept | how does this work | ***bold italic*** | `◇` |
| why | why did we do it this way | bold, underlined in pi | `?` |
| where | where does this live | bold, underlined in pi | `@` |
| how | how do I do this again | bold, underlined in pi | `›` |
| gotcha | what bit us before | bold, curly underline in pi | `!` |

In pi the underlines are raw terminal codes that pi's markdown renderer passes
through. A `context` hook strips them before each model call, so the model
sees plain `**name**`. Claude Code refuses control characters in reply text,
so there those kinds are plain bold.

Entries can link to each other (`see: scope, callback`). Links go both ways.
Every time you open an entry in the glossary it counts as a lookup; entries you
keep looking up float to the top of the quiz.

## How it works

A short system-prompt section asks the model to write new terms as
`[[term|one plain sentence]]`, or `[[kind: name|definition|see: other]]` for
the other kinds. While the reply streams, the text the screen shows is swapped
for `**term**` plus a superscript number the moment each marker is complete; an
unfinished marker shows as the bold name, or nothing until the name is
complete. When the reply is stored it is rewritten the same way, so the model
never sees the markers again, only the bolded term.

| Step | pi | Claude Code | Codex |
|---|---|---|---|
| Prompt section | `before_agent_start` | `prompt.compose` | `SessionStart` hook (`codex/notes.ts` has the Codex wording) |
| Live display | `message_update` | `ui.render` on `AssistantMessage` | none needed: the model writes the final form |
| Stored reply | `message_end` | `session.append` (main conversation only, not subagents) | `Stop` hook reads `[vocab-N]` lines |
| Numbers after a resume | read back from the session's replies | the same, on `session.start` | kept per session in `~/.codex/vocab.json`, repeated by the `UserPromptSubmit` hook |

The model marks a term once. The extension then numbers every other mention in
the reply, plurals included, and any term already numbered this session, so a
word is never numbered in one sentence and bare in the next. Code, links and
URLs are left alone.

Hints are keyboard-only on purpose in pi: pi's normal mode gives extensions no
mouse events, so hover is not an option there.

## Develop

    npm test                     # unit tests for the shared core and the Codex side, plain node
    npm run typecheck            # the pi extension and the Codex side, against pi's own declarations
    claude plugin validate .     # the Claude Code mod, as the engine reads it
    claude plugin test .         # the Claude Code mod's tests (tests/*.test.ts)

The shared core's tests are `test/*_test.ts`, so `claude plugin test`, which
runs every `*.test.ts`, only picks up the mod's own.

`PI_VOCAB_FILE=/tmp/x.json pi -e ./src/vocab.ts ...` runs pi against a scratch
settings file instead of the real one. `VOCAB_CODEX_FILE=/tmp/x.json vocab ...`
does the same for the Codex glossary.
