import type { AgentRow, AgentStatus, Assumption, SectionId, Thread, TodoStatus } from '../types'

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

const DECLARATIONS = [
  /\bfunction\s*\*?\s+([A-Za-z_$][\w$]*)/,
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::\s*[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/,
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
  c: { path: string; isNew: boolean; lines: readonly string[]; notes?: readonly string[] },
): Thread {
  const added = c.lines.filter(line => line.startsWith('+')).length
  const removed = c.lines.filter(line => line.startsWith('-')).length
  const notes = c.notes ? [...c.notes] : summarizeChange(c.lines)
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

// A running turn's time as m:ss.
export function formatElapsed(ms: number): string {
  const secs = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// A window's reset: a local time when it's today, else a short weekday.
// `offsetMinutes` is Date's getTimezoneOffset(): minutes behind UTC.
export function formatReset(resetsAt: string, now: number, offsetMinutes: number): string {
  const local = (ms: number) => new Date(ms - offsetMinutes * 60_000)
  const at = local(Date.parse(resetsAt))
  const today = local(now)
  if (at.toISOString().slice(0, 10) !== today.toISOString().slice(0, 10)) return WEEKDAYS[at.getUTCDay()]!
  const hours = at.getUTCHours()
  return `${hours % 12 || 12}:${String(at.getUTCMinutes()).padStart(2, '0')}${hours < 12 ? 'am' : 'pm'}`
}

// How long ago, in whole minutes under an hour, else hours.
export function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`
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
  return `warm · ${Math.ceil(left / 60_000)}m`
}

// What share of the cache lifetime is left: 1 while a turn runs, 0 when cold or unknown.
export function cacheFraction(
  lastReplyAt: number | null,
  now: number,
  ttlMs: number,
  isTurnRunning: boolean,
): number {
  if (isTurnRunning) return 1
  if (lastReplyAt === null) return 0
  return Math.min(1, Math.max(0, (lastReplyAt + ttlMs - now) / ttlMs))
}

const DONE: readonly AgentStatus[] = ['completed', 'failed', 'killed']
const MAX_FINISHED_AGENTS = 3
const ACTIVITY_LENGTH = 60
// Tool arguments that say what a call is about, most telling first.
const ACTIVITY_KEYS = ['file_path', 'notebook_path', 'command', 'pattern', 'url', 'query', 'description', 'skill']

export function isAgentDone(status: AgentStatus): boolean {
  return DONE.includes(status)
}

// An agent's tool call as one short line: `Read hooks/visuals.ts`, `Bash npm test`.
export function describeToolCall(tool: string, input: Record<string, unknown>, cwd: string): string {
  const name = tool.startsWith('mcp__') ? tool.split('__').slice(1).join('·') : tool
  const key = ACTIVITY_KEYS.find(k => typeof input[k] === 'string' && input[k] !== '')
  if (key === undefined) return name
  const value = String(input[key])
  const arg = (key.endsWith('path') ? relativePath(cwd, value) : value).split('\n')[0]!
  const line = `${name} ${arg}`
  return line.length <= ACTIVITY_LENGTH ? line : `${line.slice(0, ACTIVITY_LENGTH - 1)}…`
}

// The engine's agent list folded into the rows shown.
// - A row keeps the time it was first seen; a finish stamps its end.
// - One the list dropped mid-run counts as completed; finished ones stay as they stood.
// - Only the last few finished are kept.
export function mergeAgents(
  rows: readonly AgentRow[],
  listed: readonly Pick<AgentRow, 'id' | 'type' | 'description' | 'status' | 'parentId'>[],
  now: number,
): AgentRow[] {
  const seen = new Map(rows.map(row => [row.id, row]))
  const merged = rows.map(row => {
    const entry = listed.find(l => l.id === row.id)
    if (entry === undefined) {
      return isAgentDone(row.status) ? row : { ...row, status: 'completed' as const, endedAt: now }
    }
    return toRow(entry, row.startedAt, isAgentDone(entry.status) ? (row.endedAt ?? now) : undefined)
  })
  for (const entry of listed) {
    if (!seen.has(entry.id)) merged.push(toRow(entry, now, isAgentDone(entry.status) ? now : undefined))
  }
  const finished = merged.filter(row => isAgentDone(row.status)).sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0))
  const dropped = new Set(finished.slice(0, Math.max(0, finished.length - MAX_FINISHED_AGENTS)).map(row => row.id))
  return merged.filter(row => !dropped.has(row.id))
}

function toRow(
  entry: Pick<AgentRow, 'id' | 'type' | 'description' | 'status' | 'parentId'>,
  startedAt: number,
  endedAt: number | undefined,
): AgentRow {
  return {
    id: entry.id,
    type: entry.type,
    description: entry.description,
    status: entry.status,
    ...(entry.parentId === undefined ? {} : { parentId: entry.parentId }),
    startedAt,
    ...(endedAt === undefined ? {} : { endedAt }),
  }
}

// Rows in tree order, each child after its parent, with its depth.
export function agentTree(rows: readonly AgentRow[]): { row: AgentRow; depth: number }[] {
  const ids = new Set(rows.map(row => row.id))
  // A row whose parent isn't shown sits at the top.
  const parentOf = (row: AgentRow) => (row.parentId !== undefined && ids.has(row.parentId) ? row.parentId : undefined)
  const out: { row: AgentRow; depth: number }[] = []
  const walk = (parent: string | undefined, depth: number) => {
    for (const row of rows) {
      if (parentOf(row) !== parent) continue
      out.push({ row, depth })
      walk(row.id, depth + 1)
    }
  }
  walk(undefined, 0)
  return out
}
