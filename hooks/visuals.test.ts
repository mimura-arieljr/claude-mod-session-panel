import { expect, test } from 'claude-code/testing'

import { base64, cacheFraction, diffCells, ringPixels, ringSvg, splitPath } from './visuals'

const FILL = [0x4f, 0xd1, 0xc5]
const TRACK = [0x26, 0x2a, 0x35]
const BG = [0x1a, 0x1d, 0x24]

function pixel(bytes: Uint8Array, size: number, x: number, y: number): number[] {
  const i = (y * size + x) * 4
  return [bytes[i] ?? -1, bytes[i + 1] ?? -1, bytes[i + 2] ?? -1]
}

test('base64 encodes bytes', async () => {
  expect(base64(new Uint8Array([104, 105]))).toBe('aGk=')
  expect(base64(new Uint8Array([1, 2, 3]))).toBe('AQID')
  expect(base64(new Uint8Array([]))).toBe('')
})

test('the ring fills clockwise from the top', async () => {
  const size = 96
  const half = ringPixels(50, size)
  expect(half).toHaveLength(size * size * 4)
  expect(pixel(half, size, 48, 5)).toEqual(FILL)
  expect(pixel(half, size, 90, 48)).toEqual(FILL)
  expect(pixel(half, size, 47, 91)).toEqual(TRACK)
  expect(pixel(half, size, 48, 48)).toEqual(BG)
  expect(pixel(ringPixels(0, size), size, 48, 5)).toEqual(TRACK)
})

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
