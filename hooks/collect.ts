import type { On } from 'claude-code'

import {
  addMcp,
  addSkill,
  addUsage,
  applyFileChange,
  applyTaskCreate,
  applyTaskUpdate,
  applyTodoWrite,
  describeToolCall,
  relativePath,
} from './model'
import { saveSnapshot } from './thread'
import { changeThread, setAgentActivity, setLimits, setTurnRunning } from './thread-state'

type Patch = readonly { lines: readonly string[] }[] | undefined

function patchLines(patch: Patch): string[] {
  return (patch ?? []).flatMap(hunk => hunk.lines)
}

function contentLines(content: string): string[] {
  const lines = content.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines.map(line => `+${line}`)
}

export function registerCollectors(on: On): void {
  on('tool.call', async ($, e, next) => {
    // A subagent's latest call, shown under it in the Agents section.
    if (e.agentId !== undefined) {
      await setAgentActivity($, e.agentId, describeToolCall(e.tool, e as Record<string, unknown>, await $.session.cwd()))
    }
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran

    if (e.tool === 'Edit' || e.tool === 'Write') {
      const result = ran.result as {
        type?: string
        filePath?: string
        content?: string
        structuredPatch?: Patch
      }
      const cwd = await $.session.cwd()
      const path = relativePath(cwd, result.filePath ?? e.file_path)
      const isNew = e.tool === 'Write' && result.type === 'create'
      // A created file comes back with an empty patch: count its content instead.
      const lines =
        isNew && (result.structuredPatch ?? []).length === 0
          ? contentLines(result.content ?? '')
          : patchLines(result.structuredPatch)
      await changeThread($, t => applyFileChange(t, { path, isNew, lines }))
    } else if (e.tool === 'NotebookEdit') {
      const path = relativePath(await $.session.cwd(), e.notebook_path)
      await changeThread($, t =>
        applyFileChange(t, { path, isNew: false, lines: [], notes: ['edited cell'] }),
      )
    } else if (e.tool === 'TodoWrite' && e.agentId === undefined) {
      await changeThread($, t => applyTodoWrite(t, e.todos))
    } else if (e.tool === 'TaskCreate' && e.agentId === undefined) {
      const result = ran.result as { task?: { id: string } }
      const id = result.task?.id
      if (id !== undefined) await changeThread($, t => applyTaskCreate(t, id, e.subject))
    } else if (e.tool === 'TaskUpdate' && e.agentId === undefined) {
      await changeThread($, t =>
        applyTaskUpdate(t, e.taskId, { status: e.status, subject: e.subject }),
      )
    } else if (e.tool.startsWith('mcp__')) {
      await changeThread($, t => addMcp(t, e.tool))
    }
    return ran
  }).catch(($, e, next) => next(e)) // Observer only: a failure here never blocks the call.

  on('skill.prompt', async ($, e, next) => {
    await changeThread($, t => addSkill(t, e.skill))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const usage = e.usage
    const at = e.agentId === undefined ? await $.clock.now() : null
    const t = await changeThread($, current => {
      const counted = usage === undefined ? current : addUsage(current, usage)
      return at === null ? counted : { ...counted, lastReplyAt: at }
    })
    if (at !== null) {
      await saveSnapshot($, t)
      await setTurnRunning($, false)
    }
    return next(e)
  })

  // Each response's plan limits: kept with the time read, since an idle session's go stale.
  on('session.measure', async ($, e, next) => {
    if (e.rateLimits.length > 0 || e.changed.includes('rateLimits')) {
      await setLimits($, { windows: e.rateLimits, readAt: await $.clock.now() })
    }
    return next(e)
  })
}
