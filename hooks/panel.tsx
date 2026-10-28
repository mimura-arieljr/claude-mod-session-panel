import type { EngineInterface, On, RenderChildren } from 'claude-code'

import type { SectionId, Todo } from '../types'
import { cacheStatus, formatTokens, formatUsd, progress, toggleSection } from './model'
import { changeThread, readNow, readThread, readTurnRunning, setNow } from './thread-state'

export const PANE = 'session-panel'
const TITLE = 'Session'
const ACCENT = 'promptBorder'
const EMPTY_BAR = '#0e4f5c'
const BAR_CELLS = 20
// Body columns asked of the dock beside the chat.
const DOCK_COLUMNS = 56
const DOCK_MIN_TERMINAL = 110
const MAX_ROWS = 10
const GLYPH: Record<Todo['status'], string> = { completed: '✓', in_progress: '▸', pending: '○' }

let tick: { cancel(): void } | undefined

// Called from session.start: registers the command, opens the pane, starts the minute tick.
export async function setupPanel($: EngineInterface): Promise<void> {
  await $.command.register({ name: 'session-panel', description: 'Show or hide the session panel' })
  void $.ui.open({ id: PANE, title: TITLE, columns: DOCK_COLUMNS })
  tick?.cancel()
  tick = $.clock.every(60_000, async () => {
    await setNow($, await $.clock.now())
  })
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

function shortCache(status: string): string {
  return status.startsWith('warm · ') ? status.slice('warm · '.length).replace(' left', '') : status
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
    await $.ui.open({ id: PANE, title: TITLE, columns: DOCK_COLUMNS })
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

    const section = (
      id: SectionId,
      title: string,
      summary: string,
      body: () => RenderChildren,
    ) => {
      const isCollapsed = t.collapsed.includes(id)
      const label = `${isCollapsed ? '▸' : '▾'} ${title}${isCollapsed && summary !== '' ? ` · ${summary}` : ''}`
      return (
        <Box key={id} flexDirection="column" borderStyle="round" borderColor={ACCENT} paddingX={1}>
          <Button
            plain
            key={`toggle-${id}`}
            onPress={() => {
              void changeThread($, current => toggleSection(current, id))
            }}
          >
            <Text color={ACCENT} bold>
              {label}
            </Text>
          </Button>
          {!isCollapsed && body()}
        </Box>
      )
    }

    const dimRow = (text: string) => <Text dimColor>{text}</Text>
    const moreRow = (hidden: number) => hidden > 0 && dimRow(`+${hidden} more`)

    const p = progress(t)
    const progressBody = () => {
      if (p === null) return dimRow(isTurnRunning ? 'working' : 'idle')
      const filled = Math.round(p.percent / (100 / BAR_CELLS))
      const { shown, hidden } = more(t.todos)
      return (
        <Box flexDirection="column">
          <Text>
            <Text color={ACCENT}>{'█'.repeat(filled)}</Text>
            <Text color={EMPTY_BAR}>{'█'.repeat(BAR_CELLS - filled)}</Text>
            <Text color={ACCENT}>{`  ${p.done}/${p.total} · ${p.percent}%`}</Text>
          </Text>
          {shown.map(todo =>
            todo.status === 'in_progress' ? (
              <Text color={ACCENT}>{`${GLYPH[todo.status]} ${todo.text}`}</Text>
            ) : todo.status === 'pending' ? (
              dimRow(`${GLYPH[todo.status]} ${todo.text}`)
            ) : (
              <Text>
                <Text color="success">{GLYPH[todo.status]}</Text>
                {` ${todo.text}`}
              </Text>
            ),
          )}
          {moreRow(hidden)}
        </Box>
      )
    }

    const work = formatTokens(t.work.input + t.work.output)
    const usd = formatUsd(cost?.usd ?? 0)
    const cache = cacheStatus(t.lastReplyAt, at, ttlMs, isTurnRunning)
    const usageBody = () => (
      <Box flexDirection="column">
        <Text>{`Work     ${work} tokens  ·  ${usd}`}</Text>
        <Text>
          {context?.tokens === undefined
            ? 'Context  –'
            : `Context  ${formatTokens(context.tokens)} / ${formatTokens(context.window)}  ·  ${context.percent ?? 0}%`}
        </Text>
        <Text>
          {'Cache    '}
          <Text color={cache === 'cold' ? 'warning' : undefined}>{cache}</Text>
        </Text>
        {t.isTrackingSinceResume && dimRow('tracking since resume')}
      </Box>
    )
    const usageSummary = [
      work,
      usd,
      context?.percent === undefined ? null : `ctx ${context.percent}%`,
      `cache ${shortCache(cache)}`,
    ]
      .filter(part => part !== null)
      .join(' · ')

    const filesBody = () => {
      if (t.files.length === 0) return dimRow('none yet')
      const { shown, hidden } = more(t.files)
      return (
        <Box flexDirection="column">
          {shown.map(file => (
            <Box key={file.path} flexDirection="column">
              <Text>
                {`${file.path}  `}
                {file.isNew && <Text color="diffAdded">new </Text>}
                <Text color="diffAdded">{`+${file.added}`}</Text>
                {!file.isNew && <Text color="diffRemoved">{` −${file.removed}`}</Text>}
              </Text>
              {file.notes.length > 0 && dimRow(`  · ${file.notes.join('  · ')}`)}
            </Box>
          ))}
          {moreRow(hidden)}
        </Box>
      )
    }

    const toolRows = [
      ...t.skills.map(skill => ({ kind: 'skill', text: skill.name, count: skill.count })),
      ...t.mcps.map(mcp => ({
        kind: 'mcp  ',
        text: `${mcp.server} · ${mcp.tools.join(', ')}`,
        count: mcp.count,
      })),
    ]
    const toolsBody = () => {
      if (toolRows.length === 0) return dimRow('none yet')
      const { shown, hidden } = more(toolRows)
      return (
        <Box flexDirection="column">
          {shown.map(row => (
            <Text>
              <Text dimColor>{`${row.kind}  `}</Text>
              {`${row.text}  ×${row.count}`}
            </Text>
          ))}
          {moreRow(hidden)}
        </Box>
      )
    }
    const toolsSummary = `${t.skills.length} skill${t.skills.length === 1 ? '' : 's'} · ${t.mcps.length} MCP${t.mcps.length === 1 ? '' : 's'}`

    const assumptionsBody = () => {
      if (t.assumptions.length === 0) return dimRow('none yet')
      const { shown, hidden } = more(t.assumptions)
      return (
        <Box flexDirection="column">
          {shown.map(a => (
            <Text>
              {a.isFromAgent && <Text dimColor>(agent) </Text>}
              {a.text}
            </Text>
          ))}
          {moreRow(hidden)}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {section('progress', 'Progress', p === null ? '' : `${p.done}/${p.total} · ${p.percent}%`, progressBody)}
        {section('usage', 'Usage', usageSummary, usageBody)}
        {section('files', `Files changed · ${t.files.length}`, '', filesBody)}
        {section('tools', 'Skills & MCPs', toolsSummary, toolsBody)}
        {section('assumptions', 'Assumptions', String(t.assumptions.length), assumptionsBody)}
      </Box>
    )
  })
}
