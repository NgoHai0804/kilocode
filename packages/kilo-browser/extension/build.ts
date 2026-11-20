import path from "node:path"
import { cp, copyFile, mkdir, rm, stat } from "node:fs/promises"

const root = import.meta.dir
const out = path.join(root, "dist")
const uiOut = path.join(out, "ui-dist")
const staging = path.join(root, ".ui-dist-stage")

const UI_PAGES = ["sidepanel.html", "settings.html", "file.html", "diff.html"]

async function exists(target: string) {
  try {
    await stat(target)
    return true
  } catch (err) {
    const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined
    if (code === "ENOENT") return false
    throw err
  }
}

// `build:ui` (run first by the `build:extension` script) writes the Vite bundle
// to `dist/ui-dist`. The service-worker build below recreates `dist/`, so stash
// the UI bundle and restore it afterwards instead of reading a path Vite never
// writes.
if (!(await exists(uiOut))) {
  console.error(`UI bundle missing at ${path.relative(root, uiOut)}; run "bun run build:ui" first (build:extension does it automatically)`)
  process.exit(1)
}

await rm(staging, { recursive: true, force: true })
await cp(uiOut, staging, { recursive: true })

await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })

const result = await Bun.build({
  entrypoints: [path.join(root, "src/background/service-worker.ts")],
  outdir: out,
  target: "browser",
  format: "esm",
  naming: "[name].js",
  sourcemap: "none",
  minify: false,
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

for (const file of ["manifest.json", "sidepanel.html", "settings.html"]) {
  await copyFile(path.join(root, file), path.join(out, file))
}

await cp(staging, uiOut, { recursive: true })
await rm(staging, { recursive: true, force: true })

const missing: string[] = []
for (const page of UI_PAGES) {
  if (!(await exists(path.join(uiOut, page)))) missing.push(page)
}
if (missing.length > 0) {
  console.error(`UI bundle incomplete under ${path.relative(root, uiOut)}; missing: ${missing.join(", ")}`)
  process.exit(1)
}

console.log(`extension built to ${out}`)
