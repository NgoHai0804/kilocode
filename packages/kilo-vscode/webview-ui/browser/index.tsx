import "@kilocode/kilo-ui/styles"
import { render } from "solid-js/web"
import { BrowserRoot } from "./BrowserRoot"
import { installVscodeTheme } from "./vscode-theme"

const root = document.getElementById("root")
if (!root) {
  throw new Error("Root element not found")
}

installVscodeTheme()

render(() => <BrowserRoot />, root)
