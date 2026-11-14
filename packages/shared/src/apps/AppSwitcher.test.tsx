import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { AppSwitcher } from "./AppSwitcher";

afterEach(() => { cleanup(); invoke.mockReset(); });

describe("AppSwitcher", () => {
  it("lists three apps with Tucky disabled", async () => {
    render(<AppSwitcher current="scout" />);
    await userEvent.click(screen.getByRole("button", { name: "Switch app" }));
    const items = await screen.findAllByRole("menuitem");
    expect(items.map(i => i.textContent)).toEqual([expect.stringContaining("Freddai"), expect.stringContaining("Scout"), expect.stringContaining("Tucky")]);
    expect(items[2].hasAttribute("data-disabled")).toBe(true);
    expect(items[2].textContent).toContain("Soon");
    expect(items[1].getAttribute("aria-current")).toBe("true");
  });

  it("shows an inline error when opening fails", async () => {
    invoke.mockRejectedValueOnce(new Error("main window gone"));
    render(<AppSwitcher current="scout" />);
    await userEvent.click(screen.getByRole("button", { name: "Switch app" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Freddai/ }));
    expect((await screen.findByRole("alert")).textContent).toBe("main window gone");
  });
});
