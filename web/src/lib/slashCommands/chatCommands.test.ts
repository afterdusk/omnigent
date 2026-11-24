import { describe, expect, it, vi } from "vitest";
import { FALLBACK_SERVER_INFO, type ServerInfo } from "@/lib/capabilities";
import { buildSlashCatalog } from "./catalog";
import {
  CHAT_COMMANDS,
  type ChatCommand,
  type ChatCommandComposer,
  type ChatCommandSession,
} from "./chatCommands";

// An in-process Claude SDK chat with no first message yet: the commands every
// session gets, plus /compact and /model.
function session(overrides: Partial<ChatCommandSession> = {}): ChatCommandSession {
  return {
    started: false,
    harness: "claude-sdk",
    nativeWrapper: false,
    serverInfo: FALLBACK_SERVER_INFO,
    effortControl: true,
    modelPicker: false,
    modelReset: false,
    approvalModeControl: false,
    goalControl: false,
    canStartSideChat: false,
    ...overrides,
  };
}

function command(name: string): ChatCommand {
  const found = CHAT_COMMANDS.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`no ${name} command`);
  return found;
}

const offers = (name: string, overrides: Partial<ChatCommandSession> = {}) =>
  command(name).offered(session(overrides));

const offeredNames = (overrides: Partial<ChatCommandSession> = {}) =>
  buildSlashCatalog({
    commands: CHAT_COMMANDS,
    session: session(overrides),
    skills: [],
    skillPrefix: "/",
  }).names;

function composer(overrides: Partial<ChatCommandSession> = {}): ChatCommandComposer {
  return {
    session: session(overrides),
    commands: {},
    effortLevels: [],
    modelPickerReady: false,
    approvalModeRefusal: null,
    sideChatPending: () => false,
    clearDraft: vi.fn(),
    showNotice: vi.fn(),
    send: vi.fn(),
    startNewSession: vi.fn(),
    openGoalDialog: vi.fn(),
    openRewindPicker: vi.fn(),
    openApprovalModePicker: vi.fn(),
    openModelPicker: vi.fn(),
    openSideChat: vi.fn(),
    refreshGoal: vi.fn(),
  };
}

const info = (overrides: Partial<ServerInfo>) => ({ ...FALLBACK_SERVER_INFO, ...overrides });

describe("chat command availability", () => {
  it("offers the session-independent commands in menu order", () => {
    // Session- and harness-specific commands stay out until their session has them.
    expect(offeredNames()).toEqual(["/compact", "/context", "/effort", "/model", "/new", "/help"]);
  });

  it("lists every command once", () => {
    const names = CHAT_COMMANDS.map((candidate) => candidate.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([
      "/compact",
      "/clear",
      "/rewind",
      "/context",
      "/effort",
      "/model",
      "/mcp",
      "/permissions",
      "/goal",
      "/new",
      "/btw",
      "/side",
      "/help",
    ]);
  });

  it("offers /permissions only with the Codex approval-mode control", () => {
    expect(offers("/permissions")).toBe(false);
    expect(offers("/permissions", { approvalModeControl: true })).toBe(true);
  });

  it("offers /side only to a viewer who can start a side chat", () => {
    expect(offers("/side")).toBe(false);
    expect(offers("/side", { canStartSideChat: true })).toBe(true);
    expect(offers("/side", { canStartSideChat: true, harness: null })).toBe(false);
  });

  it.each([
    ["claude-native", true],
    ["codex-native", true],
    ["claude-sdk", false],
    ["openai-agents", false],
    [null, false],
  ] as const)(
    "offers native /clear for %s when the server lists the control",
    (harness, offered) => {
      const clear = (serverInfo: ServerInfo | "loading") =>
        offers("/clear", { harness, serverInfo });
      expect(clear(info({ session_event_types: ["clear"] }))).toBe(offered);
      expect(clear(info({ session_event_types: ["message"] }))).toBe(false);
      expect(clear("loading")).toBe(false);
    },
  );

  it("offers claude-sdk /clear only when the server continues it in a new session", () => {
    const sdkClear = info({ session_event_types: ["clear"], session_claude_sdk_clear: true });
    expect(offers("/clear", { harness: "claude-sdk", serverInfo: sdkClear })).toBe(true);
    expect(offers("/clear", { harness: "openai-agents", serverInfo: sdkClear })).toBe(false);
    // An older server lists "clear" for native sessions only.
    const nativeOnly = info({ session_event_types: ["clear"] });
    expect(offers("/clear", { harness: "claude-sdk", serverInfo: nativeOnly })).toBe(false);
  });

  it.each([
    ["claude-sdk", true],
    ["claude-native", true],
    ["codex-native", false],
    ["openai-agents", false],
  ] as const)("offers /rewind for %s when the server has the endpoint", (harness, offered) => {
    const rewind = (serverInfo: ServerInfo | "loading") =>
      offers("/rewind", { harness, serverInfo });
    expect(rewind(info({ session_rewind: true }))).toBe(offered);
    expect(rewind(info({}))).toBe(false);
    expect(rewind("loading")).toBe(false);
  });

  it("offers /btw only on Claude Code native", () => {
    expect(offers("/btw")).toBe(false);
    expect(offers("/btw", { harness: "codex-native" })).toBe(false);
    expect(offers("/btw", { harness: "claude-native" })).toBe(true);
  });

  it("offers /mcp and /goal only once the session has started", () => {
    expect(offers("/mcp")).toBe(false);
    expect(offers("/mcp", { started: true })).toBe(true);
    expect(offers("/goal", { goalControl: true })).toBe(false);
    expect(offers("/goal", { started: true })).toBe(false);
    expect(offers("/goal", { started: true, goalControl: true })).toBe(true);
  });

  it("omits /effort when effort controls are hidden, leaving the rest", () => {
    const names = offeredNames({ effortControl: false });
    expect(names).not.toContain("/effort");
    expect(names).toContain("/compact");
  });

  it("offers /model in process, and on a native terminal only with a model picker", () => {
    expect(offers("/model")).toBe(true);
    expect(offers("/model", { nativeWrapper: true })).toBe(false);
    expect(offers("/model", { nativeWrapper: true, modelPicker: true })).toBe(true);
    // Gating /model must not disturb the other built-ins.
    expect(offeredNames({ nativeWrapper: true })).toContain("/compact");
  });

  it("offers /compact on native terminals and Claude SDK only", () => {
    expect(offers("/compact")).toBe(true);
    expect(offers("/compact", { harness: "codex-native", nativeWrapper: true })).toBe(true);
    const others = offeredNames({ harness: "openai-agents" });
    expect(others).not.toContain("/compact");
    expect(others).toContain("/effort");
    expect(others).toContain("/help");
  });

  it("mentions the default in /model's description only where a reset works", () => {
    const modelDescription = (overrides: Partial<ChatCommandSession>) =>
      buildSlashCatalog({
        commands: CHAT_COMMANDS,
        session: session(overrides),
        skills: [],
        skillPrefix: "/",
      }).menu["/model"];
    expect(modelDescription({})).toBe("Switch the model for this session: /model <name>");
    expect(modelDescription({ modelReset: true })).toBe(
      "Switch the model for this session: /model <name> | default",
    );
  });
});

describe("chat command menu selection", () => {
  const selection = (name: string, overrides: Partial<ChatCommandSession>) =>
    buildSlashCatalog({
      commands: CHAT_COMMANDS,
      session: session(overrides),
      skills: [{ name: "triage-issues", description: "Triage issues." }],
      skillPrefix: "/",
    }).selection(name);

  it("completes the commands that take an argument, and every skill", () => {
    // Selecting these fills "/name " rather than running: the user types the rest.
    expect(selection("/effort", {})).toBe("complete");
    expect(selection("/model", {})).toBe("complete");
    expect(selection("/btw", { harness: "claude-native" })).toBe("complete");
    expect(selection("/side", { canStartSideChat: true })).toBe("complete");
    expect(selection("/triage-issues", {})).toBe("complete");
  });

  it("runs the commands that need nothing more", () => {
    expect(selection("/help", {})).toBe("run");
    expect(selection("/new", {})).toBe("run");
    expect(selection("/goal", { started: true, goalControl: true })).toBe("run");
  });

  it("keeps /compact's draft until the command accepts, and /mcp's menu open", () => {
    expect(selection("/compact", {})).toBe("run-keep-draft");
    expect(selection("/mcp", { started: true })).toBe("complete-bare");
  });
});

describe("chat commands the harness carries out", () => {
  it("opens the Goal dialog for a bare /goal and sends an objective as text", () => {
    const target = composer({ started: true, goalControl: true });
    const goal = command("/goal");
    expect(goal.forward?.({ name: "/goal", args: "" }, target)).toBeNull();
    expect(goal.forward?.({ name: "/goal", args: "Fix CI" }, target)).toEqual({
      text: "/goal Fix CI",
      afterSend: target.refreshGoal,
    });
    expect(goal.claimsSkillName).toBe(true);
  });

  it("sends /btw as typed, in its exact case only", () => {
    const btw = command("/btw");
    expect(btw.forward?.({ name: "/btw", args: "why?" }, composer())).toEqual({});
    expect(btw.caseSensitive?.(session())).toBe(true);
    expect(btw.run).toBeUndefined();
  });

  it("sends /side as typed on Codex native and opens a side chat elsewhere", () => {
    const side = command("/side");
    const invocation = { name: "/side", args: "why?" };
    const codex = composer({ harness: "codex-native" });
    expect(side.forward?.(invocation, codex)).toEqual({});
    expect(side.caseSensitive?.(codex.session)).toBe(true);
    // Unlisted there, Codex's runner still decides what the text means.
    expect(side.claimsUnlisted?.(codex.session)).toBe(false);

    const other = composer({ harness: "claude-native" });
    expect(side.forward?.(invocation, other)).toBeNull();
    expect(side.caseSensitive?.(other.session)).toBe(false);
    expect(side.claimsUnlisted?.(other.session)).toBe(true);
    side.run?.(invocation, other);
    expect(other.openSideChat).toHaveBeenCalledExactlyOnceWith("why?");
  });

  it("drops a second /side while the first side chat is still being created", () => {
    const side = command("/side");
    const invocation = { name: "/side", args: "why?" };
    const pending = { ...composer({ harness: "claude-native" }), sideChatPending: () => true };
    expect(side.ignoresSubmit?.(invocation, pending)).toBe(true);
    expect(side.ignoresSubmit?.(invocation, composer({ harness: "claude-native" }))).toBe(false);
    // Codex's fork is not created here, so nothing is pending to wait on.
    const codex = { ...composer({ harness: "codex-native" }), sideChatPending: () => true };
    expect(side.ignoresSubmit?.(invocation, codex)).toBe(false);
  });

  it("names the built-ins that run in any case", () => {
    const anyCase = (overrides: Partial<ChatCommandSession>) =>
      buildSlashCatalog({
        commands: CHAT_COMMANDS,
        session: session({ canStartSideChat: true, ...overrides }),
        skills: [],
        skillPrefix: "/",
      }).anyCaseNames;
    // /btw and Codex's /side go out as typed to case-sensitive handlers.
    expect(anyCase({ harness: "claude-native", nativeWrapper: true })).not.toContain("/btw");
    expect(anyCase({ harness: "claude-native", nativeWrapper: true })).toContain("/side");
    expect(anyCase({ harness: "codex-native", nativeWrapper: true })).not.toContain("/side");
  });
});
