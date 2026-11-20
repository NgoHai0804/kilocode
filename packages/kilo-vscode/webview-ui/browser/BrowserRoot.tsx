import { Show, createSignal, onCleanup, onMount, type Component } from "solid-js"
import App from "../src/App"
import { BrowserHostProvider } from "./BrowserHostProvider"
import { ConnectionBanner } from "./ConnectionBanner"
import { PairingScreen } from "./PairingScreen"
import { TabPicker } from "./TabPicker"
import { notifyWorker } from "./worker-bridge"
import {
  BRIDGE_ERROR_EVENT,
  BRIDGE_PAIR_REQUIRED_EVENT,
  BRIDGE_STATE_EVENT,
  browserStorage,
  clearPairing,
  describeBridgeError,
  initialPairingState,
  readPort,
  readToken,
  reducePairing,
  type BridgeErrorInfo,
  type BridgeStateDetail,
  type PairingState,
} from "./pairing"
import "./browser-pairing.css"
import { BROWSER_THEME } from "./vscode-theme"

type ViewType = "newTask" | "history" | "profile" | "settings" | "subAgentViewer"

export type BrowserRootProps = {
  initialView?: ViewType
  initialSettingsTab?: string
  theme?: string
}

export const BrowserRoot: Component<BrowserRootProps> = (props) => {
  const storage = browserStorage()
  const [token, setToken] = createSignal(readToken(storage))
  const [state, setState] = createSignal<PairingState>(initialPairingState(readPort(storage)))
  const [error, setError] = createSignal<BridgeErrorInfo>()

  const onState = (event: Event) => {
    const detail = (event as CustomEvent<BridgeStateDetail>).detail
    if (!detail) return
    setState((current) => {
      if (detail.status === "connected") {
        return reducePairing(current, { type: "success", port: detail.port ?? current.port ?? 0 })
      }
      if (detail.status === "reconnecting") {
        return reducePairing(current, { type: "reconnect", attempt: current.attempt + 1 })
      }
      return reducePairing(current, { type: "reset" })
    })
  }

  const onPairRequired = () => {
    clearPairing(storage)
    setToken(undefined)
    setError(undefined)
    setState(initialPairingState())
  }

  const onError = (event: Event) => {
    const detail = (event as CustomEvent<{ code?: string }>).detail
    const info = describeBridgeError(detail?.code)
    if (info) setError(info)
  }

  onMount(() => {
    // The page may already hold a claim from an earlier session (page reload,
    // extension reload); push it so the service worker can open the tool
    // channel without asking the user to pair again.
    const pairPort = readPort(storage)
    const pairToken = token()
    if (pairToken && pairPort) notifyWorker({ type: "kilo.pair", token: pairToken, port: pairPort })
    window.addEventListener(BRIDGE_STATE_EVENT, onState)
    window.addEventListener(BRIDGE_PAIR_REQUIRED_EVENT, onPairRequired)
    window.addEventListener(BRIDGE_ERROR_EVENT, onError)
    onCleanup(() => {
      window.removeEventListener(BRIDGE_STATE_EVENT, onState)
      window.removeEventListener(BRIDGE_PAIR_REQUIRED_EVENT, onPairRequired)
      window.removeEventListener(BRIDGE_ERROR_EVENT, onError)
    })
  })

  const pairAgain = () => onPairRequired()

  const retry = () => {
    setError(undefined)
    window.dispatchEvent(new Event("kilo:bridge-config"))
  }

  return (
    <Show
      when={token()}
      fallback={
        <PairingScreen
          storage={storage}
          initialPort={state().port}
          theme={props.theme}
          onPaired={(value, port) => {
            setError(undefined)
            setToken(value)
            setState((current) => reducePairing(current, { type: "success", port }))
          }}
        />
      }
    >
      <ConnectionBanner state={state()} error={error()} onPairAgain={pairAgain} onRetry={retry} />
      <TabPicker />
      <App
        host={BrowserHostProvider}
        theme={props.theme ?? BROWSER_THEME}
        initialView={props.initialView}
        initialSettingsTab={props.initialSettingsTab}
      />
    </Show>
  )
}
