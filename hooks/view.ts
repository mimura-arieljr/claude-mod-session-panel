import type { EngineInterface } from 'claude-code'

import type { ViewMode } from '../types'

// Store key for the last picked view, kept across sessions.
const MODE_KEY = 'view-mode'

export const MINI_SHOWN = 'Session panel switched to the mini view above the prompt.'
export const MINI_HIDDEN = 'Session panel hidden.'
export const USAGE_HINT = 'Use /session-panel to show or hide it, /session-panel toggle to switch between full and mini.'

export async function loadViewMode($: Pick<EngineInterface, 'store'>): Promise<ViewMode> {
  return (await $.store.get(MODE_KEY)) === 'mini' ? 'mini' : 'full'
}

export async function saveViewMode($: Pick<EngineInterface, 'store'>, mode: ViewMode): Promise<void> {
  await $.store.set(MODE_KEY, mode)
}

// What `/session-panel <args>` asks for: switch views, show or hide, or nothing we know.
export function parseViewArg(args: string): 'switch' | 'showHide' | 'unknown' {
  const word = args.trim().toLowerCase()
  if (word === '') return 'showHide'
  return word === 'toggle' ? 'switch' : 'unknown'
}
