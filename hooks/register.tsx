import type { Register } from 'claude-code'

import { registerCollectors } from './collect'

export const register: Register = on => {
  registerCollectors(on)
}
