"""Which session controls the runner carries out, per harness.

A session control asks Omnigent to act on a session instead of sending its
agent a message: compact the context, clear it. The runner carries each one
out through a harness-specific handler, and this table is the one place that
says which harness has a handler for which control. The runner dispatches from
it and the server reports it to clients, so a client offers a control exactly
where the runner can carry it out.

Import-safe like :mod:`omnigent.harness_capabilities`: it names handlers
without importing them, so the server can read it without the runner stack.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

COMPACT = "compact"
CLEAR = "clear"


@dataclass(frozen=True)
class SessionControlHandler:
    """How the runner carries out one control for one harness.

    :param handler: The :class:`~omnigent.runner.native_controls.NativeControls`
        attribute that handles it, e.g. ``"handle_codex_native_compact"``.
    :param requires: A request-body flag the handler needs set to ``True``,
        e.g. ``"continue_in_new_session"``. A request without it gets the same
        answer as a harness with no handler. ``None`` needs no flag.
    :param offered: Whether clients should offer the control as a command.
        ``False`` keeps a handler that no client surfaces yet out of the
        reported set.
    """

    handler: str
    requires: str | None = None
    offered: bool = True


SESSION_CONTROL_HANDLERS: Mapping[str, Mapping[str, SessionControlHandler]] = {
    COMPACT: {
        "claude-native": SessionControlHandler("handle_claude_native_compact"),
        "codex-native": SessionControlHandler("handle_codex_native_compact"),
        "opencode-native": SessionControlHandler("handle_opencode_native_compact"),
        "cursor-native": SessionControlHandler("handle_cursor_native_compact"),
        "pi-native": SessionControlHandler("handle_pi_native_compact"),
        "hermes-native": SessionControlHandler("handle_hermes_native_compact"),
        "qwen-native": SessionControlHandler("handle_qwen_native_compact"),
        "devin-native": SessionControlHandler("handle_devin_native_compact"),
        "claude-sdk": SessionControlHandler("handle_claude_sdk_compact"),
    },
    CLEAR: {
        "claude-native": SessionControlHandler("handle_claude_native_clear"),
        "codex-native": SessionControlHandler("handle_codex_native_clear"),
        # The runner clears an OpenCode session, but no client offers it yet.
        "opencode-native": SessionControlHandler("handle_opencode_native_clear", offered=False),
        # Only a server that continues the work in a new session marks the
        # request; an older server's plain clear stays unsupported.
        "claude-sdk": SessionControlHandler(
            "handle_claude_sdk_clear", requires="continue_in_new_session"
        ),
    },
}


def session_control_handler(control: str, harness: str | None, body: object) -> str | None:
    """Return the handler attribute that carries out *control* for *harness*.

    :param control: The control event type, e.g. ``"compact"``.
    :param harness: The session's canonical harness id, e.g. ``"codex-native"``.
    :param body: The control request's JSON body, which may carry the flag a
        handler requires.
    :returns: A :class:`~omnigent.runner.native_controls.NativeControls`
        attribute name, or ``None`` when the harness cannot carry the request
        out.
    """
    entry = SESSION_CONTROL_HANDLERS.get(control, {}).get(harness or "")
    if entry is None:
        return None
    if entry.requires is not None and not (
        isinstance(body, dict) and body.get(entry.requires) is True
    ):
        return None
    return entry.handler


def offered_session_controls() -> dict[str, list[str]]:
    """Return the controls clients may offer, keyed by harness id.

    :returns: ``{harness: [control, ...]}`` in table order, e.g.
        ``{"codex-native": ["compact", "clear"]}``. A harness with none is
        absent.
    """
    offered: dict[str, list[str]] = {}
    for control, handlers in SESSION_CONTROL_HANDLERS.items():
        for harness, entry in handlers.items():
            if entry.offered:
                offered.setdefault(harness, []).append(control)
    return offered
