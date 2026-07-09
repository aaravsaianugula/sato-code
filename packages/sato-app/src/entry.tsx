// Sato-Code web-UI entry.
//
// Mirrors packages/app/src/entry.tsx (the upstream web entry) but:
//   - imports the Sato Ember skin CSS after the app's own CSS so its
//     custom-property overrides win the cascade;
//   - keeps the same platform/server wiring so behaviour matches upstream.
//
// The `data-theme="sato-dark"` on <html> is set in index.html, before this
// module loads, so the first paint is already ember-tinted.

import "./index.css"
import { render } from "solid-js/web"
import {
  AppBaseProviders,
  AppInterface,
  type Platform,
  PlatformProvider,
  ServerConnection,
} from "@opencode-ai/app"

const DEFAULT_SERVER_URL_KEY = "opencode.settings.dat:defaultServerUrl"

const getStorage = (key: string) => {
  if (typeof localStorage === "undefined") return null
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const setStorage = (key: string, value: string | null) => {
  if (typeof localStorage === "undefined") return
  try {
    if (value !== null) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    return
  }
}
const readDefaultServerUrl = () => getStorage(DEFAULT_SERVER_URL_KEY)
const writeDefaultServerUrl = (url: string | null) => setStorage(DEFAULT_SERVER_URL_KEY, url)

const notify: Platform["notify"] = async (title, description) => {
  if (!("Notification" in window)) return
  const permission =
    Notification.permission === "default"
      ? await Notification.requestPermission().catch(() => "denied")
      : Notification.permission
  if (permission !== "granted") return
  const inView = document.visibilityState === "visible" && document.hasFocus()
  if (inView) return
  new Notification(title, { body: description ?? "" })
}

const platform: Platform = {
  platform: "web",
  version: "sato",
  openLink: (url) => window.open(url, "_blank"),
  back: () => window.history.back(),
  forward: () => window.history.forward(),
  restart: async () => window.location.reload(),
  notify,
  getDefaultServer: async () => {
    const stored = readDefaultServerUrl()
    return stored ? ServerConnection.Key.make(stored) : null
  },
  setDefaultServer: writeDefaultServerUrl,
}

const getCurrentUrl = () => {
  if (import.meta.env.DEV)
    return `http://${import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "localhost"}:${import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`
  return location.origin
}
const getDefaultUrl = () => readDefaultServerUrl() ?? getCurrentUrl()

const root = document.getElementById("root")
if (root instanceof HTMLElement) {
  const server: ServerConnection.Http = {
    type: "http",
    authToken: false,
    http: { url: getCurrentUrl() },
  }
  render(
    () => (
      <PlatformProvider value={platform}>
        <AppBaseProviders>
          <AppInterface
            defaultServer={ServerConnection.Key.make(getDefaultUrl())}
            canonicalLocalServer={ServerConnection.key(server)}
            servers={[server]}
            disableHealthCheck
          />
        </AppBaseProviders>
      </PlatformProvider>
    ),
    root,
  )
}
