import type { On } from 'claude-code'

import type { Thread } from '../types'
import { emptyThread } from './model'

// Tests can't read plugin state, so record each write of `thread` instead.
export function watchThread(on: On): () => Thread {
  let last: Thread = emptyThread('')
  on('state.set', { plugin: 'session-panel', key: 'thread' }, (_, e, next) => {
    last = unshape(e.value)
    return next(e)
  })
  return () => last
}

// A shaped atom stores `{ shape, value }`.
function unshape(stored: unknown): Thread {
  return (stored as { value: Thread }).value
}
