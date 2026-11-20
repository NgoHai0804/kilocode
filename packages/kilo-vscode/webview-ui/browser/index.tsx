import "@kilocode/kilo-ui/styles"
import { render } from "solid-js/web"
import { BrowserRoot } from "./BrowserRoot"

const root = document.getElementById("root")
if (!root) {
  throw new Error("Root element not found")
}

render(() => <BrowserRoot theme="kilo" />, root)
