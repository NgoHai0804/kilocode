import type { Json } from "../util/value"
import type { ToolContext } from "./context"
import { noTarget, throwIfAborted } from "../rpc/failure"
import { array, record } from "../util/value"
import { integer, optionalString } from "./params"
import { callObject, documentObject, OUTLINE_FN } from "./dom_ops"

export async function run(params: Json, ctx: ToolContext, signal: AbortSignal): Promise<Json> {
  const selector = optionalString(params.selector, "selector")
  const maxNodes = integer(params.maxNodes, "maxNodes", 120, 10, 400)
  throwIfAborted(signal)

  const doc = await documentObject(ctx)
  const payload: Record<string, unknown> = { maxNodes }
  if (selector !== undefined) payload.selector = selector
  const raw = await callObject(ctx, doc, OUTLINE_FN, [payload])
  throwIfAborted(signal)
  const data = record(raw) ?? {}
  if (data.error === "selector_not_found") throw noTarget("selector_not_found")

  const url = ctx.session.url ?? ""
  return { url, title: ctx.session.title ?? "", ...data, text: render(data, url) }
}

function render(data: Record<string, unknown>, url: string): string {
  const lines: string[] = [`PAGE ${url}`]

  const landmarks = array(data.landmarks)
  if (landmarks.length > 0) {
    lines.push("LANDMARKS")
    for (const item of landmarks) {
      const node = record(item) ?? {}
      const heading = str(node.heading)
      lines.push(`- [${str(node.role)}] ${str(node.name)}${heading ? ` \u2014 ${heading}` : ""} -> ${str(node.selector)}`)
    }
  }

  const headings = array(data.headings)
  if (headings.length > 0) {
    lines.push("HEADINGS")
    for (const item of headings) {
      const node = record(item) ?? {}
      lines.push(`- h${node.level ?? "?"} ${str(node.text)} -> ${str(node.selector)}`)
    }
  }

  const forms = array(data.forms)
  if (forms.length > 0) {
    lines.push("FORMS")
    for (const item of forms) {
      const form = record(item) ?? {}
      lines.push(`- [form] ${str(form.name)} -> ${str(form.selector)}`)
      for (const field of array(form.fields)) {
        const node = record(field) ?? {}
        const type = str(node.type)
        lines.push(`  - ${str(node.role)}${type ? `(${type})` : ""} ${str(node.name)} -> ${str(node.selector)}`)
      }
    }
  }

  const tables = array(data.tables)
  if (tables.length > 0) {
    lines.push("TABLES")
    for (const item of tables) {
      const node = record(item) ?? {}
      lines.push(`- ${str(node.caption)} rows=${node.rows ?? 0} headers=${node.headers ?? 0} -> ${str(node.selector)}`)
    }
  }

  lines.push(`COUNTS buttons=${data.buttons ?? 0} links=${data.links ?? 0} inputs=${data.inputs ?? 0}`)
  return lines.join("\n")
}

function str(value: unknown) {
  return typeof value === "string" ? value : ""
}
