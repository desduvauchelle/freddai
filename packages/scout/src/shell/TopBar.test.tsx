import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "../api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { TopBar } from "./TopBar";

const workspaces = [
  { id: "w2", name: "Recursive Solutions", color: "#7c5cff", order: 1, collapsed: false },
  { id: "w1", name: "LiveCase", color: "#2f6bff", order: 0, collapsed: false },
] as Workspace[];

function setup(overrides: Partial<Parameters<typeof TopBar>[0]> = {}) {
  const props = {
    workspaces,
    search: "",
    onSearch: vi.fn(),
    workspaceFilter: null,
    onWorkspaceFilter: vi.fn(),
    chatOpen: false,
    onToggleChat: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides,
  };
  render(<TopBar {...props} />);
  return props;
}

describe("TopBar", () => {
  afterEach(cleanup);
  it("calls onSearch as the user types", () => {
    const props = setup();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search everything" }), { target: { value: "acme" } });
    expect(props.onSearch).toHaveBeenCalledWith("acme");
  });

  it("lists every workspace in the filter and selects one", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole("button", { name: /Workspace filter: All workspaces/ }));
    const options = await screen.findAllByRole("menuitemradio");
    expect(options.map(o => o.textContent)).toEqual(["All workspaces", "LLiveCase", "RRecursive Solutions"]);
    await user.click(screen.getByRole("menuitemradio", { name: /Recursive Solutions/ }));
    expect(props.onWorkspaceFilter).toHaveBeenCalledWith("w2");
  });

  it("toggles chat and opens settings", async () => {
    const user = userEvent.setup();
    const props = setup({ chatOpen: true });
    await user.click(screen.getByRole("button", { name: "Close chat" }));
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(props.onToggleChat).toHaveBeenCalledTimes(1);
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("hides search and filter in minimal mode", () => {
    setup({ mode: "minimal" });
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /Workspace filter/ })).toBeNull();
  });
});
