# Slash commands

Status: current architecture. This note describes how the web composers offer
and carry out slash commands, and how to add one. It explains how the pieces
fit and where each kind of rule lives. The code and its tests define each
command's exact handling, so this note links to the owning symbols instead of
restating them. What a user sees, and how to verify it, is in the
[Composer feature map](../feature-map/composer.md).

## What a slash command does

A slash command is a draft that starts with `/name`, or `$name` for a skill in
a Codex native session. A composer carries it out in one of four ways:

| Route | Who carries it out |
| --- | --- |
| Runs in the composer | The web app. It shows something, opens one of its own controls, or asks the server to act on the session. |
| Forwarded as a message | The harness: the vendor's own CLI, or Omnigent's executor for that harness. |
| Resolved as a skill | The server and runner, which hand the agent the skill's instructions. |
| Sent as plain text | Nobody. The agent reads it like any other message. |

One name can take different routes. A bare `/goal` opens the composer's Goal
dialog, while `/goal <objective>` is forwarded for the harness to act on.

## How a command gets from menu to execution

### 1. Declaration

A built-in is one `SlashCommand`
([`types.ts`](../web/src/lib/slashCommands/types.ts)). It says when the
command is offered, what choosing its menu row does, and whether a submitted
line runs in the composer (`run`) or is forwarded (`forward`). The remaining
fields are the exceptions a few commands need, each explained where it is
declared.

Each composer has one list of declarations, in menu order:

| Composer | List |
| --- | --- |
| Main chat | `CHAT_COMMANDS` in [`chatCommands.ts`](../web/src/lib/slashCommands/chatCommands.ts) |
| Side chat | `SIDE_CHAT_COMMANDS` in [`sideChatCommands.ts`](../web/src/lib/slashCommands/sideChatCommands.ts) |
| New session | `NEW_SESSION_COMMANDS` in [`newSessionCommands.ts`](../web/src/lib/slashCommands/newSessionCommands.ts) |

A declaration is written against two types its composer supplies: the session
facts it is offered against, and the actions it may take when it runs. For the
main chat these are `ChatCommandSession` and `ChatCommandComposer`.

### 2. Catalog

`buildSlashCatalog` ([`catalog.ts`](../web/src/lib/slashCommands/catalog.ts))
combines a composer's declarations, its session facts and the session's skills
into a catalog. The composer reads the menu, the names to tint and the effect
of choosing a row from it, so those cannot disagree with each other.

Skills are not declared in the web app. The runner discovers them for the
session's harness (`resolve_session_skills` in
[`skill_sources.py`](../omnigent/spec/skill_sources.py)), so the menu lists
what that harness loads.

### 3. Submission

`resolveSlashSubmission` decides what a submitted draft runs:

1. A skill whose name spans several words, when the draft starts with all of it.
2. A built-in that claims the first word.
3. A skill named by the first word.
4. Otherwise, a plain message.

A draft that carries a quote, an attachment, a tag or a review comment is
always a plain message. The composer checks that before it resolves anything.

### 4. Execution

| Route | Path |
| --- | --- |
| Runs in the composer | The declaration's `run`, using the composer's actions. |
| Session control | `run` posts a control event. The server forwards it to the runner, which looks up the harness's handler in [`session_controls.py`](../omnigent/session_controls.py). See [Session controls](#session-controls). |
| Forwarded | The text joins the normal send path, so it queues like any message. A native terminal's CLI then reads it, or the harness's executor recognises it first. |
| Skill | The composer sends a `slash_command` event. The server has the runner resolve the skill and stores its instructions as a hidden message (`_dispatch_skill_slash_command_to_runner` in [`helpers.py`](../omnigent/server/routes/_sessions/helpers.py)). |

A command that runs in the composer, and a skill, cannot wait in the send
queue, so the main chat holds them while the session's host reconnects. A
forwarded command queues like any message. That is why `forward` must have no
side effects: the composer calls it to find the route before it does anything.

## Surfaces

| Surface | Built-ins | Skills |
| --- | --- | --- |
| Main chat | `CHAT_COMMANDS` | Complete in the menu. In-process sessions send them as `slash_command` events; native terminal sessions send the text. |
| Side chat | `/help` only. The other built-ins act on the main session. | As the main chat. |
| New session | None. There is no session for a built-in to act on. | Complete in the menu. The first message can invoke one. |
| Native terminal | None of Omnigent's. The vendor CLI reads whatever is typed. | The vendor CLI loads its own. |

Text that reaches a Claude Code native terminal from the web passes through
the bridge first (`_escape_unsupported_slash_command` in
[`bridge.py`](../omnigent/harnesses/claude_native/bridge.py)). It passes the
CLI commands Omnigent can follow, escapes the ones it cannot drive so they
arrive as plain text, and passes any other name on as a possible skill.

## Where availability comes from

A declaration's `offered` combines whichever of these the command needs:

| Source | Answers | Example |
| --- | --- | --- |
| Session facts the composer computes | Does this session have the control the command opens? | `/permissions`, `/goal` |
| `GET /v1/info` | Does this server version support it? | `/rewind` (`session_rewind`) |
| `GET /v1/harnesses` `session_controls` | Can the runner carry the control out for this harness? | `/compact`, `/clear` |
| Permissions | May this viewer do it? | `/side` |

When the answer depends on what the server or runner can do, take it from the
server. A rule written into the web app as a list of harness names has
nothing to keep it in step with the code that carries the command out.

A server that predates a report must not make a working command disappear.
`LEGACY_SESSION_CONTROLS` ([`sessionControls.ts`](../web/src/lib/sessionControls.ts))
answers for servers that do not report session controls, and stays fixed:
newer servers report their own table.

## Session controls

A session control asks the runner to act on a session. Today these are
`compact` and `clear`. One table,
`SESSION_CONTROL_HANDLERS` in [`session_controls.py`](../omnigent/session_controls.py),
names the handler for each control and harness:

- The runner dispatches from it. A harness with no entry answers 204, which
  the server turns into "not available for this session type".
- `GET /v1/harnesses` reports it as `session_controls`, keyed by harness id.
  The composer offers `/compact` and `/clear` against that report.

Because both read the same table, the composer offers a control exactly where
the runner has a handler. An entry can be marked `offered=False` to keep a
handler that no client surfaces yet out of the report.

[`tests/test_session_controls.py`](../tests/test_session_controls.py) checks
that every entry names a real handler and harness, and that a harness which
declares the `compaction` capability has a compact handler.

Model, effort and permission-mode changes are also runner controls, but each
still dispatches through its own per-harness branches.

## Adding a command

Pick the route first:

| The command | Route | What to add |
| --- | --- | --- |
| Shows something or opens a control in the web app | `run` | A declaration. If it needs a new action, add it to the composer's type and supply it in the composer. |
| Needs the runner to act on the session | `run` that posts a control | A handler, an entry in `SESSION_CONTROL_HANDLERS`, and a declaration offered against `session_controls`. |
| Is the vendor CLI's own command | `forward` | A declaration. For Claude Code native, also list it among the bridge's surfaced commands, so it is passed as a command and not as a guessed skill. |
| Needs Omnigent to translate it for a harness | `forward` | A declaration, and recognition in that harness's executor. |
| Is a set of instructions for the agent | Skill | A skill. It appears in every composer whose session loads it. |

Then:

1. Add the declaration to the composer's list, at its place in the menu.
2. Test what the command decides in the list's test file, next to the others.
3. Describe what the user sees in the [Composer feature map](../feature-map/composer.md).

## Examples

### `/goal`

- **Offered** where the session has a Goal control. The predicates are beside
  the other composer gates in [`ChatPage.tsx`](../web/src/pages/ChatPage.tsx)
  (`shouldShowGoalControl` and its neighbours).
- **Bare**, it runs in the composer and opens the Goal dialog.
- **With an objective**, it is forwarded as `/goal <objective>`. Codex's
  executors recognise the text and set the goal before running the objective
  (`goal_objective_from_content` in
  [`codex_goal_command.py`](../omnigent/inner/codex_goal_command.py)). Claude
  Code native passes it to the CLI's own `/goal`.
- It keeps its name from a skill called `goal`, which still completes
  mid-sentence.

### `/clear`

- **Offered** where the runner reports the `clear` control for the harness and
  the server accepts it.
- It runs in the composer and posts the `clear` control.
- For a native terminal, the runner's handler types the CLI's own `/clear`.
  For Claude SDK, the server continues the work in a new, empty session on the
  same runner and the view follows it.

### A discovered skill

- The runner finds it for the session's harness and the menu lists it after
  the built-ins.
- Choosing it completes the name and waits for arguments.
- On an in-process session the composer sends a `slash_command` event and the
  server resolves it. On a native terminal the text is sent and the vendor CLI
  loads the skill.

## Not unified yet

- **Goal availability** is decided in the web app from the session's wrapper
  label and agent name. No server report backs it.
- **Case.** The main chat runs most built-ins in any case. A side chat runs
  them only as typed.
- **Name collisions.** In the main chat only `/goal` keeps its row from a
  same-named skill. A skill named like another built-in takes that row, though
  submitting still runs the built-in.
- **The terminal REPL** has its own command registry
  ([`_repl.py`](../omnigent/repl/_repl.py)), separate from the web's.
