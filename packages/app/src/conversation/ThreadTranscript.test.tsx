// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ThreadTranscript } from "./ThreadTranscript";

const file = { id: "f1", name: "notes.txt", mime: "text/plain", bytes: 12, sha256: "x" };
afterEach(cleanup);

describe("ThreadTranscript", () => {
  it("renders user bubbles with attachments, assistant markdown and grouped tool activity", () => {
    const { container } = render(<ThreadTranscript messages={[
      { id: "1", role: "user", text: "Fix the bug", attachments: [file] },
      { id: "2", role: "assistant", text: "Here is **bold** and `code`." },
      { id: "3", role: "tool", text: "Bash ls" },
      { id: "4", role: "tool", text: "Read a.ts" },
    ]} />);
    const user = screen.getByLabelText("Your message");
    expect(user.className).toBe("chat-user");
    expect(user.textContent).toContain("Fix the bug");
    expect(user.querySelector(".attachment-chip")?.textContent).toBe("notes.txt");
    const assistant = screen.getByLabelText("Assistant message");
    expect(assistant.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelectorAll("details.tool-activity")).toHaveLength(1);
    expect(screen.getByText(/Tool activity · 2 calls/)).toBeTruthy();
    // No role labels on any density.
    expect(container.querySelector("article > small")).toBeNull();
  });

  it("shows pending outgoing messages with their status line", () => {
    render(<ThreadTranscript messages={[]} pending={[{ id: "p1", text: "Queued thing", attachments: [file], status: "Queued on your Mac" }]} />);
    const pending = screen.getByLabelText("Your message");
    expect(pending.textContent).toContain("Queued thing");
    expect(pending.querySelector("[role=status]")?.textContent).toBe("Queued on your Mac");
  });

  it("applies the density attribute and renders trailing children", () => {
    const { container, rerender } = render(<ThreadTranscript messages={[]} density="compact"><p role="alert">Boom</p></ThreadTranscript>);
    expect(container.querySelector(".thread-transcript")?.getAttribute("data-density")).toBe("compact");
    expect(screen.getByRole("alert").textContent).toBe("Boom");
    rerender(<ThreadTranscript messages={[]} />);
    expect(container.querySelector(".thread-transcript")?.getAttribute("data-density")).toBe("comfortable");
  });
});
