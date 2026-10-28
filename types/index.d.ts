export type TodoStatus = 'pending' | 'in_progress' | 'completed'
export type Todo = { id: string; text: string; status: TodoStatus }
export type FileEntry = { path: string; isNew: boolean; added: number; removed: number; notes: string[] }
export type SkillUse = { name: string; count: number }
export type McpUse = { server: string; tools: string[]; count: number }
export type Assumption = { text: string; isFromAgent: boolean; at: number }
export type SectionId = 'progress' | 'usage' | 'files' | 'tools' | 'assumptions'
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
      now: number
    }
  }
}
