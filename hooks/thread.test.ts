import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { Thread } from '../types'
import { emptyThread } from './model'
import { watchThread } from './test-support'

const EDIT = { tool: 'Edit', file_path: '/r/a.ts', old_string: 'x', new_string: 'y' } as const
const FILE = { path: 'a.ts', isNew: false, added: 1, removed: 0, notes: [] }

// Stand-ins for the engine: a session id the test can change, and an Edit that adds a.ts.
function engine(on: On, store: Record<string, unknown> = {}) {
  const session = { id: 's1' }
  on('session.id', () => ({ value: session.id }))
  on('session.cwd', () => ({ value: '/r' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('turn.start', (_, e) => ({ text: e.text, turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: { filePath: '/r/a.ts', structuredPatch: [{ lines: ['+x'] }] } }))
  mock.clock(on)
  mock.store(on, store)
  return { session, thread: watchThread(on) }
}

const START = { cwd: '/r', surface: 'terminal', isInteractive: true } as const

test('a hot reload keeps the thread', async ($, on) => {
  const { thread } = engine(on)
  await $.session.start(START)
  await $.tool.call(EDIT)
  await $.session.start(START)
  expect(thread().sessionId).toBe('s1')
  expect(thread().files).toEqual([FILE])
})

test('clear starts empty', async ($, on) => {
  const { session, thread } = engine(on)
  await $.session.start(START)
  await $.tool.call(EDIT)
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  session.id = 's2'
  await $.turn.start({ text: 'hi', turnId: 't1' })
  expect(thread()).toEqual(emptyThread('s2'))
})

test('resume loads the snapshot', async ($, on) => {
  const saved: Thread = { ...emptyThread('s0'), files: [FILE] }
  const { session, thread } = engine(on, { 'thread:s0': saved })
  await $.session.start(START)
  await $.session.end({ reason: 'resume', sessionId: 's1', resume: { id: 's1' } })
  session.id = 's0'
  await $.turn.start({ text: 'hi', turnId: 't1' })
  expect(thread()).toEqual(saved)
})

test('resume without a snapshot says so', async ($, on) => {
  const { session, thread } = engine(on)
  await $.session.start(START)
  await $.tool.call(EDIT)
  await $.session.end({ reason: 'resume', sessionId: 's1', resume: { id: 's1' } })
  session.id = 's0'
  await $.turn.start({ text: 'hi', turnId: 't1' })
  expect(thread()).toEqual({ ...emptyThread('s0'), isTrackingSinceResume: true })
})

test('starting with --resume and no snapshot says so', async ($, on) => {
  const { thread } = engine(on)
  on('classic.SessionStart', () => ({}))
  await $.classic.SessionStart({ source: 'resume' })
  await $.session.start(START)
  expect(thread()).toEqual({ ...emptyThread('s1'), isTrackingSinceResume: true })
})

test('a fork copies the thread', async ($, on) => {
  const { session, thread } = engine(on)
  await $.session.start(START)
  await $.tool.call(EDIT)
  session.id = 's3'
  await $.turn.start({ text: 'hi', turnId: 't1' })
  expect(thread().sessionId).toBe('s3')
  expect(thread().files).toEqual([FILE])
})

test('a main turn end saves the snapshot and keeps at most 50 threads', async ($, on) => {
  const old = Array.from({ length: 50 }, (_, i) => `t${i}`)
  const store: Record<string, unknown> = { threads: old }
  for (const id of old) store[`thread:${id}`] = emptyThread(id)
  store['thread:t1'] = { ...emptyThread('t1'), files: [FILE] }
  const { session, thread } = engine(on, store)
  await $.session.start(START)
  await $.tool.call(EDIT)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, reason: 'answer', turnId: 't' })

  // The next oldest is kept.
  await $.session.end({ reason: 'resume', sessionId: 's1', resume: { id: 's1' } })
  session.id = 't1'
  await $.turn.start({ text: 'hi', turnId: 't2' })
  expect(thread().files).toEqual([FILE])

  // The oldest thread was dropped: resuming it finds no snapshot.
  await $.session.end({ reason: 'resume', sessionId: 't1', resume: { id: 't1' } })
  session.id = 't0'
  await $.turn.start({ text: 'hi', turnId: 't3' })
  expect(thread().isTrackingSinceResume).toBe(true)

  // The saved thread comes back too.
  await $.session.end({ reason: 'resume', sessionId: 't0', resume: { id: 't0' } })
  session.id = 's1'
  await $.turn.start({ text: 'hi', turnId: 't4' })
  expect(thread().files).toEqual([FILE])
})

test('clear empties the thread before the next prompt', async ($, on) => {
  const { session, thread } = engine(on)
  on('classic.SessionStart', () => ({}))
  await $.session.start(START)
  await $.tool.call(EDIT)
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  expect(thread().files).toEqual([])
  session.id = 's2'
  await $.classic.SessionStart({ source: 'clear' })
  expect(thread()).toEqual(emptyThread('s2'))
})

test('resume shows the snapshot before the next prompt', async ($, on) => {
  const saved: Thread = { ...emptyThread('s0'), files: [FILE] }
  const { session, thread } = engine(on, { 'thread:s0': saved })
  on('classic.SessionStart', () => ({}))
  await $.session.start(START)
  await $.session.end({ reason: 'resume', sessionId: 's1', resume: { id: 's1' } })
  session.id = 's0'
  await $.classic.SessionStart({ source: 'resume' })
  expect(thread()).toEqual(saved)
})

test('starting with --fork-session says tracking started late', async ($, on) => {
  const { thread } = engine(on)
  on('classic.SessionStart', () => ({}))
  await $.classic.SessionStart({ source: 'fork' })
  await $.session.start(START)
  expect(thread()).toEqual({ ...emptyThread('s1'), isTrackingSinceResume: true })
})

test('an in-process fork still copies the thread', async ($, on) => {
  const { session, thread } = engine(on)
  on('classic.SessionStart', () => ({}))
  await $.session.start(START)
  await $.tool.call(EDIT)
  session.id = 's3'
  await $.classic.SessionStart({ source: 'fork' })
  expect(thread().sessionId).toBe('s3')
  expect(thread().files).toEqual([FILE])
})
