// Sato-Code web-UI entry.
//
// This wrapper is intentionally a THIN shim: it imports the Sato skin CSS
// (which cascades over @opencode-ai/app's index.css) and then defers to
// upstream's entry as-is. There is deliberately no Platform / notify /
// ServerConnection / auth_token / notification-click code here — all of
// that lives in @opencode-ai/app's entry, and mirroring it here would drift
// against upstream's near-daily cadence AND has historically dropped
// behaviors (auth-token URL flow, notification.onclick routing, real
// package version). Instead we import the same entry the upstream web
// build uses, so behavior stays identical by construction.
//
// The `data-theme="sato-dark"` default + Sato title/favicon are set in
// index.html (before this module runs), and the theme-preload default
// is rewritten by the vite plugin in vite.config.ts.
//
// Requires sato-patches/0003 (adds "./entry" to @opencode-ai/app's
// package.json exports).
import "./index.css"
import "@opencode-ai/app/entry"
