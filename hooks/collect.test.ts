import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { watchThread } from './test-support'

const USAGE = {
  input_tokens: 100,
  output_tokens: 10,
  cache_read_input_tokens: 5000,
  cache_creation_input_tokens: 0,
  model: 'm',
}

// Stand-ins for the engine calls the collectors make.
function engine(on: On) {
  on('session.cwd', () => ({ value: '/r' }))
  on('session.id', () => ({ value: 's1' }))
  return watchThread(on)
}

test('an Edit adds the file with counts and notes', async ($, on) => {
  const thread = engine(on)
  on('tool.call', () => ({
    result: { filePath: '/r/src/a.ts', structuredPatch: [{ lines: ['+function a() {', '+}'] }] },
  }))
  await $.tool.call({ tool: 'Edit', file_path: '/r/src/a.ts', old_string: 'x', new_string: 'y' })
  expect(thread().files).toEqual([
    { path: 'src/a.ts', isNew: false, added: 2, removed: 0, notes: ['added a'] },
  ])
})

test('a Write that creates a file marks it new', async ($, on) => {
  const thread = engine(on)
  on('tool.call', () => ({
    result: { type: 'create', filePath: '/r/b.md', structuredPatch: [{ lines: ['+hi'] }] },
  }))
  await $.tool.call({ tool: 'Write', file_path: '/r/b.md', content: 'hi' })
  expect(thread().files).toEqual([{ path: 'b.md', isNew: true, added: 1, removed: 0, notes: [] }])
})

test('a denied Edit adds nothing', async ($, on) => {
  const thread = engine(on)
  on('tool.call', () => ({ deny: 'no' }))
  await $.tool.call({ tool: 'Edit', file_path: '/r/a.ts', old_string: 'x', new_string: 'y' })
  expect(thread().files).toEqual([])
})

test('an errored Write adds nothing', async ($, on) => {
  const thread = engine(on)
  on('tool.call', () => ({ result: {}, isError: true }))
  await $.tool.call({ tool: 'Write', file_path: '/r/a.ts', content: 'x' })
  expect(thread().files).toEqual([])
})

test('the main TodoWrite sets the list', async ($, on) => {
  const thread = engine(on)
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [{ content: 'a', status: 'completed', activeForm: 'A' }],
  })
  expect(thread().todos).toEqual([{ id: '0', text: 'a', status: 'completed' }])
})

test("a subagent's TodoWrite does not replace the main list", async ($, on) => {
  const thread = engine(on)
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [{ content: 'a', status: 'pending', activeForm: 'A' }],
    agentId: 'a1',
  })
  expect(thread().todos).toEqual([])
})

test('task tools build the list', async ($, on) => {
  const thread = engine(on)
  on('tool.call', { tool: 'TaskCreate' }, () => ({ result: { task: { id: '7', subject: 'Plan' } } }))
  on('tool.call', { tool: 'TaskUpdate' }, () => ({ result: { success: true, taskId: '7' } }))
  await $.tool.call({ tool: 'TaskCreate', subject: 'Plan', description: 'd' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'in_progress' })
  expect(thread().todos).toEqual([{ id: '7', text: 'Plan', status: 'in_progress' }])
})

test('turn usage sums across loops', async ($, on) => {
  const thread = engine(on)
  mock.clock(on)
  on('turn.complete', () => ({ text: '' }))
  const base = { answer: '', durationMs: 1, isAborted: false, reason: 'answer', usage: USAGE } as const
  await $.turn.complete({ ...base, turnId: 't1' })
  await $.turn.complete({ ...base, turnId: 't2', agentId: 'a1' })
  expect(thread().work).toEqual({ input: 200, output: 20 })
})

test("a main turn end sets lastReplyAt, a subagent's does not", async ($, on) => {
  const thread = engine(on)
  const clock = mock.clock(on, { now: 5000 })
  on('turn.complete', () => ({ text: '' }))
  const base = { answer: '', durationMs: 1, isAborted: false, reason: 'answer' } as const
  await $.turn.complete({ ...base, turnId: 't1', agentId: 'a1' })
  expect(thread().lastReplyAt).toBe(null)
  await $.turn.complete({ ...base, turnId: 't2' })
  expect(thread().lastReplyAt).toBe(clock.now())
})

test('skill and mcp uses are listed', async ($, on) => {
  const thread = engine(on)
  on('skill.prompt', (_, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: {} }))
  await $.skill.prompt({
    skill: 'superpowers:brainstorming',
    text: 'x',
    frontmatter: {},
    source: 'plugin',
  })
  await $.tool.call({ tool: 'mcp__claude_ai_Notion__notion-search', query: 'q' })
  const t = thread()
  expect(t.skills).toEqual([{ name: 'superpowers:brainstorming', count: 1 }])
  expect(t.mcps).toEqual([{ server: 'claude_ai_Notion', tools: ['notion-search'], count: 1 }])
})

test('a Write that creates a file counts its content', async ($, on) => {
  const thread = engine(on)
  // The engine's real create result: an empty patch, the content beside it.
  on('tool.call', () => ({
    result: {
      type: 'create',
      filePath: '/r/c.ts',
      content: 'export function c() {}\nexport function d() {}\n',
      structuredPatch: [],
      originalFile: null,
    },
  }))
  await $.tool.call({ tool: 'Write', file_path: '/r/c.ts', content: 'x' })
  expect(thread().files).toEqual([
    { path: 'c.ts', isNew: true, added: 2, removed: 0, notes: ['added c', 'added d'] },
  ])
})
