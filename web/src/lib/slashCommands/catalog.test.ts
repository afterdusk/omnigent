import { describe, expect, it } from "vitest";
import { slashCommandMatches } from "@/components/SlashCommandMenu";
import {
  buildSlashCatalog,
  firstArgument,
  formatCommandListing,
  resolveSlashSubmission,
} from "./catalog";
import type { SlashCommand, SlashSkill } from "./types";

interface Session {
  extras?: boolean;
  exactCase?: boolean;
}

type Command = SlashCommand<Session, unknown>;

const help: Command = { name: "/help", description: "Show help", offered: () => true };
const effort: Command = {
  name: "/effort",
  description: "Set effort",
  offered: () => true,
  menuSelection: "complete",
};
const goal: Command = {
  name: "/goal",
  description: "Set the goal",
  offered: () => true,
  claimsSkillName: true,
};
const extra: Command = {
  name: "/extra",
  description: (session) => (session.extras ? "Extra, on" : "Extra"),
  offered: (session) => session.extras === true,
};
const side: Command = {
  name: "/side",
  description: "Side chat",
  offered: () => false,
  claimsUnlisted: (session) => session.exactCase !== true,
  caseSensitive: (session) => session.exactCase === true,
};

const COMMANDS = [help, effort, goal, extra, side];

function catalog(
  skills: readonly SlashSkill[] = [],
  session: Session = {},
  skillPrefix: "/" | "$" = "/",
) {
  return buildSlashCatalog({ commands: COMMANDS, session, skills, skillPrefix });
}

describe("buildSlashCatalog", () => {
  it("lists the offered built-ins in declaration order, then the skills", () => {
    const built = catalog([
      { name: "triage-issues", description: "Triage issues." },
      { name: "mlflow-bug", description: "File an MLflow bug." },
    ]);
    // The menu shows built-ins above skills, each group in its given order.
    expect(built.names).toEqual(["/help", "/effort", "/goal", "/triage-issues", "/mlflow-bug"]);
    expect(built.menu["/help"]).toBe("Show help");
    expect(built.menu["/triage-issues"]).toBe("Triage issues.");
    expect(built.commands).toEqual([help, effort, goal]);
  });

  it("offers a command only where its declaration says, with a session-specific description", () => {
    expect(catalog().command("/extra")).toBeUndefined();
    const on = catalog([], { extras: true });
    expect(on.command("/extra")).toBe(extra);
    expect(on.menu["/extra"]).toBe("Extra, on");
  });

  it("matches skills via the shared substring matcher the menu uses", () => {
    const built = catalog([
      { name: "superpowers:using-superpowers", description: "Establishes how to use skills" },
      { name: "mlflow-bug", description: "File an MLflow bug." },
    ]);
    // A namespaced skill is found by its leaf name.
    expect(built.names.filter((name) => slashCommandMatches(name, "using-superpowers"))).toEqual([
      "/superpowers:using-superpowers",
    ]);
  });

  it("labels a skill whose display name differs from its command", () => {
    const built = catalog([
      { name: "asd-ste100", description: "Plain English", display_name: "Simplified English" },
    ]);
    expect(built.menu["/asd-ste100"]).toBe("Simplified English — Plain English");
    expect(built.labels).toEqual({ "/asd-ste100": "Simplified English" });
  });

  it("types skills with the session's prefix", () => {
    const built = catalog([{ name: "review", description: "Review." }], {}, "$");
    expect(built.names).toEqual(["/help", "/effort", "/goal", "$review"]);
    expect(built.skills).toEqual({ $review: "Review." });
  });

  it.each(["goal", "Goal"])(
    "keeps a claimed name from a %s skill at the start of a message only",
    (name) => {
      const built = catalog([{ name, description: "Project goal skill" }]);
      expect(built.names).toEqual(["/help", "/effort", "/goal"]);
      expect(built.menu["/goal"]).toBe("Set the goal");
      expect(built.claimedNames).toEqual(new Set(["/goal"]));
      // The skill still completes mid-sentence.
      expect(built.skills).toEqual({ [`/${name}`]: "Project goal skill" });
    },
  );

  it("leaves a same-named skill alone when the session types skills differently", () => {
    const built = catalog([{ name: "goal", description: "Project goal skill" }], {}, "$");
    expect(built.names).toEqual(["/help", "/effort", "/goal", "$goal"]);
  });

  it("gives an unclaimed name's row to a same-named skill", () => {
    const built = catalog([{ name: "help", description: "Help desk" }]);
    expect(built.names).toEqual(["/help", "/effort", "/goal"]);
    expect(built.menu["/help"]).toBe("Help desk");
    // The row is the skill's, so choosing it completes like any skill.
    expect(built.selection("/help")).toBe("complete");
  });

  it("says what choosing a menu row does", () => {
    const built = catalog([{ name: "review", description: "Review." }]);
    expect(built.selection("/help")).toBe("run");
    expect(built.selection("/effort")).toBe("complete");
    // Skills never run on selection: the user may add context first.
    expect(built.selection("/review")).toBe("complete");
  });

  it("names the built-ins that run in any case", () => {
    expect(catalog().anyCaseNames).toEqual(["/help", "/effort", "/goal"]);
  });

  it("claims a submitted first word in any case unless the command is case-sensitive", () => {
    const built = catalog();
    expect(built.claim("/HELP")).toBe(help);
    expect(built.claim("/helper")).toBeUndefined();
    // Not listed, but still claimed on submit.
    expect(built.claim("/Side")).toBe(side);
    const exact = catalog([], { exactCase: true });
    expect(exact.claim("/side")).toBeUndefined();
  });
});

describe("resolveSlashSubmission", () => {
  const skills = [
    { name: "review-pr", description: "Review a PR." },
    { name: "Help Desk", description: "Summarize the help desk." },
    { name: "help", description: "A help skill." },
  ];

  it("routes a known skill with its arguments", () => {
    expect(resolveSlashSubmission(catalog(skills), "/review-pr 123 focus on auth", true)).toEqual({
      kind: "skill",
      name: "review-pr",
      args: "123 focus on auth",
    });
  });

  it("prefers a multi-word skill over a built-in matching only its first word", () => {
    expect(resolveSlashSubmission(catalog(skills), "/Help Desk summarize", true)).toEqual({
      kind: "skill",
      name: "Help Desk",
      args: "summarize",
    });
  });

  it("prefers a built-in over a skill of the same name", () => {
    expect(resolveSlashSubmission(catalog(skills), "/help", true)).toEqual({
      kind: "command",
      command: help,
      invocation: { name: "/help", args: "" },
    });
  });

  it("splits a built-in's arguments from any-case and multi-line input", () => {
    expect(resolveSlashSubmission(catalog(), "/Goal\nFix  CI", true)).toEqual({
      kind: "command",
      command: goal,
      invocation: { name: "/goal", args: "Fix  CI" },
    });
  });

  it("sends a skill as a message where the session doesn't resolve skills", () => {
    // A native terminal reads the skill from the text itself.
    expect(resolveSlashSubmission(catalog(skills), "/review-pr 123", false)).toEqual({
      kind: "message",
    });
    // Built-ins still run there.
    expect(resolveSlashSubmission(catalog(skills), "/effort high", false).kind).toBe("command");
  });

  it.each(["/unknown now", "/etc/hosts", "plain text", ""])("sends %j as a message", (text) => {
    expect(resolveSlashSubmission(catalog(skills), text, true)).toEqual({ kind: "message" });
  });
});

describe("firstArgument", () => {
  it("returns the first word of the arguments, or nothing", () => {
    expect(firstArgument({ name: "/model", args: "gpt-5  extra" })).toBe("gpt-5");
    expect(firstArgument({ name: "/model", args: "" })).toBe("");
  });
});

describe("formatCommandListing", () => {
  it("lists one command per line", () => {
    expect(formatCommandListing({ "/help": "Show help", "/review": "Review." })).toBe(
      "/help — Show help\n/review — Review.",
    );
  });
});
