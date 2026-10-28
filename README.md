# session-panel

A Claude Code mod: a pane beside the chat for checking on long tasks at a glance.

Five collapsible cards on a dark `#101317` panel, split by thin cyan lines, each with an uppercase header and a summary on the right:

- **Progress**: whether Claude is idle or working (and on which step), then the to-do list as a bar and `3/6 · 50%`, with every item.
- **Usage**: a context-window ring (braille in the terminal, SVG elsewhere), work tokens (new input + output), the dollar cost, and how long the prompt cache stays warm.
- **Files changed**: files Claude edited or created, tagged NEW or EDIT, with their folder, `+/−` line counts, a diff bar and short mechanical summaries.
- **Skills & MCPs**: every skill and MCP tool used in the thread, with counts.
- **Assumptions**: numbered things Claude assumed that you didn't say, recorded live through a `note_assumption` tool.

Totals cover the whole chat thread. `/clear` starts fresh; `/resume` brings a thread's totals back.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install session-panel --marketplace mimura-arieljr/claude-mod-session-panel
```

Answer `y` to add the marketplace, then pick a scope. From a shell:

```sh
claude plugin install session-panel --marketplace mimura-arieljr/claude-mod-session-panel
```

## Use

- The pane opens at session start on terminals 144+ columns wide.
- `/session-panel` shows or hides it at any width, and says where it went.
- It docks beside the chat in fullscreen layout (`"tui": "fullscreen"`) on terminals 110+ columns wide; otherwise it sits above the prompt.
- Click a section title (or Tab to it and press Enter) to collapse or expand it.

## Matching frame

Claude Code paints the frame around a docked pane with the theme color `composerSidebarBackground` (`#262626` in the dark theme). To make the frame match the panel (`#101317`), add it to your custom theme's overrides, for example `~/.claude/themes/<name>.json`:

```json
"overrides": { "composerSidebarBackground": "#101317" }
```

## Options

- `cacheTtl`: `60m` (default) or `5m`, the prompt-cache lifetime the countdown uses. Claude Code doesn't tell mods this value, so set it to match your setup.

## Run from this folder

```sh
claude --plugin-dir /path/to/claude-mod-session-panel
```

## Develop

```sh
claude plugin validate .
claude plugin test .
```
