import type { ExtensionMessage, WebviewMessage } from "../types/messages"

export type HostKind = "vscode" | "browser"

export type HostCapability =
  | "chat"
  | "history"
  | "profile"
  | "settings"
  | "settings.models"
  | "settings.providers"
  | "settings.autoApprove"
  | "settings.agentBehaviour"
  | "settings.display"
  | "settings.language"
  | "settings.about"
  | "settings.browser"
  | "settings.checkpoints"
  | "settings.autocomplete"
  | "settings.notifications"
  | "settings.context"
  | "settings.indexing"
  | "settings.sandboxing"
  | "settings.commitMessage"
  | "settings.experimental"
  | "file.open"
  | "agentManager"
  | "marketplace"
  | "migration"
  | "subAgentViewer"
  | "worktree"
  | "terminal"
  | "speech"
  | "ghostText"
  | "cloud"

export type HostCapabilities = Record<HostCapability, boolean>

export const NO_HOST_CAPABILITIES: HostCapabilities = {
  chat: false,
  history: false,
  profile: false,
  settings: false,
  "settings.models": false,
  "settings.providers": false,
  "settings.autoApprove": false,
  "settings.agentBehaviour": false,
  "settings.display": false,
  "settings.language": false,
  "settings.about": false,
  "settings.browser": false,
  "settings.checkpoints": false,
  "settings.autocomplete": false,
  "settings.notifications": false,
  "settings.context": false,
  "settings.indexing": false,
  "settings.sandboxing": false,
  "settings.commitMessage": false,
  "settings.experimental": false,
  "file.open": false,
  agentManager: false,
  marketplace: false,
  migration: false,
  subAgentViewer: false,
  worktree: false,
  terminal: false,
  speech: false,
  ghostText: false,
  cloud: false,
}

/** VS Code keeps every surface enabled, including ones added later. */
export const ALL_HOST_CAPABILITIES: HostCapabilities = Object.fromEntries(
  Object.keys(NO_HOST_CAPABILITIES).map((name) => [name, true]),
) as HostCapabilities

export function hostCapabilities(overrides: Partial<HostCapabilities> = {}): HostCapabilities {
  return { ...NO_HOST_CAPABILITIES, ...overrides }
}

export interface HostClipboard {
  readText(): Promise<string>
  writeText(text: string): Promise<void>
}

export interface HostDiffInput {
  path: string
  before: string
  after: string
}

export interface HostFileValidation {
  ok: string[]
  denied: { path: string; reason: string }[]
}

/**
 * Seam between the shared chat/settings UI and its host.
 *
 * `kilo-vscode` provides a VS Code-backed implementation; the browser
 * extension provides a WebSocket-backed one. Shared components must only use
 * this interface so they never import `vscode`, `chrome`, or the bridge
 * transport directly.
 */
export interface HostBridge {
  readonly kind: HostKind
  readonly capabilities: HostCapabilities
  post(message: WebviewMessage): void
  subscribe(listener: (message: ExtensionMessage) => void): () => void
  getState<T>(): T | undefined
  setState<T>(state: T): void
  sidebarSide(): "left" | "right" | undefined
  active(): boolean
  clipboard: HostClipboard
  openExternal?(url: string): Promise<void>
  openFile?(path: string): Promise<void>
  openDiff?(input: HostDiffInput): Promise<void>
  validateFiles?(paths: string[]): Promise<HostFileValidation>
  /**
   * Sidebar-only preference. Hosts that persist it may expose these; the
   * compatibility `useVSCode()` hook falls back to `true` when absent.
   */
  modelSelectorExpanded?(): boolean
  setModelSelectorExpanded?(value: boolean): void
}