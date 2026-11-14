import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeActions, makeDb, makeState } from "../settings/testFixtures";
import { Onboarding } from "./Onboarding";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));
vi.mock("@freddai/shared/apps/registry", () => ({ openApp: vi.fn(async () => {}) }));
vi.mock("../chat", () => ({ ChatPanel: () => <div data-testid="chat-panel" /> }));

afterEach(cleanup);

const setup = (step: number, actions = makeActions(), onStep = vi.fn()) => {
  render(<Onboarding state={makeState()} db={makeDb()} actions={actions} step={step} onStep={onStep} onDone={vi.fn()} onSkip={vi.fn()} />);
  return { actions, onStep };
};

describe("Onboarding", () => {
  it("shows the six-step strip with the current step and the chat rail", () => {
    setup(3);
    const strip = screen.getByRole("list", { name: "Onboarding progress" });
    expect(within(strip).getAllByRole("button")).toHaveLength(6);
    expect(within(strip).getByRole("button", { name: /3 Workspaces/ }).getAttribute("aria-current")).toBe("step");
    expect(screen.getByTestId("chat-panel")).toBeTruthy();
  });

  it("step 1 is the Welcome slide and Next goes to where it all comes from", async () => {
    const { actions, onStep } = setup(1);
    expect(screen.getByRole("heading", { level: 1, name: /Throw everything at me/ })).toBeTruthy();
    expect(screen.getByText(/Scout gathers what's coming at you, per account/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Next: where it all comes from/ }));
    expect(onStep).toHaveBeenCalledWith(2);
    expect(actions.settingsSave).not.toHaveBeenCalled();
  });

  it("step 2 is the sources step and Next goes to workspaces", async () => {
    const { onStep } = setup(2);
    expect(screen.getByRole("heading", { level: 1, name: "Where's it all coming from?" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Next: workspaces/ }));
    expect(onStep).toHaveBeenCalledWith(3);
  });

  it("step 3 assignment creates a routing rule with the project id", async () => {
    const { actions } = setup(4);
    await userEvent.selectOptions(screen.getByLabelText("Project for Gmail · you@livecase.example"), "p2");
    expect(actions.ruleSave).toHaveBeenCalledWith(expect.objectContaining({
      name: "Route Gmail · you@livecase.example",
      when_text: "something arrives from Gmail · you@livecase.example",
      then_text: "add it to Support",
      project: "p2",
    }));
  });

  it("step 3 drag and drop onto a project also creates the rule", () => {
    const { actions } = setup(4);
    const data = new Map<string, string>([["text/plain", "s1"]]);
    const dataTransfer = { getData: (t: string) => data.get(t) ?? "", setData: () => {} };
    fireEvent.drop(screen.getByTestId("drop-p1"), { dataTransfer });
    expect(actions.ruleSave).toHaveBeenCalledWith(expect.objectContaining({ project: "p1", then_text: "add it to Sales" }));
  });

  it("step 6 creates an item and Finish calls onDone", async () => {
    const actions = makeActions();
    const onDone = vi.fn();
    render(<Onboarding state={makeState()} db={makeDb()} actions={actions} step={6} onStep={vi.fn()} onDone={onDone} onSkip={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("What is it?"), "Reply to Jordan");
    await userEvent.click(screen.getByRole("button", { name: "Create item" }));
    expect(actions.itemSave).toHaveBeenCalledWith(expect.objectContaining({ title: "Reply to Jordan", project: "p1", lane: "focus", origin: "user" }));
    await userEvent.click(screen.getByRole("button", { name: /Finish/ }));
    expect(onDone).toHaveBeenCalled();
  });
});
