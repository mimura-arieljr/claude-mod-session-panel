import { expect, test } from 'claude-code/testing'

import {
  addMcp,
  agentTree,
  describeToolCall,
  mergeAgents,
  addUsage,
  applyFileChange,
  applyTaskCreate,
  applyTaskUpdate,
  applyTodoWrite,
  cacheFraction,
  cacheStatus,
  emptyThread,
  formatAge,
  formatReset,
  formatTokens,
  formatUsd,
  parseTtl,
  relativePath,
  summarizeChange,
  toggleSection,
} from './model'

test('todo writes keep the task in progress for the status line', async () => {
  const t = applyTodoWrite(emptyThread('s'), [
    { content: 'a', status: 'completed' },
    { content: 'b', status: 'completed' },
    { content: 'c', status: 'completed' },
    { content: 'd', status: 'in_progress' },
    { content: 'e', status: 'pending' },
    { content: 'f', status: 'pending' },
  ])
  expect(t.todos.find(todo => todo.status === 'in_progress')?.text).toBe('d')
})

test('task tools build and update the list', async () => {
  let t = applyTaskCreate(emptyThread('s'), '1', 'Read parser')
  t = applyTaskUpdate(t, '1', { status: 'completed' })
  t = applyTaskCreate(t, '2', 'Tests')
  t = applyTaskUpdate(t, '2', { status: 'deleted' })
  expect(t.todos).toEqual([{ id: '1', text: 'Read parser', status: 'completed' }])
})

test('same file accumulates, stays new, dedupes notes', async () => {
  let t = applyFileChange(emptyThread('s'), {
    path: 'a.ts',
    isNew: true,
    lines: ['+function parse() {', '+}'],
  })
  t = applyFileChange(t, {
    path: 'a.ts',
    isNew: false,
    lines: [' function parse() {', '-  return 1', '+  return 2'],
  })
  t = applyFileChange(t, {
    path: 'a.ts',
    isNew: false,
    lines: [' function parse() {', '-  return 2', '+  return 3'],
  })
  expect(t.files).toEqual([
    { path: 'a.ts', isNew: true, added: 4, removed: 2, notes: ['added parse', 'edited parse'] },
  ])
})

test('summaries name added, removed, edited and tests', async () => {
  expect(summarizeChange(['+export function tokenize(s) {', '-const old = () => 1'])).toEqual([
    'added tokenize',
    'removed old',
  ])
  expect(summarizeChange(['-def run(x):', '+def run(x, y):'])).toEqual(['edited run'])
  expect(summarizeChange(["+test('a', () => {})", "+it('b', () => {})"])).toEqual(['added 2 tests'])
  expect(summarizeChange(["+test('a', () => {})"])).toEqual(['added 1 test'])
  expect(summarizeChange(['+# heading'])).toEqual([])
})

test('summaries cap at four notes', async () => {
  const lines = ['a', 'b', 'c', 'd', 'e'].map(n => `+function ${n}() {}`)
  expect(summarizeChange(lines)).toHaveLength(4)
})

test('mcp tools group by server and skip our own', async () => {
  let t = addMcp(emptyThread('s'), 'mcp__claude_ai_Notion__notion-search')
  t = addMcp(t, 'mcp__claude_ai_Notion__notion-fetch')
  t = addMcp(t, 'mcp__claude_ai_Notion__notion-search')
  t = addMcp(t, 'mcp__session-panel__note_assumption')
  expect(t.mcps).toEqual([
    { server: 'claude_ai_Notion', tools: ['notion-search', 'notion-fetch'], count: 3 },
  ])
})

test('usage sums input and output only', async () => {
  const t = addUsage(addUsage(emptyThread('s'), { input_tokens: 100, output_tokens: 50 }), {
    input_tokens: 10,
    output_tokens: 5,
  })
  expect(t.work).toEqual({ input: 110, output: 55 })
})

test('number formats', async () => {
  expect([950, 9000, 38_240, 142_000, 1_000_000, 1_240_000].map(formatTokens)).toEqual([
    '950',
    '9k',
    '38.2k',
    '142k',
    '1M',
    '1.2M',
  ])
  expect(formatUsd(1.236)).toBe('$1.24')
})

test('relative paths strip the working directory', async () => {
  expect(relativePath('/r', '/r/src/a.ts')).toBe('src/a.ts')
  expect(relativePath('/r', '/other/a.ts')).toBe('/other/a.ts')
})

test('cache status counts down from the last reply', async () => {
  const H = 3_600_000
  expect(cacheStatus(null, 0, H, false)).toBe('–')
  expect(cacheStatus(0, 1, H, true)).toBe('warm')
  expect(cacheStatus(0, 8 * 60_000 + 1, H, false)).toBe('warm · 52m')
  expect(cacheStatus(0, H, H, false)).toBe('cold')
  expect(parseTtl('5m')).toBe(300_000)
  expect(parseTtl('60m')).toBe(H)
})

test('cache fraction is what is left of the lifetime', async () => {
  const H = 3_600_000
  expect(cacheFraction(null, 0, H, false)).toBe(0)
  expect(cacheFraction(0, 5, H, true)).toBe(1)
  expect(cacheFraction(0, H / 4, H, false)).toBe(0.75)
  expect(cacheFraction(0, H * 2, H, false)).toBe(0)
})

test('a change can bring its own notes', async () => {
  let t = applyFileChange(emptyThread('s'), { path: 'n.ipynb', isNew: false, lines: [], notes: ['edited cell'] })
  t = applyFileChange(t, { path: 'n.ipynb', isNew: false, lines: [], notes: ['edited cell'] })
  expect(t.files).toEqual([{ path: 'n.ipynb', isNew: false, added: 0, removed: 0, notes: ['edited cell'] }])
})

test('toggle collapses and expands', async () => {
  const t = toggleSection(emptyThread('s'), 'files')
  expect(t.collapsed).toEqual(['files'])
  expect(toggleSection(t, 'files').collapsed).toEqual([])
})

test('a parenthesized value is not read as a function', async () => {
  expect(summarizeChange(['+  const n = (a << 16) | b', '+  const i = (y * size + x) * 4'])).toEqual([])
  expect(summarizeChange(['+const go = (x: number) => x', '+const run = async () => {'])).toEqual([
    'added go',
    'added run',
  ])
})

test('a reset reads as a local time today, else a short weekday', async () => {
  // Thu 2026-10-29 09:00 UTC; offset +420 is UTC-7, so 02:00 local.
  const now = Date.UTC(2026, 9, 29, 9, 0)
  expect(formatReset('2026-10-29T20:50:00Z', now, 420)).toBe('1:50pm')
  expect(formatReset('2026-10-29T07:05:00Z', now, 0)).toBe('7:05am')
  expect(formatReset('2026-10-31T12:00:00Z', now, 0)).toBe('Sat')
  // Late tonight in UTC is already tomorrow at UTC+9.
  expect(formatReset('2026-10-29T20:00:00Z', now, -540)).toBe('Fri')
})

test('ages read in minutes, then hours', async () => {
  expect(formatAge(6 * 60_000)).toBe('6m')
  expect(formatAge(90 * 60_000)).toBe('1h')
})

test("an agent's tool call reads as the tool and its main argument", async () => {
  expect(describeToolCall('Read', { file_path: '/r/hooks/visuals.ts' }, '/r')).toBe('Read hooks/visuals.ts')
  expect(describeToolCall('Bash', { command: 'npm test\nmore' }, '/r')).toBe('Bash npm test')
  expect(describeToolCall('mcp__aws__run_script', { code: 'x' }, '/r')).toBe('aws·run_script')
  expect(describeToolCall('Grep', { pattern: 'x'.repeat(80) }, '/r')).toHaveLength(60)
})

const listed = (id: string, status: string, parentId?: string) => ({
  id,
  type: 'Explore',
  description: `task ${id}`,
  status: status as 'running',
  ...(parentId === undefined ? {} : { parentId }),
})

test('merging the agent list keeps start times and stamps the end', async () => {
  const first = mergeAgents([], [listed('a', 'running')], 1000)
  expect(first).toEqual([{ ...listed('a', 'running'), startedAt: 1000 }])
  const done = mergeAgents(first, [listed('a', 'completed')], 5000)
  expect(done[0]).toMatchObject({ status: 'completed', startedAt: 1000, endedAt: 5000 })
  // Dropped by the engine after it ended: kept as it last stood.
  expect(mergeAgents(done, [], 9000)).toEqual(done)
})

test('an agent the list drops mid-run is counted as completed', async () => {
  const rows = mergeAgents([], [listed('a', 'running')], 1000)
  expect(mergeAgents(rows, [], 3000)[0]).toMatchObject({ status: 'completed', endedAt: 3000 })
})

test('only the last three finished agents are kept', async () => {
  let rows = mergeAgents([], ['a', 'b', 'c', 'd', 'e'].map(id => listed(id, 'running')), 0)
  rows = mergeAgents(rows, [listed('a', 'completed'), listed('b', 'failed'), listed('c', 'killed'), listed('d', 'completed'), listed('e', 'running')], 10)
  expect(rows.map(r => r.id)).toEqual(['b', 'c', 'd', 'e'])
})

test('agents nest under their parent, in start order', async () => {
  const rows = mergeAgents([], [listed('a', 'running'), listed('b', 'running'), listed('c', 'running', 'a')], 0)
  expect(agentTree(rows).map(({ row, depth }) => [row.id, depth])).toEqual([
    ['a', 0],
    ['c', 1],
    ['b', 0],
  ])
})
