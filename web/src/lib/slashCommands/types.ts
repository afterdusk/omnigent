/**
 * The slash-command contract. One {@link SlashCommand} declares everything a
 * composer needs to list, complete and carry out a built-in command; the
 * catalog (`catalog.ts`) derives the menu and the submit routing from those
 * declarations. A composer supplies two things: the session facts commands
 * are offered against, and the actions a running command may take.
 */

/** A submitted command line, split at the command name. */
export interface SlashInvocation {
  /** The command's own name, e.g. `/model`, whatever case was typed. */
  name: string;
  /** Everything after the name, trimmed; `""` for a bare command. */
  args: string;
}

/**
 * A command the composer sends to the agent as a message instead of running:
 * the harness, or Omnigent's executor for it, carries it out.
 */
export interface ForwardedCommand {
  /** Replaces the draft's text; omitted to send the draft as typed. */
  text?: string;
  /** Called once the message has been handed to the send path. */
  afterSend?: () => void;
}

/**
 * What choosing a command's row in the menu does:
 *
 * - `run`: clear the draft and run with no arguments. The default.
 * - `run-keep-draft`: run with no arguments; the command clears the draft
 *   itself, so one it refuses stays in the composer.
 * - `complete`: complete the name and leave room for arguments.
 * - `complete-bare`: complete only the name, keeping the menu open on the
 *   command's own panel.
 */
export type SlashMenuSelection = "run" | "run-keep-draft" | "complete" | "complete-bare";

/**
 * A built-in slash command.
 *
 * `Session` is what the command reads to decide whether and how it is
 * offered; it must be plain data so a composer can memoize the catalog on it.
 * `Composer` is what a submitted command may read and do.
 */
export interface SlashCommand<Session, Composer> {
  /** The typed name with its leading slash, lower-case, e.g. `/compact`. */
  name: string;
  /** Menu and `/help` text; a function when it depends on the session. */
  description: string | ((session: Session) => string);
  /** Whether this session lists the command. */
  offered: (session: Session) => boolean;
  /**
   * Whether a submitted invocation is claimed even when the command is not
   * listed. Unset, only a listed command is claimed.
   */
  claimsUnlisted?: (session: Session) => boolean;
  /** Defaults to `run`. */
  menuSelection?: SlashMenuSelection;
  /**
   * Keeps the name from a same-named skill at the start of a message, so the
   * menu shows this command and not a skill that could never run there. The
   * skill stays available mid-sentence.
   */
  claimsSkillName?: boolean;
  /**
   * Whether only the exact-case name is recognised, for a command sent as
   * typed to a case-sensitive handler. Unset, any case runs the command.
   */
  caseSensitive?: (session: Session) => boolean;
  /** A submit is dropped while this returns true, as a disabled Send would be. */
  ignoresSubmit?: (invocation: SlashInvocation, composer: Composer) => boolean;
  /**
   * Returns how to send the invocation to the agent, or null to run it here.
   * Must have no side effects: a forwarded command waits in the send queue
   * like any message, while one that runs here cannot.
   */
  forward?: (invocation: SlashInvocation, composer: Composer) => ForwardedCommand | null;
  /** Runs the command in the composer. */
  run?: (invocation: SlashInvocation, composer: Composer) => void;
}

/** A skill as the catalog reads it: the fields of the server's skill summary. */
export interface SlashSkill {
  name: string;
  description: string;
  display_name?: string | null;
}
