// Drawing helpers for the panel's look: the context ring, diff bars, short paths.

export const COLORS = {
  // Inside the rounded frame, behind the cards.
  page: '#101317',
  card: '#1A1D24',
  raised: '#20242D',
  track: '#262A35',
  badge: '#262A35',
  dashed: '#343A47',
  frame: '#3A4150',
  accent: '#4FD1C5',
  // accent at 12% over the card
  accentTint: '#203337',
  amber: '#E6B866',
  // amber at 16% over the card
  amberTint: '#3B362F',
  added: '#6EE7A0',
  // added at 16% over the card
  addedTint: '#273D38',
  removed: '#FF8A7A',
  text: '#E6E8EC',
  textSoft: '#D5D9E0',
  textMid: '#C3C8D1',
  label: '#AEB4BF',
  muted: '#8B93A1',
  idleTint: '#232733',
} as const

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

// How many of `cells` go to added and removed lines, each side shown when present.
export function diffCells(added: number, removed: number, cells: number): { plus: number; minus: number } {
  const total = added + removed
  if (total === 0) return { plus: 0, minus: 0 }
  let plus = Math.round((added / total) * cells)
  if (removed > 0 && plus === cells) plus = cells - 1
  if (added > 0 && plus === 0) plus = 1
  return { plus, minus: cells - plus }
}

// A file's name and its folder, the folder cut to its last two parts.
export function splitPath(path: string): { name: string; dir: string } {
  const parts = path.split('/')
  const name = parts[parts.length - 1] ?? path
  const dirs = parts.slice(0, -1).filter(part => part !== '')
  if (dirs.length === 0) return { name, dir: '' }
  if (dirs.length <= 2) return { name, dir: `${dirs.join('/')}/` }
  return { name, dir: `…/${dirs.slice(-2).join('/')}/` }
}

// The design's ring as SVG, for surfaces that draw SVG (desktop, editor, mobile).
export function ringSvg(percent: number): string {
  const share = clamp01(percent / 100)
  const circumference = 2 * Math.PI * 44
  const dash = `${(share * circumference).toFixed(1)} ${circumference.toFixed(1)}`
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="104" height="104" viewBox="0 0 104 104">',
    `<circle cx="52" cy="52" r="44" fill="none" stroke="${COLORS.track}" stroke-width="9"/>`,
    `<circle cx="52" cy="52" r="44" fill="none" stroke="${COLORS.accent}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${dash}" transform="rotate(-90 52 52)"/>`,
    `<text x="52" y="52" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="22" font-weight="700" fill="${COLORS.text}">${Math.round(percent)}%</text>`,
    `<text x="52" y="70" text-anchor="middle" font-family="Inter, sans-serif" font-size="10" letter-spacing="0.8" fill="${COLORS.muted}">CONTEXT</text>`,
    '</svg>',
  ].join('')
}

// Braille dot bits by [x][y] within a 2×4 cell.
const BRAILLE_BITS = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
]

type RingCell = { glyph: string; color: string }

// A braille ring with the percent inside, as rows of colored cells.
export function ringCells(percent: number, columns: number, rows: number): RingCell[][] {
  // Braille dots are square on a 1:2 cell, so the ring is round in dot space.
  const width = columns * 2
  const height = rows * 4
  const cx = width / 2
  const cy = height / 2
  const outer = Math.min(width, height) / 2 - 0.25
  const inner = outer * 0.72
  const share = clamp01(percent / 100)

  const cells: RingCell[][] = []
  for (let row = 0; row < rows; row++) {
    const line: RingCell[] = []
    for (let col = 0; col < columns; col++) {
      let bits = 0
      let filled = 0
      let tracked = 0
      for (let dx = 0; dx < 2; dx++) {
        for (let dy = 0; dy < 4; dy++) {
          const x = col * 2 + dx + 0.5 - cx
          const y = row * 4 + dy + 0.5 - cy
          const d = Math.sqrt(x * x + y * y)
          if (d > outer || d < inner) continue
          bits |= BRAILLE_BITS[dx]![dy]!
          let angle = Math.atan2(x, -y)
          if (angle < 0) angle += 2 * Math.PI
          if (angle / (2 * Math.PI) < share) filled++
          else tracked++
        }
      }
      line.push({
        glyph: bits === 0 ? ' ' : String.fromCharCode(0x2800 + bits),
        color: filled >= tracked && filled > 0 ? COLORS.accent : COLORS.track,
      })
    }
    cells.push(line)
  }

  // The percent and a label, centered in the hole.
  const write = (text: string, row: number, color: string) => {
    const start = Math.floor((columns - text.length) / 2)
    for (let k = 0; k < text.length; k++) cells[row]![start + k] = { glyph: text[k]!, color }
  }
  const middle = Math.floor((rows - 1) / 2)
  write(`${Math.round(percent)}%`, middle, COLORS.text)
  write('ctx', middle + 1, COLORS.muted)
  return cells
}

// The ring as rows of colored text runs, for drawing with plain Text.
export function ringRows(percent: number, columns: number, rows: number): { text: string; color: string }[][] {
  return ringCells(percent, columns, rows).map(line => {
    const runs: { text: string; color: string }[] = []
    for (const { glyph, color } of line) {
      const last = runs[runs.length - 1]
      // A blank joins the run before it: its color doesn't show.
      if (last !== undefined && (last.color === color || glyph === ' ')) last.text += glyph
      else runs.push({ text: glyph, color })
    }
    return runs
  })
}
