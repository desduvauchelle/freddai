// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@rive-app/react-canvas", () => ({
  Alignment: { Center: 0 }, Fit: { Contain: 0 }, Layout: class {},
  RuntimeLoader: { setWasmUrl: vi.fn(), setWasmFallbackUrl: vi.fn(), setWasmThreadsUrl: vi.fn() },
  useRive: () => ({ rive: { viewModelInstance: {} }, RiveComponent: () => null }),
  useViewModelInstanceNumber: () => ({ setValue: vi.fn() }),
  useViewModelInstanceTrigger: () => ({ trigger: vi.fn() }),
}));

import { Dormouse } from "./Dormouse";
import { playAntic, resetAntics } from "./mascot-antics";

beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); resetAntics(); vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))); });
afterEach(() => { cleanup(); resetAntics(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Dormouse antics", () => {
  it("shows data-mascot-antic at mood 0 with antics on, and never at mood 2", () => {
    const { container } = render(<><Dormouse size={56} mood={0} label="Ready" antics /><Dormouse size={56} mood={2} label="Working" antics /></>);
    const [idle, busy] = Array.from(container.querySelectorAll<HTMLElement>(".dormouse-companion"));
    expect(idle.dataset.mascotAntic).toBeUndefined();
    act(() => { playAntic(9); });
    expect(idle.dataset.mascotAntic).toBe("Hula");
    expect(idle.dataset.mascotState).toBe("9");
    expect(busy.dataset.mascotAntic).toBeUndefined();
    expect(busy.dataset.mascotState).toBe("2");
    expect(screen.getAllByRole("button", { name: /Hula break/ }).length).toBe(1);
  });

  it("stays plain when antics is off", () => {
    const { container } = render(<Dormouse size={56} mood={0} label="Ready" />);
    act(() => { playAntic(9); });
    expect(container.querySelector<HTMLElement>(".dormouse-companion")!.dataset.mascotAntic).toBeUndefined();
  });
});
