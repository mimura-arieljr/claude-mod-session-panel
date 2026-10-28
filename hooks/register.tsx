import type { Register } from 'claude-code'

import { registerCollectors } from './collect'
import { registerThread } from './thread'

export const register: Register = on => {
  registerThread(on)
  registerCollectors(on)
}
