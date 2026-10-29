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
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('tool.call', (_, e) => {
    const filePath = String((e as { file_path?: unknown }).file_path ?? '')
    // A Write creates its file, as the engine reports one.
    if (e.tool === 'Write') return { result: { type: 'create', filePath, structuredPatch: [] } }
    return { result: { filePath, structuredPatch: [{ lines: ['+x'] }] } }
  })
  mock.store(on)
  return mock.clock(on)
}

const SIX_TODOS = ['a', 'b', 'c', 'd', 'e', 'f'].map((content, i) => ({
  content,
  activeForm: content,
  status: i < 3 ? 'completed' : i === 3 ? 'in_progress' : 'pending',
})) as { content: string; activeForm: string; status: 'completed' | 'in_progress' | 'pending' }[]

test('all sections start expanded, with no progress section', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: 'TodoWrite', todos: SIX_TODOS })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    for (const title of ['USAGE', 'FILES CHANGED', 'SKILLS & MCPS', 'ASSUMPTIONS']) {
      expect(await ui.find({ text: new RegExp(`▾ \\S ${title}`) })).toBeDefined()
    }
    expect(await ui.find({ text: /PROGRESS/ })).toBeUndefined()
    expect(await ui.find({ text: /IDLE/ })).toBeDefined()
    expect(await ui.find({ text: /waiting for input/ })).toBeDefined()
    expect(await ui.find({ text: /None yet/ })).toBeDefined()
    await ui.unmount()
  }
})

test('pressing a title collapses it and keeps its summary', async ($, on) => {
  engine(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ text: /^ctx/ })).toBeDefined()
    await ui.press({ key: 'toggle-usage' })
    expect(await ui.find({ text: /▸ ∑ USAGE/ })).toBeDefined()
    expect(await ui.find({ text: /\$1\.24/ })).toBeDefined()
    expect(await ui.find({ text: /^ctx/ })).toBeUndefined()
    await ui.press({ key: 'toggle-usage' })
    expect(await ui.find({ text: /▾ ∑ USAGE/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the status line names the task in progress', async ($, on) => {
  const clock = engine(on)
  on('turn.start', (_, e) => ({ text: e.text, turnId: e.turnId }))
  await $.turn.start({ text: 'hi', turnId: 't' })
  await $.tool.call({ tool: 'TodoWrite', todos: SIX_TODOS })
  await clock.advance(1000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ text: /^d$/ })).toBeDefined()
  await ui.unmount()
})

test('usage shows the context bar, work tokens, cost and cache', async ($, on) => {
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
    // Text bars on every surface: no ring image or SVG.
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).not.toContain('"Svg"')
    expect(drawn).not.toContain('"Raster"')
    expect(await ui.find({ text: /^ctx/ })).toBeDefined()
    expect(await ui.find({ text: /14%/ })).toBeDefined()
    expect(await ui.find({ text: /142k\/1M/ })).toBeDefined()
    expect(await ui.find({ text: /38\.2k/ })).toBeDefined()
    expect(await ui.find({ text: /\$1\.24/ })).toBeDefined()
    expect(await ui.find({ text: /warm · 52m$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('files group under their folder, edits marked ~ with no tag', async ($, on) => {
  engine(on)
  for (const name of ['a.ts', 'b.ts']) {
    await $.tool.call({ tool: 'Edit', file_path: `/r/src/deep/dir/${name}`, old_string: 'a', new_string: 'b' })
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn.match(/"children":\["…\/deep\/dir\/"\]/g)).toHaveLength(1)
  expect(await ui.find({ text: /^~ $/ })).toBeDefined()
  expect(await ui.find({ text: /EDIT/ })).toBeUndefined()
  expect(await ui.find({ text: /^ +\+1$/ })).toBeDefined()
  await ui.unmount()
})

test('a new file carries a NEW tag with no background fill', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: 'Write', file_path: '/r/n.ts', content: 'x' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const tag = (await ui.find({ text: /^NEW$/ })) as { props?: Record<string, unknown> } | undefined
  expect(tag).toBeDefined()
  expect(tag?.props?.backgroundColor).toBeUndefined()
  await ui.unmount()
})

test('a running turn shows a spinner and the time since it started', async ($, on) => {
  const clock = engine(on)
  on('turn.start', (_, e) => ({ text: e.text, turnId: e.turnId }))
  await $.turn.start({ text: 'hi', turnId: 't' })
  await clock.advance(12_000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ text: /WORKING/ })).toBeDefined()
  expect(await ui.find({ text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]$/ })).toBeDefined()
  expect(await ui.find({ text: /^0:12$/ })).toBeDefined()
  await ui.unmount()
})

test('only assumption rows carry the amber fill', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: 'mcp__session-panel__note_assumption', assumption: 'x' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn.match(/"backgroundColor":"#262318"/g)).toHaveLength(1)
  expect(drawn).not.toContain('"backgroundColor":"#3B362F"')
  await ui.unmount()
})

test('long lists cap at 10', async ($, on) => {
  engine(on)
  for (let i = 0; i < 13; i++) {
    await $.tool.call({ tool: 'Edit', file_path: `/r/f${i}.ts`, old_string: 'a', new_string: 'b' })
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ text: /^13$/ })).toBeDefined()
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

test('the panel paints nothing outside its frame', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  type Node = { props?: Record<string, unknown>; children?: Node[] }
  const root = (await ui.drawn()) as Node
  expect(root.props?.backgroundColor).toBeUndefined()
  expect(root.props?.minHeight).toBe(80)
  expect(root.children?.[0]?.props?.backgroundColor).toBe('#1A1D24')
  await ui.unmount()
})

test('the pane opens on a transparent body', async ($, on) => {
  engine(on)
  const opened: unknown[] = []
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', (_, e) => {
    opened.push(e)
    return { value: { isPlaced: true } }
  })
  await $.command.run({ command: 'session-panel', args: '' } as never)
  expect(opened).toEqual([expect.objectContaining({ backgroundColor: 'transparent' })])
})

test('sections sit on the frame, split by dim rules', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const drawn = JSON.stringify(await ui.drawn())
  // Rules span the frame's inside: 60 less the inset (2), the padding (2) and the border (2).
  expect(drawn.match(new RegExp(`"color":"#2A2F3A"\\},"children":\\["${'─'.repeat(54)}"\\]`, 'g'))).toHaveLength(3)
  expect(drawn.match(/"backgroundColor":"#1A1D24"/g)).toHaveLength(1)
  await ui.unmount()
})

test('the panel sits in a rounded frame inset on every side', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  type Node = { props?: Record<string, unknown>; children?: Node[] }
  const root = (await ui.drawn()) as Node
  expect(root.props).toEqual(expect.objectContaining({ paddingX: 1, paddingY: 1 }))
  const frame = root.children?.[0]
  expect(frame?.props).toEqual(
    expect.objectContaining({ borderStyle: 'round', borderColor: '#3A4150', gap: 1, paddingX: 1, paddingY: 1 }),
  )
  await ui.unmount()
})

test('the status sits on its own line under the header', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ text: /^❯_ Session$/ })).toBeDefined()
  expect(await ui.find({ text: /^● +IDLE +waiting for input$/ })).toBeDefined()
  await ui.unmount()
})

test('section titles turn cyan under the pointer, the badge outside the press', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('"key":"head-files"')
  expect(drawn.match(/"hover":\{"color":"#4FD1C5"\}/g)?.length).toBeGreaterThanOrEqual(10)
  type Node = { type?: string; props?: Record<string, unknown>; children?: Node[] }
  const buttons: Node[] = []
  const walk = (n: Node) => {
    if (n.type === 'Button') buttons.push(n)
    n.children?.forEach(walk)
  }
  walk((await ui.drawn()) as Node)
  expect(buttons.length).toBe(4)
  for (const b of buttons) expect(JSON.stringify(b)).not.toContain('#262A35')
  await ui.unmount()
})

test('each section title has a cyan icon beside it', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const drawn = JSON.stringify(await ui.drawn())
  for (const icon of ['∑', '±', '✦', '≈']) {
    expect(drawn).toContain(`"props":{"color":"#4FD1C5"},"hover":{"color":"#4FD1C5"},"children":["${icon} "]`)
  }
  await ui.unmount()
})

test('pressing a file name opens it in VS Code', async ($, on) => {
  engine(on)
  const ran: (readonly string[])[] = []
  on('process.run', (_, e) => {
    ran.push(e.argv)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.tool.call({ tool: 'Edit', file_path: '/r/src/my file.ts', old_string: 'a', new_string: 'b' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'open-src/my file.ts' })
  expect(ran).toEqual([['open', 'vscode://file/r/src/my%20file.ts']])
  await ui.unmount()
})

const LIMITS = [
  { kind: 'five_hour', percentUsed: 26.4, resetsAt: '2099-01-01T00:00:00Z' },
  { kind: 'seven_day', percentUsed: 16 },
]
const MEASURE = { context: { window: 1_000_000 }, changed: ['rateLimits' as const] }

test('usage shows each plan limit as a bar with its percent', async ($, on) => {
  engine(on)
  await $.session.measure({ ...MEASURE, rateLimits: LIMITS })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ text: /^5h/ })).toBeDefined()
  expect(await ui.find({ text: /^week/ })).toBeDefined()
  expect(await ui.find({ text: /^ 26%$/ })).toBeDefined()
  expect(await ui.find({ text: /^resets / })).toBeDefined()
  expect(await ui.find({ text: /as of/ })).toBeUndefined()
  await ui.unmount()
})

test('no limit rows before the first reading', async ($, on) => {
  engine(on)
  await $.session.measure({ ...MEASURE, rateLimits: [] })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ text: /^5h/ })).toBeUndefined()
  expect(await ui.find({ text: /0%/ })).toBeUndefined()
  await ui.unmount()
})

test('an old reading dims and says its age', async ($, on) => {
  const clock = engine(on)
  await $.session.measure({ ...MEASURE, rateLimits: LIMITS })
  await clock.advance(6 * 60_000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ text: /^limits as of 6m ago$/ })).toBeDefined()
  const drawn = JSON.stringify(await ui.drawn())
  const rows = drawn.slice(drawn.indexOf('limit-five_hour'), drawn.indexOf('limits as of'))
  expect(rows).not.toContain('#4FD1C5')
  await ui.unmount()
})
