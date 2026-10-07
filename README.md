# pi-vocab

Jargon hints for [pi](https://pi.dev). Every time the agent introduces a term
you might not know, the reply shows it in bold with a superscript number:

    A **closure**¹ keeps the surrounding **scope**² alive.

Under the reply, a footnote strip lists each term with its one-line definition,
so most of the time nothing needs pressing. For the full text, `alt+2` jumps
straight to term 2. `alt+w` opens the glossary for the whole reply; type to
search every term ever stored.

## Install

    pi install /path/to/vocab

Or for a checkout you want to hack on:

    ln -s /path/to/vocab/src/vocab.ts ~/.pi/agent/extensions/vocab.ts

## Keys

| Key | Does |
|---|---|
| `alt+1` to `alt+9` | Jump straight to that term of the last reply. |
| `ctrl+1` to `ctrl+9` | Same, in terminals with the kitty keyboard protocol (Ghostty, kitty, WezTerm, iTerm2). Older terminals cannot tell `ctrl+1` from `1`. |
| `alt+w` | Open or close the glossary. `1`-`9` picks a term from the last reply. Typing filters the whole glossary. `esc` closes. |
| `alt+shift+w` | Look up whatever is typed in the input box, without sending it. |

## Commands

| Command | Does |
|---|---|
| `/vocab` | Same as `alt+w`. |
| `/vocab toggle` | Stop or resume asking the model to mark terms. On by default. |
| `/vocab footnotes` | Show or hide the footnote strip above the input. On by default. |
| `/vocab forget <term>` | Remove a term from the glossary. |

## How it works

A short system-prompt section asks the model to write new terms as
`[[term|one plain sentence]]`. When a reply finishes, the extension strips the
markers, renders `**term**` plus a superscript digit, and stores the definition
in `~/.pi/agent/vocab.json`. The model never sees the markers again, only the
bolded term.

Hints are keyboard-only on purpose: pi's normal mode gives extensions no mouse
events, so hover is not an option.

## Develop

    npm test           # unit tests, plain node, no install needed
    npm run typecheck  # links pi's own type declarations into node_modules/ and runs tsc

`PI_VOCAB_FILE=/tmp/x.json pi -e ./src/vocab.ts ...` runs against a scratch
glossary instead of the real one.
