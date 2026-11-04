import { describe, expect, it, vi } from "vitest";
import { dotClass, interruptedThreads, interruptedBannerText, resumeAll } from "./interrupted";
import { hostUpdateNotice, HOST_UPDATE_NOTICE, runningThreadCount } from "./host-update";

describe("interrupted threads", () => {
  it("maps statuses to dot colors, interrupted is red-class not needs-you", () => {
    expect(dotClass("interrupted")).toBe("Interrupted");
    expect(dotClass("failed")).toBe("Failed");
    expect(dotClass("waiting")).toBe("Needs-you");
    expect(dotClass("unread")).toBe("Needs-you");
    expect(dotClass("running")).toBe("In-progress");
    expect(dotClass("done")).toBe("Done");
  });
  it("counts only live interrupted threads and words the banner", () => {
    const list = interruptedThreads([
      { id: "a", status: "interrupted" }, { id: "b", status: "interrupted", archived: true },
      { id: "c", status: "interrupted", deleted_at: 5 }, { id: "d", status: "done" },
    ] as any);
    expect(list.map(t => (t as any).id)).toEqual(["a"]);
    expect(interruptedBannerText(1)).toBe("1 thread was interrupted.");
    expect(interruptedBannerText(3)).toBe("3 threads were interrupted.");
  });
  it("resume-all resumes each thread, surfaces failures, and logs the count", async () => {
    const resume = vi.fn(async (t: { id: string }) => { if (t.id === "b") throw new Error("boom"); });
    const log = vi.fn();
    const out = await resumeAll([{ id: "a" }, { id: "b" }, { id: "c" }], resume, log);
    expect(resume).toHaveBeenCalledTimes(3);
    expect(out.resumed).toBe(2);
    expect(out.failures).toEqual([{ id: "b", error: "Error: boom" }]);
    expect(log).toHaveBeenCalledWith({ event: "resume_all", count: 3, resumed: 2, failed: 1 });
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "resume_all.failed", thread: "b" }));
  });
});

describe("host update banner text", () => {
  it("states the interruption count when threads run", () => {
    const db = (n: number) => ({ host_update_pending: true, sessions: Array.from({ length: n }, () => ({ status: "running" })).concat([{ status: "done" }]) });
    expect(runningThreadCount(db(2))).toBe(2);
    expect(hostUpdateNotice(db(1))).toBe("Update ready. Restart now to apply — interrupts 1 running thread.");
    expect(hostUpdateNotice(db(2))).toBe("Update ready. Restart now to apply — interrupts 2 running threads.");
    expect(hostUpdateNotice(db(0))).toBe(HOST_UPDATE_NOTICE);
    expect(hostUpdateNotice({ host_update_pending: false })).toBeNull();
  });
});
