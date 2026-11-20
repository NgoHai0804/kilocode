/**
 * Capability gates shared by the chat and settings surfaces.
 *
 * Pure and Solid-free so the filtering rules can be unit tested without a
 * webview runtime. `useCapability` and `CapabilityBoundary` live in
 * `capability-context.tsx` and read the active host.
 */

import type { HostCapabilities, HostCapability } from "./HostBridge"

export type BrowserView = "newTask" | "history" | "profile" | "settings" | "subAgentViewer"

const VIEW_CAPABILITIES: Record<BrowserView, HostCapability | undefined> = {
  newTask: "chat",
  history: "history",
  profile: "profile",
  settings: "settings",
  subAgentViewer: "subAgentViewer",
}

/** Capability that owns a settings tab. Unknown tabs stay hidden. */
const TAB_CAPABILITIES: Record<string, HostCapability> = {
  models: "settings.models",
  providers: "settings.providers",
  agentBehaviour: "settings.agentBehaviour",
  autoApprove: "settings.autoApprove",
  agentManager: "agentManager",
  browser: "settings.browser",
  checkpoints: "settings.checkpoints",
  display: "settings.display",
  autocomplete: "settings.autocomplete",
  notifications: "settings.notifications",
  context: "settings.context",
  commitMessage: "settings.commitMessage",
  indexing: "settings.indexing",
  experimental: "settings.experimental",
  sandboxing: "settings.sandboxing",
  language: "settings.language",
  aboutKiloCode: "settings.about",
}

/** Capabilities the browser host enables for the v1 UI. */
export const BROWSER_V1_CAPABILITIES: Partial<HostCapabilities> = {
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
  "settings.experimental": false,
  "file.open": true,
}

export function hasCapability(capabilities: HostCapabilities | undefined, name: HostCapability): boolean {
  return capabilities?.[name] === true
}

export function capabilityForView(view: string): HostCapability | undefined {
  return VIEW_CAPABILITIES[view as BrowserView]
}

export function settingsTabCapability(tab: string): HostCapability | undefined {
  return TAB_CAPABILITIES[tab]
}

/** Keep only settings tabs the host can render. Unknown tabs are dropped. */
export function filterSettingsTabs<T extends { id: string }>(
  tabs: readonly T[],
  capabilities: HostCapabilities | undefined,
): T[] {
  return tabs.filter((tab) => {
    const capability = settingsTabCapability(tab.id)
    return capability !== undefined && hasCapability(capabilities, capability)
  })
}