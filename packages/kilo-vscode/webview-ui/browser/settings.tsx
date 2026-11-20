import "@kilocode/kilo-ui/styles"
import { render } from "solid-js/web"
import { BrowserRoot } from "./BrowserRoot"

const root = document.getElementById("root")
if (!root) {
  throw new Error("Root element not found")
}

const tab = new URLSearchParams(window.location.search).get("tab") ?? undefined

render(() => <BrowserRoot initialView="settings" initialSettingsTab={tab} />, root)
