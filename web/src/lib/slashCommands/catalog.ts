/**
 * Derives what a composer needs from its command declarations: the menu, the
 * names to tint, and what a submitted line runs. Everything here is pure, so
 * each composer reads the same answers from the same declarations instead of
 * keeping its own lists in step.
 */
import {
  matchSlashCommandInvocation,
  skillDisplayNames,
  skillMenuDescription,
} from "@/components/SlashCommandMenu";
import type { SlashCommand, SlashInvocation, SlashMenuSelection, SlashSkill } from "./types";

/** One session's commands and skills, as its composer offers them. */
export interface SlashCatalog<Session, Composer> {
  /** The listed built-ins, in menu order. */
  commands: readonly SlashCommand<Session, Composer>[];
  /** Name to description at the start of a message: built-ins, then skills. */
  menu: Readonly<Record<string, string>>;
  /** Name to description for every skill: what completes mid-sentence. */
  skills: Readonly<Record<string, string>>;
  /** Skill display names by typed name, where the two differ. */
  labels: Readonly<Record<string, string>>;
  /** The menu's names, in menu order. */
  names: readonly string[];
  /** Built-ins that keep their name from a same-named skill. */
  claimedNames: ReadonlySet<string>;
  /** Built-in names that run in any case. */
  anyCaseNames: readonly string[];
  /** What choosing `name` from the start-of-message menu does. */
  selection: (name: string) => SlashMenuSelection;
  /** The listed built-in called `name`, if any. */
  command: (name: string) => SlashCommand<Session, Composer> | undefined;
  /** The built-in a submitted first word runs, if any. */
  claim: (firstWord: string) => SlashCommand<Session, Composer> | undefined;
}

export interface SlashCatalogOptions<Session, Composer> {
  /** The surface's built-ins, in menu order. */
  commands: readonly SlashCommand<Session, Composer>[];
  session: Session;
  skills: readonly SlashSkill[];
  /** How this session types a skill: `$` for Codex native, `/` elsewhere. */
  skillPrefix: "/" | "$";
}

/** A command's menu text for `session`. */
export function describeSlashCommand<Session, Composer>(
  command: SlashCommand<Session, Composer>,
  session: Session,
): string {
  return typeof command.description === "function"
    ? command.description(session)
    : command.description;
}

export function buildSlashCatalog<Session, Composer>({
  commands,
  session,
  skills,
  skillPrefix,
}: SlashCatalogOptions<Session, Composer>): SlashCatalog<Session, Composer> {
  const exactCase = (command: SlashCommand<Session, Composer>) =>
    command.caseSensitive?.(session) === true;
  const matches = (command: SlashCommand<Session, Composer>, typed: string) =>
    (exactCase(command) ? typed : typed.toLowerCase()) === command.name;

  const listed = commands.filter((command) => command.offered(session));
  const claimable = commands.filter(
    (command) => listed.includes(command) || command.claimsUnlisted?.(session) === true,
  );
  const claiming = listed.filter((command) => command.claimsSkillName === true);
  const typedName = (skill: SlashSkill) => `${skillPrefix}${skill.name}`;
  const leadingSkills = skills.filter(
    (skill) => !claiming.some((command) => matches(command, typedName(skill))),
  );
  const skillEntries = (list: readonly SlashSkill[]) =>
    Object.fromEntries(list.map((skill) => [typedName(skill), skillMenuDescription(skill)]));

  const leadingSkillNames = new Set(leadingSkills.map(typedName));
  // A skill sharing an unclaimed built-in's name overrides its description, as its row is the skill's.
  const menu = {
    ...Object.fromEntries(
      listed.map((command) => [command.name, describeSlashCommand(command, session)]),
    ),
    ...skillEntries(leadingSkills),
  };
  const byName = new Map(listed.map((command) => [command.name, command]));

  return {
    commands: listed,
    menu,
    skills: skillEntries(skills),
    labels: skillDisplayNames(skills, skillPrefix),
    names: Object.keys(menu),
    claimedNames: new Set(claiming.map((command) => command.name)),
    anyCaseNames: listed.filter((command) => !exactCase(command)).map((command) => command.name),
    selection: (name) =>
      leadingSkillNames.has(name) ? "complete" : (byName.get(name)?.menuSelection ?? "run"),
    command: (name) => byName.get(name),
    claim: (firstWord) => claimable.find((command) => matches(command, firstWord)),
  };
}

/** What a submitted line does. */
export type SlashSubmission<Session, Composer> =
  | { kind: "command"; command: SlashCommand<Session, Composer>; invocation: SlashInvocation }
  /** A skill the server resolves; `name` has no prefix. */
  | { kind: "skill"; name: string; args: string }
  /** Not a command here: the text goes to the agent as written. */
  | { kind: "message" };

/**
 * Decide what the trimmed draft `text` runs.
 *
 * A skill whose name spans several words outranks a built-in that matches
 * only its first word (`/Help Desk summarize` is the skill, not `/help`).
 * Otherwise a built-in outranks a skill of the same name.
 *
 * @param structuredSkills Whether this session sends skills as `slash_command`
 *   events. Native terminal sessions don't: their vendor CLI reads the skill
 *   from the text.
 */
export function resolveSlashSubmission<Session, Composer>(
  catalog: SlashCatalog<Session, Composer>,
  text: string,
  structuredSkills: boolean,
): SlashSubmission<Session, Composer> {
  const skill = structuredSkills ? matchSlashCommandInvocation(text, catalog.names) : null;
  const firstWord = text.split(/\s+/)[0] ?? "";
  const asSkill = (match: { command: string; args: string }) =>
    ({ kind: "skill", name: match.command.slice(1), args: match.args }) as const;
  if (skill !== null && skill.command !== firstWord) return asSkill(skill);
  const command = catalog.claim(firstWord);
  if (command !== undefined) {
    const args = text.slice(firstWord.length).trim();
    return { kind: "command", command, invocation: { name: command.name, args } };
  }
  return skill !== null ? asSkill(skill) : { kind: "message" };
}

/** The first whitespace-separated argument, or `""`. */
export function firstArgument(invocation: SlashInvocation): string {
  return invocation.args.split(/\s+/)[0] ?? "";
}

/** `/help` output: one line per command the surface offers. */
export function formatCommandListing(commands: Readonly<Record<string, string>>): string {
  return Object.entries(commands)
    .map(([name, description]) => `${name} — ${description}`)
    .join("\n");
}
