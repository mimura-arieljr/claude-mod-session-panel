import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { TOOL_DESCRIPTION } from './assumptions'
import { watchThread } from './test-support'

const TOOL = 'mcp__session-panel__note_assumption'

// The engine's generated tool list doesn't declare the mod's own tool.
function note($: Engine, input: Record<string, unknown>) {
  return $.tool.call({ tool: TOOL, ...input } as never)
}

test('a noted assumption reaches the thread, newest first', async ($, on) => {
  const thread = watchThread(on)
  mock.clock(on, { now: 42 })
  on('tool.call', () => ({ result: {} }))
  const first = await note($, { assumption: 'Tests use vitest' })
  await note($, { assumption: 'Config lives in src/' })
  expect(first.result).toBe('noted')
  expect(thread().assumptions).toEqual([
    { text: 'Config lives in src/', isFromAgent: false, at: 42 },
    { text: 'Tests use vitest', isFromAgent: false, at: 42 },
  ])
})

test("a subagent's assumption is marked", async ($, on) => {
  const thread = watchThread(on)
  mock.clock(on)
  on('tool.call', () => ({ result: {} }))
  await note($, { assumption: 'x', agentId: 'a1' })
  expect(thread().assumptions[0]?.isFromAgent).toBe(true)
})

// Org sessions: cc-plugin-sec-default skips user prompt.compose hooks, so the tool carries the instruction.
test('the tool description says when to use it', () => {
  expect(TOOL_DESCRIPTION).toContain('assume something the user did not state')
  expect(TOOL_DESCRIPTION).toContain('keep working')
})

test('the system prompt is left alone', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'x', text: 'x', scope: 'shared' }] }))
  const composed = await $.prompt.compose({
    model: 'm',
    promptModel: 'm',
    surfaces: [],
    tools: [],
    outputStyle: null,
    traits: [],
  })
  expect(composed.sections.map(s => s.id)).toEqual(['x'])
})
