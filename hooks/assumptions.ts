import type { EngineInterface, On } from 'claude-code'

import { addAssumption } from './model'
import { changeThread } from './thread-state'

export const ASSUMPTION_SECTION_ID = 'session-panel:assumptions'
const TOOL = 'mcp__session-panel__note_assumption'
const MAX_LENGTH = 200

const INSTRUCTION =
  'When you assume something the user did not state (a library, a file location, a convention, the scope of a change), record it with the note_assumption tool in one short sentence, in the same step as your other work. Do not stop or ask because of it; keep working.'

// Called from session.start: tools can only be registered once the session binds.
export async function registerAssumptionTool($: EngineInterface): Promise<void> {
  await $.tool.register({
    name: 'note_assumption',
    description:
      'Record one assumption you made that the user did not state. One short sentence. Returns immediately.',
    inputSchema: {
      type: 'object',
      properties: { assumption: { type: 'string', description: 'One short sentence' } },
      required: ['assumption'],
    },
    isDeferred: false,
  })
}

export function registerAssumptions(on: On): void {
  on('tool.call', { tool: TOOL }, async ($, e) => {
    const text = String(e.assumption ?? '').slice(0, MAX_LENGTH)
    const at = await $.clock.now()
    await changeThread($, t => addAssumption(t, { text, isFromAgent: e.agentId !== undefined, at }))
    return { result: 'noted' }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    return {
      ...composed,
      sections: [
        ...composed.sections,
        { id: ASSUMPTION_SECTION_ID, scope: 'session', text: INSTRUCTION },
      ],
    }
  })
}
