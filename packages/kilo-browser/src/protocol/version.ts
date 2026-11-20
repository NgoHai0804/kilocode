export const PROTOCOL_VERSION = "1.0"
export const BRIDGE_VERSION = "0.1.0"
export const WS_SUBPROTOCOL = "kilo-browser.v1"

export type Version = { major: number; minor: number; raw: string }

export type Negotiation = { ok: true; version: Version } | { ok: false; required: string; got: string }

export function parseVersion(raw: string): Version | undefined {
  const match = /^(\d+)\.(\d+)$/.exec(raw)
  if (!match) return undefined
  return { major: Number(match[1]), minor: Number(match[2]), raw }
}

export function negotiate(got: string, supported = PROTOCOL_VERSION): Negotiation {
  const client = parseVersion(got)
  const bridge = parseVersion(supported)
  if (!client || !bridge) return { ok: false, required: supported, got }
  if (client.major !== bridge.major) return { ok: false, required: supported, got }
  if (client.minor > bridge.minor) return { ok: false, required: supported, got }
  return { ok: true, version: client }
}
