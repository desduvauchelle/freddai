import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { AttachmentLabel } from "./AttachmentLabel";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const file = { id: "image-id", name: "Screen grab.png", bytes: 1024, mime: "image/png", sha256: "hash" };
it("loads an image on demand and closes with Escape", async () => {
  vi.mocked(invoke).mockResolvedValue("data:image/png;base64,abc");
  const user = userEvent.setup();
  render(<AttachmentLabel file={file}/>);
  expect(invoke).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Preview Screen grab.png" }));
  expect((await screen.findByRole("img")).getAttribute("src")).toBe("data:image/png;base64,abc");
  expect(invoke).toHaveBeenCalledWith("preview_attachment", { id: "image-id" });
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("shows a failed load without removing the attachment", async () => {
  vi.mocked(invoke).mockRejectedValue("Attachment file missing");
  render(<AttachmentLabel file={file}/>);
  await userEvent.click(screen.getByRole("button"));
  expect((await screen.findByRole("alert")).textContent).toContain("Attachment file missing");
});
it("keeps other files as labels", () => {
  render(<AttachmentLabel file={{ ...file, mime: "text/plain" }}/>);
  expect(screen.queryByRole("button")).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
});
