import type { On, RenderChildren } from 'claude-code'

import { LIMIT_LABEL, LIMITS_STALE_MS, formatReset, packSegments } from './model'
import { readLimits, readNow, readThread, readView } from './thread-state'
import { COLORS, eighthBar, limitColor } from './visuals'

// The mini view: a frameless strip in the band above the prompt.
const BAR_CELLS = 8
const GAP = 3

type Segment = { key: string; width: number; node: RenderChildren; isTools?: boolean }

export function registerBand(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Reading `now` subscribes the strip to the clock tick, as the pane does.
    const [view, t, limits, , at, { context }] = await Promise.all([
      readView($),
      readThread($),
      readLimits($),
      readNow($),
      $.clock.now(),
      $.session.usage(),
    ])
    if (view.mode !== 'mini' || !view.isShown || e.props.hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)

    const bar = (fraction: number, color: string) => {
      const fill = eighthBar(fraction, BAR_CELLS)
      return [
        <Text key="fill" color={color}>{fill}</Text>,
        <Text key="track" color={COLORS.track}>{'░'.repeat(Math.max(0, BAR_CELLS - fill.length))}</Text>,
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
            <Text color={COLORS.muted}>{'ctx '}</Text>
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
      const reset = w.resetsAt === undefined ? '' : ` ↻${formatReset(w.resetsAt, at, offsetMinutes)}`
      segments.push({
        key: `limit-${w.kind}`,
        width: label.length + BAR_CELLS + pct.length + reset.length,
        node: (
          <Text>
            <Text color={COLORS.muted}>{label}</Text>
            {bar(w.percentUsed / 100, limitColor(w.percentUsed, isStale))}
            <Text color={isStale ? COLORS.muted : COLORS.text}>{pct}</Text>
            {reset !== '' && <Text color={COLORS.muted}>{reset}</Text>}
          </Text>
        ),
      })
    }

    // Tools: packed by the summary's width; on its row it grows and the names truncate.
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
    const hasTools = t.skills.length + t.mcps.length > 0
    const summary = hasTools
      ? `✦ ${plural(t.skills.length, 'skill')} · ${plural(t.mcps.length, 'mcp')}`
      : '✦ none yet'
    const names = [
      ...t.skills.map(skill => `${skill.name} ×${skill.count}`),
      ...t.mcps.map(mcp => `${mcp.server} ×${mcp.count}`),
    ].join(' · ')
    segments.push({
      key: 'tools',
      width: summary.length,
      isTools: true,
      node: (
        <Text wrap="truncate-end">
          <Text color={COLORS.accent}>{summary}</Text>
          {names !== '' && <Text color={COLORS.text}>{`   ${names}`}</Text>}
        </Text>
      ),
    })

    const rows = packSegments(
      segments.map(s => s.width),
      e.props.bodyColumns,
      GAP,
    )
    return (
      <Box flexDirection="column">
        {rows.map((row, r) => (
          <Box key={`mini-row-${r}`} flexDirection="row">
            {row.map((i, n) => {
              const s = segments[i]!
              return (
                <Box
                  key={s.key}
                  marginLeft={n === 0 ? 0 : GAP}
                  flexShrink={s.isTools === true ? 1 : 0}
                  flexGrow={s.isTools === true ? 1 : 0}
                >
                  {s.node}
                </Box>
              )
            })}
          </Box>
        ))}
      </Box>
    )
  })
}
