interface ChromeEvent<Args extends unknown[]> {
  addListener(callback: (...args: Args) => void): void
  removeListener(callback: (...args: Args) => void): void
  hasListener(callback: (...args: Args) => void): boolean
}

interface ChromeStorageArea {
  get(keys?: null | string | string[]): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
  remove(keys: string | string[]): Promise<void>
  clear?(): Promise<void>
}

interface ChromeDebuggee {
  tabId?: number
  extensionId?: string
  targetId?: string
}

interface ChromeDebuggerTarget {
  id?: string
  tabId?: number
  attached?: boolean
  url?: string
  title?: string
  type?: string
}

interface ChromeDebuggerApi {
  attach(target: ChromeDebuggee, requiredVersion: string): Promise<void>
  detach(target: ChromeDebuggee): Promise<void>
  sendCommand(target: ChromeDebuggee, method: string, commandParams?: Record<string, unknown>): Promise<unknown>
  getTargets(): Promise<ChromeDebuggerTarget[]>
  onEvent: ChromeEvent<[source: ChromeDebuggee, method: string, params?: Record<string, unknown>]>
  onDetach: ChromeEvent<[source: ChromeDebuggee, reason: string]>
}

interface ChromeAlarm {
  name: string
  scheduledTime: number
}

interface ChromeAlarmsApi {
  create(name: string, info: { when?: number; delayInMinutes?: number; periodInMinutes?: number }): Promise<void>
  clear(name: string): Promise<boolean>
  clearAll(): Promise<boolean>
  onAlarm: ChromeEvent<[alarm: ChromeAlarm]>
}

interface ChromeTab {
  id?: number
  windowId?: number
  url?: string
  title?: string
  active?: boolean
}

interface ChromeMessageSender {
  id?: string
  tab?: ChromeTab
}

interface ChromeTabsApi {
  get(tabId: number): Promise<ChromeTab>
  query(queryInfo: { active?: boolean; currentWindow?: boolean; lastFocusedWindow?: boolean }): Promise<ChromeTab[]>
  update(tabId: number, updateProperties: { active?: boolean }): Promise<ChromeTab>
  create(createProperties?: { url?: string; active?: boolean }): Promise<ChromeTab>
  remove(tabIds: number | number[]): Promise<void>
  onRemoved: ChromeEvent<[tabId: number, removeInfo: { windowId: number; isWindowClosing: boolean }]>
  onActivated: ChromeEvent<[activeInfo: { tabId: number; windowId: number }]>
  onUpdated: ChromeEvent<[tabId: number, changeInfo: { status?: string; url?: string }, tab: ChromeTab]>
}

interface ChromeRuntimeApi {
  id: string
  lastError: { message?: string } | undefined
  onInstalled: ChromeEvent<[details: { reason: string }]>
  onStartup: ChromeEvent<[]>
  onMessage: ChromeEvent<[message: unknown, sender: ChromeMessageSender, sendResponse: (response?: unknown) => void]>
  getURL(path: string): string
  getManifest(): { version: string }
  sendMessage(message: unknown): Promise<unknown>
}

interface ChromeWindow {
  id?: number
  focused?: boolean
}

interface ChromeWindowsApi {
  update(windowId: number, updateInfo: { focused?: boolean }): Promise<ChromeWindow>
  getLastFocused(): Promise<ChromeWindow>
}

interface ChromeSidePanelApi {
  setPanelBehavior(options: { openPanelOnActionClick?: boolean }): Promise<void>
}

interface ChromeActionApi {
  onClicked: ChromeEvent<[tab: ChromeTab]>
}

interface ChromeApi {
  storage: { local: ChromeStorageArea }
  debugger: ChromeDebuggerApi
  alarms: ChromeAlarmsApi
  tabs: ChromeTabsApi
  windows: ChromeWindowsApi
  runtime: ChromeRuntimeApi
  sidePanel: ChromeSidePanelApi
  action: ChromeActionApi
}

declare const chrome: ChromeApi