import type { EngineInterface, On } from 'claude-code'

import { addAssumption } from './model'
import { changeThread } from './thread-state'

// A pattern: the engine's generated tool list predates the mod's own tool.
const TOOL = /^mcp__session-panel__note_assumption$/
const MAX_LENGTH = 200

// The instruction lives here, not in prompt.compose:
// - org sessions skip user prompt.compose hooks (cc-plugin-sec-default runs first).
export const TOOL_DESCRIPTION =
  'Whenever you assume something the user did not state (a library, a file location, a convention, the scope of a change), record it here in one short sentence, in the same step as your other work. Do not stop or ask because of it; keep working. Returns immediately.'

// Called from session.start: tools can only be registered once the session binds.
export async function registerAssumptionTool($: EngineInterface): Promise<void> {
  await $.tool.register({
    name: 'note_assumption',
    description: TOOL_DESCRIPTION,
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
    const text = String((e as { assumption?: unknown }).assumption ?? '').slice(0, MAX_LENGTH)
    const at = await $.clock.now()
    await changeThread($, t => addAssumption(t, { text, isFromAgent: e.agentId !== undefined, at }))
    return { result: 'noted' }
  }).catch(() => ({ result: 'noted' })) // Never fail Claude's call over the panel.
}
