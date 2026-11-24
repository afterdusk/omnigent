/**
 * A side chat's built-in commands, in menu order.
 *
 * Only `/help`: the main chat's other built-ins act on the main session, so a
 * side chat leaves them out. A side chat on a native terminal runs none at
 * all, since the vendor CLI reads slash text itself.
 */
import { type HelpComposer, helpCommand } from "./helpCommand";
import type { SlashCommand } from "./types";

export type SideChatCommandComposer = HelpComposer;
export type SideChatCommand = SlashCommand<unknown, SideChatCommandComposer>;

export const SIDE_CHAT_COMMANDS: readonly SideChatCommand[] = [
  // A side chat runs a built-in only as typed, and its menu never shows a
  // skill in place of one: that skill could not run from the start of a message.
  { ...helpCommand, caseSensitive: () => true, claimsSkillName: true },
];
