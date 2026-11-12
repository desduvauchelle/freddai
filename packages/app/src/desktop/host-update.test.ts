import { describe, expect, it } from "vitest";
import { launchErrorMessage } from "./host-update";

describe("launchErrorMessage", () => {
  it("explains host-rejected options while an update is pending", () => {
    expect(launchErrorMessage("Unsupported reasoning effort", { host_update_pending: true })).toBe(
      'Unsupported reasoning effort. The background host has not restarted since the last update, so this option is not available yet. Use "Restart now" in the update banner.',
    );
    expect(launchErrorMessage("Invalid model configuration", { host_update_pending: true })).toContain("Restart now");
  });
  it("leaves unrelated errors unchanged while an update is pending", () => {
    expect(launchErrorMessage("Network down", { host_update_pending: true })).toBe("Network down");
  });
  it("leaves errors unchanged when no update is pending", () => {
    expect(launchErrorMessage("Unsupported reasoning effort", { host_update_pending: false })).toBe("Unsupported reasoning effort");
    expect(launchErrorMessage("Unsupported reasoning effort", null)).toBe("Unsupported reasoning effort");
  });
});
