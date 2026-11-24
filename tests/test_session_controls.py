"""The session-control table matches the handlers and the claims built on it."""

from __future__ import annotations

import dataclasses

import pytest

from omnigent.harness_plugins import harness_capabilities, valid_harnesses
from omnigent.runner.native_controls import NativeControls
from omnigent.session_controls import (
    CLEAR,
    COMPACT,
    SESSION_CONTROL_HANDLERS,
    SessionControlHandler,
    offered_session_controls,
    session_control_handler,
)

_ENTRIES = [
    (control, harness, entry)
    for control, handlers in SESSION_CONTROL_HANDLERS.items()
    for harness, entry in handlers.items()
]


@pytest.mark.parametrize(
    ("control", "harness", "entry"),
    _ENTRIES,
    ids=[f"{control}-{harness}" for control, harness, _ in _ENTRIES],
)
def test_every_entry_names_a_real_handler_and_harness(
    control: str, harness: str, entry: SessionControlHandler
) -> None:
    # The runner looks the handler up by this name, so a typo would only fail
    # when that harness's session asks for the control.
    handler_names = {field.name for field in dataclasses.fields(NativeControls)}
    assert entry.handler in handler_names, f"{control}/{harness} names no NativeControls handler"
    assert harness in valid_harnesses()


def test_a_harness_that_declares_compaction_has_a_compact_handler() -> None:
    # ``compaction=True`` is the bench's claim that the harness can compact;
    # the runner must be able to act on it.
    declared = {
        harness
        for harness, capabilities in harness_capabilities().items()
        if capabilities.compaction is True
    }
    assert declared, "expected at least one harness to declare compaction"
    assert declared <= set(SESSION_CONTROL_HANDLERS[COMPACT])


def test_handler_lookup_follows_the_table() -> None:
    assert session_control_handler(COMPACT, "codex-native", {}) == "handle_codex_native_compact"
    assert session_control_handler(CLEAR, "claude-native", {}) == "handle_claude_native_clear"
    # No handler: the runner answers 204 and the server reports "not available".
    assert session_control_handler(COMPACT, "kiro-native", {}) is None
    assert session_control_handler(COMPACT, None, {}) is None
    assert session_control_handler("model_change", "codex-native", {}) is None


def test_claude_sdk_clear_needs_the_server_to_continue_in_a_new_session() -> None:
    marked = {"type": "clear", "continue_in_new_session": True}
    assert session_control_handler(CLEAR, "claude-sdk", marked) == "handle_claude_sdk_clear"
    # An older server's plain clear stays unsupported.
    assert session_control_handler(CLEAR, "claude-sdk", {"type": "clear"}) is None
    assert session_control_handler(CLEAR, "claude-sdk", None) is None
    truthy_but_not_true = {"type": "clear", "continue_in_new_session": "yes"}
    assert session_control_handler(CLEAR, "claude-sdk", truthy_but_not_true) is None


def test_offered_controls_leave_out_handlers_no_client_surfaces() -> None:
    offered = offered_session_controls()
    assert offered["codex-native"] == [COMPACT, CLEAR]
    assert offered["claude-sdk"] == [COMPACT, CLEAR]
    # The runner clears an OpenCode session, but clients are not told to offer it.
    assert session_control_handler(CLEAR, "opencode-native", {}) is not None
    assert offered["opencode-native"] == [COMPACT]
    assert "kiro-native" not in offered


def test_the_harness_catalog_reports_the_offered_controls() -> None:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from omnigent.server.routes.harnesses import create_harnesses_router

    app = FastAPI()
    app.include_router(create_harnesses_router(), prefix="/v1")
    body = TestClient(app).get("/v1/harnesses").json()
    assert body["session_controls"] == offered_session_controls()
    # Native wrappers are not picker rows, so their controls are keyed by harness id.
    assert "codex-native" not in {row["id"] for row in body["data"]}
    assert body["session_controls"]["codex-native"] == [COMPACT, CLEAR]
