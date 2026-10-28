# session-panel

A Claude Code mod: a pane beside the chat for checking on long tasks at a glance.

Five collapsible sections, each in a box drawn in your theme's prompt-border color:

- **Progress**: Claude's to-do list as a bar and `3/6 · 50%`, with every item.
- **Usage**: work tokens (new input + output) with the dollar cost, context-window fill, and how long the prompt cache stays warm.
- **Files changed**: files Claude edited or created, with `+/−` line counts and short mechanical summaries.
- **Skills & MCPs**: every skill and MCP tool used in the thread, with counts.
- **Assumptions**: things Claude assumed that you didn't say, recorded live through a `note_assumption` tool.

Totals cover the whole chat thread. `/clear` starts fresh; `/resume` brings a thread's totals back.

## Use

- The pane opens at session start on terminals 144+ columns wide.
- `/session-panel` shows or hides it at any width, and says where it went.
- It docks beside the chat in fullscreen layout (`"tui": "fullscreen"`) on terminals 110+ columns wide; otherwise it sits above the prompt.
- Click a section title (or Tab to it and press Enter) to collapse or expand it.

## Black frame

Claude Code paints the frame around a docked pane with the theme color `composerSidebarBackground` (`#262626` in the dark theme). To make the frame match the panel (`#47475C`), add it to your custom theme's overrides, for example `~/.claude/themes/<name>.json`:

```json
"overrides": { "composerSidebarBackground": "#47475C" }
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
