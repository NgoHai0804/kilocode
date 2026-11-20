// The VS Code extension renders the shared webview with the `kilo-vscode`
// theme, where `vscode-bridge.css` maps design tokens to the editor's
// `--vscode-*` variables. The standalone browser has no editor to inject those
// variables, so we install the matching VS Code default theme (Dark Modern /
// Light Modern) ourselves to keep the UI byte-for-byte close to the extension.
import { VSCODE_THEMES } from "../../../kilo-ui/src/stories/vscode-themes"
import { WEBVIEW_BASE_STYLES } from "../../src/shared/webview-base-styles"

export const BROWSER_THEME = "kilo-vscode"

const STYLE_ID = "kilo-vscode-vars"
const COLOR_SCHEME_KEY = "opencode-color-scheme"

// The curated VS Code theme data only covers the variables used by
// `vscode-bridge.css` and `globals.css`. The VS Code webview styles also read a
// few more without a fallback; supply the built-in Dark Modern / Light Modern
// values so those rules never resolve to an invalid custom property.
const SUPPLEMENT: Record<"dark" | "light", Record<string, string>> = {
  dark: {
    "--vscode-badge-background": "#616161",
    "--vscode-badge-foreground": "#F8F8F8",
    "--vscode-button-secondaryForeground": "#CCCCCC",
    "--vscode-dropdown-background": "#313131",
    "--vscode-dropdown-border": "#3C3C3C",
    "--vscode-dropdown-foreground": "#CCCCCC",
    "--vscode-editorWarning-foreground": "#CCA700",
    "--vscode-editorWidget-foreground": "#CCCCCC",
    "--vscode-errorForeground": "#F85149",
    "--vscode-input-border": "#3C3C3C",
    "--vscode-input-foreground": "#CCCCCC",
    "--vscode-inputValidation-infoBackground": "#063B49",
    "--vscode-list-highlightForeground": "#2AAAFF",
    "--vscode-panel-background": "#181818",
    "--vscode-textCodeBlock-background": "#2B2B2B",
    "--vscode-textLink-activeForeground": "#4DAAFC",
  },
  light: {
    "--vscode-badge-background": "#CCCCCC",
    "--vscode-badge-foreground": "#3B3B3B",
    "--vscode-button-secondaryForeground": "#3B3B3B",
    "--vscode-dropdown-background": "#FFFFFF",
    "--vscode-dropdown-border": "#CECECE",
    "--vscode-dropdown-foreground": "#3B3B3B",
    "--vscode-editorWarning-foreground": "#BF8803",
    "--vscode-editorWidget-foreground": "#3B3B3B",
    "--vscode-errorForeground": "#F85149",
    "--vscode-input-border": "#CECECE",
    "--vscode-input-foreground": "#3B3B3B",
    "--vscode-inputValidation-infoBackground": "#D6ECF2",
    "--vscode-list-highlightForeground": "#0066BF",
    "--vscode-panel-background": "#F8F8F8",
    "--vscode-textCodeBlock-background": "#E8E8E8",
    "--vscode-textLink-activeForeground": "#0066BF",
  },
}

export function installVscodeTheme() {
  const theme = VSCODE_THEMES[resolveVscodeThemeId()] ?? VSCODE_THEMES["dark-modern"]
  if (!theme) return

  const vars = { ...SUPPLEMENT[theme.colorScheme], ...theme.vars }
  const style = ensureStyle()
  style.textContent = [
    `:root {\n${Object.entries(vars)
      .map(([name, value]) => `  ${name}: ${value};`)
      .join("\n")}\n}`,
    // Base document styling the VS Code host injects into every webview. Shared
    // with the host via packages/kilo-vscode/src/shared/webview-base-styles.ts so
    // the standalone browser renders identically. Without it the page has a
    // default body margin, no full-height chain for `.container` (so the chat
    // composer floats up), and invisible default text colors.
    WEBVIEW_BASE_STYLES,
    // The sidebar webview pins the layout to the viewport (utils.ts extraStyles).
    `.container {
  height: 100vh;
}`,
  ].join("\n")

  document.documentElement.dataset.theme = BROWSER_THEME
  document.documentElement.dataset.colorScheme = theme.colorScheme
  document.body?.classList.remove("vscode-dark", "vscode-light", "vscode-high-contrast", "vscode-high-contrast-light")
  document.body?.classList.add(theme.colorScheme === "light" ? "vscode-light" : "vscode-dark")
}

// Mirror the theme provider's resolution (saved scheme, then OS preference) so
// the seeded `--vscode-*` variables and the JSON theme variant agree.
function resolveVscodeThemeId() {
  const saved = readSavedScheme()
  if (saved === "dark") return "dark-modern"
  if (saved === "light") return "light-modern"
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark-modern" : "light-modern"
}

function readSavedScheme() {
  try {
    return localStorage.getItem(COLOR_SCHEME_KEY)
  } catch {
    return null
  }
}

function ensureStyle(): HTMLStyleElement {
  const existing = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (existing) return existing
  const style = document.createElement("style")
  style.id = STYLE_ID
  document.head.appendChild(style)
  return style
}
