import { atom, update } from 'claude-code'
import type { StateDollar } from 'claude-code'

import type { PendingSwitch, Thread } from '../types'
import { emptyThread } from './model'

// Change the tag when Thread's fields change: it declines older stored values.
export const thread = atom({ plugin: 'session-panel', key: 'thread' } as const, emptyThread(''), {
  shape: 'thread-1',
})
export const pendingSwitch = atom(
  { plugin: 'session-panel', key: 'pendingSwitch' } as const,
  null as PendingSwitch,
)
export const turnRunning = atom({ plugin: 'session-panel', key: 'turnRunning' } as const, false)
export const now = atom({ plugin: 'session-panel', key: 'now' } as const, 0)

export function changeThread($: StateDollar, fn: (t: Thread) => Thread): Promise<Thread> {
  return update($, thread, fn)
}
