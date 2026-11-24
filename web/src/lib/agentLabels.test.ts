import { describe, expect, it, vi } from "vitest";
import { authenticatedFetch } from "@/lib/identity";
import { fetchHarnessCatalog } from "./agentLabels";
import { LEGACY_SESSION_CONTROLS } from "./sessionControls";

vi.mock("@/lib/identity", () => ({ authenticatedFetch: vi.fn() }));

describe("fetchHarnessCatalog", () => {
  it("collects the rows that declare workspace_file_mentions", async () => {
    vi.mocked(authenticatedFetch).mockResolvedValue(
      Response.json({
        data: [
          {
            id: "claude-sdk",
            label: "Claude SDK",
            capabilities: { workspace_file_mentions: true },
          },
          { id: "codex", label: "Codex", capabilities: { workspace_file_mentions: null } },
          { id: "pi", label: "Pi" },
        ],
      }),
    );

    const catalog = await fetchHarnessCatalog();

    expect(catalog.fileMentionHarnesses).toEqual(new Set(["claude-sdk"]));
  });

  it("reads the session controls the server reports for each harness", async () => {
    vi.mocked(authenticatedFetch).mockResolvedValue(
      Response.json({
        data: [],
        // Keyed by harness id, so a native wrapper is covered without a picker row.
        session_controls: { "codex-native": ["compact", "clear"], "kiro-native": [] },
      }),
    );

    const catalog = await fetchHarnessCatalog();

    expect(catalog.sessionControls).toEqual({
      "codex-native": ["compact", "clear"],
      "kiro-native": [],
    });
  });

  it("assumes an older server's controls when it reports none", async () => {
    vi.mocked(authenticatedFetch).mockResolvedValue(Response.json({ data: [] }));

    const catalog = await fetchHarnessCatalog();

    expect(catalog.sessionControls).toBe(LEGACY_SESSION_CONTROLS);
  });
});
