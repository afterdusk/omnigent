import { describe, expect, it } from "vitest";
import { LEGACY_SESSION_CONTROLS, parseSessionControls } from "./sessionControls";

describe("parseSessionControls", () => {
  it("reads the controls reported for each harness", () => {
    expect(
      parseSessionControls({ "codex-native": ["compact", "clear"], "claude-sdk": ["compact"] }),
    ).toEqual({ "codex-native": ["compact", "clear"], "claude-sdk": ["compact"] });
  });

  it.each([undefined, null, "compact", ["compact"]])("reports nothing for %j", (wire) => {
    // An older server omits the field; the caller falls back to what those servers handled.
    expect(parseSessionControls(wire)).toBeNull();
  });

  it("drops malformed entries without losing the rest", () => {
    expect(
      parseSessionControls({ "codex-native": ["compact", 7, null], "pi-native": "compact" }),
    ).toEqual({ "codex-native": ["compact"] });
  });
});

describe("LEGACY_SESSION_CONTROLS", () => {
  it("leaves out native harnesses whose runner never compacted", () => {
    // The composer used to offer /compact on every native terminal, including these.
    for (const harness of ["kiro-native", "antigravity-native", "goose-native", "kimi-native"]) {
      expect(LEGACY_SESSION_CONTROLS[harness]).toBeUndefined();
    }
    expect(LEGACY_SESSION_CONTROLS["codex-native"]).toEqual(["compact", "clear"]);
  });
});
