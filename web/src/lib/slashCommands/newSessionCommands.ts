import type { SlashCommand } from "./types";

/**
 * The new-session composer's built-in commands: none yet. The main chat's
 * built-ins act on a session, and this composer has none. Skills still
 * complete here, and the first message can invoke one.
 */
export const NEW_SESSION_COMMANDS: readonly SlashCommand<unknown, unknown>[] = [];
