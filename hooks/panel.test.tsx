import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'session-panel',
  component: 'Pane',
  requestId: 'session-panel',
  props: {
    title: 'Session',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 80 },
    view: {},
  },
} as const

const SURFACES = ['terminal', 'desktop'] as const
const BASE_TURN = { answer: '', durationMs: 1, isAborted: false, reason: 'answer' } as const

// Stand-ins for everything the panel and its collectors ask the engine.
function engine(on: On) {
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/r' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 142_000, window: 1_000_000, percent: 14 },
      rateLimits: [],
      cost: { usd: 1.24 },
    },
  }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', (_, e) => ({
    result: { filePath: String((e as { file_path?: unknown }).file_path ?? ''), structuredPatch: [{ lines: ['+x'] }] },
  }))
  mock.store(on)
  return mock.clock(on)
}

const SIX_TODOS = ['a', 'b', 'c', 'd', 'e', 'f'].map((content, i) => ({
  content,
  activeForm: content,
  status: i < 3 ? 'completed' : i === 3 ? 'in_progress' : 'pending',
})) as { content: string; activeForm: string; status: 'completed' | 'in_progress' | 'pending' }[]

test('all sections start expanded', async ($, on) => {
  engine(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    for (const title of ['Progress', 'Usage', 'Files changed', 'Skills & MCPs', 'Assumptions']) {
      expect(await ui.find({ text: new RegExp(`▾ ${title}`) })).toBeDefined()
    }
    expect(await ui.find({ text: /none yet/ })).toBeDefined()
    await ui.unmount()
  }
})

test('pressing a title collapses it with a summary', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: 'TodoWrite', todos: SIX_TODOS })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ text: /3\/6 · 50%/ })).toBeDefined()
    await ui.press({ key: 'toggle-progress' })
    expect(await ui.find({ text: /▸ Progress · 3\/6 · 50%/ })).toBeDefined()
    expect(await ui.find({ text: /▸ d/ })).toBeUndefined()
    await ui.press({ key: 'toggle-progress' })
    expect(await ui.find({ text: /▾ Progress/ })).toBeDefined()
    await ui.unmount()
  }
})

test('usage shows work tokens, dollars, context and cache', async ($, on) => {
  const clock = engine(on)
  await $.turn.complete({
    ...BASE_TURN,
    turnId: 't',
    usage: {
      input_tokens: 30_000,
      output_tokens: 8_240,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      model: 'm',
    },
  })
  await clock.advance(8 * 60_000 + 1)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ text: /38\.2k tokens/ })).toBeDefined()
    expect(await ui.find({ text: /\$1\.24/ })).toBeDefined()
    expect(await ui.find({ text: /142k \/ 1M/ })).toBeDefined()
    expect(await ui.find({ text: /warm · 52m left/ })).toBeDefined()
    await ui.unmount()
  }
})

test('long lists cap at 10', async ($, on) => {
  engine(on)
  for (let i = 0; i < 13; i++) {
    await $.tool.call({ tool: 'Edit', file_path: `/r/f${i}.ts`, old_string: 'a', new_string: 'b' })
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ text: /Files changed · 13/ })).toBeDefined()
  expect(await ui.find({ text: /\+3 more/ })).toBeDefined()
  expect(await ui.find({ text: /f12\.ts/ })).toBeUndefined()
  await ui.unmount()
})

test('the command opens a pane that is listed but not drawn', async ($, on) => {
  engine(on)
  const calls: string[] = []
  on('command.register', () => ({ value: { command: 'session-panel' } }))
  on('ui.panes', () => ({
    value: [{ id: 'session-panel', title: 'Session', isShown: true, isFocused: false, isPlaced: false }],
  }))
  on('ui.open', () => {
    calls.push('open')
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => {
    calls.push('close')
    return { value: undefined }
  })
  const ran = await $.command.run({ command: 'session-panel', args: '' } as never)
  expect(calls).toEqual(['open'])
  expect(ran.text).toContain('Session panel shown')
})

test('section titles are drawn inside their boxes, not over the border', async ($, on) => {
  engine(on)
  // The terminal does not paint an absolute overlay on a border row.
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(JSON.stringify(await ui.drawn())).not.toContain('"absolute"')
  await ui.unmount()
})

test('titles carry no hotkey numbering', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(JSON.stringify(await ui.drawn())).not.toContain('"hotkey"')
  await ui.unmount()
})

test('the command says why the pane is not beside the chat', async ($, on) => {
  engine(on)
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const narrow = await $.command.run({
    command: 'session-panel',
    args: '',
    presentation: { isFullscreen: true, columns: 96 },
  } as never)
  expect(narrow.text).toContain('110 columns')
  const mainScreen = await $.command.run({
    command: 'session-panel',
    args: '',
    presentation: { isFullscreen: false, columns: 200 },
  } as never)
  expect(mainScreen.text).toContain('fullscreen')
  const wide = await $.command.run({
    command: 'session-panel',
    args: '',
    presentation: { isFullscreen: true, columns: 200 },
  } as never)
  expect(wide.text).toBe('Session panel shown beside the chat.')
})
