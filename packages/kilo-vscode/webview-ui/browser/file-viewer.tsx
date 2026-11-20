import "@kilocode/kilo-ui/styles"
import { Show, createResource, type Component } from "solid-js"
import { render } from "solid-js/web"
import { ThemeProvider } from "@kilocode/kilo-ui/theme"
import { File } from "@kilocode/kilo-ui/file"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { fetchUiFile, viewerConfig, type UiFile } from "./viewer-api"
import "./viewer.css"

type State =
  | { kind: "ready"; file: UiFile }
  | { kind: "unpaired" }
  | { kind: "missing" }
  | { kind: "error"; message: string }

function query(): URLSearchParams {
  return new URLSearchParams(location.search)
}

const FileViewer: Component = () => {
  const path = () => query().get("path") ?? ""
  const session = () => query().get("session") ?? undefined

  const [state] = createResource<State>(async () => {
    const target = path()
    if (target.length === 0) return { kind: "missing" }
    const config = viewerConfig()
    if (!config) return { kind: "unpaired" }
    const result = await fetchUiFile(config, target, session())
    if (!result.ok) return { kind: "error", message: result.message }
    return { kind: "ready", file: result.value }
  })

  const truncated = () => {
    const value = state()
    return value?.kind === "ready" ? value.file.truncated : false
  }

  return (
    <div data-component="file-viewer" class="viewer">
      <header class="viewer-header">
        <span class="viewer-path" title={path()}>
          {path() || "File"}
        </span>
        <Show when={truncated()}>
          <span class="viewer-note">truncated</span>
        </Show>
      </header>
      <div class="viewer-body">
        <Show when={state()} fallback={<div class="viewer-state"><Spinner /> Loading…</div>}>
          {(current) => {
            const value = current()
            if (value.kind === "ready") {
              return <File mode="text" file={{ name: value.file.path || "file", contents: value.file.text }} />
            }
            if (value.kind === "unpaired") {
              return <div class="viewer-state">Not paired with the Kilo bridge. Open the Kilo side panel and pair first.</div>
            }
            if (value.kind === "missing") {
              return <div class="viewer-state">No file path was provided.</div>
            }
            return <div class="viewer-state viewer-error">{value.message}</div>
          }}
        </Show>
      </div>
    </div>
  )
}

const root = document.getElementById("root")
if (!root) throw new Error("Root element not found")
render(
  () => (
    <ThemeProvider defaultTheme="kilo">
      <FileViewer />
    </ThemeProvider>
  ),
  root,
)