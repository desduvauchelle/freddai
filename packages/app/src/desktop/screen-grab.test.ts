import { describe, expect, it, vi } from "vitest";
import { mergeAttachments, runScreenGrab, type ScreenGrabDeps } from "./screen-grab";
import type { Attachment } from "./types";

const shot: Attachment = { id: "a1", name: "screen-grab-1.png", bytes: 10, mime: "image/png", sha256: "abc" };

function setup(result: unknown, overrides: Partial<ScreenGrabDeps> = {}) {
  const drafts: Record<string, Attachment[]> = {};
  const deps = {
    invoke: vi.fn(async () => { if (result instanceof Error) throw result; return result; }) as unknown as ScreenGrabDeps["invoke"],
    currentThread: "t1",
    isLive: (t: string) => t === "t1" || t === "new",
    openNewThread: vi.fn(),
    addAttachments: vi.fn((target: string, files: Attachment[]) => { drafts[target] = mergeAttachments(drafts[target] ?? [], files); }),
    focusComposer: vi.fn(),
    showError: vi.fn(),
    showNotice: vi.fn(),
    logEvent: vi.fn(),
    ...overrides,
  } satisfies ScreenGrabDeps;
  return { deps, drafts };
}

describe("runScreenGrab", () => {
  it("cancel (null from Esc) does nothing and shows no error", async () => {
    const { deps, drafts } = setup(null);
    expect(await runScreenGrab("current", deps)).toBe("cancelled");
    expect(deps.invoke).toHaveBeenCalledWith("capture_screenshot");
    expect(deps.showError).not.toHaveBeenCalled();
    expect(deps.addAttachments).not.toHaveBeenCalled();
    expect(deps.focusComposer).not.toHaveBeenCalled();
    expect(deps.openNewThread).not.toHaveBeenCalled();
    expect(drafts).toEqual({});
  });

  it("cancel for a new thread does not open the composer", async () => {
    const { deps } = setup(null);
    await runScreenGrab("new", deps);
    expect(deps.openNewThread).not.toHaveBeenCalled();
  });

  it("failure is shown visibly and logged by name", async () => {
    const { deps } = setup(new Error("Screen Recording permission is not granted. Grant it in System Settings"));
    expect(await runScreenGrab("current", deps)).toBe("error");
    expect(deps.showError).toHaveBeenCalledWith(expect.stringContaining("Screen Recording permission"));
    expect(deps.logEvent).toHaveBeenCalledWith("screen_grab.failed", expect.stringContaining("Screen Recording"));
    expect(deps.addAttachments).not.toHaveBeenCalled();
  });

  it("attaches to the current thread's own draft and focuses its composer", async () => {
    const { deps, drafts } = setup([shot]);
    expect(await runScreenGrab("current", deps)).toBe("attached");
    expect(drafts).toEqual({ t1: [shot] });
    expect(deps.focusComposer).toHaveBeenCalledWith("t1");
    expect(deps.openNewThread).not.toHaveBeenCalled();
  });

  it("start new thread opens the composer, attaches to it, and focuses it", async () => {
    const { deps, drafts } = setup([shot]);
    expect(await runScreenGrab("new", deps)).toBe("attached");
    expect(deps.openNewThread).toHaveBeenCalledOnce();
    expect(drafts).toEqual({ new: [shot] });
    expect(deps.focusComposer).toHaveBeenCalledWith("new");
  });

  it("does not attach to a thread that closed during the capture", async () => {
    const { deps, drafts } = setup([shot], { isLive: () => false });
    expect(await runScreenGrab("current", deps)).toBe("cancelled");
    expect(deps.showNotice).toHaveBeenCalled();
    expect(drafts).toEqual({});
  });

  it("with no thread selected, current is a no-op without invoking capture", async () => {
    const { deps } = setup([shot], { currentThread: "" });
    expect(await runScreenGrab("current", deps)).toBe("cancelled");
    expect(deps.invoke).not.toHaveBeenCalled();
  });
});

describe("mergeAttachments", () => {
  it("skips content that is already attached", () => {
    expect(mergeAttachments([shot], [{ ...shot, id: "a2" }])).toEqual([shot]);
  });
});
