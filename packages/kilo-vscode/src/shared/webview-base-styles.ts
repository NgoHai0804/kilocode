/**
 * Base document styles the VS Code host injects into every webview. Shared with
 * the standalone browser surface so it renders identically.
 */
export const WEBVIEW_BASE_STYLES = `html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  overflow: hidden;
}
body {
  background-color: var(--vscode-sideBar-background, var(--vscode-editor-background));
  color: var(--vscode-foreground);
  font-family: var(--vscode-font-family);
}
#root {
  height: 100%;
}`
