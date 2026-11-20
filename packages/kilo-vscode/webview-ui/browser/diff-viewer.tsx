import "@kilocode/kilo-ui/styles"
import { For, Show, createResource, type Component } from "solid-js"
import { render } from "solid-js/web"
import { ThemeProvider } from "@kilocode/kilo-ui/theme"
import { Diff } from "@kilocode/kilo-ui/diff"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { fetchUiDiff, readDiffPreview, viewerConfig, type UiDiffFile } from "./viewer-api"
import "./viewer.css"

type State =
  | { kind: "ready"; files: UiDiffFile[] }
  | { kind: "unpaired" }
  | { kind: "missing" }
  | { kind: "error"; message: string }

function query(): URLSearchParams {
  return new URLSearchParams(location.search)
}

const DiffViewer: Component = () => {
  const session = () => query().get("session") ?? ""
  const preview = () => query().get("preview") !== null
  const diffStyle = () => (query().get("style") === "split" ? "split" : "unified")

  const [state] = createResource<State>(async () => {
    if (preview()) {
      const files = readDiffPreview()
      return files.length === 0 ? { kind: "missing" } : { kind: "ready", files }
    }
    if (session().length === 0) return { kind: "missing" }
    const config = viewerConfig()
    if (!config) return { kind: "unpaired" }
    const result = await fetchUiDiff(config, session())
    if (!result.ok) return { kind: "error", message: result.message }
    return { kind: "ready", files: result.value }
  })

  return (
    <div data-component="diff-viewer" class="viewer">
      <header class="viewer-header">
        <span class="viewer-path">{session().length > 0 ? `Session ${session()}` : "Diff"}</span>
      </header>
      <div class="viewer-body">
        <Show when={state()} fallback={<div class="viewer-state"><Spinner /> Loading…</div>}>
          {(current) => {
            const value = current()
            if (value.kind === "ready") {
              return (
                <div class="viewer-files">
                  <For each={value.files}>{(file) => <DiffFileView file={file} style={diffStyle()} />}</For>
                </div>
              )
            }
            if (value.kind === "unpaired") {
              return <div class="viewer-state">Not paired with the Kilo bridge. Open the Kilo side panel and pair first.</div>
            }
            if (value.kind === "missing") {
              return <div class="viewer-state">No diff was provided.</div>
            }
            return <div class="viewer-state viewer-error">{value.message}</div>
          }}
        </Show>
      </div>
    </div>
  )
}

const DiffFileView: Component<{ file: UiDiffFile; style: "unified" | "split" }> = (props) => {
  const empty = () => props.file.before.length === 0 && props.file.after.length === 0 && !props.file.patch
  return (
    <div class="viewer-file">
      <div class="viewer-file-path" title={props.file.path}>
        {props.file.path || "file"}
      </div>
      <Show when={!empty()} fallback={<div class="viewer-state">Diff preview unavailable for this file.</div>}>
        <Diff
          before={{ name: props.file.path || "before", contents: props.file.before }}
          after={{ name: props.file.path || "after", contents: props.file.after }}
          patch={props.file.patch}
          diffStyle={props.style}
        />
      </Show>
    </div>
  )
}

const root = document.getElementById("root")
if (!root) throw new Error("Root element not found")
render(
  () => (
    <ThemeProvider defaultTheme="kilo">
      <DiffViewer />
    </ThemeProvider>
  ),
  root,
)