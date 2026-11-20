import { test, expect } from "bun:test"
import { KiloClient, type BridgeEvent } from "../../../src/bridge/kilo"
import { supervisorEndpointHook } from "../../../src/cli"

/** A real local Kilo stand-in so requests and SSE are exercised over HTTP. */
function kilo(label: string) {
  const paths: string[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname
      paths.push(path)
      if (path === "/global/health") return Response.json({ ok: true, server: label })
      if (path === "/global/event") {
        const encoder = new TextEncoder()
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const frame = `data: ${JSON.stringify({
              id: "1",
              type: "session.status",
              properties: { sessionID: label, status: "busy" },
            })}\n\n`
            controller.enqueue(encoder.encode(frame))
          },
        })
        return new Response(stream, { headers: { "Content-Type": "text/event-stream" } })
      }
      return Response.json({ ok: true })
    },
  })
  return { server, url: `http://127.0.0.1:${server.port}`, paths }
}

function sessionOf(event: BridgeEvent) {
  const data = event.data
  return typeof data === "object" && data !== null && "sessionID" in data
    ? (data as { sessionID?: unknown }).sessionID
    : undefined
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await Bun.sleep(20)
  }
  throw new Error("condition timed out")
}

test("a supervised restart retargets the client and resubscribes SSE", async () => {
  const first = kilo("first")
  const second = kilo("second")
  const client = new KiloClient(first.url, { username: "kilo", password: "pw" })
  const events: BridgeEvent[] = []
  const stop = client.startEvents((event) => events.push(event))
  // Mirrors how cli.ts wires Supervisor.onReady -> KiloClient.setEndpoint.
  const hook = supervisorEndpointHook(() => client)
  try {
    await waitFor(() => events.some((event) => sessionOf(event) === "first"))
    expect(client.url).toBe(first.url)

    // Fake supervisor emits a second URL after a restart.
    hook({ url: second.url })
    expect(client.url).toBe(second.url)

    await waitFor(() => events.some((event) => sessionOf(event) === "second"))
    expect(second.paths).toContain("/global/event")
    expect(await client.healthy()).toBe(true)
    expect(second.paths).toContain("/global/health")
  } finally {
    stop()
    await client.stop()
    first.server.stop(true)
    second.server.stop(true)
  }
})