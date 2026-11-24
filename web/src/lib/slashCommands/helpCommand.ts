import { formatCommandListing } from "./catalog";
import type { SlashCommand } from "./types";

/** What `/help` needs from the composer it runs in. */
export interface HelpComposer {
  /** The menu this composer offers, as `/help` lists it. */
  commands: Readonly<Record<string, string>>;
  /** Shows text under the composer; null clears it. */
  showNotice: (text: string | null) => void;
}

/** Lists what the composer offers. Shared by every surface that can show a notice. */
export const helpCommand: SlashCommand<unknown, HelpComposer> = {
  name: "/help",
  description: "Show available slash commands",
  offered: () => true,
  run: (_invocation, composer) => composer.showNotice(formatCommandListing(composer.commands)),
};
