import { describe, expect, it } from "vitest";
import { detectAiProfile, isAcpProtocolPayload } from "../../ai-profile";
import { conversationHasContent, mergeAiConversation } from "../index";

describe("acp snapshot-only streams", () => {
  it("treats SessionUpdates inside updates[] as protocol payloads", () => {
    expect(
      isAcpProtocolPayload({
        sessionId: "s1",
        version: 3,
        updates: [
          {
            sessionUpdate: "agent_thought",
            messageId: "t1",
            content: [{ type: "text", text: "thinking" }],
          },
        ],
      }),
    ).toBe(true);

    expect(
      isAcpProtocolPayload({
        sessionId: "s1",
        version: 0,
        updates: [],
      }),
    ).toBe(false);
  });

  it("detects and merges a snapshot-only conversation (no JSON-RPC update frames)", () => {
    const events = [
      {
        event: "snapshot",
        data: JSON.stringify({
          sessionId: "s1",
          version: 2,
          updates: [
            {
              sessionUpdate: "agent_thought",
              messageId: "th1",
              content: [{ type: "text", text: "only thought" }],
            },
            {
              sessionUpdate: "agent_message",
              messageId: "m1",
              content: [{ type: "text", text: "only message" }],
            },
          ],
        }),
      },
    ];

    const det = detectAiProfile(events, "https://example.test/whatever");
    expect(det.profile).toBe("acp");
    expect(det.vendorHint).toBe("acp");

    const merged = mergeAiConversation(events, "https://example.test/whatever");
    expect(merged.profile).toBe("acp");
    expect(merged.channels.reasoning).toContain("only thought");
    expect(merged.channels.content).toContain("only message");
    expect(merged.channels.content).not.toContain("only thought");
    expect(merged.channels.reasoning).not.toContain("only message");
    expect(conversationHasContent(merged)).toBe(true);
  });
});
