import { describe, it, expect } from "vitest";
import { ConversationMergeSession, mergeAiConversation } from "../index";

function assert(cond: unknown, msg: string): asserts cond {
  expect(cond, msg).toBeTruthy();
}

describe("session", () => {
  it("matches previous script coverage", () => {
    function chunk(content) {
      return {
        event: "message",
        data: JSON.stringify({
          id: "x",
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: { content } }],
        }),
      };
    }

    const events = [chunk("Hel"), chunk("lo"), chunk("!")];
    const oneShot = mergeAiConversation(events);

    const session = new ConversationMergeSession();
    session.push(events.slice(0, 1));
    session.push(events.slice(0, 2));
    session.push(events);
    const incremental = session.snapshot();

    assert(
      oneShot.channels.content === "Hello!",
      `oneShot content got ${oneShot.channels.content}`,
    );
    assert(
      incremental.channels.content === oneShot.channels.content,
      "incremental matches one-shot content",
    );
    assert(incremental.profile === oneShot.profile, "profile match");
    assert(session.consumedCount === 3, "consumed all");

    // Further push with no new events is a no-op
    session.push(events);
    assert(session.snapshot().channels.content === "Hello!", "idempotent");
  });

  it("replays the whole stream when the profile is forced", () => {
    function chunk(content: string) {
      return {
        event: "message",
        data: JSON.stringify({
          id: "x",
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: { content } }],
        }),
      };
    }

    const events = [chunk("Hel"), chunk("lo")];
    const session = new ConversationMergeSession();
    session.push(events);
    expect(session.snapshot().profile).toBe("openai-compatible");
    expect(session.snapshot().profileOverride).toBeNull();
    expect(session.snapshot().channels.content).toBe("Hello");

    session.setForcedProfile("deepseek-web");
    session.push(events);
    const forced = session.snapshot();
    expect(forced.profile).toBe("deepseek-web");
    expect(forced.profileOverride).toBe("deepseek-web");
    expect(forced.vendorHint).toBe("deepseek");
    expect(forced.channels.content).toBe("");

    session.setForcedProfile("openai-compatible");
    session.push(events);
    session.push([...events, chunk("!")]);
    const replayed = session.snapshot();
    expect(replayed.profileOverride).toBe("openai-compatible");
    expect(replayed.channels.content).toBe("Hello!");

    session.setForcedProfile(null);
    session.push([...events, chunk("!")]);
    const detected = session.snapshot();
    expect(detected.profile).toBe("openai-compatible");
    expect(detected.profileOverride).toBeNull();
    expect(detected.channels.content).toBe("Hello!");
  });
});
