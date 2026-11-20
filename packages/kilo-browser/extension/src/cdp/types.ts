export type Json = Record<string, unknown>

export type TabInfo = {
  id: number
  url?: string
  title?: string
  attached: boolean
}

export type DebuggerTarget = {
  id?: string
  tabId?: number
  attached?: boolean
  url?: string
  title?: string
  type?: string
}

export type DebuggerSource = {
  tabId?: number
  extensionId?: string
  targetId?: string
}

export interface DebuggerApi {
  attach(target: { tabId: number }, version: string): Promise<void>
  detach(target: { tabId: number }): Promise<void>
  sendCommand(target: { tabId: number }, method: string, params?: Json): Promise<unknown>
  getTargets(): Promise<DebuggerTarget[]>
  onEvent(listener: (source: DebuggerSource, method: string, params: unknown) => void): () => void
  onDetach(listener: (source: DebuggerSource, reason: string) => void): () => void
}

export interface CdpConnection {
  readonly tabId: number
  send(method: string, params?: Json): Promise<Json>
}
