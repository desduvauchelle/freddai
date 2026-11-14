import { describe, expect, it } from "vitest";
import { latestDraft } from "./draft";

describe("latestDraft", () => {
  it("reads a ```draft block from the latest assistant message only", () => {
    const text = "Shortened it.\n\n```draft\nTo: jordan@acme.example\nSubject: Re: Pricing\n\nHi Jordan,\n\nThursday at 2?\n```\n";
    expect(latestDraft([{ id: "m1", role: "assistant", text }])).toEqual({
      messageId: "m1", to: "jordan@acme.example", subject: "Re: Pricing", body: "Hi Jordan,\n\nThursday at 2?",
    });
    expect(latestDraft([{ id: "m1", role: "assistant", text }, { id: "m2", role: "assistant", text: "Sent nothing yet." }])).toBeNull();
    expect(latestDraft([{ id: "m1", role: "assistant", text: "```ts\nconst a = 1\n```" }])).toBeNull();
  });
});
