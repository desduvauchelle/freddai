import { describe, expect, it } from "vitest";
import { VOICE_CALL_SUFFIX, capSpoken, extractSpoken, renderSpoken, stripVoiceCall } from "./voiceCallMarkup";

describe("stripVoiceCall", () => {
  it("removes the instruction block and flags the message", () => {
    expect(stripVoiceCall(`hello there${VOICE_CALL_SUFFIX}`)).toEqual({ text: "hello there", voice: true });
  });
  it("leaves ordinary messages alone", () => {
    expect(stripVoiceCall("hello")).toEqual({ text: "hello", voice: false });
  });
  it("drops an unterminated block", () => {
    expect(stripVoiceCall("hi\n\n<voice-call>Live voice")).toEqual({ text: "hi", voice: true });
  });
});

describe("renderSpoken", () => {
  it("turns the spoken block into a leading paragraph", () => {
    expect(renderSpoken("<spoken>Done, two files changed.</spoken>\n\nDetails here")).toBe("Done, two files changed.\n\nDetails here");
  });
  it("handles an open tag while streaming", () => {
    expect(renderSpoken("<spoken>Working on")).toBe("Working on");
  });
  it("handles a closed block with no detail yet", () => {
    expect(renderSpoken("<spoken>All good.</spoken>").trim()).toBe("All good.");
  });
  it("is a no-op without tags", () => {
    const text = "plain **markdown**";
    expect(renderSpoken(text)).toBe(text);
  });
});

describe("extractSpoken", () => {
  it("uses the spoken block", () => {
    expect(extractSpoken("<spoken>Fixed the bug. Tests pass.</spoken>\n\n```ts\ncode\n```")).toBe("Fixed the bug. Tests pass.");
  });
  it("falls back to the first two sentences with markdown stripped", () => {
    expect(extractSpoken("## Result\n\nI **fixed** the [bug](http://x.y). All tests pass! Extra detail.\n\n- a")).toBe("Result I fixed the bug. All tests pass!");
  });
  it("ignores code blocks in the fallback", () => {
    expect(extractSpoken("```\nrm -rf\n```\nDone.")).toBe("Done.");
  });
  it("caps long text at a sentence boundary", () => {
    const long = `${"Short sentence here. ".repeat(30)}`;
    const out = extractSpoken(`<spoken>${long}</spoken>`);
    expect(out.length).toBeLessThanOrEqual(300);
    expect(out.endsWith(".")).toBe(true);
  });
  it("returns nothing for an empty reply", () => {
    expect(extractSpoken("")).toBe("");
  });
});

describe("capSpoken", () => {
  it("falls back to a word boundary with an ellipsis when there is no sentence end", () => {
    const out = capSpoken("word ".repeat(100), 50);
    expect(out.length).toBeLessThanOrEqual(51);
    expect(out.endsWith("…")).toBe(true);
  });
});
