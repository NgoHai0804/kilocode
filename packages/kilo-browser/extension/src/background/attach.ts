import type { TabRef } from "../storage/store"

export type ActiveTab = {
  tabId: number
  windowId?: number
}

/**
 * Decide which tab the service worker should drive.
 *
 * Auto-attach tracks whichever tab is active so the agent can control every
 * page without a manual pick. When it is off, a previously selected tab is kept
 * and nothing is attached until the user chooses one.
 */
export function pickAttachTab(input: {
  autoAttach: boolean
  selected: TabRef | null
  active: ActiveTab | null
}): ActiveTab | undefined {
  if (input.autoAttach) return input.active ?? undefined
  if (input.selected) return { tabId: input.selected.tabId, windowId: input.selected.windowId }
  return undefined
}

const BLOCKED_SCHEMES = [
  "chrome://",
  "chrome-extension://",
  "chrome-search://",
  "edge://",
  "devtools://",
  "about:",
]

/**
 * CDP cannot drive browser-internal pages; attaching to them fails. An unknown
 * URL is treated as attachable so a restricted `tabs` view does not disable
 * auto-attach entirely.
 */
export function isAttachable(url: string | undefined): boolean {
  if (!url) return true
  const lower = url.toLowerCase()
  return !BLOCKED_SCHEMES.some((scheme) => lower.startsWith(scheme))
}
