import { atom, read, update } from 'claude-code'
import type { StateDollar } from 'claude-code'

import type { PendingSwitch, Thread } from '../types'
import { emptyThread } from './model'

// The engine only lets the file that defines an atom read or write it, so every access lives here.

// Change the tag when Thread's fields change: it declines older stored values.
const thread = atom({ plugin: 'session-panel', key: 'thread' } as const, emptyThread(''), {
  shape: 'thread-1',
})
const pendingSwitch = atom(
  { plugin: 'session-panel', key: 'pendingSwitch' } as const,
  null as PendingSwitch,
)
const turnRunning = atom({ plugin: 'session-panel', key: 'turnRunning' } as const, false)
const turnStartedAt = atom({ plugin: 'session-panel', key: 'turnStartedAt' } as const, 0)
const now = atom({ plugin: 'session-panel', key: 'now' } as const, 0)

export function readThread($: StateDollar): Promise<Thread> {
  return read($, thread)
}

export function changeThread($: StateDollar, fn: (t: Thread) => Thread): Promise<Thread> {
  return update($, thread, fn)
}

export function readPendingSwitch($: StateDollar): Promise<PendingSwitch> {
  return read($, pendingSwitch)
}

export function setPendingSwitch($: StateDollar, value: PendingSwitch): Promise<PendingSwitch> {
  return update($, pendingSwitch, () => value)
}

export function readTurnRunning($: StateDollar): Promise<boolean> {
  return read($, turnRunning)
}

export function setTurnRunning($: StateDollar, value: boolean): Promise<boolean> {
  return update($, turnRunning, () => value)
}

export function readTurnStartedAt($: StateDollar): Promise<number> {
  return read($, turnStartedAt)
}

export function setTurnStartedAt($: StateDollar, value: number): Promise<number> {
  return update($, turnStartedAt, () => value)
}

export function readNow($: StateDollar): Promise<number> {
  return read($, now)
}

export function setNow($: StateDollar, value: number): Promise<number> {
  return update($, now, () => value)
}
