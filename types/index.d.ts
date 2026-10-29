export type TodoStatus = 'pending' | 'in_progress' | 'completed'
export type Todo = { id: string; text: string; status: TodoStatus }
export type FileEntry = { path: string; isNew: boolean; added: number; removed: number; notes: string[] }
export type SkillUse = { name: string; count: number }
export type McpUse = { server: string; tools: string[]; count: number }
export type Assumption = { text: string; isFromAgent: boolean; at: number }
export type SectionId = 'agents' | 'usage' | 'files' | 'tools' | 'assumptions'
export type RateLimit = { kind: string; percentUsed: number; resetsAt?: string }
// The plan limits the session's last response reported, and when
export type Limits = { windows: RateLimit[]; readAt: number }
export type AgentStatus = 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'
// One subagent or teammate as the panel last saw it
export type AgentRow = {
  id: string
  type: string
  description: string
  status: AgentStatus
  parentId?: string
  startedAt: number
  endedAt?: number
}
// The agents shown, and whether any still needs watching
export type Agents = { rows: AgentRow[]; isWatching: boolean }
export type PendingSwitch = 'clear' | 'resume' | null
export type Thread = {
  sessionId: string
  todos: Todo[]
  files: FileEntry[]
  skills: SkillUse[]
  mcps: McpUse[]
  work: { input: number; output: number }
  // Newest first
  assumptions: Assumption[]
  collapsed: SectionId[]
  isTrackingSinceResume: boolean
  // Ms epoch of the last main-loop turn end
  lastReplyAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'session-panel': {
      thread: Shaped<Thread>
      pendingSwitch: PendingSwitch
      turnRunning: boolean
      // Ms epoch the current main-loop turn started
      turnStartedAt: number
      limits: Limits
      agents: Agents
      // Each agent's latest tool call, by agent id
      agentActivity: Record<string, string>
      now: number
    }
  }
}
