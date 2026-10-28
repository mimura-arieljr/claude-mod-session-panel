import type { Register } from 'claude-code'

import { registerAssumptionTool, registerAssumptions } from './assumptions'
import { registerCollectors } from './collect'
import { registerThread, syncThread } from './thread'

export const register: Register = on => {
  // The one session.start hook: each part's setup runs here.
  on('session.start', async ($, e, next) => {
    await syncThread($)
    await registerAssumptionTool($)
    return next(e)
  })

  registerThread(on)
  registerAssumptions(on)
  registerCollectors(on)
}
