import { describe, expect, it, vi } from "vitest";
import { buildSlashCatalog, resolveSlashSubmission } from "./catalog";
import { SIDE_CHAT_COMMANDS } from "./sideChatCommands";
import type { SlashSkill } from "./types";

const catalog = (skills: readonly SlashSkill[] = []) =>
  buildSlashCatalog({
    commands: SIDE_CHAT_COMMANDS,
    session: undefined,
    skills,
    skillPrefix: "/",
  });

describe("side chat commands", () => {
  it("offers /help ahead of the session's skills", () => {
    const built = catalog([{ name: "review", description: "Review." }]);
    expect(built.names).toEqual(["/help", "/review"]);
    expect(built.selection("/help")).toBe("run");
    expect(built.selection("/review")).toBe("complete");
  });

  it("shows the built-in /help, not a skill that collides with its exact name", () => {
    const built = catalog([{ name: "help", description: "Run the help skill" }]);
    expect(built.menu).toEqual({ "/help": "Show available slash commands" });
    // Mid-sentence nothing runs here, so the skill still completes there.
    expect(built.skills).toEqual({ "/help": "Run the help skill" });
  });

  it("runs a built-in only as typed, so a skill that differs in case stays reachable", () => {
    const built = catalog([{ name: "Help", description: "A capitalised help skill" }]);
    expect(built.names).toEqual(["/help", "/Help"]);
    expect(resolveSlashSubmission(built, "/Help", true)).toEqual({
      kind: "skill",
      name: "Help",
      args: "",
    });
    expect(resolveSlashSubmission(built, "/HELP", true)).toEqual({ kind: "message" });
    expect(resolveSlashSubmission(built, "/help", true).kind).toBe("command");
  });

  it("lists what the side chat offers when /help runs", () => {
    const built = catalog([{ name: "review", description: "Review." }]);
    const showNotice = vi.fn();
    built
      .command("/help")
      ?.run?.({ name: "/help", args: "" }, { commands: built.menu, showNotice });
    expect(showNotice).toHaveBeenCalledExactlyOnceWith(
      "/help — Show available slash commands\n/review — Review.",
    );
  });
});
