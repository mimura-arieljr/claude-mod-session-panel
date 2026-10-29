import type { EngineInterface, On, RenderChildren } from 'claude-code'

import type { AgentRow, FileEntry, SectionId } from '../types'
import { pollAgents } from './agents'
import {
  agentTree,
  cacheFraction,
  cacheStatus,
  formatAge,
  formatElapsed,
  formatReset,
  formatTokens,
  formatUsd,
  isAgentDone,
  toggleSection,
} from './model'
import {
  changeThread,
  readAgentActivity,
  readAgents,
  readLimits,
  readNow,
  readThread,
  readTurnRunning,
  readTurnStartedAt,
  setNow,
} from './thread-state'
import { COLORS, diffBar, diffCells, eighthBar, groupByFolder, splitPath } from './visuals'

export const PANE = 'session-panel'
const TITLE = 'Session'
// Body columns asked of the dock beside the chat.
const DOCK_COLUMNS = 56
const DOCK_MIN_TERMINAL = 110
const MAX_ROWS = 10
const FILE_BAR_CELLS = 10
const SUMMARY_CELLS = 10
// Usage rows: labels padded to one column so the bars start together.
const LABEL_COLUMNS = 6
// Inset outside and inside the rounded frame: one cell, just enough to show.
const INSET_X = 1
const INSET_Y = 1
// After this long without a new response, the plan limits may lag other sessions.
const LIMITS_STALE_MS = 5 * 60_000
const LIMIT_LABEL: Record<string, string> = { five_hour: '5h', seven_day: 'week', spend_limit: 'spend' }
const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
const SPIN_MS = 250
// How often the agent list is re-read while an agent is unfinished.
const AGENT_POLL_MS = 2000
const AGENT_TYPE_COLUMNS = 9
const AGENT_STATUS_WORD: Record<AgentRow['status'], string> = {
  pending: 'pending',
  running: '',
  waiting: 'waiting',
  idle: 'idle',
  completed: 'done',
  failed: 'failed',
  killed: 'killed',
}
// Single-width glyphs: emoji take two cells and break the row's alignment.
const ICON: Record<SectionId, string> = {
  agents: '⋔',
  usage: '∑',
  files: '±',
  tools: '✦',
  assumptions: '≈',
}

// The engine draws the frame (close row, edges); the body is left unpainted so the inset shows through.
const PANE_OPEN = { id: PANE, title: TITLE, columns: DOCK_COLUMNS, backgroundColor: 'transparent' }

let tick: { cancel(): void } | undefined

// Called from session.start: registers the command, opens the pane, starts the clock tick.
export async function setupPanel($: EngineInterface): Promise<void> {
  await $.command.register({ name: 'session-panel', description: 'Show or hide the session panel' })
  void $.ui.open(PANE_OPEN)
  tick?.cancel()
  tick = $.clock.every(SPIN_MS, async () => {
    const [at, isTurnRunning, last, agents] = await Promise.all([
      $.clock.now(),
      readTurnRunning($),
      readNow($),
      readAgents($),
    ])
    // While an agent is unfinished, re-read the list every few seconds.
    if (agents.isWatching && Math.floor(at / AGENT_POLL_MS) !== Math.floor(last / AGENT_POLL_MS)) await pollAgents($)
    // Each spinner frame while a turn or an agent runs, else once a minute for the cache countdown.
    const isMinuteNew = Math.floor(at / 60_000) !== Math.floor(last / 60_000)
    if (isTurnRunning || agents.isWatching || isMinuteNew) await setNow($, at)
  })
}

// Opens a file in VS Code through its vscode:// handler: `open` on macOS, `xdg-open` elsewhere.
async function openInVsCode($: Pick<EngineInterface, 'process' | 'ui'>, path: string): Promise<void> {
  const url = `vscode://file${encodeURI(path)}`
  let reason = ''
  for (const opener of ['open', 'xdg-open']) {
    try {
      const { exitCode, stderr } = await $.process.run([opener, url])
      if (exitCode === 0) return
      reason = stderr.trim()
      break
    } catch {
      // That opener isn't on this system: try the next.
    }
  }
  $.ui.toast(`Couldn't open ${path} in VS Code${reason === '' ? '' : `: ${reason}`}`)
}

function more<T>(list: readonly T[]): { shown: readonly T[]; hidden: number } {
  return { shown: list.slice(0, MAX_ROWS), hidden: Math.max(0, list.length - MAX_ROWS) }
}

// Says where the pane went, and what docks it beside the chat when it didn't.
function placementNote(presentation: { isFullscreen: boolean; columns: number } | undefined): string {
  if (presentation === undefined) return 'Session panel shown.'
  if (!presentation.isFullscreen) {
    return 'Session panel shown above the prompt. It docks beside the chat in fullscreen layout ("tui": "fullscreen" in settings).'
  }
  if (presentation.columns < DOCK_MIN_TERMINAL) {
    return `Session panel shown above the prompt. Widen the terminal to ${DOCK_MIN_TERMINAL} columns (now ${presentation.columns}) to dock it beside the chat.`
  }
  return 'Session panel shown beside the chat.'
}

export function registerPanel(on: On, ttlMs: number): void {
  on('command.run', { command: 'session-panel' }, async ($, e) => {
    // A pane waiting for room, or a tab behind another, counts as not open.
    const isOpen = (await $.ui.panes()).some(
      pane => pane.id === PANE && pane.isPlaced && pane.isShown,
    )
    if (isOpen) {
      await $.ui.close({ id: PANE })
      return { text: 'Session panel hidden.' }
    }
    await $.ui.open(PANE_OPEN)
    return { text: placementNote(e.presentation) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    // Reading `now` subscribes the pane to the clock tick.
    const [t, isTurnRunning, turnStartedAt, limits, agents, activity, , at, cwd, { context, cost }] = await Promise.all([
      readThread($),
      readTurnRunning($),
      readTurnStartedAt($),
      readLimits($),
      readAgents($),
      readAgentActivity($),
      readNow($),
      $.clock.now(),
      $.session.cwd(),
      $.session.usage(),
    ])
    // Cells inside the frame: the body less both insets and the border.
    const contentColumns = Math.max(0, e.props.bodyColumns - INSET_X * 4 - 2)
    const barCells = Math.max(8, Math.min(24, contentColumns - 24))
    const spinner = SPIN[Math.floor(at / SPIN_MS) % SPIN.length]!

    const muted = (text: string) => <Text color={COLORS.muted}>{text}</Text>
    const rowLabel = (text: string) => <Text color={COLORS.muted}>{text.padEnd(LABEL_COLUMNS)}</Text>
    const moreRow = (hidden: number) => hidden > 0 && muted(`+${hidden} more`)
    const empty = (hint: string) => (
      <Box flexDirection="column" borderStyle="round" borderColor={COLORS.dashed} paddingX={1}>
        <Text color={COLORS.textMid} bold>
          None yet
        </Text>
        {muted(hint)}
      </Box>
    )

    const section = (
      id: SectionId,
      title: string,
      badge: RenderChildren,
      right: RenderChildren,
      body: () => RenderChildren,
    ) => {
      const isCollapsed = t.collapsed.includes(id)
      return (
        <Box key={id} flexDirection="column">
          {/* Keyed so hover turns the title cyan; the pointer's inversion then highlights in cyan. */}
          <Box key={`head-${id}`} flexDirection="row" justifyContent="space-between">
            <Box flexDirection="row">
              <Button
                plain
                key={`toggle-${id}`}
                onPress={() => {
                  void changeThread($, current => toggleSection(current, id))
                }}
              >
                <Text color={COLORS.muted} hover={{ color: COLORS.accent }}>
                  {isCollapsed ? '▸ ' : '▾ '}
                </Text>
                <Text color={COLORS.accent} hover={{ color: COLORS.accent }}>
                  {`${ICON[id]} `}
                </Text>
                <Text color={COLORS.label} bold hover={{ color: COLORS.accent }}>
                  {title}
                </Text>
              </Button>
              {badge !== null && <Text> {badge}</Text>}
            </Box>
            {right}
          </Box>
          {!isCollapsed && (
            <Box flexDirection="column" marginTop={1}>
              {body()}
            </Box>
          )}
        </Box>
      )
    }

    // A dim line between sections.
    const rule = (n: number) => (
      <Text key={`rule-${n}`} color={COLORS.rule}>
        {'─'.repeat(contentColumns)}
      </Text>
    )

    // Header: the panel's name.
    const header = (
      <Box flexDirection="row" paddingX={1}>
        <Text>
          <Text color={COLORS.accent} bold>
            {'❯_ '}
          </Text>
          <Text color={COLORS.text} bold>
            {TITLE}
          </Text>
        </Text>
      </Box>
    )

    // Status line: a spinner and the turn's time while working.
    const current = t.todos.find(todo => todo.status === 'in_progress')
    const status = (
      <Box flexDirection="row" justifyContent="space-between" backgroundColor={COLORS.raised} paddingX={1}>
        {isTurnRunning ? (
          <Box flexShrink={1}>
            <Text wrap="truncate-end">
              <Text color={COLORS.accent}>{'● '}</Text>
              <Text color={COLORS.accent} bold>
                WORKING
              </Text>
              {'  '}
              <Text color={COLORS.accent}>{spinner}</Text>{' '}
              <Text color={COLORS.textMid} italic>
                {current?.text ?? 'Thinking…'}
              </Text>
            </Text>
          </Box>
        ) : (
          <Text>
            <Text color={COLORS.muted}>{'● '}</Text>
            <Text color={COLORS.label} bold>
              IDLE
            </Text>
            <Text color={COLORS.muted}>{'  waiting for input'}</Text>
          </Text>
        )}
        {isTurnRunning && (
          <Box flexShrink={0} marginLeft={1}>
            {muted(formatElapsed(at - turnStartedAt))}
          </Box>
        )}
      </Box>
    )

    // Agents, shown once one has started
    const runningAgents = agents.rows.filter(row => row.status === 'running').length
    const agentsBadge = (
      <Text color={COLORS.text} bold>
        {String(agents.rows.length)}
      </Text>
    )
    const agentsRight = muted(runningAgents > 0 ? `${runningAgents} running` : 'none running')
    const agentRow = (row: AgentRow, depth: number) => {
      const isDone = isAgentDone(row.status)
      const isQuiet = row.status === 'idle' || row.status === 'waiting' || row.status === 'pending'
      const [glyph, glyphColor] =
        row.status === 'running'
          ? [spinner, COLORS.accent]
          : row.status === 'completed'
            ? ['✓', COLORS.added]
            : isDone
              ? ['✗', COLORS.removed]
              : ['○', COLORS.muted]
      const type = row.type === 'general-purpose' ? 'general' : row.type.slice(0, AGENT_TYPE_COLUMNS)
      const latest = activity[row.id]
      return (
        <Box key={`agent-${row.id}`} flexDirection="column" marginLeft={depth * 2}>
          <Box flexDirection="row">
            <Text color={glyphColor}>{`${glyph} `}</Text>
            <Text color={COLORS.muted}>{`${type.padEnd(AGENT_TYPE_COLUMNS)} `}</Text>
            <Box flexGrow={1} flexShrink={1}>
              <Text color={isQuiet || isDone ? COLORS.textMid : COLORS.text} dimColor={isQuiet} wrap="truncate-end">
                {row.description}
              </Text>
            </Box>
            <Box flexShrink={0} marginLeft={1}>
              {row.status === 'running'
                ? muted(formatElapsed(at - row.startedAt))
                : <Text color={row.status === 'failed' || row.status === 'killed' ? COLORS.removed : COLORS.muted}>
                    {AGENT_STATUS_WORD[row.status]}
                  </Text>}
            </Box>
          </Box>
          {!isDone && latest !== undefined && (
            <Box marginLeft={2}>
              <Text color={COLORS.muted} wrap="truncate-end">{`› ${latest}`}</Text>
            </Box>
          )}
        </Box>
      )
    }
    const agentsBody = () => (
      <Box flexDirection="column">{agentTree(agents.rows).map(({ row, depth }) => agentRow(row, depth))}</Box>
    )

    // Usage
    const work = formatTokens(t.work.input + t.work.output)
    const usd = formatUsd(cost?.usd ?? 0)
    const cache = cacheStatus(t.lastReplyAt, at, ttlMs, isTurnRunning)
    const cacheCells = Math.round(cacheFraction(t.lastReplyAt, at, ttlMs, isTurnRunning) * barCells)
    const percent = context?.percent ?? 0
    const contextFill = eighthBar(percent / 100, barCells)
    const limitsAge = at - limits.readAt
    const isLimitsStale = limitsAge >= LIMITS_STALE_MS
    const offsetMinutes = new Date(at).getTimezoneOffset()
    const limitRow = (w: (typeof limits.windows)[number]) => {
      const fill = eighthBar(w.percentUsed / 100, barCells)
      const color = isLimitsStale
        ? COLORS.muted
        : w.percentUsed >= 95
          ? COLORS.removed
          : w.percentUsed >= 80
            ? COLORS.amber
            : COLORS.accent
      return (
        <Box key={`limit-${w.kind}`} flexDirection="row" justifyContent="space-between">
          <Text>
            {rowLabel(LIMIT_LABEL[w.kind] ?? w.kind.slice(0, LABEL_COLUMNS - 1))}
            <Text color={color}>{fill}</Text>
            <Text color={COLORS.track}>{'░'.repeat(Math.max(0, barCells - fill.length))}</Text>
            <Text color={isLimitsStale ? COLORS.muted : COLORS.text}>{` ${Math.round(w.percentUsed)}%`}</Text>
          </Text>
          {w.resetsAt !== undefined && muted(`resets ${formatReset(w.resetsAt, at, offsetMinutes)}`)}
        </Box>
      )
    }
    const usageBody = () => (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text>
            {rowLabel('ctx')}
            <Text color={COLORS.accent}>{contextFill}</Text>
            <Text color={COLORS.track}>{'░'.repeat(Math.max(0, barCells - contextFill.length))}</Text>
            <Text color={COLORS.text}>{` ${Math.round(percent)}%`}</Text>
          </Text>
          {muted(
            `${context?.tokens === undefined ? '–' : formatTokens(context.tokens)}/${formatTokens(context?.window ?? 0)}`,
          )}
        </Box>
        <Text>
          {rowLabel('work')}
          <Text color={COLORS.text} bold>
            {work}
          </Text>
          <Text color={COLORS.muted}> tokens</Text>
        </Text>
        <Box flexDirection="row" justifyContent="space-between">
          <Text>
            {rowLabel('cache')}
            <Text color={COLORS.amber}>{'━'.repeat(cacheCells)}</Text>
            <Text color={COLORS.track}>{'┄'.repeat(barCells - cacheCells)}</Text>
          </Text>
          <Text color={COLORS.amber}>{cache}</Text>
        </Box>
        {limits.windows.map(limitRow)}
        {limits.windows.length > 0 && isLimitsStale && (
          <Text color={COLORS.muted} italic>
            {`limits as of ${formatAge(limitsAge)} ago`}
          </Text>
        )}
        {t.isTrackingSinceResume && muted('tracking since resume')}
      </Box>
    )

    // Files changed
    const added = t.files.reduce((sum, file) => sum + file.added, 0)
    const removed = t.files.reduce((sum, file) => sum + file.removed, 0)
    const cells = diffCells(added, removed, SUMMARY_CELLS)
    const filesBadge = (
      <Text color={COLORS.text} bold>
        {String(t.files.length)}
      </Text>
    )
    const filesRight =
      t.files.length === 0 ? (
        muted('0')
      ) : (
        <Text>
          <Text color={COLORS.added}>{`+${added}`}</Text>
          {removed > 0 && <Text color={COLORS.removed}>{`  −${removed}`}</Text>}
          {'  '}
          <Text color={COLORS.added}>{'█'.repeat(cells.plus)}</Text>
          <Text color={COLORS.removed}>{'█'.repeat(cells.minus)}</Text>
        </Text>
      )
    const fileRow = (file: FileEntry, largest: number) => {
      const { name } = splitPath(file.path)
      const bar = diffBar(file.added, file.removed, largest, FILE_BAR_CELLS)
      const path = file.path.startsWith('/') ? file.path : `${cwd}/${file.path}`
      return (
        <Box key={file.path} flexDirection="column">
          <Box flexDirection="row">
            <Box flexDirection="row" flexGrow={1} flexShrink={1} marginLeft={2}>
              <Text color={file.isNew ? COLORS.added : COLORS.amber} bold>
                {file.isNew ? '+ ' : '~ '}
              </Text>
              <Box flexShrink={1}>
                <Button
                  plain
                  key={`open-${file.path}`}
                  onPress={() => {
                    void openInVsCode($, path)
                  }}
                >
                  <Text color={COLORS.text} wrap="truncate-end" hover={{ color: COLORS.accent }}>
                    {name}
                  </Text>
                </Button>
              </Box>
              {file.isNew && (
                <Box marginLeft={1} flexShrink={0}>
                  <Text color={COLORS.added} bold>
                    NEW
                  </Text>
                </Box>
              )}
            </Box>
            {/* Counts and bar in fixed columns so every row lines up. */}
            <Box flexShrink={0}>
              <Text>
                <Text color={COLORS.added}>{`+${file.added}`.padStart(5)}</Text>
                <Text color={COLORS.removed}>{(file.removed > 0 ? `−${file.removed}` : '').padStart(5)}</Text>
                {'  '}
                <Text color={COLORS.added}>{bar.plus}</Text>
                <Text color={COLORS.removed}>{bar.minus}</Text>
                {' '.repeat(Math.max(0, FILE_BAR_CELLS - bar.plus.length - bar.minus.length))}
              </Text>
            </Box>
          </Box>
          {file.notes.length > 0 && (
            <Box marginLeft={4}>
              <Text color={COLORS.muted} wrap="truncate-end">
                {`› ${file.notes.join(' · ')}`}
              </Text>
            </Box>
          )}
        </Box>
      )
    }
    const filesBody = () => {
      if (t.files.length === 0) return empty('Files Claude edits appear here.')
      const { shown, hidden } = more(t.files)
      const largest = Math.max(0, ...shown.map(file => file.added + file.removed))
      return (
        <Box flexDirection="column" gap={1}>
          {groupByFolder(shown).map(group => (
            <Box key={`dir-${group.dir}`} flexDirection="column">
              <Text color={COLORS.muted} wrap="truncate-start">
                {group.dir === '' ? './' : group.dir}
              </Text>
              <Box flexDirection="column" gap={1}>
                {group.files.map(file => fileRow(file, largest))}
              </Box>
            </Box>
          ))}
          {moreRow(hidden)}
        </Box>
      )
    }

    // Skills & MCPs
    const toolRows = [
      ...t.skills.map(skill => ({ kind: 'skill', text: skill.name, count: skill.count })),
      ...t.mcps.map(mcp => ({
        kind: 'mcp  ',
        text: `${mcp.server} · ${mcp.tools.join(', ')}`,
        count: mcp.count,
      })),
    ]
    const toolUses = toolRows.reduce((sum, row) => sum + row.count, 0)
    const toolsBody = () => {
      if (toolRows.length === 0) return empty("Skills and MCP tools appear here as they're called.")
      const { shown, hidden } = more(toolRows)
      return (
        <Box flexDirection="column">
          {shown.map(row => (
            <Box key={`${row.kind}-${row.text}`} flexDirection="row" justifyContent="space-between">
              <Text wrap="truncate-end">
                <Text color={COLORS.muted}>{`${row.kind}  `}</Text>
                <Text color={COLORS.text}>{row.text}</Text>
              </Text>
              <Text color={COLORS.label}>{`×${row.count}`}</Text>
            </Box>
          ))}
          {moreRow(hidden)}
        </Box>
      )
    }

    // Assumptions: the only rows with a fill.
    const assumptionsBadge = (
      <Text color={COLORS.amber} bold>
        {String(t.assumptions.length)}
      </Text>
    )
    const assumptionsBody = () => {
      if (t.assumptions.length === 0) return empty('Things Claude assumes appear here.')
      const { shown, hidden } = more(t.assumptions)
      return (
        <Box flexDirection="column" gap={1}>
          {shown.map((a, i) => (
            <Box
              key={`assumption-${a.at}-${i}`}
              flexDirection="row"
              backgroundColor={COLORS.assumptionFill}
              paddingX={1}
            >
              <Text color={COLORS.amber} bold>
                {String(t.assumptions.length - i).padStart(2, '0')}
              </Text>
              <Box marginLeft={1} flexShrink={1}>
                <Text color={COLORS.assumptionText}>
                  {a.isFromAgent && (
                    <Text color={COLORS.muted} italic>
                      (agent){' '}
                    </Text>
                  )}
                  {a.text}
                </Text>
              </Box>
            </Box>
          ))}
          {moreRow(hidden)}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" minHeight={e.props.scroll.bodyRows} paddingX={INSET_X} paddingY={INSET_Y}>
        <Box
          flexDirection="column"
          flexGrow={1}
          gap={1}
          paddingX={INSET_X}
          paddingY={INSET_Y}
          backgroundColor={COLORS.page}
          borderStyle="round"
          borderColor={COLORS.frame}
        >
          {header}
          {status}
          {[
            agents.rows.length > 0 && section('agents', 'AGENTS', agentsBadge, agentsRight, agentsBody),
            section('usage', 'USAGE', null, muted(usd), usageBody),
            section('files', 'FILES CHANGED', filesBadge, filesRight, filesBody),
            section('tools', 'SKILLS & MCPS', null, muted(String(toolUses)), toolsBody),
            section('assumptions', 'ASSUMPTIONS', assumptionsBadge, null, assumptionsBody),
          ]
            .filter(shown => shown !== false)
            .flatMap((shown, i) => (i === 0 ? [shown] : [rule(i), shown]))}
        </Box>
      </Box>
    )
  })
}
