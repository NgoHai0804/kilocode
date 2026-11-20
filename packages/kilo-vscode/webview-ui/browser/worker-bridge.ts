/**
 * Page -> service worker messages for the Kilo Browser extension.
 *
 * The UI page and the service worker each hold their own WebSocket to the
 * bridge: the page keeps the `ui.*` channel (chat, settings, permissions) and
 * the worker owns the `tool.*` channel that the `browser_*` tools need. The
 * page learns the bridge port and token first, so it must hand them to the
 * worker for the tool channel to come up at all.
 *
 * Outside the extension (VS Code webview, tests) `chrome.runtime` is missing
 * and every call here is a no-op.
 */

export type WorkerMessage =
  | { type: "kilo.pair"; code?: string; port?: number; token?: string }
  | { type: "kilo.attach"; tabId: number }
  | { type: "kilo.detach" }

type ChromeRuntime = { sendMessage?(message: unknown): Promise<unknown> }

function runtime(): ChromeRuntime | undefined {
  return (globalThis as unknown as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime
}

export function notifyWorker(message: WorkerMessage): void {
  const api = runtime()
  if (!api?.sendMessage) return
  try {
    void api.sendMessage(message).catch((err: unknown) => {
      console.warn("[Kilo Browser] service worker message failed", message.type, err)
    })
  } catch (err) {
    console.warn("[Kilo Browser] service worker unavailable", message.type, err)
  }
}
