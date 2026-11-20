import type { DebuggerApi, DebuggerSource } from "../cdp/types"
import type { StorageArea } from "../storage/store"
import type { Socket } from "../transport/ws"
import { WS_SUBPROTOCOL } from "../../../src/protocol/version"

export const storage: StorageArea = {
  get(keys) {
    return chrome.storage.local.get(keys ?? null)
  },
  set(items) {
    return chrome.storage.local.set(items)
  },
  remove(keys) {
    return chrome.storage.local.remove(keys)
  },
}

export const debuggerApi: DebuggerApi = {
  attach(target, version) {
    return chrome.debugger.attach({ tabId: target.tabId }, version)
  },
  detach(target) {
    return chrome.debugger.detach({ tabId: target.tabId })
  },
  sendCommand(target, method, params) {
    return chrome.debugger.sendCommand({ tabId: target.tabId }, method, params)
  },
  getTargets() {
    return chrome.debugger.getTargets()
  },
  onEvent(listener) {
    const handler = (source: ChromeDebuggee, method: string, params?: Record<string, unknown>) => {
      listener(source as DebuggerSource, method, params ?? {})
    }
    chrome.debugger.onEvent.addListener(handler)
    return () => chrome.debugger.onEvent.removeListener(handler)
  },
  onDetach(listener) {
    const handler = (source: ChromeDebuggee, reason: string) => {
      listener(source as DebuggerSource, reason)
    }
    chrome.debugger.onDetach.addListener(handler)
    return () => chrome.debugger.onDetach.removeListener(handler)
  },
}

export function createSocket(url: string): Socket {
  const socket = new WebSocket(url, WS_SUBPROTOCOL)
  return {
    send(data) {
      socket.send(data)
    },
    close(code, reason) {
      socket.close(code, reason)
    },
    onOpen(listener) {
      const handler = () => listener()
      socket.addEventListener("open", handler)
      return () => socket.removeEventListener("open", handler)
    },
    onClose(listener) {
      const handler = (event: CloseEvent) => listener(event.code, event.reason)
      socket.addEventListener("close", handler)
      return () => socket.removeEventListener("close", handler)
    },
    onMessage(listener) {
      const handler = (event: MessageEvent) => {
        if (typeof event.data === "string") listener(event.data)
      }
      socket.addEventListener("message", handler)
      return () => socket.removeEventListener("message", handler)
    },
    onError(listener) {
      const handler = (event: Event) => listener(event)
      socket.addEventListener("error", handler)
      return () => socket.removeEventListener("error", handler)
    },
  }
}

export async function defineAlarm(periodInMinutes: number) {
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes })
}

export const ALARM_NAME = "kilo-browser-keepalive"


