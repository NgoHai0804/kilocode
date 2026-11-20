import { createComponent, createContext, useContext, type ParentComponent } from "solid-js"
import type { HostBridge } from "./HostBridge"

const HostContext = createContext<HostBridge>()

// JSX-free so headless harnesses that load this module without the Solid JSX
// transform (e.g. the prewarm unit test child) can still build the provider.
export const HostProvider: ParentComponent<{ host: HostBridge }> = (props) =>
  createComponent(HostContext.Provider, {
    value: props.host,
    get children() {
      return props.children
    },
  })

export function useHost(): HostBridge {
  const host = useContext(HostContext)
  if (!host) {
    throw new Error("useHost must be used within a HostProvider")
  }
  return host
}
