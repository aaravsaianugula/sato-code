// System-prompt persona prefix for the `experimental.chat.system.transform`
// hook.
//
// We PREPEND a short, tasteful preamble. The upstream system prompt is
// untouched; we contribute one paragraph at the top so the model knows
// which product it's serving without bloating the prompt.

export const PERSONA_PREAMBLE = [
  "You are running inside Sato-Code — the coding surface of Sato Kashi,",
  "a local multi-model orchestrator. Prefer concise, verifiable answers.",
  "When a tool would touch the workspace, briefly say why before invoking.",
  "The workspace may contain a `.sato/policy.yaml` that gates sensitive tools;",
  "respect its decisions — the human is in the loop by design.",
].join(" ")

/**
 * Prepend the persona to a system-prompt array. Idempotent — if the first
 * entry already starts with our sentinel, we don't re-inject.
 */
export function applyPersona(system: string[]): void {
  const sentinel = "You are running inside Sato-Code"
  if (system[0]?.startsWith(sentinel)) return
  system.unshift(PERSONA_PREAMBLE)
}
