import { expect, test } from 'claude-code/testing'

import { diffCells, ringCells, ringRows, ringSvg, splitPath } from './visuals'

test('diff cells split by share, each side visible when present', async () => {
  expect(diffCells(5, 0, 7)).toEqual({ plus: 7, minus: 0 })
  expect(diffCells(13, 24, 7)).toEqual({ plus: 2, minus: 5 })
  expect(diffCells(100, 1, 5)).toEqual({ plus: 4, minus: 1 })
  expect(diffCells(0, 0, 5)).toEqual({ plus: 0, minus: 0 })
})

test('paths split into a name and a short folder', async () => {
  expect(splitPath('greet.ts')).toEqual({ name: 'greet.ts', dir: '' })
  expect(splitPath('hooks/panel.tsx')).toEqual({ name: 'panel.tsx', dir: 'hooks/' })
  expect(splitPath('/private/tmp/scratchpad/live-check/greet.ts')).toEqual({
    name: 'greet.ts',
    dir: '…/scratchpad/live-check/',
  })
})

test('the svg ring dashes its fill to the percent', async () => {
  const svg = ringSvg(31)
  expect(svg).toContain('stroke-dasharray="85.7 276.5"')
  expect(svg).toContain('#4FD1C5')
  expect(svg).toContain('>31%<')
})

test('the braille ring fills clockwise and shows the percent inside', async () => {
  const cells = ringCells(50, 12, 6)
  expect(cells).toHaveLength(6)
  expect(cells.every(row => row.length === 12)).toBe(true)
  const top = cells[0]![6]!
  expect(top.glyph.charCodeAt(0)).toBeGreaterThan(0x2800)
  expect(top.color).toBe('#4FD1C5')
  const bottom = cells[5]![5]!
  expect(bottom.glyph.charCodeAt(0)).toBeGreaterThan(0x2800)
  expect(bottom.color).toBe('#262A35')
  expect(cells[2]!.map(cell => cell.glyph).join('')).toContain('50%')
})

test('ring rows group cells into colored runs', async () => {
  const rows = ringRows(50, 12, 6)
  expect(rows).toHaveLength(6)
  for (const row of rows) {
    expect(row.map(run => run.text).join('')).toHaveLength(12)
    for (let i = 1; i < row.length; i++) expect(row[i]!.color).not.toBe(row[i - 1]!.color)
  }
  expect(rows[2]!.map(run => run.text).join('')).toContain('50%')
  expect(rows[0]!.some(run => run.color === '#4FD1C5')).toBe(true)
})
