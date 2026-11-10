import { expect, it } from "vitest";
import { formatProposalResult } from "./formatResult";

it("turns a started-thread payload into a human line", () => {
  expect(formatProposalResult('{"thread":"cb3cb075-309e-4054-8c4a-08463112d8dc"}')).toBe("Started");
});
it("keeps plain text and defaults empty results", () => {
  expect(formatProposalResult("Scheduled for 9am")).toBe("Scheduled for 9am");
  expect(formatProposalResult(null)).toBe("Approved.");
});
it("never dumps raw JSON", () => {
  expect(formatProposalResult('{"message":"Saved it"}')).toBe("Saved it");
  expect(formatProposalResult('{"status":"queued","count":3,"id":"x"}')).toBe("status: queued · count: 3");
  expect(formatProposalResult('{"nested":{"a":1}}')).toBe("Done.");
  expect(formatProposalResult("[1,2]")).toBe("Done (2 items).");
  expect(formatProposalResult("{broken")).toBe("Done.");
});
