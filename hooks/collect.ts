import type { On } from 'claude-code'

import {
  addMcp,
  addSkill,
  addUsage,
  applyFileChange,
  applyTaskCreate,
  applyTaskUpdate,
  applyTodoWrite,
  relativePath,
} from './model'
import { changeThread } from './thread-state'

type Patch = readonly { lines: readonly string[] }[] | undefined

function patchLines(patch: Patch): string[] {
  return (patch ?? []).flatMap(hunk => hunk.lines)
}

export function registerCollectors(on: On): void {
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran

    if (e.tool === 'Edit' || e.tool === 'Write') {
      const result = ran.result as { type?: string; filePath?: string; structuredPatch?: Patch }
      const cwd = await $.session.cwd()
      const path = relativePath(cwd, result.filePath ?? e.file_path)
      const isNew = e.tool === 'Write' && result.type === 'create'
      await changeThread($, t =>
        applyFileChange(t, { path, isNew, lines: patchLines(result.structuredPatch) }),
      )
    } else if (e.tool === 'NotebookEdit') {
      const path = relativePath(await $.session.cwd(), e.notebook_path)
      await changeThread($, t => {
        const touched = applyFileChange(t, { path, isNew: false, lines: [] })
        return {
          ...touched,
          files: touched.files.map(file =>
            file.path === path && !file.notes.includes('edited cell')
              ? { ...file, notes: [...file.notes, 'edited cell'] }
              : file,
          ),
        }
      })
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
  })

  on('skill.prompt', async ($, e, next) => {
    await changeThread($, t => addSkill(t, e.skill))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const usage = e.usage
    const at = e.agentId === undefined ? await $.clock.now() : null
    await changeThread($, t => {
      const counted = usage === undefined ? t : addUsage(t, usage)
      return at === null ? counted : { ...counted, lastReplyAt: at }
    })
    return next(e)
  })
}
