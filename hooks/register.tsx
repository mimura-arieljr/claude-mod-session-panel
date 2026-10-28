import type { Register } from 'claude-code'

import { registerAssumptionTool, registerAssumptions } from './assumptions'
import { registerCollectors } from './collect'
import { parseTtl } from './model'
import { registerPanel, setupPanel } from './panel'
import { registerThread, syncThread } from './thread'

export const register: Register = (on, options) => {
  // The one session.start hook: each part's setup runs here.
  on('session.start', async ($, e, next) => {
    await syncThread($)
    await registerAssumptionTool($)
    await setupPanel($)
    return next(e)
  })

  registerThread(on)
  registerAssumptions(on)
  registerCollectors(on)
  registerPanel(on, parseTtl(String(options.cacheTtl ?? '60m')))
}
