import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { isRecord } from "../config/schema"
import { BRIDGE_VERSION } from "../protocol/version"
import type { BridgeEvent, KiloBackend } from "./kilo"
import { checkJail, resolveSafe } from "../policy/jail"
import type { LogEvent } from "../log/jsonl"
import type { UiMessage } from "./ui-ws"
import type {
  Config,
  FeatureFlags,
  Message,
  ModelSelection,
  Part,
  PermissionRequest,
  Provider,
  ProvidersLoadedMessage,
  QuestionRequest,
  SessionInfo,
  SessionModelUsageLoadedMessage,
  TodoItem,
  WebviewMessage,
} from "@kilo-webview/src/types/messages"
import type { HostCapabilities } from "@kilo-webview/src/host/HostBridge"

export type UiHostOptions = {
  workspace: string
  kilo: KiloBackend
  home?: string
  port?: number
  log?: (event: LogEvent) => void
}

type Usage = { count: number; lastUsed: number }

type UiState = {
  recents: ModelSelection[]
  favorites: ModelSelection[]
  variants: Record<string, string>
  modelUsage: Record<string, Usage>
  settings: Record<string, unknown>
  modelSelectorExpanded: boolean
}

const FEATURES: FeatureFlags = {
  indexing: false,
  sandboxControls: false,
  backgroundSubagents: false,
  speechToText: false,
}

const CAPABILITIES: HostCapabilities = {
  chat: true,
  history: true,
  profile: true,
  settings: true,
  "settings.models": true,
  "settings.providers": true,
  "settings.autoApprove": true,
  "settings.agentBehaviour": true,
  "settings.display": true,
  "settings.language": true,
  "settings.about": true,
  "settings.browser": false,
  "settings.checkpoints": false,
  "settings.autocomplete": false,
  "settings.notifications": false,
  "settings.context": false,
  "settings.indexing": false,
  "settings.sandboxing": false,
  "settings.commitMessage": false,
  "settings.experimental": false,
  "file.open": true,
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

const STATE_FILE = path.join(".kilo", "kilo-browser", "ui-state.json")

/**
 * Host side of the browser UI message contract.
 *
 * The UI speaks raw WebviewMessage objects over the UI WebSocket; this class
 * answers with ExtensionMessage objects and maps backend SSE into the same
 * shape. Unsupported message types answer with code "HOST_UNSUPPORTED" once
 * per connection so the UI never silently no-ops a side-effecting action.
 */
export class UiHost {
  private readonly workspace: string
  private readonly kilo: KiloBackend
  private readonly home: string
  private port: number
  private readonly log?: (event: LogEvent) => void
  private send: (message: UiMessage) => void = () => {}
  private state: UiState = {
    recents: [],
    favorites: [],
    variants: {},
    modelUsage: {},
    settings: {},
    modelSelectorExpanded: true,
  }
  private loading?: Promise<void>
  private drafts = new Map<string, { sid: string; exp: number }>()
  private unsupported = new Set<string>()
  private missing = new Set<string>()

  constructor(options: UiHostOptions) {
    this.workspace = path.resolve(options.workspace)
    this.kilo = options.kilo
    this.home = options.home ?? os.homedir()
    this.port = options.port ?? 0
    this.log = options.log
  }

  get statePath() {
    return path.join(this.workspace, STATE_FILE)
  }

  get globalPath() {
    const root = process.env.XDG_CONFIG_HOME || path.join(this.home, ".config")
    return path.join(root, "kilo", "kilo.json")
  }

  get projectPath() {
    return path.join(this.workspace, ".kilo", "kilo.json")
  }

  bind(send: (message: UiMessage) => void) {
    this.send = send
  }

  setPort(port: number) {
    this.port = port
  }

  ready() {
    void this.ensureState()
    this.send({
      type: "ready",
      serverInfo: { port: this.port, version: BRIDGE_VERSION },
      extensionVersion: BRIDGE_VERSION,
      workspaceDirectory: this.workspace,
      capabilities: CAPABILITIES,
    })
    this.send({ type: "connectionState", state: "connected" })
    this.send({ type: "extensionDataReady" })
  }

  close() {
    this.drafts.clear()
  }

  handle(message: WebviewMessage) {
    void this.dispatch(message).catch((err: unknown) => {
      this.log?.({ event: "ui.rpc.error", level: "warn", data: { type: message.type, error: errorText(err) } })
      this.send({ type: "error", message: `${message.type}: ${errorText(err)}` })
    })
  }

  event(event: BridgeEvent) {
    if (event.channel !== "ui") return
    const data = isRecord(event.data) ? event.data : {}
    switch (event.type) {
      case "session.status":
        this.emitStatus(data)
        break
      case "session.idle": {
        const sessionID = str(data.sessionID)
        if (sessionID) this.send({ type: "sessionStatus", sessionID, status: "idle" })
        break
      }
      case "session.turn.close":
        this.emitTurnClose(event, data)
        break
      case "message.part.delta":
        this.emitPartDelta(data)
        break
      case "message.part.updated":
        this.emitPartUpdated(data)
        break
      case "message.part.removed": {
        const sessionID = str(data.sessionID)
        const messageID = str(data.messageID)
        const partID = str(data.partID)
        if (sessionID && messageID && partID) this.send({ type: "partRemoved", sessionID, messageID, partID })
        break
      }
      case "message.updated": {
        const info = isRecord(data.info) ? data.info : undefined
        if (info) this.send({ type: "messageCreated", message: messageToWebview({ info, parts: [] }) })
        break
      }
      case "message.removed": {
        const sessionID = str(data.sessionID)
        const messageID = str(data.messageID)
        if (sessionID && messageID) this.send({ type: "messageRemoved", sessionID, messageID })
        break
      }
      case "session.created": {
        const info = isRecord(data.info) ? data.info : undefined
        if (info) this.send({ type: "sessionCreated", session: sessionToWebview(info) })
        break
      }
      case "session.updated": {
        const info = isRecord(data.info) ? data.info : undefined
        if (info) this.send({ type: "sessionUpdated", session: sessionToWebview(info) })
        break
      }
      case "session.deleted": {
        const sessionID = str(data.sessionID)
        if (sessionID) this.send({ type: "sessionDeleted", sessionID })
        break
      }
      case "session.error": {
        const error = isRecord(data.error) ? data.error : undefined
        const sessionID = str(data.sessionID)
        this.send({
          type: "sessionError",
          eventID: event.id ?? randomUUID(),
          ...(sessionID ? { sessionID } : {}),
          ...(error ? { error: error as { name: string; data?: Record<string, unknown> } } : {}),
        })
        break
      }
      case "todo.updated": {
        const sessionID = str(data.sessionID)
        if (!sessionID) return
        const items = Array.isArray(data.todos) ? (data.todos as unknown as TodoItem[]) : []
        this.send({ type: "todoUpdated", sessionID, items })
        break
      }
      case "permission.asked":
        this.emitPermissionAsked(data)
        break
      case "permission.replied": {
        const permissionID = str(data.requestID)
        if (permissionID) this.send({ type: "permissionResolved", permissionID })
        break
      }
      case "question.asked": {
        const question = isRecord(data) ? (data as unknown as QuestionRequest) : undefined
        if (question && typeof question.id === "string") this.send({ type: "questionRequest", question })
        break
      }
      case "question.replied":
      case "question.rejected": {
        const requestID = str(data.requestID)
        if (requestID) this.send({ type: "questionResolved", requestID })
        break
      }
      case "session.diff":
        this.reportMissing("session.diff")
        break
      default:
        break
    }
  }

  private async dispatch(message: WebviewMessage) {
    switch (message.type) {
      case "webviewReady":
        this.ready()
        break
      case "loadSessions": {
        const raw = await this.kilo.listSessions?.()
        const sessions = Array.isArray(raw) ? raw.map(sessionToWebview) : []
        this.send({ type: "sessionsLoaded", sessions, hasMore: false })
        break
      }
      case "createSession": {
        const raw = await this.kilo.createSession({})
        this.send({ type: "sessionCreated", session: sessionToWebview(raw) })
        break
      }
      case "loadMessages": {
        const raw = await this.kilo.getMessages(message.sessionID)
        const messages = Array.isArray(raw) ? raw.map(messageToWebview) : []
        const mode = message.mode === "focus" ? undefined : message.mode
        this.send({ type: "messagesLoaded", sessionID: message.sessionID, messages, ...(mode ? { mode } : {}), hasMore: false })
        break
      }
      case "deleteSession": {
        await this.kilo.deleteSession?.({ sessionID: message.sessionID })
        this.send({ type: "sessionDeleted", sessionID: message.sessionID })
        break
      }
      case "renameSession": {
        const raw = await this.kilo.renameSession?.({ sessionID: message.sessionID, title: message.title })
        const info = isRecord(raw) ? raw : { id: message.sessionID, title: message.title, time: {} }
        this.send({ type: "sessionUpdated", session: sessionToWebview(info) })
        break
      }
      case "requestSessionModelUsage": {
        const data = await this.kilo.sessionModelUsage?.(message.sessionID)
        this.send({
          type: "sessionModelUsageLoaded",
          sessionID: message.sessionID,
          requestID: message.requestID,
          data: data as SessionModelUsageLoadedMessage["data"],
        })
        break
      }
      case "abort":
        await this.kilo.abort({ sessionID: message.sessionID, scope: message.scope === "tree" ? "tree" : "session" })
        break
      case "sendMessage":
        await this.sendMessage(message)
        break
      case "permissionResponse":
        await this.replyPermission(message)
        break
      case "questionReply":
        await this.replyQuestion(message.requestID, message.answers)
        break
      case "questionReject":
        await this.rejectQuestion(message.requestID)
        break
      case "requestConfig":
        await this.sendConfig()
        break
      case "updateConfig":
        await this.updateConfig(message.config, message.projectConfig, message.globalUnset, message.projectUnset)
        break
      case "updateSetting":
        await this.updateSetting(message.key, message.value)
        break
      case "requestProviders":
        await this.sendProviders()
        break
      case "requestRecents":
        await this.ensureState()
        this.send({ type: "recentsLoaded", recents: this.state.recents })
        break
      case "persistRecents":
        await this.ensureState()
        this.state.recents = selectionList(message.recents).slice(0, 5)
        await this.saveState()
        break
      case "requestFavorites":
        await this.ensureState()
        this.send({ type: "favoritesLoaded", favorites: this.state.favorites })
        break
      case "toggleFavorite":
        await this.toggleFavorite(message.action, message.providerID, message.modelID)
        break
      case "requestModelUsage":
        await this.ensureState()
        this.send({ type: "modelUsageLoaded", usage: this.state.modelUsage })
        break
      case "recordModelUsage":
        await this.recordModelUsage(message.providerID, message.modelID)
        break
      case "requestVariants":
        await this.ensureState()
        this.send({ type: "variantsLoaded", variants: this.state.variants })
        break
      case "persistVariant":
        await this.ensureState()
        this.state.variants[message.key] = message.value
        await this.saveState()
        break
      case "requestModelSelectorExpanded":
        await this.ensureState()
        this.send({ type: "modelSelectorExpandedLoaded", value: this.state.modelSelectorExpanded })
        break
      case "persistModelSelectorExpanded":
        await this.ensureState()
        this.state.modelSelectorExpanded = message.value
        await this.saveState()
        break
      case "validateFiles":
        await this.sendValidateFiles(message.id, message.paths)
        break
      case "copyToClipboard":
        this.send({ type: "clipboardWriteResult", id: message.id, ok: false, error: "Clipboard writes happen in the UI page" })
        break
      case "requestAutocompleteSettings":
        this.send({
          type: "autocompleteSettingsLoaded",
          settings: {
            enableAutoTrigger: false,
            enableSmartInlineTaskKeybinding: false,
            enableChatAutocomplete: false,
            provider: null,
            model: null,
          },
        })
        break
      case "requestChatSettings":
        this.send({
          type: "chatSettingsLoaded",
          settings: {
            shiftTabCyclesVariant: false,
            agentManagerSplash: false,
            browserAutomation: false,
            agentManagerBrowserOpenLinksIn: "external",
            workspaceTrusted: false,
          },
        })
        break
      case "requestIndexingSettings":
        this.send({ type: "indexingSettingsLoaded", settings: { showButtonWhenDisabled: false, consent: false, projects: [] } })
        break
      case "requestAgents":
        this.send({ type: "agentsLoaded", agents: [], allAgents: [], defaultAgent: "code" })
        break
      case "requestSkills":
        this.send({ type: "skillsLoaded", skills: [] })
        break
      case "requestCommands":
        this.send({ type: "commandsLoaded", commands: [] })
        break
      case "requestMcpStatus":
        this.send({ type: "mcpStatusLoaded", status: {} })
        break
      case "requestNotifications":
        this.send({ type: "notificationsLoaded", notifications: [], dismissedIds: [] })
        break
      case "requestAutoApproveState":
        this.send({ type: "autoApproveState", active: false })
        break
      case "requestBrowserSettings":
        this.send({ type: "browserSettingsLoaded", settings: { enabled: false, useSystemChrome: false, headless: false } })
        break
      case "requestClaudeCompatSetting":
        this.send({ type: "claudeCompatSettingLoaded", enabled: false })
        break
      case "requestTimelineSetting":
        this.send({ type: "timelineSettingLoaded", visible: false })
        break
      case "requestThroughputSetting":
        this.send({ type: "throughputSettingLoaded", visible: false })
        break
      case "requestAutoApprovalReasonSetting":
        this.send({ type: "autoApprovalReasonSettingLoaded", visible: false })
        break
      default:
        this.unsupportedType(message.type)
        break
    }
  }

  private async sendMessage(message: Extract<WebviewMessage, { type: "sendMessage" }>) {
    let sid = message.sessionID
    if (!sid) sid = await this.resolveSession(message.draftID, message.injectedTitle)
    if (!sid) return
    const parts: unknown[] = []
    for (const file of message.files ?? []) {
      parts.push({ type: "file", mime: file.mime, url: file.url, filename: file.filename, source: file.source })
    }
    parts.push({ type: "text", text: message.text })
    const model = message.providerID && message.modelID ? { providerID: message.providerID, modelID: message.modelID } : undefined
    try {
      await this.kilo.promptAsync({
        sessionID: sid,
        messageID: message.messageID,
        parts,
        model,
        agent: message.agent,
        variant: message.variant,
      })
    } catch (err) {
      this.log?.({ event: "ui.rpc.error", level: "warn", data: { type: "sendMessage", error: errorText(err) } })
      this.send({
        type: "sendMessageFailed",
        error: errorText(err),
        text: message.text,
        sessionID: sid,
        ...(message.draftID ? { draftID: message.draftID } : {}),
        ...(message.messageID ? { messageID: message.messageID } : {}),
        ...(message.files ? { files: message.files } : {}),
      })
    }
  }

  private async resolveSession(draftID?: string, title?: string) {
    if (draftID) {
      const cached = this.drafts.get(draftID)
      if (cached && cached.exp > Date.now()) return cached.sid
    }
    const raw = await this.kilo.createSession(title ? { title } : {})
    const info = isRecord(raw) ? raw : {}
    const id = typeof info.id === "string" ? info.id : undefined
    if (!id) throw new Error("createSession returned no id")
    this.send({ type: "sessionCreated", session: sessionToWebview(raw), ...(draftID ? { draftID } : {}) })
    if (draftID) this.drafts.set(draftID, { sid: id, exp: Date.now() + 60_000 })
    return id
  }

  private async replyPermission(message: Extract<WebviewMessage, { type: "permissionResponse" }>) {
    try {
      const approvedAlways = Array.isArray(message.approvedAlways) ? message.approvedAlways : []
      const deniedAlways = Array.isArray(message.deniedAlways) ? message.deniedAlways : []
      if (approvedAlways.length > 0 || deniedAlways.length > 0) {
        if (!this.kilo.saveAlwaysRules) throw new Error("always-rules are not supported by the backend")
        await this.kilo.saveAlwaysRules({ requestID: message.permissionId, approvedAlways, deniedAlways })
      }
      if (!this.kilo.reply) throw new Error("permission reply is not supported by the backend")
      await this.kilo.reply({
        requestID: message.permissionId,
        reply: message.response,
        message: message.feedback,
        interactive: true,
      })
      this.send({ type: "permissionResolved", permissionID: message.permissionId })
    } catch (err) {
      this.log?.({ event: "ui.rpc.error", level: "warn", data: { type: "permissionResponse", error: errorText(err) } })
      this.send({ type: "permissionError", permissionID: message.permissionId })
    }
  }

  private async replyQuestion(requestID: string, answers: string[][]) {
    try {
      if (!this.kilo.questionReply) throw new Error("question reply is not supported by the backend")
      await this.kilo.questionReply({ requestID, answers })
      this.send({ type: "questionResolved", requestID })
    } catch (err) {
      this.log?.({ event: "ui.rpc.error", level: "warn", data: { type: "questionReply", error: errorText(err) } })
      this.send({ type: "questionError", requestID })
    }
  }

  private async rejectQuestion(requestID: string) {
    try {
      if (!this.kilo.questionReject) throw new Error("question reject is not supported by the backend")
      await this.kilo.questionReject({ requestID })
      this.send({ type: "questionResolved", requestID })
    } catch (err) {
      this.log?.({ event: "ui.rpc.error", level: "warn", data: { type: "questionReject", error: errorText(err) } })
      this.send({ type: "questionError", requestID })
    }
  }

  private async sendConfig() {
    const globalConfig = await readConfigFile(this.globalPath)
    const projectConfig = await readConfigFile(this.projectPath)
    const effective = deepMerge(globalConfig, projectConfig)
    await this.ensureState()
    this.send({
      type: "configLoaded",
      config: effective as Config,
      globalConfig: globalConfig as Config,
      projectConfig: projectConfig as Config,
      settings: this.state.settings,
      features: FEATURES,
    })
  }

  private async updateConfig(
    config: unknown,
    projectConfig: unknown,
    globalUnset: string[][] | undefined,
    projectUnset: string[][] | undefined,
  ) {
    const globalPatch = isRecord(config) ? config : {}
    const projectPatch = isRecord(projectConfig) ? projectConfig : {}
    const unsetGlobal = Array.isArray(globalUnset) ? globalUnset : []
    const unsetProject = Array.isArray(projectUnset) ? projectUnset : []
    const touchGlobal = Object.keys(globalPatch).length > 0 || unsetGlobal.length > 0
    const touchProject = Object.keys(projectPatch).length > 0 || unsetProject.length > 0
    if (!touchGlobal && !touchProject) return
    try {
      let global = await readConfigFile(this.globalPath)
      let project = await readConfigFile(this.projectPath)
      if (touchGlobal) {
        global = unsetPaths(deepMerge(global, globalPatch), unsetGlobal)
        await writeConfigFile(this.globalPath, global)
      }
      if (touchProject) {
        project = unsetPaths(deepMerge(project, projectPatch), unsetProject)
        await checkJail([this.workspace], this.projectPath)
        await writeConfigFile(this.projectPath, project)
      }
      await this.ensureState()
      this.send({
        type: "configUpdated",
        config: deepMerge(global, project) as Config,
        globalConfig: global as Config,
        projectConfig: project as Config,
        settings: this.state.settings,
        features: FEATURES,
      })
    } catch (err) {
      this.log?.({ event: "ui.rpc.error", level: "warn", data: { type: "updateConfig", error: errorText(err) } })
      this.send({ type: "configUpdateFailed", message: errorText(err) })
    }
  }

  private async updateSetting(key: string, value: unknown) {
    await this.ensureState()
    this.state.settings[key] = value === null ? undefined : value
    await this.saveState()
  }

  private async sendProviders() {
    const [list, methods] = await Promise.all([this.kilo.providers?.(), this.kilo.providerAuth?.()])
    this.send(buildProviders(list, methods))
  }

  private async toggleFavorite(action: "add" | "remove", providerID: string, modelID: string) {
    await this.ensureState()
    const key = `${providerID}/${modelID}`
    const rest = this.state.favorites.filter((item) => `${item.providerID}/${item.modelID}` !== key)
    this.state.favorites = action === "add" ? [...rest, { providerID, modelID }] : rest
    await this.saveState()
    this.send({ type: "favoritesLoaded", favorites: this.state.favorites })
  }

  private async recordModelUsage(providerID: string, modelID: string) {
    await this.ensureState()
    const key = `${providerID}/${modelID}`
    const current = this.state.modelUsage[key] ?? { count: 0, lastUsed: 0 }
    this.state.modelUsage[key] = { count: current.count + 1, lastUsed: Date.now() }
    await this.saveState()
  }

  private async sendValidateFiles(id: string, paths: string[]) {
    const existing: string[] = []
    for (const target of paths) {
      const result = await resolveSafe([this.workspace], target)
      if (!result.ok) continue
      if (await Bun.file(result.resolved).exists()) existing.push(target)
    }
    this.send({ type: "validateFilesResult", id, existing })
  }

  private emitStatus(data: Record<string, unknown>) {
    const sessionID = str(data.sessionID)
    if (!sessionID) return
    const status = isRecord(data.status) ? data.status : {}
    const kind = typeof status.type === "string" ? status.type : "idle"
    if (kind === "retry") {
      const attempt = num(status.attempt)
      const message = str(status.message)
      const next = num(status.next)
      this.send({
        type: "sessionStatus",
        sessionID,
        status: "retry",
        ...(attempt !== undefined ? { attempt } : {}),
        ...(message !== undefined ? { message } : {}),
        ...(next !== undefined ? { next } : {}),
      })
      return
    }
    if (kind === "offline") {
      const message = str(status.message)
      this.send({ type: "sessionStatus", sessionID, status: "offline", ...(message !== undefined ? { message } : {}) })
      return
    }
    this.send({ type: "sessionStatus", sessionID, status: kind === "idle" ? "idle" : "busy" })
  }

  private emitTurnClose(event: BridgeEvent, data: Record<string, unknown>) {
    const sessionID = str(data.sessionID)
    if (!sessionID) return
    const parentID = str(data.parentID)
    this.send({
      type: "sessionTurnClosed",
      sessionID,
      eventID: event.id ?? randomUUID(),
      reason: closeReason(data.reason),
      ...(parentID ? { parentID } : {}),
    })
  }

  private emitPartDelta(data: Record<string, unknown>) {
    const sessionID = str(data.sessionID)
    const messageID = str(data.messageID)
    const partID = str(data.partID)
    const delta = str(data.delta)
    if (!sessionID || !messageID || !partID || delta === undefined) return
    this.send({
      type: "partUpdated",
      sessionID,
      messageID,
      part: { id: partID, type: "text", messageID, text: delta },
      delta: { type: "text-delta", textDelta: delta },
    })
  }

  private emitPartUpdated(data: Record<string, unknown>) {
    const sessionID = str(data.sessionID)
    const part = isRecord(data.part) ? data.part : undefined
    if (!sessionID || !part) return
    if (typeof part.id !== "string" || typeof part.type !== "string") return
    this.send({ type: "partUpdated", sessionID, messageID: str(part.messageID) ?? "", part: part as unknown as Part })
  }

  private emitPermissionAsked(data: Record<string, unknown>) {
    const id = str(data.id)
    const sessionID = str(data.sessionID)
    if (!id || !sessionID) return
    const permission = str(data.permission) ?? "unknown"
    const tool = isRecord(data.tool) ? (data.tool as { messageID: string; callID: string }) : undefined
    const request: PermissionRequest = {
      id,
      sessionID,
      toolName: permission,
      patterns: strArray(data.patterns),
      always: strArray(data.always),
      args: (isRecord(data.metadata) ? data.metadata : {}) as PermissionRequest["args"],
      message: `Permission required: ${permission}`,
      ...(tool ? { tool } : {}),
    }
    this.send({ type: "permissionRequest", permission: request })
  }

  private async ensureState() {
    if (this.loading) return this.loading
    this.loading = (async () => {
      const raw = await readConfigFile(this.statePath)
      this.state = {
        recents: selectionList(raw.recents).slice(0, 5),
        favorites: selectionList(raw.favorites),
        variants: stringMap(raw.variants),
        modelUsage: usageMap(raw.modelUsage),
        settings: isRecord(raw.settings) ? raw.settings : {},
        modelSelectorExpanded: raw.modelSelectorExpanded !== false,
      }
    })()
    return this.loading
  }

  private async saveState() {
    await checkJail([this.workspace], this.statePath)
    await writeConfigFile(this.statePath, {
      recents: this.state.recents,
      favorites: this.state.favorites,
      variants: this.state.variants,
      modelUsage: this.state.modelUsage,
      settings: this.state.settings,
      modelSelectorExpanded: this.state.modelSelectorExpanded,
    })
  }

  private unsupportedType(type: string) {
    if (this.unsupported.has(type)) return
    this.unsupported.add(type)
    this.log?.({ event: "ui.rpc.error", level: "warn", data: { type, code: "HOST_UNSUPPORTED" } })
    this.send({ type: "error", message: `Host RPC is not supported: ${type}`, code: "HOST_UNSUPPORTED" })
  }

  private reportMissing(type: string) {
    if (this.missing.has(type)) return
    this.missing.add(type)
    this.log?.({ event: "ui.rpc.error", level: "warn", data: { type, reason: "missing UI message type" } })
  }
}

function buildProviders(listRaw: unknown, methodsRaw: unknown): ProvidersLoadedMessage {
  const list = isRecord(listRaw) ? listRaw : {}
  const all = Array.isArray(list.all) ? list.all : []
  const providers: Record<string, Provider> = {}
  const authStates: ProvidersLoadedMessage["authStates"] = {}
  for (const item of all) {
    if (!isRecord(item) || typeof item.id !== "string") continue
    const id = item.id
    const copy: Record<string, unknown> = { ...item }
    if (typeof copy.key === "string" && copy.key.length > 0) authStates[id] = "api"
    delete copy.key
    if (typeof copy.name !== "string") copy.name = id
    if (!isRecord(copy.models)) copy.models = {}
    providers[id] = copy as unknown as Provider
  }
  const connected = Array.isArray(list.connected)
    ? list.connected.filter((value): value is string => typeof value === "string")
    : Object.keys(providers)
  const defaults = stringMap(list.default)
  const failures = Array.isArray(list.failures) ? (list.failures as ProvidersLoadedMessage["failures"]) : []
  return {
    type: "providersLoaded",
    providers,
    connected,
    defaults,
    defaultSelection: firstDefault(defaults),
    authMethods: (isRecord(methodsRaw) ? methodsRaw : {}) as ProvidersLoadedMessage["authMethods"],
    authStates,
    failures,
  }
}

function firstDefault(defaults: Record<string, string>): ModelSelection {
  const entry = Object.entries(defaults).find(([, model]) => typeof model === "string" && model.length > 0)
  if (!entry) return { providerID: "", modelID: "" }
  return { providerID: entry[0], modelID: entry[1] }
}

function sessionToWebview(raw: unknown): SessionInfo {
  const source = isRecord(raw) ? raw : {}
  const time = isRecord(source.time) ? source.time : {}
  const created = typeof time.created === "number" ? time.created : Date.now()
  const updated = typeof time.updated === "number" ? time.updated : created
  const model = isRecord(source.model) ? source.model : undefined
  const id = typeof source.id === "string" ? source.id : ""
  const modelID = model ? str(model.modelID) ?? str(model.id) : undefined
  return {
    id,
    parentID: str(source.parentID) ?? null,
    ...(typeof source.title === "string" ? { title: source.title } : {}),
    createdAt: new Date(created).toISOString(),
    updatedAt: new Date(updated).toISOString(),
    ...(typeof source.agent === "string" ? { agent: source.agent } : {}),
    ...(model && typeof model.providerID === "string" && modelID
      ? {
          model: {
            providerID: model.providerID,
            modelID,
            ...(typeof model.variant === "string" && model.variant !== "default" ? { variant: model.variant } : {}),
          },
        }
      : {}),
    revert: isRecord(source.revert) ? (source.revert as SessionInfo["revert"]) : null,
    summary: isRecord(source.summary) ? (source.summary as SessionInfo["summary"]) : null,
  }
}

function messageToWebview(raw: unknown): Message {
  const record = isRecord(raw) ? raw : {}
  const info = isRecord(record.info) ? record.info : record
  const parts = Array.isArray(record.parts) ? record.parts : Array.isArray(info.parts) ? info.parts : []
  const time = isRecord(info.time) ? info.time : {}
  const created = typeof time.created === "number" ? time.created : Date.now()
  const id = typeof info.id === "string" ? info.id : ""
  const sessionID = typeof info.sessionID === "string" ? info.sessionID : ""
  return {
    ...info,
    id,
    sessionID,
    role: info.role === "assistant" ? "assistant" : "user",
    parts: parts as Message["parts"],
    createdAt: new Date(created).toISOString(),
  } as unknown as Message
}

async function readConfigFile(file: string): Promise<Record<string, unknown>> {
  const handle = Bun.file(file)
  if (!(await handle.exists())) return {}
  const text = await handle.text()
  if (text.trim().length === 0) return {}
  const value = JSON.parse(text) as unknown
  return isRecord(value) ? value : {}
}

async function writeConfigFile(file: string, value: Record<string, unknown>) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  await Bun.write(file, `${JSON.stringify(value, null, 2)}\n`)
}

function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    const current = out[key]
    out[key] = isRecord(value) && isRecord(current) ? deepMerge(current, value) : value
  }
  return out
}

function unsetPaths(root: Record<string, unknown>, paths: string[][]): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(root)) as Record<string, unknown>
  for (const segments of paths) {
    if (!Array.isArray(segments) || segments.length === 0) continue
    let node: Record<string, unknown> | undefined = copy
    for (let index = 0; index < segments.length - 1; index += 1) {
      if (node === undefined) break
      const child: unknown = node[segments[index]]
      if (!isRecord(child)) {
        node = undefined
        break
      }
      node = child
    }
    if (!node) continue
    delete node[segments[segments.length - 1]]
  }
  return copy
}

function selectionList(raw: unknown): ModelSelection[] {
  if (!Array.isArray(raw)) return []
  const out: ModelSelection[] = []
  for (const item of raw) {
    if (isRecord(item) && typeof item.providerID === "string" && typeof item.modelID === "string") {
      out.push({ providerID: item.providerID, modelID: item.modelID })
    }
  }
  return out
}

function usageMap(raw: unknown): Record<string, Usage> {
  if (!isRecord(raw)) return {}
  const out: Record<string, Usage> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue
    out[key] = {
      count: typeof value.count === "number" ? value.count : 0,
      lastUsed: typeof value.lastUsed === "number" ? value.lastUsed : 0,
    }
  }
  return out
}

function stringMap(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") out[key] = value
  }
  return out
}

function str(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function num(value: unknown) {
  return typeof value === "number" ? value : undefined
}

function strArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function closeReason(value: unknown): "completed" | "error" | "interrupted" | "superseded" {
  if (value === "error" || value === "interrupted" || value === "superseded") return value
  return "completed"
}

function errorText(err: unknown) {
  return err instanceof Error ? err.message : "unexpected error"
}
