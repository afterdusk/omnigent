/**
 * The main chat composer's built-in commands, in menu order.
 *
 * Each entry says when the command is offered and what a submitted line does,
 * so adding a command is one entry here. Commands the harness carries out
 * itself declare `forward`; the rest run in the composer through `run`.
 */
import { toast } from "sonner";
import { readAlwaysSteer } from "@/lib/alwaysSteerPreferences";
import type { ServerInfo } from "@/lib/capabilities";
import { shouldQueueSend } from "@/lib/messageQueue";
import { supportsSideChat, usesNativeSideChatFork } from "@/lib/sideChat";
import { useChatStore } from "@/store/chatStore";
import { firstArgument, formatCommandListing } from "./catalog";
import type { ForwardedCommand, SlashCommand } from "./types";

/** The session facts the main chat's commands are offered against. */
export interface ChatCommandSession {
  /** Whether the session exists yet; false on a chat with no first message. */
  started: boolean;
  /** The session's harness id, e.g. `claude-native`. */
  harness: string | null;
  /** Whether the session wraps a vendor terminal UI. */
  nativeWrapper: boolean;
  serverInfo: ServerInfo | "loading";
  /** Whether the composer shows a reasoning-effort control. */
  effortControl: boolean;
  /** Whether the composer shows a model picker. */
  modelPicker: boolean;
  /** Whether the model can be set back to the agent's default. */
  modelReset: boolean;
  /** Whether the composer shows Codex's approval-mode control. */
  approvalModeControl: boolean;
  /** Whether the composer shows a Goal control. */
  goalControl: boolean;
  /** Whether the viewer may start a side chat from this session. */
  canStartSideChat: boolean;
}

/** What a submitted main-chat command may read and do. */
export interface ChatCommandComposer {
  session: ChatCommandSession;
  /** The menu this composer offers, as `/help` lists it. */
  commands: Readonly<Record<string, string>>;
  /** Reasoning efforts the session's model accepts. */
  effortLevels: readonly string[];
  /** Whether the model picker has a catalog to open on. */
  modelPickerReady: boolean;
  /** Why the approval mode cannot change right now, or null when it can. */
  approvalModeRefusal: string | null;
  /** Whether this session is already creating a side chat. */
  sideChatPending: () => boolean;
  clearDraft: () => void;
  /** Shows text under the composer; null clears it. */
  showNotice: (text: string | null) => void;
  /** Sends `text` to the agent through the message queue. */
  send: (text: string) => void;
  startNewSession: () => void;
  openGoalDialog: () => void;
  openRewindPicker: () => void;
  openApprovalModePicker: () => void;
  openModelPicker: () => void;
  openSideChat: (question: string) => void;
  /** Re-reads the session's goal once the agent has acted on a new one. */
  refreshGoal: () => void;
}

export type ChatCommand = SlashCommand<ChatCommandSession, ChatCommandComposer>;

/** Send the draft exactly as the user typed it. */
const AS_TYPED: ForwardedCommand = {};

const errorText = (err: unknown, fallback: string) =>
  err instanceof Error ? err.message : fallback;

/** Clears the draft and any notice, as a command does once it accepts its input. */
function accept(composer: ChatCommandComposer): void {
  composer.clearDraft();
  composer.showNotice(null);
}

// Harnesses whose compaction takes no instructions, by the name the refusal shows.
const COMPACT_WITHOUT_ARGUMENTS: Readonly<Record<string, string>> = {
  "codex-native": "Codex",
  "pi-native": "Pi",
  "claude-sdk": "Claude SDK",
};

// These compact through the message queue, which keeps a /compact sent mid-turn in order;
// the store turns the queued text into the control for all but Claude Code, which reads it.
const COMPACT_THROUGH_QUEUE: ReadonlySet<string> = new Set([
  "claude-native",
  "claude-sdk",
  "codex-native",
  "pi-native",
]);

const compact: ChatCommand = {
  name: "/compact",
  description: "Compact conversation context to free up space",
  offered: (session) => session.nativeWrapper || session.harness === "claude-sdk",
  // A /compact refused while Codex is busy stays in the composer.
  menuSelection: "run-keep-draft",
  run: ({ args }, composer) => {
    const harness = composer.session.harness ?? "";
    const withoutArguments = COMPACT_WITHOUT_ARGUMENTS[harness];
    if (withoutArguments !== undefined && args) {
      composer.showNotice(`/compact does not accept arguments for ${withoutArguments}`);
      return;
    }
    const chat = useChatStore.getState();
    if (
      harness === "codex-native" &&
      (chat.status === "streaming" || chat.sessionStatus === "running") &&
      !shouldQueueSend(
        chat.conversationId,
        chat.status,
        chat.sessionStatus,
        chat.queuedMessages,
        readAlwaysSteer(),
      )
    ) {
      toast.error("Compact is disabled while a chat is in progress", { richColors: true });
      return;
    }
    accept(composer);
    if (COMPACT_THROUGH_QUEUE.has(harness)) {
      composer.send(args ? `/compact ${args}` : "/compact");
      return;
    }
    void useChatStore
      .getState()
      .compact()
      .catch((err: unknown) => composer.showNotice(errorText(err, "Compact failed")));
  },
};

/**
 * Whether the composer offers `/clear` for a session on `harness`.
 *
 * Claude SDK needs the server to continue the work in a new session; native
 * sessions need it to accept the clear control. Elsewhere a typed `/clear`
 * stays text.
 */
function offersClear(harness: string | null, info: ServerInfo | "loading"): boolean {
  if (info === "loading") return false;
  if (harness === "claude-sdk") return info.session_claude_sdk_clear === true;
  return (
    (harness === "claude-native" || harness === "codex-native") &&
    !!info.session_event_types?.includes("clear")
  );
}

const clear: ChatCommand = {
  name: "/clear",
  description: "Clear the context and continue in a new chat on the same machine",
  offered: (session) => offersClear(session.harness, session.serverInfo),
  run: ({ args }, composer) => {
    if (args) {
      composer.showNotice("/clear does not accept arguments");
      return;
    }
    accept(composer);
    void useChatStore
      .getState()
      .clearContext()
      .catch((err: unknown) => composer.showNotice(errorText(err, "Clear failed")));
  },
};

/** Older servers have no rewind endpoint, so `/rewind` stays text or a project skill there. */
function offersRewind(harness: string | null, info: ServerInfo | "loading"): boolean {
  if (info === "loading") return false;
  return (harness === "claude-native" || harness === "claude-sdk") && info.session_rewind === true;
}

const rewind: ChatCommand = {
  name: "/rewind",
  description: "Rewind the conversation to an earlier prompt and edit it",
  offered: (session) => offersRewind(session.harness, session.serverInfo),
  run: ({ args }, composer) => {
    // A chat with no first message has no prompts to rewind to.
    if (!composer.session.started) {
      composer.showNotice("/rewind is not supported for this agent type");
      return;
    }
    if (args) {
      composer.showNotice("/rewind does not accept arguments");
      return;
    }
    accept(composer);
    composer.openRewindPicker();
  },
};

const context: ChatCommand = {
  name: "/context",
  description: "Show context window usage for this session",
  offered: () => true,
  run: (_invocation, composer) => {
    const { contextWindow, llmModel, sessionModelOverride, tokensUsed, blocks } =
      useChatStore.getState();
    const lines: string[] = [];
    if (sessionModelOverride) lines.push(`Model: ${sessionModelOverride} (override)`);
    else if (llmModel) lines.push(`Model: ${llmModel}`);
    // contextWindow > 0 keeps a zero window out of the division (0/0 → "NaN%").
    if (tokensUsed != null && contextWindow != null && contextWindow > 0) {
      const used = Math.min(tokensUsed / contextWindow, 1);
      const filled = Math.round(used * 20);
      lines.push(
        `${tokensUsed.toLocaleString()} / ${contextWindow.toLocaleString()} tokens (${(used * 100).toFixed(1)}%)`,
      );
      lines.push("█".repeat(filled) + "░".repeat(20 - filled));
    } else if (tokensUsed != null) {
      lines.push(`${tokensUsed.toLocaleString()} tokens`);
      lines.push("(Context window size unknown)");
    } else {
      lines.push("No usage data yet — send a message first.");
    }
    lines.push(`Items in context: ${blocks.length}`);
    composer.showNotice(lines.join("\n"));
  },
};

const effort: ChatCommand = {
  name: "/effort",
  description: "Set reasoning effort: /effort low | medium | high | default",
  offered: (session) => session.effortControl,
  menuSelection: "complete",
  run: (invocation, composer) => {
    const requested = firstArgument(invocation).toLowerCase();
    const valid = [...composer.effortLevels, "default"];
    if (!requested || !valid.includes(requested)) {
      composer.showNotice(`Usage: /effort ${valid.join(" | ")}`);
      return;
    }
    accept(composer);
    void useChatStore
      .getState()
      .setEffort(requested === "default" ? null : requested)
      .catch((err: unknown) => composer.showNotice(errorText(err, "Failed to set effort")));
  },
};

const MODEL_DESCRIPTION = "Switch the model for this session: /model <name>";
const MODEL_RESET_WORDS: ReadonlySet<string> = new Set(["default", "off", "reset"]);

const model: ChatCommand = {
  name: "/model",
  description: (session) =>
    session.modelReset ? `${MODEL_DESCRIPTION} | default` : MODEL_DESCRIPTION,
  // In-process harnesses re-read the session's model each turn; a native
  // terminal takes a change only through its picker.
  offered: (session) => !session.nativeWrapper || session.modelPicker,
  menuSelection: "complete",
  run: (invocation, composer) => {
    // The whole id is one argument, bare (`databricks-gpt-5-4`) or provider-prefixed.
    const target = firstArgument(invocation);
    if (!target) {
      // Sent as text, a bare /model would open the vendor terminal's own
      // selector, which the web can't show: open the composer's picker instead.
      if (composer.modelPickerReady) {
        accept(composer);
        composer.openModelPicker();
        return;
      }
      const { sessionModelOverride, llmModel } = useChatStore.getState();
      const current = sessionModelOverride
        ? `${sessionModelOverride} (override)`
        : (llmModel ?? "agent default");
      const reset = composer.session.modelReset ? " | default" : "";
      composer.showNotice(`Model: ${current}\nUsage: /model <name>${reset}`);
      return;
    }
    const reset = MODEL_RESET_WORDS.has(target.toLowerCase());
    if (reset && !composer.session.modelReset) {
      composer.showNotice(
        "This session does not support resetting the model. Choose a model with /model <name>.",
      );
      return;
    }
    accept(composer);
    // The server confirms a change with a note in the transcript, so only a
    // failure shows here. Native sessions also show the change as pending
    // until the harness reports its model.
    const harness = useChatStore.getState().sessionHarness;
    void useChatStore
      .getState()
      .setModel(reset ? null : target, {
        expectConfirmation: harness === "claude-native" || harness === "codex-native",
      })
      .catch((err: unknown) => composer.showNotice(errorText(err, "Failed to set model")));
  },
};

const mcp: ChatCommand = {
  name: "/mcp",
  description: "Show MCP servers enabled for this session",
  offered: (session) => session.started,
  // The menu lists the session's MCP servers while the draft is exactly `/mcp`.
  menuSelection: "complete-bare",
  run: ({ args }, composer) => {
    if (args) composer.showNotice("Usage: /mcp");
  },
};

const permissions: ChatCommand = {
  name: "/permissions",
  description: "Change the approval mode for this session",
  // Codex native only. Claude Code's own /permissions edits tool rules rather
  // than the mode, so there the text goes to its terminal.
  offered: (session) => session.approvalModeControl,
  run: ({ args }, composer) => {
    if (args) {
      composer.showNotice("/permissions does not accept arguments");
      return;
    }
    if (composer.approvalModeRefusal !== null) {
      composer.showNotice(composer.approvalModeRefusal);
      return;
    }
    accept(composer);
    composer.openApprovalModePicker();
  },
};

const goal: ChatCommand = {
  name: "/goal",
  description: "View or set the goal for this session",
  offered: (session) => session.started && session.goalControl,
  claimsSkillName: true,
  // With an objective the harness sets the goal; bare, the composer's dialog opens.
  forward: ({ args }, composer) =>
    args ? { text: `/goal ${args}`, afterSend: composer.refreshGoal } : null,
  run: (_invocation, composer) => {
    accept(composer);
    composer.openGoalDialog();
  },
};

const newSession: ChatCommand = {
  name: "/new",
  description: "Start a blank session in the same project",
  offered: () => true,
  run: ({ args }, composer) => {
    if (args) {
      composer.showNotice("/new does not accept arguments");
      return;
    }
    accept(composer);
    composer.startNewSession();
  },
};

const btw: ChatCommand = {
  name: "/btw",
  description:
    "Ask a side question — answered in a dismissable overlay, not saved to the conversation",
  // Claude Code's own command: its terminal answers, and the answer is relayed to an overlay.
  offered: (session) => session.harness === "claude-native",
  menuSelection: "complete",
  caseSensitive: () => true,
  forward: () => AS_TYPED,
};

const side: ChatCommand = {
  name: "/side",
  description:
    "Start a side chat: an ephemeral fork opened as its own sub-agent chat, kept out of this conversation",
  offered: (session) => supportsSideChat(session.harness, session.canStartSideChat),
  // Outside Codex native the composer always opens the side chat, so a viewer who
  // can't start one gets the server's refusal rather than a message to the agent.
  claimsUnlisted: (session) => !usesNativeSideChatFork(session.harness),
  menuSelection: "complete",
  caseSensitive: (session) => usesNativeSideChatFork(session.harness),
  ignoresSubmit: (_invocation, composer) =>
    !usesNativeSideChatFork(composer.session.harness) && composer.sideChatPending(),
  // Codex native forks in its own runner from the typed command.
  forward: (_invocation, composer) =>
    usesNativeSideChatFork(composer.session.harness) ? AS_TYPED : null,
  run: ({ args }, composer) => composer.openSideChat(args),
};

/** Lists what the composer offers. Shared by every surface that shows a notice. */
export const helpCommand: SlashCommand<
  unknown,
  Pick<ChatCommandComposer, "commands" | "showNotice">
> = {
  name: "/help",
  description: "Show available slash commands",
  offered: () => true,
  run: (_invocation, composer) => composer.showNotice(formatCommandListing(composer.commands)),
};

export const CHAT_COMMANDS: readonly ChatCommand[] = [
  compact,
  clear,
  rewind,
  context,
  effort,
  model,
  mcp,
  permissions,
  goal,
  newSession,
  btw,
  side,
  helpCommand,
];
