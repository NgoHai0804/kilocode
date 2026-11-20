const page = document.body.dataset.kiloPage

if (page === "settings") {
  await import("@kilo-webview-settings")
} else if (page === "file") {
  await import("@kilo-webview-file")
} else if (page === "diff") {
  await import("@kilo-webview-diff")
} else {
  await import("@kilo-webview-entry")
}