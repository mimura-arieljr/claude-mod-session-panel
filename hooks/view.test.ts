import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { MINI_HIDDEN, MINI_SHOWN, USAGE_HINT, parseViewArg } from './view'

const START = { cwd: '/r', surface: 'terminal', isInteractive: true } as const

// Stand-ins for the engine: a pane list that open and close keep, and a store the test can read.
function engine(on: On, initial: Record<string, unknown> = {}, isPaneOpen = false) {
  const calls: string[] = []
  const store: Record<string, unknown> = { ...initial }
  let isPaneUp = isPaneOpen
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/r' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'session-panel' } }))
  on('tool.register', () => ({ value: { tool: 'note_assumption' } }))
  on('ui.panes', () => ({
    value: isPaneUp
      ? [{ id: 'session-panel', title: 'Session', isShown: true, isFocused: false, isPlaced: true }]
      : [],
  }))
  on('ui.open', () => {
    calls.push('open')
    isPaneUp = true
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => {
    calls.push('close')
    isPaneUp = false
    return { value: undefined }
  })
  mock.clock(on)
  on('store.get', (_, e) => ({ value: store[e.key] }))
  on('store.set', (_, e) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    delete store[e.key]
    return { value: undefined }
  })
  return { calls, store }
}

const run = (
  $: { command: { run(args: never): Promise<{ text?: string }> } },
  args: string,
) => $.command.run({ command: 'session-panel', args } as never)

test('args parse to mini, toggle or unknown', () => {
  expect(parseViewArg('')).toBe('toggle')
  expect(parseViewArg('  MINI ')).toBe('mini')
  expect(parseViewArg('foo')).toBe('unknown')
})

test('mini closes the full pane and is remembered', async ($, on) => {
  const { calls, store } = engine(on)
  await $.session.start(START)
  calls.length = 0
  const ran = await run($, 'mini')
  expect(calls).toEqual(['close'])
  expect(ran.text).toBe(MINI_SHOWN)
  expect(store['view-mode']).toBe('mini')
})

test('mini again opens the full pane and stores full', async ($, on) => {
  const { calls, store } = engine(on)
  await $.session.start(START)
  await run($, 'mini')
  const ran = await run($, 'mini')
  expect(calls.at(-1)).toBe('open')
  expect(ran.text).toContain('Session panel shown')
  expect(store['view-mode']).toBe('full')
})

test('bare command in mini hides then shows the strip without opening the pane', async ($, on) => {
  const { calls } = engine(on)
  await $.session.start(START)
  await run($, 'mini')
  calls.length = 0
  expect((await run($, '')).text).toBe(MINI_HIDDEN)
  expect((await run($, '')).text).toBe(MINI_SHOWN)
  expect(calls).toEqual([])
})

test('an unknown argument changes nothing', async ($, on) => {
  const { calls, store } = engine(on)
  await $.session.start(START)
  calls.length = 0
  const ran = await run($, 'foo')
  expect(ran.text).toBe(USAGE_HINT)
  expect(calls).toEqual([])
  expect(store['view-mode']).toBeUndefined()
})

test('a session stored as mini does not open the pane', async ($, on) => {
  const { calls } = engine(on, { 'view-mode': 'mini' })
  await $.session.start(START)
  expect(calls).not.toContain('open')
})

test('a session starting in mini closes a pane left up from before', async ($, on) => {
  const { calls } = engine(on, { 'view-mode': 'mini' }, true)
  await $.session.start(START)
  expect(calls).toEqual(['close'])
})
