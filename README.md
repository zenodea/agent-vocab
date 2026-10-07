# pi-vocab

Jargon hints for [pi](https://pi.dev). Every time the agent introduces a term
you might not know, the reply shows it in bold with a superscript number:

    A **closure**¹ keeps the surrounding **scope**² alive.

Press `alt+w`, then the digit, and a short plain definition pops up. Type
instead of a digit to search every term the glossary has ever stored.

## Install

    pi install /path/to/vocab

Or for a checkout you want to hack on:

    ln -s /path/to/vocab/src/vocab.ts ~/.pi/agent/extensions/vocab.ts

## Keys

| Key | Does |
|---|---|
| `alt+w` | Open or close the glossary. Typing a number picks that hint. Typing a word filters the whole glossary. `esc` closes. |
| `alt+shift+w` | Look up whatever is typed in the input box, without sending it. |

Inside the glossary:

| Key | Does |
|---|---|
| `ctrl+e` | Ask the agent to explain the selected entry again, plainly, with an example from this project. |
| `tab` | Follow the first link of the selected entry (see: ...). |

## Commands

| Command | Does |
|---|---|
| `/vocab` | Same as `alt+w`. |
| `/vocab quiz [n]` | Five flashcards (or `n`) from this session's entries most likely to have slipped: looked up often, missed before, not seen for a while. Self-graded: `space` reveals, `y` got it, `n` missed. |
| `/vocab toggle` | Stop or resume asking the model to mark terms. On by default. |
| `/vocab forget <term>` | Remove a term from the glossary. |

## Kinds

Everything renders the same way in the reply, `**name**` plus a number, so the
screen does not get busier. The glossary shows a glyph per kind.

| Kind | Answers | Glyph |
|---|---|---|
| term | what is this called | |
| concept | how does this work | `◇` |
| why | why did we do it this way | `?` |
| where | where does this live | `@` |
| how | how do I do this again | `›` |
| gotcha | what bit us before | `!` |

Entries can link to each other (`see: scope, callback`). Links go both ways.
Every time you open an entry in the glossary it counts as a lookup; entries you
keep looking up float to the top of the quiz.

## How it works

A short system-prompt section asks the model to write new terms as
`[[term|one plain sentence]]`, or `[[kind: name|definition|see: other]]` for
the other kinds. While the reply streams, the extension swaps the text the
screen shows for `**term**` plus a superscript number the moment each marker is
complete; an unfinished marker shows as the bold name, or nothing until the name
is complete. When the reply finishes, the stored message is rewritten the same
way and a snapshot of the glossary is appended to the pi session as a custom
entry, which the model never sees. Only the on/off flag lives outside the
session, in `~/.pi/agent/vocab.json`. The model never sees the markers again,
only the bolded term.

The model marks a term once. The extension then numbers every other mention in
the reply, plurals included, and any term already in the glossary from an
earlier reply, so a word is never numbered in one sentence and bare in the
next. Code, links and URLs are left alone.

Hints are keyboard-only on purpose: pi's normal mode gives extensions no mouse
events, so hover is not an option.

## Develop

    npm test           # unit tests, plain node, no install needed
    npm run typecheck  # links pi's own type declarations into node_modules/ and runs tsc

`PI_VOCAB_FILE=/tmp/x.json pi -e ./src/vocab.ts ...` runs against a scratch
glossary instead of the real one.
