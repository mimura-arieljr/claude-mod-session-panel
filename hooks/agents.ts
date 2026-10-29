import type { On, StateDollar } from 'claude-code'

import type { AgentRow } from '../types'
import { isAgentDone, mergeAgents } from './model'
import { changeAgents } from './thread-state'

type AgentDollar = StateDollar & {
  agent: { list(): Promise<Pick<AgentRow, 'id' | 'type' | 'description' | 'status' | 'parentId'>[]> }
  clock: { now(): Promise<number> }
}

// Reads the engine's agent list into the panel's rows; keeps watching while any is unfinished.
export async function pollAgents($: AgentDollar): Promise<void> {
  const [listed, now] = await Promise.all([$.agent.list(), $.clock.now()])
  await changeAgents($, current => {
    const rows = mergeAgents(current.rows, listed, now)
    return { rows, isWatching: rows.some(row => !isAgentDone(row.status)) }
  })
}

export function registerAgents(on: On): void {
  // No event says an agent's status changed: a spawn starts the panel's watch.
  on('agent.spawn', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.agentId !== undefined) await pollAgents($)
    return ran
  }).catch(($, e, next) => next(e)) // Observer only: a failure here never blocks the spawn.
}
