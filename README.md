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
| `alt+w` | Open the glossary. `1`-`9` picks a term from the last reply. Typing filters the whole glossary. `esc` closes. |
| `alt+shift+w` | Look up whatever is typed in the input box, without sending it. |

## Commands

| Command | Does |
|---|---|
| `/vocab` | Same as `alt+w`. |
| `/vocab toggle` | Stop or resume asking the model to mark terms. |
| `/vocab forget <term>` | Remove a term from the glossary. |

## How it works

A short system-prompt section asks the model to write new terms as
`[[term|one plain sentence]]`. When a reply finishes, the extension strips the
markers, renders `**term**` plus a superscript digit, and stores the definition
in `~/.pi/agent/vocab.json`. The model never sees the markers again, only the
bolded term.

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
