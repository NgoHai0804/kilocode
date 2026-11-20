import { Show, type Accessor, type JSX, type ParentComponent } from "solid-js"
import { useHost } from "./HostProvider"
import { hasCapability } from "./capabilities"
import type { HostCapability } from "./HostBridge"

export * from "./capabilities"

/** Reactive read of one capability from the active host adapter. */
export function useCapability(name: HostCapability): Accessor<boolean> {
  const host = useHost()
  return () => hasCapability(host.capabilities, name)
}

/**
 * Render children only when the host advertises a capability.
 *
 * Use this instead of hiding unsupported surfaces with CSS: an unsupported
 * component must never mount, and its host messages must never be posted.
 */
export const CapabilityBoundary: ParentComponent<{
  capability: HostCapability
  fallback?: JSX.Element
}> = (props) => (
  <Show when={useCapability(props.capability)} fallback={props.fallback}>
    {props.children}
  </Show>
)