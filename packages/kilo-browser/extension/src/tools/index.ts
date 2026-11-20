import type { Router } from "../rpc/router"
import type { ToolContext } from "./context"
import * as status from "./status"
import * as tabs from "./tabs"
import * as switchTab from "./switch_tab"
import * as navigate from "./navigate"
import * as snapshot from "./snapshot"
import * as screenshot from "./screenshot"
import * as console from "./console"
import * as network from "./network"
import * as click from "./click"
import * as type from "./type"
import * as press from "./press"
import * as reload from "./reload"
import * as waitFor from "./wait_for"
import * as evaluate from "./eval"

export function registerTools(router: Router, ctx: ToolContext) {
  router.register("browser.status", (params, signal) => status.run(params, ctx, signal), {
    timeoutMs: 2000,
    idempotent: true,
  })
  router.register("browser.tabs", (params, signal) => tabs.run(params, ctx, signal), { timeoutMs: 5000 })
  router.register("browser.switch_tab", (params, signal) => switchTab.run(params, ctx, signal), { timeoutMs: 15000 })
  router.register("browser.navigate", (params, signal) => navigate.run(params, ctx, signal), { timeoutMs: 15000 })
  router.register("browser.snapshot", (params, signal) => snapshot.run(params, ctx, signal), {
    timeoutMs: 5000,
    idempotent: true,
  })
  router.register("browser.screenshot", (params, signal) => screenshot.run(params, ctx, signal), { timeoutMs: 10000 })
  router.register("browser.console", (params, signal) => console.run(params, ctx, signal), {
    timeoutMs: 3000,
    idempotent: true,
  })
  router.register("browser.network", (params, signal) => network.run(params, ctx, signal), {
    timeoutMs: 5000,
    idempotent: true,
  })
  router.register("browser.click", (params, signal) => click.run(params, ctx, signal), { timeoutMs: 5000 })
  router.register("browser.type", (params, signal) => type.run(params, ctx, signal), { timeoutMs: 8000 })
  router.register("browser.press", (params, signal) => press.run(params, ctx, signal), { timeoutMs: 3000 })
  router.register("browser.reload", (params, signal) => reload.run(params, ctx, signal), { timeoutMs: 15000 })
  router.register("browser.wait_for", (params, signal) => waitFor.run(params, ctx, signal), {
    timeoutMs: 30000,
    idempotent: true,
  })
  router.register("browser.eval", (params, signal) => evaluate.run(params, ctx, signal), { timeoutMs: 10000 })
}