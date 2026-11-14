import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OFFICE_VERSIONS, OFFICE_VERSION_EVENT, OFFICE_VERSION_KEY, readOfficeVersion, writeOfficeVersion } from "./officeVersion";
import { OfficeVersionPicker } from "./OfficeVersionPicker";

afterEach(() => { cleanup(); localStorage.clear(); });

it("defaults to v7 and reads stored versions; retired versions fall back to Campus", () => {
  expect(readOfficeVersion()).toBe("v7");
  for (const v of ["v1", "v7"]) { localStorage.setItem(OFFICE_VERSION_KEY, v); expect(readOfficeVersion()).toBe(v); }
  for (const v of ["v2", "v3", "v4", "v5", "v6", "junk"]) { localStorage.setItem(OFFICE_VERSION_KEY, v); expect(readOfficeVersion()).toBe("v7"); }
});

it("write persists and dispatches the sync event", () => {
  const on = vi.fn();
  window.addEventListener(OFFICE_VERSION_EVENT, on);
  writeOfficeVersion("v1");
  window.removeEventListener(OFFICE_VERSION_EVENT, on);
  expect(localStorage.getItem(OFFICE_VERSION_KEY)).toBe("v1");
  expect(on).toHaveBeenCalledTimes(1);
});

it("lists Classic and Campus", () => {
  expect(OFFICE_VERSIONS.map(v => v.label)).toEqual(["Classic", "Campus"]);
});

it("picker is a select with 2 options, shows the current one and writes + dispatches on change", () => {
  render(<OfficeVersionPicker />);
  const select = screen.getByLabelText("Office style") as HTMLSelectElement;
  expect(select.tagName).toBe("SELECT");
  expect(select.options).toHaveLength(2);
  expect(select.value).toBe("v7");
  const on = vi.fn();
  window.addEventListener(OFFICE_VERSION_EVENT, on);
  fireEvent.change(select, { target: { value: "v1" } });
  window.removeEventListener(OFFICE_VERSION_EVENT, on);
  expect(localStorage.getItem(OFFICE_VERSION_KEY)).toBe("v1");
  expect(on).toHaveBeenCalledTimes(1);
  expect(select.value).toBe("v1");
});
