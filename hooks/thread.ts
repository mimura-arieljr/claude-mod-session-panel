import type { On, StateDollar } from 'claude-code'

import type { Thread } from '../types'
import { emptyThread } from './model'
import {
  changeThread,
  readPendingSwitch,
  readThread,
  resetAgents,
  setPendingSwitch,
  setTurnRunning,
  setTurnStartedAt,
} from './thread-state'

const MAX_THREADS = 50
const INDEX_KEY = 'threads'

type StoreDollar = StateDollar & {
  store: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void>; delete(key: string): Promise<void> }
  session: { id(): Promise<string> }
}

function snapshotKey(id: string): string {
  return `thread:${id}`
}

// Brings `thread` in line with the session id after a clear, resume or fork.
// - `sessionId` is the caller's new id when it knows it; else the engine's is asked.
export async function syncThread($: StoreDollar, sessionId?: string): Promise<Thread> {
  const id = sessionId ?? (await $.session.id())
  const current = await readThread($)
  if (current.sessionId === id) return current

  const pending = await readPendingSwitch($)
  const stored = (await $.store.get(snapshotKey(id))) as Thread | undefined
  const fresh = emptyThread(id)
  const synced: Thread =
    stored !== undefined
      ? { ...fresh, ...stored, sessionId: id }
      : pending === 'clear'
        ? fresh
        : pending === 'resume'
          ? { ...fresh, isTrackingSinceResume: true }
          : current.sessionId === ''
            ? fresh
            : { ...current, sessionId: id }

  await setPendingSwitch($, null)
  return changeThread($, () => synced)
}

export async function saveSnapshot($: StoreDollar, t: Thread): Promise<void> {
  if (t.sessionId === '') return
  const index = ((await $.store.get(INDEX_KEY)) as string[] | undefined) ?? []
  const ids = [...index.filter(id => id !== t.sessionId), t.sessionId]
  const dropped = ids.slice(0, Math.max(0, ids.length - MAX_THREADS))
  for (const id of dropped) await $.store.delete(snapshotKey(id))
  await $.store.set(snapshotKey(t.sessionId), t)
  await $.store.set(INDEX_KEY, ids.slice(-MAX_THREADS))
}

export function registerThread(on: On): void {
  // Fires for startup, /clear, /resume and forks with the new id already in place.
  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'resume' || e.source === 'clear') {
      await setPendingSwitch($, e.source)
    } else if (e.source === 'fork' && (await readThread($)).sessionId === '') {
      // A process started with --fork-session can't find its parent: say tracking started late.
      await setPendingSwitch($, 'resume')
    }
    // The hook's own id: `$.session.id()` may still answer the old one here.
    if (e.source !== 'startup') await syncThread($, e.session_id)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    const t = await readThread($)
    await saveSnapshot($, t)
    // A SessionStart that already synced the next thread must not be undone.
    const isEndingThread = t.sessionId === e.sessionId || t.sessionId === ''
    if ((e.reason === 'clear' || e.reason === 'resume') && isEndingThread) {
      // Empty the pane now: the old conversation never shows under the new one.
      await changeThread($, () => emptyThread(''))
      await resetAgents($)
      await setPendingSwitch($, e.reason)
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await syncThread($)
      await setTurnStartedAt($, await $.clock.now())
      await setTurnRunning($, true)
    }
    return next(e)
  })
}
