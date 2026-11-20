const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    if (new URL(request.url).pathname === "/global/health") {
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } })
    }
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } })
  },
})

console.log(`kilo server listening on http://127.0.0.1:${server.port}`)