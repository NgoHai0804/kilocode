import { noTarget } from "../rpc/failure"
import { record, text } from "../util/value"
import type { ToolContext } from "./context"

/** Trim a string to a byte-ish budget and report whether it was cut. */
export function clip(value: string, maxBytes: number) {
  if (value.length <= maxBytes) return { value, truncated: false }
  return { value: value.slice(0, maxBytes), truncated: true }
}

/**
 * Run a fixed helper function against a resolved node object.
 *
 * Arguments travel as `{ value }` entries, so agent-provided strings are passed
 * as data and never interpolated into the function source.
 */
export async function callObject(
  ctx: ToolContext,
  objectId: string,
  fn: string,
  args: unknown[] = [],
): Promise<unknown> {
  const result = await ctx.session.send("Runtime.callFunctionOn", {
    objectId,
    functionDeclaration: fn,
    arguments: args.map((value) => ({ value })),
    returnByValue: true,
    awaitPromise: false,
  })
  if (record(result.exceptionDetails)) throw noTarget("script_failed")
  return record(result.result)?.value
}

/** Object id of the page `document`, used as the root for page-wide queries. */
export async function documentObject(ctx: ToolContext): Promise<string> {
  const result = await ctx.session.send("Runtime.evaluate", {
    expression: "document",
    returnByValue: false,
    awaitPromise: false,
  })
  const id = text(record(result.result)?.objectId)
  if (!id) throw noTarget("no_document")
  return id
}

export async function pageText(ctx: ToolContext): Promise<string> {
  const result = await ctx.session.send("Runtime.evaluate", {
    expression: "document.body ? document.body.innerText : ''",
    returnByValue: true,
    awaitPromise: false,
  })
  const value = record(result.result)?.value
  return typeof value === "string" ? value : ""
}

export const TEXT_FN = `function () { return (this.innerText || this.textContent || "").replace(/\\n{3,}/g, "\\n\\n").trim() }`

export const HTML_FN = `function () { return this.outerHTML }`

export const ATTRS_FN = `function () {
  var out = {};
  var attrs = this.attributes || [];
  for (var i = 0; i < attrs.length; i += 1) out[attrs[i].name] = attrs[i].value;
  return {
    tag: this.tagName.toLowerCase(),
    attributes: out,
    value: this.value === undefined ? undefined : String(this.value),
    checked: this.checked === true,
    disabled: this.disabled === true,
    readOnly: this.readOnly === true,
    text: (this.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 300)
  }
}`

export const SCROLL_BLOCK_FN = `function (args) {
  this.scrollIntoView({ block: (args && args.block) || "center", inline: "nearest" });
  return true
}`

export const PAGE_SCROLL_FN = `function (args) {
  var direction = (args && args.direction) || "down";
  var amount = (args && args.amount) || 400;
  if (direction === "top") window.scrollTo(0, 0);
  else if (direction === "bottom") window.scrollTo(0, document.body ? document.body.scrollHeight : 0);
  else if (direction === "up") window.scrollBy(0, -Math.abs(amount));
  else window.scrollBy(0, Math.abs(amount));
  return { x: window.scrollX, y: window.scrollY }
}`

export const SELECT_FN = `function (args) {
  var options = this.options || [];
  var index = this.selectedIndex;
  if (args && args.index !== undefined && args.index !== null) index = args.index | 0;
  else if (args && args.value !== undefined && args.value !== null) {
    index = -1;
    var want = String(args.value);
    for (var i = 0; i < options.length; i += 1) if (options[i].value === want) { index = i; break }
  } else if (args && args.label !== undefined && args.label !== null) {
    index = -1;
    var label = String(args.label);
    for (var j = 0; j < options.length; j += 1) if ((options[j].text || "").trim() === label) { index = j; break }
  }
  if (index < 0 || index >= options.length) return { ok: false };
  this.selectedIndex = index;
  this.dispatchEvent(new Event("input", { bubbles: true }));
  this.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, value: this.value, label: (options[index] && options[index].text) || "" }
}`

export const FILL_FN = `function (args) {
  var value = args && args.value != null ? String(args.value) : "";
  var el = this;
  if (el.isContentEditable) {
    el.focus();
    el.textContent = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: el.textContent || "" }
  }
  var proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  var desc = Object.getOwnPropertyDescriptor(proto, "value");
  if (desc && desc.set) desc.set.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, value: el.value }
}`

export const FIND_FN = `function (args) {
  var selector = args && args.selector ? String(args.selector) : "";
  var role = args && args.role ? String(args.role) : "";
  var needle = args && args.text ? String(args.text).toLowerCase() : "";
  var limit = args && args.limit ? args.limit : 40;
  function norm(value) { return (value || "").replace(/\\s+/g, " ").trim() }
  function pathOf(el) {
    var parts = [];
    var node = el;
    var guard = 0;
    while (node && node.nodeType === 1 && parts.length < 8 && guard < 10) {
      guard += 1;
      var sel = node.tagName.toLowerCase();
      if (node.id) { parts.unshift(sel + "#" + node.id); break }
      var parent = node.parentElement;
      if (parent) {
        var sames = [];
        var kids = parent.children;
        for (var i = 0; i < kids.length; i += 1) if (kids[i].tagName === node.tagName) sames.push(kids[i]);
        if (sames.length > 1) sel += ":nth-of-type(" + (sames.indexOf(node) + 1) + ")";
      }
      parts.unshift(sel);
      node = parent;
    }
    return parts.join(" > ");
  }
  var pool;
  if (selector) { try { pool = document.querySelectorAll(selector) } catch (err) { pool = [] } }
  else if (role) { pool = document.querySelectorAll("[role]") }
  else { pool = document.querySelectorAll("a,button,input,select,textarea,[role],[onclick],[tabindex]") }
  var out = [];
  for (var j = 0; j < pool.length && out.length < limit; j += 1) {
    var el = pool[j];
    if (role && (el.getAttribute("role") || "") !== role) continue;
    var label = norm(el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.value || el.innerText || el.textContent || "");
    if (needle && label.toLowerCase().indexOf(needle) < 0) continue;
    var path = pathOf(el);
    if (!path) continue;
    out.push({ tag: el.tagName.toLowerCase(), role: el.getAttribute("role") || "", name: label.slice(0, 140), selector: path });
  }
  return out;
}`
