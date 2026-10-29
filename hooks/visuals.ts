// Drawing helpers for the panel's look: eighth-block bars, diff bars, folders and short paths.

import type { FileEntry } from '../types'

export const COLORS = {
  // Inside the rounded frame
  page: '#1A1D24',
  raised: '#20242D',
  track: '#2E3340',
  rule: '#2A2F3A',
  dashed: '#343A47',
  frame: '#3A4150',
  accent: '#4FD1C5',
  amber: '#E6B866',
  // Behind assumption rows only
  assumptionFill: '#262318',
  assumptionText: '#E2D8C2',
  added: '#6EE7A0',
  removed: '#FF8A7A',
  text: '#E6E8EC',
  textMid: '#C3C8D1',
  label: '#AEB4BF',
  muted: '#8B93A1',
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

// Partial cells by eighths, index 1 to 7.
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

// A run of full and partial blocks for a length counted in eighths of a cell.
function blocks(eighths: number): string {
  return '█'.repeat(Math.floor(eighths / 8)) + EIGHTHS[eighths % 8]!
}

// A bar filled to `share` of `cells`, in eighths; the caller draws the track after it.
export function eighthBar(share: number, cells: number): string {
  return blocks(Math.round(clamp01(share) * cells * 8))
}

// A file's diff bar: its length its change against the largest, added then removed.
export function diffBar(added: number, removed: number, largest: number, cells: number): { plus: string; minus: string } {
  const total = added + removed
  if (total === 0 || largest === 0) return { plus: '', minus: '' }
  const eighths = Math.max(1, Math.round((total / largest) * cells * 8))
  if (removed === 0) return { plus: blocks(eighths), minus: '' }
  if (added === 0) return { plus: '', minus: blocks(eighths) }
  // Added rounds to whole cells when it can, so the colors meet without a gap.
  const plusEighths = Math.max(1, Math.round((added / total) * eighths))
  const plus = plusEighths >= 8 ? Math.round(plusEighths / 8) * 8 : plusEighths
  return { plus: blocks(plus), minus: blocks(Math.max(1, eighths - plus)) }
}

// Files under their short folder, folders in the order first seen.
export function groupByFolder(files: readonly FileEntry[]): { dir: string; files: FileEntry[] }[] {
  const groups = new Map<string, FileEntry[]>()
  for (const file of files) {
    const { dir } = splitPath(file.path)
    const group = groups.get(dir)
    if (group === undefined) groups.set(dir, [file])
    else group.push(file)
  }
  return [...groups].map(([dir, grouped]) => ({ dir, files: grouped }))
}
