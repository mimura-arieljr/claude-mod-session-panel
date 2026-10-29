# session-panel

A Claude Code mod: a pane beside the chat for checking on long tasks at a glance.

A rounded frame with a status line on top, then collapsible sections split by dim rules, each with an icon, an uppercase header and a summary on the right:

- **Status line**: `● IDLE`, or `● WORKING` with a spinner, the task in progress and how long the turn has run.
- **Agents** (once a subagent starts): each subagent with a spinner and timer while running, then done, failed or killed; its latest tool call; children nested under their parent. The last 3 finished stay listed.
- **Usage**: context-window fill as an eighth-block bar, work tokens (new input + output), the dollar cost, how long the prompt cache stays warm, and your plan's 5-hour and weekly limits with reset times (dimmed when the reading is over 5 minutes old).
- **Files changed**: files Claude edited (`~`) or created (`+`, tagged NEW), grouped by folder, with `+/−` line counts in fixed columns, a diff bar sized by change and short mechanical summaries.
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
- Click a file name to open it in VS Code (through its `vscode://` handler).

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

Mods load from the installed copy, not this folder. To ship a change: bump `version` in `.claude-plugin/plugin.json`, push to `main`, then `claude plugin update session-panel@claude-mod-session-panel` and restart. An unchanged version makes the update a no-op.

### Files

All in `hooks/`; each has a `*.test.ts(x)` beside it.

- `hooks.json`: loads `./register.tsx` as the mod's only hooks module.
- `register.tsx`: entry point. Its one `session.start` hook syncs the thread, registers the assumption tool and sets up the panel; it wires up every other part's hooks.
- `panel.tsx`: the `/session-panel` command, the docked pane, the clock tick (spinner frames, agent polling, the minute countdown) and the pane's drawing.
- `agents.ts`: reads `$.agent.list()` into the Agents rows on `agent.spawn`, then every 2s while any agent is unfinished.
- `collect.ts`: watches tool calls (Edit/Write/NotebookEdit, TodoWrite, TaskCreate/TaskUpdate, MCP, each subagent's latest call), skills, `turn.complete` usage and `session.measure` rate limits.
- `assumptions.ts`: the `note_assumption` tool, saving each call as an assumption, and the prompt section telling Claude to use it.
- `thread.ts`: keeps the thread matched to the session id across `/clear`, `/resume` and forks, saves per-session snapshots (up to 50), and stamps when a turn starts.
- `thread-state.ts`: every `$.state` atom (thread, pendingSwitch, turnRunning, turnStartedAt, limits, agents, agentActivity, now) and its read/write helpers. The engine only lets the defining file touch an atom, so all access lives here.
- `model.ts`: pure functions: thread updates (todos, tasks, file diffs, skills, MCPs, usage, assumptions, collapsed sections), formatters, cache-warmth math, agent-list merging and the agent tree.
- `visuals.ts`: the color palette and drawing helpers: eighth-block bars, diff bars, short folder paths and grouping files by folder.
- `test-support.ts`: records each write of the `thread` state through `state.set`, since tests can't read plugin state directly.

`types/index.d.ts` is the `$.state` contract: every value above is declared there, and `claude plugin validate` checks the module against it.
