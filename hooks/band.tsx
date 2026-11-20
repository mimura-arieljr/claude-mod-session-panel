import type { On, RenderChildren } from 'claude-code'

import { LIMIT_LABEL, LIMITS_STALE_MS, formatReset, packSegments } from './model'
import { readLimits, readNow, readThread, readView } from './thread-state'
import { COLORS, eighthBar, limitColor } from './visuals'

// The mini view: a frameless strip in the band above the prompt.
const BAR_CELLS = 8
// Between usage segments on one row: a dim bar with room either side.
const SEPARATOR = '  │  '
// Lines the strip up with the names in the `/` suggestions above it.
const INSET = 4

export function isEngineOnly(drawn: unknown): boolean {
  return drawn === null || drawn === undefined || (drawn as { type?: unknown }).type === 'engine'
}

type Segment = { key: string; width: number; node: RenderChildren }

export function registerBand(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Only `view` is read first, so the full view never redraws the band on a tick.
    const view = await readView($)
    if (view.mode !== 'mini' || !view.isShown || e.props.hasSurvey) return next(e)
    // Another mod drawing here (an exit prompt, say) goes first; bare, `next` gives the engine's node.
    const below = await next(e)
    if (!isEngineOnly(below)) return below
    // Reading `now` subscribes the strip to the clock tick, as the pane does.
    const [t, limits, , at, { context }] = await Promise.all([
      readThread($),
      readLimits($),
      readNow($),
      $.clock.now(),
      $.session.usage(),
    ])
    const { Box, Text } = $.ui.resolve(e)

    const bar = (fraction: number, color: string) => {
      const fill = eighthBar(fraction, BAR_CELLS)
      return [
        <Text key="fill" color={color}>{fill}</Text>,
        <Text key="track" color={COLORS.bandTrack}>{'░'.repeat(Math.max(0, BAR_CELLS - fill.length))}</Text>,
      ]
    }

    const percent = context?.percent ?? 0
    const ctxPercent = ` ${Math.round(percent)}%`
    const segments: Segment[] = [
      {
        key: 'ctx',
        width: 4 + BAR_CELLS + ctxPercent.length,
        node: (
          <Text>
            <Text color={COLORS.label} bold>{'Ctx '}</Text>
            {bar(percent / 100, COLORS.accent)}
            <Text color={COLORS.text}>{ctxPercent}</Text>
          </Text>
        ),
      },
    ]

    const isStale = at - limits.readAt >= LIMITS_STALE_MS
    const offsetMinutes = new Date(at).getTimezoneOffset()
    for (const w of limits.windows) {
      const label = `${LIMIT_LABEL[w.kind] ?? w.kind} `
      const pct = ` ${Math.round(w.percentUsed)}%`
      const reset = w.resetsAt === undefined ? '' : ` resets ${formatReset(w.resetsAt, at, offsetMinutes)}`
      segments.push({
        key: `limit-${w.kind}`,
        width: label.length + BAR_CELLS + pct.length + reset.length,
        node: (
          <Text>
            <Text color={COLORS.label} bold>{label}</Text>
            {bar(w.percentUsed / 100, limitColor(w.percentUsed, isStale))}
            <Text color={isStale ? COLORS.muted : COLORS.text}>{pct}</Text>
            {reset !== '' && <Text color={COLORS.muted}>{reset}</Text>}
          </Text>
        ),
      })
    }

    // Tools: always their own row, names truncated to fit.
    const names = [
      ...t.skills.map(skill => `${skill.name} ×${skill.count}`),
      ...t.mcps.map(mcp => `${mcp.server} ×${mcp.count}`),
    ].join(' · ')

    const rows = packSegments(
      segments.map(s => s.width),
      e.props.bodyColumns - INSET,
      SEPARATOR.length,
    )
    return (
      <Box flexDirection="column" paddingLeft={INSET} paddingTop={1}>
        {rows.map((row, r) => (
          <Box key={`mini-row-${r}`} flexDirection="row">
            {row.map((i, n) => {
              const s = segments[i]!
              return (
                <Box key={s.key} flexShrink={0}>
                  {n > 0 && <Text color={COLORS.muted}>{SEPARATOR}</Text>}
                  {s.node}
                </Box>
              )
            })}
          </Box>
        ))}
        <Box key="mini-tools" flexDirection="row">
          <Text wrap="truncate-end">
            <Text color={COLORS.label} bold>
              Skills & MCPs
            </Text>
            <Text color={names === '' ? COLORS.muted : COLORS.text}>{`  ${names === '' ? 'none yet' : names}`}</Text>
          </Text>
        </Box>
      </Box>
    )
  })
}
