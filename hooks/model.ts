import type { Assumption, SectionId, Thread, TodoStatus } from '../types'

const OWN_SERVER = 'session-panel'
const MAX_NOTES = 4
const MAX_ASSUMPTIONS = 100

export function emptyThread(sessionId: string): Thread {
  return {
    sessionId,
    todos: [],
    files: [],
    skills: [],
    mcps: [],
    work: { input: 0, output: 0 },
    assumptions: [],
    collapsed: [],
    isTrackingSinceResume: false,
    lastReplyAt: null,
  }
}

export function applyTodoWrite(
  t: Thread,
  todos: readonly { content: string; status: TodoStatus }[],
): Thread {
  return {
    ...t,
    todos: todos.map((todo, i) => ({ id: String(i), text: todo.content, status: todo.status })),
  }
}

export function applyTaskCreate(t: Thread, id: string, subject: string): Thread {
  return { ...t, todos: [...t.todos, { id, text: subject, status: 'pending' }] }
}

export function applyTaskUpdate(
  t: Thread,
  id: string,
  change: { status?: TodoStatus | 'deleted'; subject?: string },
): Thread {
  if (change.status === 'deleted') {
    return { ...t, todos: t.todos.filter(todo => todo.id !== id) }
  }
  const status = change.status
  return {
    ...t,
    todos: t.todos.map(todo =>
      todo.id === id
        ? { ...todo, text: change.subject ?? todo.text, status: status ?? todo.status }
        : todo,
    ),
  }
}

export function progress(t: Thread): { done: number; total: number; percent: number } | null {
  const total = t.todos.length
  if (total === 0) return null
  const done = t.todos.filter(todo => todo.status === 'completed').length
  return { done, total, percent: Math.round((done / total) * 100) }
}

const DECLARATIONS = [
  /\bfunction\s*\*?\s+([A-Za-z_$][\w$]*)/,
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|function\b|[A-Za-z_$][\w$]*\s*=>)/,
  /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/,
  /\bclass\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:(?:public|private|protected|static|async|override|readonly)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^={]+)?\{\s*$/,
]
const NOT_NAMES = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'with'])
const TEST_CALL = /^\s*(?:test|it)(?:\.\w+)?\s*\(\s*['"`]/

function declaredName(code: string): string | null {
  for (const pattern of DECLARATIONS) {
    const name = pattern.exec(code)?.[1]
    if (name !== undefined && !NOT_NAMES.has(name)) return name
  }
  return null
}

export function summarizeChange(lines: readonly string[]): string[] {
  const order: string[] = []
  const added = new Set<string>()
  const removed = new Set<string>()
  let tests = 0
  let contextName: string | null = null
  let hasChanged = false

  for (const line of lines) {
    const sign = line[0]
    const code = line.slice(1)
    if (sign === ' ') {
      if (!hasChanged) contextName = declaredName(code) ?? contextName
      continue
    }
    if (sign !== '+' && sign !== '-') continue
    hasChanged = true
    if (sign === '+' && TEST_CALL.test(code)) {
      tests += 1
      continue
    }
    const name = declaredName(code)
    if (name === null) continue
    if (!order.includes(name)) order.push(name)
    ;(sign === '+' ? added : removed).add(name)
  }

  const notes = order.map(name =>
    added.has(name) && removed.has(name)
      ? `edited ${name}`
      : added.has(name)
        ? `added ${name}`
        : `removed ${name}`,
  )
  if (notes.length === 0 && tests === 0 && hasChanged && contextName !== null) {
    notes.push(`edited ${contextName}`)
  }
  if (tests > 0) notes.push(`added ${tests} test${tests === 1 ? '' : 's'}`)
  return notes.slice(0, MAX_NOTES)
}

export function applyFileChange(
  t: Thread,
  c: { path: string; isNew: boolean; lines: readonly string[] },
): Thread {
  const added = c.lines.filter(line => line.startsWith('+')).length
  const removed = c.lines.filter(line => line.startsWith('-')).length
  const notes = summarizeChange(c.lines)
  const existing = t.files.find(file => file.path === c.path)
  if (existing === undefined) {
    return {
      ...t,
      files: [...t.files, { path: c.path, isNew: c.isNew, added, removed, notes }],
    }
  }
  const merged = [...existing.notes, ...notes.filter(note => !existing.notes.includes(note))]
  return {
    ...t,
    files: t.files.map(file =>
      file === existing
        ? {
            ...file,
            added: file.added + added,
            removed: file.removed + removed,
            notes: merged.slice(-MAX_NOTES),
          }
        : file,
    ),
  }
}

export function addSkill(t: Thread, name: string): Thread {
  const existing = t.skills.find(skill => skill.name === name)
  return {
    ...t,
    skills:
      existing === undefined
        ? [...t.skills, { name, count: 1 }]
        : t.skills.map(skill => (skill === existing ? { ...skill, count: skill.count + 1 } : skill)),
  }
}

export function addMcp(t: Thread, tool: string): Thread {
  const match = /^mcp__(.+?)__(.+)$/.exec(tool)
  if (match === null) return t
  const [, server = '', name = ''] = match
  if (server === OWN_SERVER) return t
  const existing = t.mcps.find(mcp => mcp.server === server)
  if (existing === undefined) {
    return { ...t, mcps: [...t.mcps, { server, tools: [name], count: 1 }] }
  }
  return {
    ...t,
    mcps: t.mcps.map(mcp =>
      mcp === existing
        ? {
            ...mcp,
            tools: mcp.tools.includes(name) ? mcp.tools : [...mcp.tools, name],
            count: mcp.count + 1,
          }
        : mcp,
    ),
  }
}

export function addUsage(t: Thread, u: { input_tokens: number; output_tokens: number }): Thread {
  return {
    ...t,
    work: { input: t.work.input + u.input_tokens, output: t.work.output + u.output_tokens },
  }
}

export function addAssumption(t: Thread, a: Assumption): Thread {
  return { ...t, assumptions: [a, ...t.assumptions].slice(0, MAX_ASSUMPTIONS) }
}

export function toggleSection(t: Thread, id: SectionId): Thread {
  return {
    ...t,
    collapsed: t.collapsed.includes(id)
      ? t.collapsed.filter(one => one !== id)
      : [...t.collapsed, id],
  }
}

function oneDecimal(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '')
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 100_000) return `${oneDecimal(n / 1000)}k`
  if (Math.round(n / 1000) < 1000) return `${Math.round(n / 1000)}k`
  return `${oneDecimal(n / 1_000_000)}M`
}

export function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`
}

export function relativePath(cwd: string, path: string): string {
  const prefix = cwd.endsWith('/') ? cwd : `${cwd}/`
  return path.startsWith(prefix) ? path.slice(prefix.length) : path
}

export function parseTtl(v: string): number {
  return v === '5m' ? 300_000 : 3_600_000
}

export function cacheStatus(
  lastReplyAt: number | null,
  now: number,
  ttlMs: number,
  isTurnRunning: boolean,
): string {
  if (isTurnRunning) return 'warm'
  if (lastReplyAt === null) return '–'
  const left = lastReplyAt + ttlMs - now
  if (left <= 0) return 'cold'
  return `warm · ${Math.ceil(left / 60_000)}m left`
}
