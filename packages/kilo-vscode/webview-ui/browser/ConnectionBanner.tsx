import { Show, type Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { connectionBanner, type BridgeErrorInfo, type PairingState } from "./pairing"

export type ConnectionBannerProps = {
  state: PairingState
  error?: BridgeErrorInfo
  onPairAgain: () => void
  onRetry: () => void
}

export const ConnectionBanner: Component<ConnectionBannerProps> = (props) => {
  const model = () => connectionBanner(props.state, props.error)
  return (
    <Show when={model().visible}>
      <div class="kilo-bridge-banner" data-tone={model().tone} role="status" aria-live="polite">
        <span class="kilo-bridge-banner-text">{model().text}</span>
        <Show when={model().action === "pair-again"}>
          <Button size="small" variant="secondary" onClick={props.onPairAgain}>
            Pair again
          </Button>
        </Show>
        <Show when={model().action && model().action !== "pair-again"}>
          <Button size="small" variant="secondary" onClick={props.onRetry}>
            {model().actionLabel}
          </Button>
        </Show>
      </div>
    </Show>
  )
}
