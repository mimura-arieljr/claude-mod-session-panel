import type { EngineInterface, On, RenderChildren } from 'claude-code'

import type { SectionId, Todo } from '../types'
import { cacheStatus, formatTokens, formatUsd, progress, toggleSection } from './model'
import { changeThread, readNow, readThread, readTurnRunning, setNow } from './thread-state'
import { cacheFraction, COLORS, diffCells, ringRows, ringSvg, splitPath } from './visuals'

export const PANE = 'session-panel'
const TITLE = 'Session'
// Body columns asked of the dock beside the chat.
const DOCK_COLUMNS = 56
const DOCK_MIN_TERMINAL = 110
const MAX_ROWS = 10
const RING_COLUMNS = 12
const RING_ROWS = 6
const FILE_BAR_CELLS = 7
const SUMMARY_SQUARES = 5
const GLYPH: Record<Todo['status'], string> = { completed: '✓', in_progress: '▸', pending: '○' }
const TODO_COLOR: Record<Todo['status'], string> = {
  completed: COLORS.added,
  in_progress: COLORS.accent,
  pending: COLORS.muted,
}

// The engine draws the frame (close row, edges); this paints the body under it.
const PANE_OPEN = { id: PANE, title: TITLE, columns: DOCK_COLUMNS, backgroundColor: COLORS.page }

let tick: { cancel(): void } | undefined
const rings = new Map<number, ReturnType<typeof ringRows>>()

// Called from session.start: registers the command, opens the pane, starts the minute tick.
export async function setupPanel($: EngineInterface): Promise<void> {
  await $.command.register({ name: 'session-panel', description: 'Show or hide the session panel' })
  void $.ui.open(PANE_OPEN)
  tick?.cancel()
  tick = $.clock.every(60_000, async () => {
    await setNow($, await $.clock.now())
  })
}

function more<T>(list: readonly T[]): { shown: readonly T[]; hidden: number } {
  return { shown: list.slice(0, MAX_ROWS), hidden: Math.max(0, list.length - MAX_ROWS) }
}

// The ring's text rows, kept per whole percent.
function ring(percent: number): ReturnType<typeof ringRows> {
  const key = Math.round(percent)
  let drawn = rings.get(key)
  if (drawn === undefined) {
    drawn = ringRows(key, RING_COLUMNS, RING_ROWS)
    rings.set(key, drawn)
  }
  return drawn
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
    const t = await readThread($)
    const isTurnRunning = await readTurnRunning($)
    // Reading `now` subscribes the pane to the minute tick.
    await readNow($)
    const at = await $.clock.now()
    const { context, cost } = await $.session.usage()
    const barCells = Math.max(8, Math.min(28, e.props.bodyColumns - 18))

    const label = (text: string) => (
      <Text color={COLORS.muted} bold>
        {text}
      </Text>
    )
    const muted = (text: string) => <Text color={COLORS.muted}>{text}</Text>
    const bar = (filled: number, total: number, color: string) => (
      <Text>
        <Text color={color}>{'━'.repeat(filled)}</Text>
        <Text color={COLORS.track}>{'━'.repeat(Math.max(0, total - filled))}</Text>
      </Text>
    )
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
        <Box key={id} flexDirection="column" backgroundColor={COLORS.card} paddingX={1} paddingY={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Button
              plain
              key={`toggle-${id}`}
              onPress={() => {
                void changeThread($, current => toggleSection(current, id))
              }}
            >
              <Text color={COLORS.muted}>{isCollapsed ? '▸ ' : '▾ '}</Text>
              <Text color={COLORS.label} bold>
                {title}
              </Text>
              {badge}
            </Button>
            {right}
          </Box>
          {!isCollapsed && body()}
        </Box>
      )
    }

    // A thin cyan line between sections.
    const divider = (n: number) => (
      <Box key={`divider-${n}`}>
        <Text color={COLORS.accent}>{'─'.repeat(e.props.bodyColumns)}</Text>
      </Box>
    )

    // Header: name and a WORKING / IDLE pill.
    const header = (
      <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
        <Text>
          <Text color={COLORS.accent} bold>
            {'❯_ '}
          </Text>
          <Text color={COLORS.text} bold>
            {TITLE}
          </Text>
        </Text>
        <Box marginRight={1}>
          {isTurnRunning ? (
            <Text backgroundColor={COLORS.pillWorking} color={COLORS.accentSoft} bold>
              <Text color={COLORS.accent}>{' ● '}</Text>
              {'WORKING '}
            </Text>
          ) : (
            <Text backgroundColor={COLORS.pillIdle} color={COLORS.label} bold>
              <Text color={COLORS.muted}>{' ● '}</Text>
              {'IDLE '}
            </Text>
          )}
        </Box>
      </Box>
    )

    // Progress
    const p = progress(t)
    const current = t.todos.find(todo => todo.status === 'in_progress')
    const progressBody = () => {
      const { shown, hidden } = more(t.todos)
      return (
        <Box flexDirection="column" marginTop={1}>
          <Box flexDirection="row">
            {isTurnRunning ? (
              <Text backgroundColor={COLORS.accentTint} color={COLORS.accent} bold>
                {' ✳ '}
              </Text>
            ) : (
              <Text backgroundColor={COLORS.idleTint} color={COLORS.label} bold>
                {' ⏸ '}
              </Text>
            )}
            <Box flexDirection="column" marginLeft={1} flexShrink={1}>
              <Text color={COLORS.text} bold>
                {isTurnRunning ? 'Working' : 'Idle'}
              </Text>
              {muted(
                isTurnRunning ? (current?.text ?? 'Thinking…') : 'Waiting for your next message',
              )}
            </Box>
          </Box>
          {p !== null && (
            <Box flexDirection="column" marginTop={1}>
              <Text>
                {bar(Math.round((p.percent / 100) * barCells), barCells, COLORS.accent)}
                <Text color={COLORS.label}>{`  ${p.done}/${p.total} · ${p.percent}%`}</Text>
              </Text>
              {shown.map(todo => (
                <Text key={`todo-${todo.id}`}>
                  <Text color={TODO_COLOR[todo.status]}>{`${GLYPH[todo.status]} `}</Text>
                  <Text color={todo.status === 'pending' ? COLORS.muted : COLORS.textMid}>
                    {todo.text}
                  </Text>
                </Text>
              ))}
              {moreRow(hidden)}
            </Box>
          )}
        </Box>
      )
    }
    const progressRight = muted(
      p !== null ? `${p.done}/${p.total} · ${p.percent}%` : isTurnRunning ? 'running' : 'idle',
    )

    // Usage
    const work = formatTokens(t.work.input + t.work.output)
    const usd = formatUsd(cost?.usd ?? 0)
    const cache = cacheStatus(t.lastReplyAt, at, ttlMs, isTurnRunning)
    const cacheShare = cacheFraction(t.lastReplyAt, at, ttlMs, isTurnRunning)
    const percent = context?.percent ?? 0
    // The terminal draws a braille ring as colored text; desktop, editor and mobile draw the design's SVG.
    const contextRing = () => {
      if (e.surface === 'terminal') {
        return (
          <Box key="context-ring" flexDirection="column">
            {ring(percent).map((runs, row) => (
              <Text key={`ring-${row}`}>
                {runs.map((run, k) => (
                  <Text key={`ring-${row}-${k}`} color={run.color}>
                    {run.text}
                  </Text>
                ))}
              </Text>
            ))}
          </Box>
        )
      }
      const { Svg } = $.ui.resolve(e)
      return <Svg source={ringSvg(percent)} alt={`${percent}% context`} width={104} height={104} />
    }
    const usageBody = () => (
      <Box flexDirection="column" marginTop={1}>
        <Box flexDirection="row">
          <Box flexDirection="column" alignItems="center">
            {contextRing()}
            <Text>
              <Text color={COLORS.label}>
                {context?.tokens === undefined ? '–' : formatTokens(context.tokens)}
              </Text>
              <Text color={COLORS.muted}>{` / ${formatTokens(context?.window ?? 0)}`}</Text>
            </Text>
          </Box>
          <Box flexDirection="column" marginLeft={2} flexGrow={1}>
            {label('WORK')}
            <Text>
              <Text color={COLORS.text} bold>
                {work}
              </Text>
              <Text color={COLORS.muted}> tokens</Text>
            </Text>
            <Box marginTop={1}>{label('COST')}</Box>
            <Text color={COLORS.text} bold>
              {usd}
            </Text>
            <Box marginTop={1} flexDirection="row" justifyContent="space-between">
              {label('CACHE')}
              <Text color={COLORS.amber}>{cache}</Text>
            </Box>
            {bar(Math.round(cacheShare * barCells), barCells, COLORS.amber)}
          </Box>
        </Box>
        {t.isTrackingSinceResume && muted('tracking since resume')}
      </Box>
    )

    // Files changed
    const added = t.files.reduce((sum, file) => sum + file.added, 0)
    const removed = t.files.reduce((sum, file) => sum + file.removed, 0)
    const squares = diffCells(added, removed, SUMMARY_SQUARES)
    const filesBadge = (
      <Text backgroundColor={COLORS.badge} color={COLORS.text} bold>
        {` ${t.files.length} `}
      </Text>
    )
    const filesRight =
      t.files.length === 0 ? (
        muted('0')
      ) : (
        <Text>
          <Text color={COLORS.added}>{`+${added}`}</Text>
          <Text color={COLORS.removed}>{` −${removed} `}</Text>
          <Text color={COLORS.added}>{'■'.repeat(squares.plus)}</Text>
          <Text color={COLORS.removed}>{'■'.repeat(squares.minus)}</Text>
        </Text>
      )
    const filesBody = () => {
      if (t.files.length === 0) return empty('Files Claude edits appear here.')
      const { shown, hidden } = more(t.files)
      return (
        <Box flexDirection="column">
          {shown.map(file => {
            const { name, dir } = splitPath(file.path)
            const cells = diffCells(file.added, file.removed, FILE_BAR_CELLS)
            const tint = file.isNew ? COLORS.added : COLORS.amber
            const tintBg = file.isNew ? COLORS.addedTint : COLORS.amberTint
            return (
              <Box key={file.path} flexDirection="row" alignItems="flex-start" marginTop={1}>
                <Box flexShrink={0}>
                  <Text backgroundColor={tintBg} color={tint} bold>
                    {file.isNew ? ' + ' : ' ~ '}
                  </Text>
                </Box>
                <Box flexDirection="column" marginLeft={1} flexGrow={1} flexShrink={1}>
                  <Text wrap="truncate-end">
                    <Text color={COLORS.text} bold>
                      {name}
                    </Text>{' '}
                    <Text backgroundColor={tintBg} color={tint} bold>
                      {file.isNew ? ' NEW ' : ' EDIT '}
                    </Text>
                  </Text>
                  {dir !== '' && (
                    <Text color={COLORS.muted} wrap="truncate-start">
                      {dir}
                    </Text>
                  )}
                  {file.notes.length > 0 && (
                    <Text color={COLORS.textMid} wrap="truncate-end">
                      <Text color={COLORS.muted}>{'› '}</Text>
                      {file.notes.join(' · ')}
                    </Text>
                  )}
                </Box>
                <Box flexDirection="column" alignItems="flex-end" marginLeft={1} flexShrink={0}>
                  <Text>
                    <Text color={COLORS.added}>{`+${file.added}`}</Text>
                    {file.removed > 0 && <Text color={COLORS.removed}>{` −${file.removed}`}</Text>}
                  </Text>
                  <Text>
                    <Text color={COLORS.added}>{'▬'.repeat(cells.plus)}</Text>
                    <Text color={COLORS.removed}>{'▬'.repeat(cells.minus)}</Text>
                  </Text>
                </Box>
              </Box>
            )
          })}
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

    // Assumptions
    const assumptionsBadge = (
      <Text backgroundColor={COLORS.amberTint} color={COLORS.amber} bold>
        {` ${t.assumptions.length} `}
      </Text>
    )
    const assumptionsBody = () => {
      if (t.assumptions.length === 0) return empty('Things Claude assumes appear here.')
      const { shown, hidden } = more(t.assumptions)
      return (
        <Box flexDirection="column">
          {shown.map((a, i) => (
            <Box
              key={`assumption-${a.at}-${i}`}
              flexDirection="row"
              backgroundColor={COLORS.raised}
              paddingX={1}
              marginTop={1}
            >
              <Text color={COLORS.amber} bold>
                {String(t.assumptions.length - i).padStart(2, '0')}
              </Text>
              <Box marginLeft={1} flexShrink={1}>
                <Text color={COLORS.textSoft}>
                  {a.isFromAgent && <Text color={COLORS.muted}>(agent) </Text>}
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
      <Box flexDirection="column" backgroundColor={COLORS.page} minHeight={e.props.scroll.bodyRows}>
        <Box marginBottom={1}>{header}</Box>
        {section('progress', 'PROGRESS', null, progressRight, progressBody)}
        {divider(0)}
        {section('usage', 'USAGE', null, muted(usd), usageBody)}
        {divider(1)}
        {section('files', 'FILES CHANGED ', filesBadge, filesRight, filesBody)}
        {divider(2)}
        {section('tools', 'SKILLS & MCPS', null, muted(String(toolUses)), toolsBody)}
        {divider(3)}
        {section('assumptions', 'ASSUMPTIONS ', assumptionsBadge, null, assumptionsBody)}
      </Box>
    )
  })
}
