// Sato-Code web UI: reuses upstream @opencode-ai/app's vite plugin stack
// (tailwind, solid, theme-preload transform), but adds our own index.html
// (Sato title + favicon), a merged publicDir (upstream app/public + our
// public/), and a data-theme="sato-dark" default so the Ember skin paints
// on first render before localStorage-driven preload can run.
//
// Output: packages/sato-app/dist — build-sato.sh copies this over
// packages/app/dist so the CLI's createEmbeddedWebUIBundle() picks it up.
import { defineConfig, type Plugin } from "vite"
import appPlugin from "@opencode-ai/app/vite"
import { fileURLToPath } from "node:url"
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const here = fileURLToPath(new URL(".", import.meta.url))
const appPublic = fileURLToPath(new URL("../app/public", import.meta.url))
const themePreload = fileURLToPath(new URL("../app/public/oc-theme-preload.js", import.meta.url))

// Emit every file under upstream app/public that isn't already provided by
// our own public/ dir (which vite already copies via publicDir).
function mergeAppPublic(): Plugin {
  const walk = (dir: string, out: string[] = []) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name)
      if (statSync(abs).isDirectory()) walk(abs, out)
      else out.push(abs)
    }
    return out
  }
  return {
    name: "sato:merge-app-public",
    apply: "build",
    generateBundle() {
      if (!existsSync(appPublic)) return
      const ownPublic = join(here, "public")
      for (const abs of walk(appPublic)) {
        const rel = relative(appPublic, abs).replaceAll("\\", "/")
        // Don't overwrite files provided by our own public/ (e.g. sato-favicon.svg).
        if (existsSync(join(ownPublic, rel))) continue
        this.emitFile({ type: "asset", fileName: rel, source: readFileSync(abs) })
      }
    },
  }
}

export default defineConfig({
  plugins: [
    {
      // Runs BEFORE @opencode-ai/app's own theme-preload transform (which is
      // a literal-string replace of `<script id="oc-theme-preload-script" src=
      // "/oc-theme-preload.js"></script>`). We replace that same tag first
      // with a Sato-defaulting inline script; upstream's plugin then finds
      // nothing to match and skips.
      //
      // First-launch behaviour: no `opencode-theme-id` in localStorage →
      // theme id defaults to "sato-dark" (users can still pick opencode themes
      // via /theme later — we only change the FIRST-LAUNCH default).
      name: "sato:theme-preload",
      enforce: "pre",
      transformIndexHtml(html) {
        // Fail LOUDLY if either target string moves upstream — a silent
        // .replace() miss would ship an un-skinned first paint (still
        // "oc-2" default) or leave upstream's preload tag in place.
        // Better to break the build so the sync PR flags it.
        const preloadRaw = readFileSync(themePreload, "utf8")
        const defaultTarget = `localStorage.getItem(key) || "oc-2"`
        if (!preloadRaw.includes(defaultTarget)) {
          throw new Error(
            `sato:theme-preload: target '${defaultTarget}' not found in ${themePreload}; upstream oc-theme-preload.js changed — update this transform.`,
          )
        }
        const src = preloadRaw.replace(defaultTarget, `localStorage.getItem(key) || "sato-dark"`)
        const scriptTagTarget = `<script id="oc-theme-preload-script" src="/oc-theme-preload.js"></script>`
        if (!html.includes(scriptTagTarget)) {
          throw new Error(
            `sato:theme-preload: target '${scriptTagTarget}' not found in index.html; the wrapper's index.html or upstream tag changed — update this transform.`,
          )
        }
        return html.replace(scriptTagTarget, `<script id="oc-theme-preload-script">${src}</script>`)
      },
    },
    ...(appPlugin as Plugin[]),
    mergeAppPublic(),
  ],
  publicDir: join(here, "public"),
  root: here,
  build: {
    target: "esnext",
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
  },
})
