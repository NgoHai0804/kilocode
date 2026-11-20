import { Show, createSignal, onMount, type Component } from "solid-js"
import { ThemeProvider } from "@kilocode/kilo-ui/theme"
import { Button } from "@kilocode/kilo-ui/button"
import { Card, CardDescription, CardTitle } from "@kilocode/kilo-ui/card"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { BROWSER_THEME } from "./vscode-theme"
import {
  claimWithRetry,
  initialPairingState,
  isPairCode,
  parsePort,
  reducePairing,
  requestHint,
  storePairing,
  type ClaimResult,
  type PairingStorage,
} from "./pairing"
import "./browser-pairing.css"
import { notifyWorker } from "./worker-bridge"

function extensionId(): string {
  const globals = window as {
    KILO_EXTENSION_ID?: string
    chrome?: { runtime?: { id?: string } }
  }
  return globals.KILO_EXTENSION_ID ?? globals.chrome?.runtime?.id ?? ""
}

function claimError(result: ClaimResult): string {
  if (result.ok) return ""
  switch (result.kind) {
    case "BAD_CODE":
      return "That pair code is not correct."
    case "LOCKED":
      return "Too many attempts. Wait 60 seconds, then try again."
    case "EXPIRED":
      return "The pair code expired. Run kilo-browser pair again."
    case "NETWORK":
      return "Could not reach the bridge on that port."
    case "SERVER":
      return "The bridge is not ready yet. Try again."
    default:
      return "Pairing failed. Check the code and port."
  }
}

export type PairingScreenProps = {
  storage: PairingStorage
  initialPort?: number
  theme?: string
  onPaired: (token: string, port: number) => void
}

export const PairingScreen: Component<PairingScreenProps> = (props) => {
  const [state, setState] = createSignal(initialPairingState(props.initialPort))
  const [port, setPort] = createSignal(props.initialPort ? String(props.initialPort) : "")
  const [code, setCode] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [hint, setHint] = createSignal("")

  const refreshHint = async (value: number) => {
    const result = await requestHint({ port: value })
    if (!result.ok) {
      setHint("")
      return
    }
    if (result.port) setPort(String(result.port))
    setHint(result.requiresPair ? "Waiting for a valid pair code." : "This bridge is already paired to an extension.")
  }

  onMount(() => {
    const value = parsePort(port())
    if (value) void refreshHint(value)
  })

  const submit = async () => {
    const value = parsePort(port())
    if (!value) {
      setState((current) => reducePairing(current, { type: "failure", error: "Enter the bridge port." }))
      return
    }
    if (!isPairCode(code())) {
      setState((current) => reducePairing(current, { type: "failure", error: "The pair code is six digits." }))
      return
    }
    setState((current) => reducePairing(current, { type: "submit", port: value }))
    setBusy(true)
    const result = await claimWithRetry({ port: value, code: code(), extensionId: extensionId() })
    setBusy(false)
    if (result.ok) {
      storePairing(props.storage, result.token, result.port)
      // The UI owns the claim, but only the service worker can open the tool
      // WebSocket the browser_* tools use; hand it the code and port.
      notifyWorker({ type: "kilo.pair", code: code(), port: result.port })
      setState((current) => reducePairing(current, { type: "success", port: result.port }))
      props.onPaired(result.token, result.port)
      return
    }
    setState((current) => reducePairing(current, { type: "failure", error: claimError(result) }))
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && !busy()) void submit()
  }

  return (
      <ThemeProvider defaultTheme={props.theme ?? BROWSER_THEME}>
      <div class="kilo-pairing">
        <Card class="kilo-pairing-card">
          <CardTitle>Connect to the Kilo bridge</CardTitle>
          <CardDescription>
            Start kilo-browser in your project, then enter the bridge port and the six-digit pair code.
          </CardDescription>
          <TextField
            label="Bridge port"
            inputMode="numeric"
            value={port()}
            onChange={setPort}
            placeholder="7373"
            disabled={busy()}
          />
          <TextField
            label="Pair code"
            inputMode="numeric"
            value={code()}
            onChange={setCode}
            onKeyDown={onKeyDown}
            placeholder="123456"
            maxLength={6}
            disabled={busy()}
          />
          <Show when={state().error}>{(message) => <div class="kilo-pairing-error">{message()}</div>}</Show>
          <Show when={hint()}>{(text) => <div class="kilo-pairing-hint">{text()}</div>}</Show>
          <Button variant="primary" onClick={() => void submit()} disabled={busy()}>
            {busy() ? "Pairing..." : "Pair"}
          </Button>
        </Card>
      </div>
    </ThemeProvider>
  )
}
