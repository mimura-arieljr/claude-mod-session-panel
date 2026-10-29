import { expect, test } from 'claude-code/testing'

import { diffBar, diffCells, eighthBar, groupByFolder, splitPath } from './visuals'

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

test('eighth bars fill to the share in eighths of a cell', async () => {
  expect(eighthBar(0.12, 16)).toBe('█▉')
  expect(eighthBar(0, 16)).toBe('')
  expect(eighthBar(1, 4)).toBe('████')
})

test('diff bars size by the change against the largest, split added then removed', async () => {
  expect(diffBar(26, 13, 39, 10)).toEqual({ plus: '███████', minus: '███' })
  expect(diffBar(13, 0, 39, 10)).toEqual({ plus: '███▍', minus: '' })
  expect(diffBar(1, 0, 39, 10)).toEqual({ plus: '▎', minus: '' })
  expect(diffBar(0, 0, 39, 10)).toEqual({ plus: '', minus: '' })
})

test('files group by folder in first-seen order', async () => {
  const f = (path: string) => ({ path, isNew: false, added: 1, removed: 0, notes: [] })
  const groups = groupByFolder([f('hooks/a.ts'), f('b.ts'), f('hooks/c.ts')])
  expect(groups.map(g => [g.dir, g.files.map(x => x.path)])).toEqual([
    ['hooks/', ['hooks/a.ts', 'hooks/c.ts']],
    ['', ['b.ts']],
  ])
})
