import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'session-panel',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 6,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 5 },
    view: {},
  },
} as const

const SURFACES = ['terminal', 'desktop'] as const
const LIMITS = [
  { kind: 'five_hour', percentUsed: 22, resetsAt: '2099-01-01T00:00:00Z' },
  { kind: 'seven_day', percentUsed: 9 },
]
const MEASURE = { context: { window: 1_000_000 }, changed: ['rateLimits' as const] }

// Stand-ins for what the strip and the command ask the engine.
function engine(on: On) {
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/r' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 410_000, window: 1_000_000, percent: 41 },
      rateLimits: [],
      cost: { usd: 1 },
    },
  }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  mock.store(on)
  return mock.clock(on)
}

const command = (args: string) => ({ command: 'session-panel', args }) as never

test('the band draws nothing of ours in full view', async ($, on) => {
  engine(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ text: /^ctx/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('mini view draws context, limits and tools on one row when wide', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: { success: true, commandName: 'run' } }))
  await $.tool.call({ tool: 'Skill', skill: 'run' })
  await $.session.measure({ ...MEASURE, rateLimits: LIMITS })
  await $.command.run(command('mini'))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ text: /^ctx/ })).toBeDefined()
    expect(await ui.find({ text: /^ 41%/ })).toBeDefined()
    expect(await ui.find({ text: /^5h/ })).toBeDefined()
    expect(await ui.find({ text: /^week/ })).toBeDefined()
    expect(await ui.find({ text: /1 skill/ })).toBeDefined()
    expect(await ui.find({ text: /run ×1/ })).toBeDefined()
    expect(await ui.find({ key: 'mini-row-0' })).toBeDefined()
    expect(await ui.find({ key: 'mini-row-1' })).toBeUndefined()
    await ui.unmount()
  }
})

test('a narrow band wraps segments onto more rows', async ($, on) => {
  engine(on)
  await $.session.measure({ ...MEASURE, rateLimits: LIMITS })
  await $.command.run(command('mini'))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, bodyColumns: 40 } })
  expect(await ui.find({ key: 'mini-row-1' })).toBeDefined()
  expect(await ui.find({ text: /^week/ })).toBeDefined()
  await ui.unmount()
})

test('with no limits or tools the strip shows context and none yet', async ($, on) => {
  engine(on)
  await $.command.run(command('mini'))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ text: /^ctx/ })).toBeDefined()
  expect(await ui.find({ text: /none yet/ })).toBeDefined()
  expect(await ui.find({ text: /^5h/ })).toBeUndefined()
  expect(await ui.find({ key: 'mini-row-1' })).toBeUndefined()
  await ui.unmount()
})

test('the band yields to a survey', async ($, on) => {
  engine(on)
  await $.command.run(command('mini'))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, hasSurvey: true } })
  expect(await ui.find({ text: /^ctx/ })).toBeUndefined()
  await ui.unmount()
})

test('hidden mini view draws nothing', async ($, on) => {
  engine(on)
  await $.command.run(command('mini'))
  await $.command.run(command(''))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ text: /^ctx/ })).toBeUndefined()
  await ui.unmount()
})

test('the strip has no frame', async ($, on) => {
  engine(on)
  await $.command.run(command('mini'))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(JSON.stringify(await ui.drawn())).not.toContain('borderStyle')
  await ui.unmount()
})
