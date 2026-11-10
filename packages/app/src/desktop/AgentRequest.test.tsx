import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Permission } from "./AgentRequest";
afterEach(cleanup);
const pending = { id: "mcp-42", method: "mcpServer/elicitation/request", params: { serverName: "Freddai", mode: "form", message: "Approve LiveCase task?", requestedSchema: { type: "object", required: ["approved"], properties: { approved: { type: "boolean", title: "Approve task" } } } } };
it("shows the MCP message and submits typed input only after a decision", async () => {
  const onReply = vi.fn();
  render(<Permission pending={pending} provider="codex" onReply={onReply} />);
  expect(screen.getByText("Approve LiveCase task?")).toBeTruthy();
  fireEvent.click(screen.getByText("Allow once"));
  expect(onReply).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Approve task"), { target: { value: "true" } });
  fireEvent.click(screen.getByText("Allow once"));
  expect(onReply).toHaveBeenCalledWith(true, { approved: true });
});
it("allows declining without completing a form", () => {
  const onReply = vi.fn();
  render(<Permission pending={pending} provider="codex" onReply={onReply} />);
  fireEvent.click(screen.getByText("Decline"));
  expect(onReply).toHaveBeenCalledWith(false, {});
});
