/**
 * Session controls: requests the runner carries out on a session instead of
 * passing a message to its agent, such as compacting or clearing its context.
 * The server reports which harness supports which control in `/v1/harnesses`
 * (`session_controls`), from the same table its runner dispatches by, so the
 * composer offers a control exactly where it would work.
 */

/** harness id → the controls its runner carries out, e.g. `["compact", "clear"]`. */
export type SessionControlsByHarness = Readonly<Record<string, readonly string[]>>;

export const NO_SESSION_CONTROLS: readonly string[] = [];

/**
 * What a server that predates the `session_controls` report handles. Used for
 * those servers and until the catalog loads. Frozen: a newer server reports
 * its own table, so support added later never needs an entry here.
 */
export const LEGACY_SESSION_CONTROLS: SessionControlsByHarness = {
  "claude-native": ["compact", "clear"],
  "codex-native": ["compact", "clear"],
  "claude-sdk": ["compact", "clear"],
  "opencode-native": ["compact"],
  "cursor-native": ["compact"],
  "pi-native": ["compact"],
  "hermes-native": ["compact"],
  "qwen-native": ["compact"],
  "devin-native": ["compact"],
};

/**
 * Read `/v1/harnesses` `session_controls`, dropping anything malformed.
 *
 * @returns The reported table, or null when the server reports none.
 */
export function parseSessionControls(wire: unknown): SessionControlsByHarness | null {
  if (wire === null || typeof wire !== "object" || Array.isArray(wire)) return null;
  const controls: Record<string, readonly string[]> = {};
  for (const [harness, names] of Object.entries(wire)) {
    if (!Array.isArray(names)) continue;
    controls[harness] = names.filter((name): name is string => typeof name === "string");
  }
  return controls;
}
