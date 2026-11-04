import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Session } from "./types";
import { ConversationActivity } from "./MascotScenes";

vi.mock("./Dormouse", () => ({ Dormouse: ({ mood }: { mood: number }) => <div data-testid="character" data-mood={mood} /> }));
afterEach(cleanup);
const thread: Session = { id: "activity", title: "Synthetic thread", project: "p", account: "a", status: "starting", updated: 1, provider_id: null, messages: [], pending: null, error: null };

it("follows launch, work, input, resume and completion without leaving a loader behind", () => {
  const view = render(<ConversationActivity thread={thread} />);
  expect(screen.getByRole("status").textContent).toBe("Starting…");
  view.rerender(<ConversationActivity thread={{ ...thread, status: "running" }} />);
  expect(screen.getByRole("status").textContent).toBe("Working…");
  expect(screen.getByTestId("character").getAttribute("data-mood")).toBe("2");
  view.rerender(<ConversationActivity thread={{ ...thread, status: "waiting" }} />);
  expect(screen.getByRole("status").textContent).toBe("Waiting for your input…");
  expect(screen.getByTestId("character").getAttribute("data-mood")).toBe("4");
  view.rerender(<ConversationActivity thread={{ ...thread, status: "running" }} />);
  expect(screen.getByRole("status").textContent).toBe("Working…");
  for (const status of ["done", "idle"] as const) {
    view.rerender(<ConversationActivity thread={{ ...thread, status }} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByTestId("character")).toBeNull();
  }
});

it("shows an input request even while running and keeps split panes independent", () => {
  const pending = {} as NonNullable<Session["pending"]>;
  render(<><ConversationActivity thread={{ ...thread, status: "running", pending }} /><ConversationActivity thread={{ ...thread, id: "other", status: "running" }} /></>);
  expect(screen.getAllByRole("status").map(el => el.textContent)).toEqual(["Waiting for your input…", "Working…"]);
  expect(screen.getAllByTestId("character").map(el => el.getAttribute("data-mood"))).toEqual(["4", "2"]);
});

it("replaces working with an accurate interrupted or failure state", () => {
  const view = render(<ConversationActivity thread={{ ...thread, status: "interrupted" }} />);
  expect(screen.getByRole("status").textContent).toBe("Interrupted");
  expect(screen.getByTestId("character").getAttribute("data-mood")).toBe("7");
  view.rerender(<ConversationActivity thread={{ ...thread, status: "failed" }} />);
  expect(screen.getByRole("status").textContent).toBe("Needs attention");
  expect(screen.getByTestId("character").getAttribute("data-mood")).toBe("8");
});
