import { run } from "../mcp"

run().catch((err: unknown) => {
  process.stderr.write(`kilo-browser-mcp: ${err instanceof Error ? err.message : "failed"}\n`)
  process.exit(1)
})
