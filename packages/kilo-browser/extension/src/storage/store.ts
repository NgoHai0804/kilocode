import { DEFAULT_ALLOWED_ORIGINS } from "../policy/origin"

export const SCHEMA_VERSION = 1

export type Pairing = {
  extensionId: string
  token: string
  bridgeUrl: string
  pairedAt: string
}

export type Settings = {
  bridgePort: number | null
  autoReconnect: boolean
  redactInUi: boolean
  /** Follow the active tab automatically instead of waiting for a manual pick. */
  autoAttach: boolean
}

export type Allowlist = {
  origins: string[]
}

export type TabRef = {
  tabId: number
  windowId?: number
}

export type UiState = {
  panelOpen: boolean
  pageMode: "sidepanel" | "tab"
  theme: string
  lastError: string | null
}

export type ExtensionState = {
  schemaVersion: number
  settings: Settings
  pairing: Pairing | null
  allowlist: Allowlist
  tab: TabRef | null
  ui: UiState
}

export type StatePatch = Partial<Omit<ExtensionState, "settings" | "allowlist" | "ui">> & {
  settings?: Partial<Settings>
  allowlist?: Partial<Allowlist>
  ui?: Partial<UiState>
}

export interface StorageArea {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
  remove(keys: string | string[]): Promise<void>
}

export const DEFAULT_STATE: ExtensionState = {
  schemaVersion: SCHEMA_VERSION,
  settings: { bridgePort: null, autoReconnect: true, redactInUi: true, autoAttach: true },
  pairing: null,
  // Mirror the bridge default so loopback dev works without extra setup; the
  // extension has no origin editor, so an empty list would deny every tool.
  allowlist: { origins: [...DEFAULT_ALLOWED_ORIGINS] },
  tab: null,
  ui: { panelOpen: false, pageMode: "sidepanel", theme: "kilo", lastError: null },
}

export function migrate(raw: unknown): ExtensionState {
  if (!isRecord(raw)) return clone(DEFAULT_STATE)
  const version = typeof raw.schemaVersion === "number" ? raw.schemaVersion : 0
  const state = clone(DEFAULT_STATE)
  if (isRecord(raw.settings)) {
    state.settings.bridgePort = typeof raw.settings.bridgePort === "number" ? raw.settings.bridgePort : null
    state.settings.autoReconnect = raw.settings.autoReconnect !== false
    state.settings.redactInUi = raw.settings.redactInUi !== false
    state.settings.autoAttach = raw.settings.autoAttach !== false
  }
  if (isRecord(raw.pairing) && validPairing(raw.pairing)) {
    state.pairing = {
      extensionId: raw.pairing.extensionId,
      token: raw.pairing.token,
      bridgeUrl: raw.pairing.bridgeUrl,
      pairedAt: raw.pairing.pairedAt,
    }
  }
  if (isRecord(raw.allowlist) && Array.isArray(raw.allowlist.origins)) {
    const origins = raw.allowlist.origins.filter((item): item is string => typeof item === "string")
    if (origins.length > 0) state.allowlist.origins = origins
  }
  if (isRecord(raw.tab) && typeof raw.tab.tabId === "number") {
    state.tab = {
      tabId: raw.tab.tabId,
      windowId: typeof raw.tab.windowId === "number" ? raw.tab.windowId : undefined,
    }
  }
  if (isRecord(raw.ui)) {
    state.ui.panelOpen = raw.ui.panelOpen === true
    state.ui.pageMode = raw.ui.pageMode === "tab" ? "tab" : "sidepanel"
    state.ui.theme = typeof raw.ui.theme === "string" ? raw.ui.theme : DEFAULT_STATE.ui.theme
    state.ui.lastError = typeof raw.ui.lastError === "string" ? raw.ui.lastError : null
  }
  state.schemaVersion = Math.max(version, SCHEMA_VERSION)
  return state
}

export class Store {
  private readonly area: StorageArea
  private state?: ExtensionState

  constructor(area: StorageArea) {
    this.area = area
  }

  async load(): Promise<ExtensionState> {
    const raw = await this.area.get(null)
    this.state = migrate(raw)
    if (raw.schemaVersion !== SCHEMA_VERSION) await this.persist(this.state)
    return this.state
  }

  async current(): Promise<ExtensionState> {
    if (this.state) return this.state
    return this.load()
  }

  async patch(patch: StatePatch): Promise<ExtensionState> {
    const state = await this.current()
    const next: ExtensionState = {
      ...state,
      ...patch,
      settings: patch.settings ? { ...state.settings, ...patch.settings } : state.settings,
      allowlist: patch.allowlist ? { ...state.allowlist, ...patch.allowlist } : state.allowlist,
      ui: patch.ui ? { ...state.ui, ...patch.ui } : state.ui,
    }
    this.state = next
    await this.persist(next)
    return next
  }

  async setPairing(pairing: Pairing | null): Promise<ExtensionState> {
    return this.patch({ pairing })
  }

  async setTab(tab: TabRef | null): Promise<ExtensionState> {
    return this.patch({ tab })
  }

  async token(): Promise<string | undefined> {
    const state = await this.current()
    return state.pairing?.token
  }

  async bridgeUrl(): Promise<string | undefined> {
    const state = await this.current()
    return state.pairing?.bridgeUrl
  }

  async allowlist(): Promise<string[]> {
    const state = await this.current()
    return [...state.allowlist.origins]
  }

  private async persist(state: ExtensionState) {
    await this.area.set(state as unknown as Record<string, unknown>)
  }
}

function validPairing(value: Record<string, unknown>): value is Record<string, unknown> & Pairing {
  return (
    typeof value.extensionId === "string" &&
    typeof value.token === "string" &&
    typeof value.bridgeUrl === "string" &&
    typeof value.pairedAt === "string"
  )
}

function clone(state: ExtensionState): ExtensionState {
  return {
    schemaVersion: state.schemaVersion,
    settings: { ...state.settings },
    pairing: state.pairing ? { ...state.pairing } : null,
    allowlist: { origins: [...state.allowlist.origins] },
    tab: state.tab ? { ...state.tab } : null,
    ui: { ...state.ui },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}