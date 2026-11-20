import { For, Show, createSignal, onMount, type Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { notifyWorker } from "./worker-bridge"
import "./browser-tabs.css"

type TabInfo = { id?: number; title?: string; url?: string }
type ChromeTabs = { query(queryInfo: Record<string, unknown>): Promise<TabInfo[]> }
type ChromeLike = { tabs?: ChromeTabs }

const LIMIT = 30

function chromeTabs(): ChromeTabs | undefined {
  return (globalThis as unknown as { chrome?: ChromeLike }).chrome?.tabs
}

function label(tab: TabInfo) {
  return tab.title && tab.title.length > 0 ? tab.title : tab.url ?? `Tab ${tab.id}`
}

/**
 * Pick the real browser tab the agent should drive.
 *
 * Only the service worker can attach CDP to a tab, so a click here forwards
 * `kilo.attach` with the tab id; the worker persists the selection and restores
 * it when the bridge reconnects.
 */
export const TabPicker: Component = () => {
  const [tabs, setTabs] = createSignal<TabInfo[]>([])
  const [attached, setAttached] = createSignal<number>()
  const [error, setError] = createSignal("")
  const [open, setOpen] = createSignal(false)

  const refresh = async () => {
    const api = chromeTabs()
    if (!api?.query) {
      setError("Tab selection is only available inside the extension.")
      return
    }
    try {
      const list = await api.query({})
      setError("")
      setTabs(
        list
          .filter((tab) => typeof tab.id === "number")
          .slice(0, LIMIT),
      )
    } catch (err) {
      console.warn("[Kilo Browser] could not list browser tabs", err)
      setError("Could not list browser tabs.")
    }
  }

  const pick = (tab: TabInfo) => {
    if (typeof tab.id !== "number") return
    setAttached(tab.id)
    notifyWorker({ type: "kilo.attach", tabId: tab.id })
  }

  onMount(() => {
    void refresh()
  })

  return (
    <div class="kilo-tabs">
      <div class="kilo-tabs-header">
        <span class="kilo-tabs-title">
          {attached() === undefined ? "No browser tab attached" : `Browser tab attached (#${attached()})`}
        </span>
        <Button
          size="small"
          variant="ghost"
          onClick={() => {
            if (!open()) void refresh()
            setOpen(!open())
          }}
        >
          {open() ? "Hide tabs" : "Select tab"}
        </Button>
      </div>
      <Show when={open()}>
        <Show when={error()}>{(text) => <div class="kilo-tabs-error">{text()}</div>}</Show>
        <div class="kilo-tabs-list">
          <For each={tabs()}>
            {(tab) => (
              <Button
                size="small"
                variant={attached() === tab.id ? "primary" : "ghost"}
                class="kilo-tabs-item"
                onClick={() => pick(tab)}
              >
                {label(tab)}
              </Button>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
