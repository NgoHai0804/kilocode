let saves = 0

export function start(port = Number(process.env.PORT ?? 3000)) {
  saves = 0
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/") return Response.redirect(`${url.origin}/login`, 302)
      if (url.pathname === "/login") return new Response(loginPage(), { headers: { "Content-Type": "text/html; charset=utf-8" } })
      if (url.pathname === "/api/save" && request.method === "POST") {
        saves += 1
        if (saves === 1) {
          return Response.json({ error: "internal error", attempt: saves }, { status: 500 })
        }
        return Response.json({ ok: true, attempt: saves })
      }
      if (url.pathname === "/api/reset" && request.method === "POST") {
        saves = 0
        return Response.json({ ok: true })
      }
      return new Response("not found", { status: 404 })
    },
  })
  return server
}

function loginPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Login</title>
</head>
<body>
  <main>
    <h1>Sign in</h1>
    <form data-testid="login" id="login">
      <label>Email <input name="email" type="email" value="dev@example.com" autocomplete="username" /></label>
      <label>Password <input name="password" type="password" value="hunter2" autocomplete="current-password" /></label>
      <button id="save" type="submit">Save</button>
    </form>
    <p id="status" role="status"></p>
  </main>
  <script>
    const form = document.getElementById("login")
    const button = document.getElementById("save")
    const status = document.getElementById("status")
    form.addEventListener("submit", async (event) => {
      event.preventDefault()
      button.disabled = true
      status.textContent = "Saving..."
      try {
        const response = await fetch("/api/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: form.email.value }),
        })
        if (!response.ok) throw new Error("save failed with " + response.status)
        status.textContent = "Saved"
      } catch (error) {
        console.error("Failed to save:", error.message)
        status.textContent = "Save failed"
      } finally {
        button.disabled = false
      }
    })
  </script>
</body>
</html>`
}

if (import.meta.main) {
  const server = start()
  console.log(`fixture app listening on http://127.0.0.1:${server.port}/login`)
}

