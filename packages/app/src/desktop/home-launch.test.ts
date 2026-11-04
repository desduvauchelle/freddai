import { expect, it } from "vitest";
import { resolveHomeLaunch } from "./home-launch";
import { empty, type Database } from "./types";

const acct = (id: string) => ({ id, name: id, provider: "claude" }) as unknown as Database["accounts"][number];
const proj = (over: Partial<Database["projects"][number]> = {}) => ({ id: "p", name: "P", path: "/p", color: "#fff", policy: "inherit", account: null, last: null, ...over }) as Database["projects"][number];
const db = (over: Partial<Database> = {}): Database => ({ ...empty, accounts: [acct("proj"), acct("global")], projects: [proj()], preferences: { ...empty.preferences, fallback: "global" }, ...over });

it("uses the project's own default agent when it has one", () => {
  const plan = resolveHomeLaunch(db({ projects: [proj({ policy: "fixed", account: "proj" })] }), "p", "default" as never);
  expect(plan.ok && plan.account).toBe("proj");
});

it("falls back to the global default when the project has none", () => {
  const plan = resolveHomeLaunch(db({ projects: [proj({ policy: "fixed", account: null })] }), "p", "default" as never);
  expect(plan.ok && plan.account).toBe("global");
});

it("fails with a reason when there is no agent at all", () => {
  const plan = resolveHomeLaunch(db({ preferences: { ...empty.preferences, fallback: null } , projects: [proj({ policy: "fixed", account: null })] }), "p", "default" as never);
  expect(plan.ok).toBe(false);
});
