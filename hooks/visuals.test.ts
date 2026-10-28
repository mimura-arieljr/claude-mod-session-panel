import { expect, test } from 'claude-code/testing'

import { cacheFraction, diffCells, ringCells, ringRows, ringSvg, splitPath } from './visuals'

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

test('cache fraction is what is left of the lifetime', async () => {
  const H = 3_600_000
  expect(cacheFraction(null, 0, H, false)).toBe(0)
  expect(cacheFraction(0, 5, H, true)).toBe(1)
  expect(cacheFraction(0, H / 4, H, false)).toBe(0.75)
  expect(cacheFraction(0, H * 2, H, false)).toBe(0)
})

test('the svg ring dashes its fill to the percent', async () => {
  const svg = ringSvg(31)
  expect(svg).toContain('stroke-dasharray="85.7 276.5"')
  expect(svg).toContain('#4FD1C5')
  expect(svg).toContain('>31%<')
})

// One cell of a Raster: [codePoint, foreground, background].
function cell(words: Uint32Array, columns: number, x: number, y: number): [number, number, number] {
  const i = (y * columns + x) * 3
  return [words[i] ?? 0, words[i + 1] ?? 0, words[i + 2] ?? 0]
}

test('the braille ring fills clockwise and shows the percent inside', async () => {
  const words = ringCells(50, 12, 6)
  expect(words).toHaveLength(12 * 6 * 3)
  const [topGlyph, topColor] = cell(words, 12, 6, 0)
  expect(topGlyph).toBeGreaterThan(0x2800)
  expect(topColor).toBe(0x4fd1c5)
  const [bottomGlyph, bottomColor] = cell(words, 12, 5, 5)
  expect(bottomGlyph).toBeGreaterThan(0x2800)
  expect(bottomColor).toBe(0x262a35)
  const middle = [4, 5, 6, 7].map(x => String.fromCharCode(cell(words, 12, x, 2)[0])).join('')
  expect(middle).toContain('50%')
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
