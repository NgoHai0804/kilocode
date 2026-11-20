import { createContext, useContext, type ParentComponent } from "solid-js"
import type { HostBridge } from "./HostBridge"

const HostContext = createContext<HostBridge>()

export const HostProvider: ParentComponent<{ host: HostBridge }> = (props) => (
  <HostContext.Provider value={props.host}>{props.children}</HostContext.Provider>
)

export function useHost(): HostBridge {
  const host = useContext(HostContext)
  if (!host) {
    throw new Error("useHost must be used within a HostProvider")
  }
  return host
}
