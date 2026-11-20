import path from "node:path"
import { mkdir, rm } from "node:fs/promises"

/**
 * Package build: bridge + CLI + MCP shim + guard plugin into `dist/`.
 *
 * No fixed ports or machine-specific paths. Fails non-zero when any bundle
 * fails so `bun run build` is a reliable release gate.
 */

const root = import.meta.dir
const dist = path.join(root, "dist")

const entrypoints = [
  path.join(root, "src/index.ts"),
  path.join(root, "src/cli.ts"),
  path.join(root, "src/mcp/main.ts"),
  path.join(root, "src/plugin/kilo-browser-guard.ts"),
]

const manifest = (await Bun.file(path.join(root, "package.json")).json()) as {
  name?: string
  version?: string
}

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })

const result = await Bun.build({
  entrypoints,
  outdir: dist,
  root: path.join(root, "src"),
  target: "bun",
  format: "esm",
  naming: "[dir]/[name].js",
  sourcemap: "none",
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

const outputs = result.outputs.map((output) => path.relative(root, output.path).split(path.sep).join("/"))
const required = ["dist/index.js", "dist/cli.js", "dist/mcp/main.js", "dist/plugin/kilo-browser-guard.js"]
const missing = required.filter((file) => !outputs.includes(file))
if (missing.length > 0) {
  console.error(`build produced unexpected outputs; missing: ${missing.join(", ")}`)
  console.error(`got: ${outputs.join(", ")}`)
  process.exit(1)
}

await Bun.write(
  path.join(dist, "version.json"),
  `${JSON.stringify({ name: manifest.name ?? "@kilocode/kilo-browser", version: manifest.version ?? "0.0.0" }, null, 2)}\n`,
)

console.log(`built ${outputs.length} files to ${path.relative(root, dist)}`)
