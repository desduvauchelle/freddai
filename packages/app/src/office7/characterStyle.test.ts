import { afterEach, describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { CHARACTER_COLOR_KEY, CHARACTER_STYLE_KEY, readCharacterColorMode, readCharacterStyle, useCharacterSettings } from "./characterStyle";

afterEach(() => localStorage.clear());

describe("character settings", () => {
  it("defaults and ignores junk values", () => {
    expect(readCharacterStyle()).toBe("blob");
    expect(readCharacterColorMode()).toBe("project");
    localStorage.setItem(CHARACTER_STYLE_KEY, "minion");
    localStorage.setItem(CHARACTER_COLOR_KEY, "neon");
    expect(readCharacterStyle()).toBe("blob");
    expect(readCharacterColorMode()).toBe("project");
  });
  it("persists and notifies subscribers", () => {
    const { result } = renderHook(() => useCharacterSettings());
    act(() => { result.current.setStyle("wisp"); result.current.setColor("vivid"); });
    expect(result.current.style).toBe("wisp");
    expect(result.current.color).toBe("vivid");
    expect(localStorage.getItem(CHARACTER_STYLE_KEY)).toBe("wisp");
    expect(localStorage.getItem(CHARACTER_COLOR_KEY)).toBe("vivid");
  });
});
