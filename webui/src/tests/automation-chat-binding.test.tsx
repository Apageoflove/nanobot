import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AutomationDetailDialog } from "@/components/settings/system/AutomationsSettings";
import { fetchAutomationChats } from "@/lib/api";
import type { AutomationChatsPayload, SessionAutomationJob } from "@/lib/types";

vi.mock("@/lib/api", () => ({ fetchAutomationChats: vi.fn() }));
const source = { id: "source", title: "My planning", channel: "websocket" };
const target = { id: "target", title: "Product team", channel: "telegram" };
const choices: AutomationChatsPayload = { revision: "rev-1", current: source, chats: [source, target] };
const job: SessionAutomationJob = {
  id: "daily", name: "Daily report", enabled: true, chat_binding_revision: "rev-1",
  schedule: { kind: "every", every_ms: 86400000 }, state: {},
  payload: { message: "Summarize the work." }, origin: { ...source, session_key: "websocket:source" },
};
const props = { open: true, locale: "en", actionKey: null, error: null,
  onOpenChange: vi.fn(), onAction: vi.fn(), onRequestEdit: vi.fn(), onRequestDelete: vi.fn() };
beforeEach(() => { vi.mocked(fetchAutomationChats).mockResolvedValue(choices); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

async function choose() {
  const control = await screen.findByRole("combobox", { name: "Task chat" });
  await waitFor(() => expect(control).toBeEnabled());
  fireEvent.keyDown(control, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: /Product team/ }));
  await screen.findByRole("heading", { name: "Change chat" });
}

it("keeps the original route until acknowledgement and saves the reviewed prompt", async () => {
  let finish!: () => void;
  const save = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const user = userEvent.setup();
  render(<AutomationDetailDialog {...props} job={job} onChangeChat={save} />);
  await choose();
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByText(/Previous chat:/)).toHaveTextContent("My planning");
  await user.clear(screen.getByRole("textbox", { name: "Task instructions" }));
  await user.type(screen.getByRole("textbox", { name: "Task instructions" }), "New instructions");
  await user.click(screen.getByRole("button", { name: "Confirm change" }));
  expect(save).toHaveBeenCalledWith(job, { target_id: "target", revision: "rev-1", message: "New instructions" });
  expect(screen.getByRole("button", { name: "Changing…" })).toBeDisabled();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  await act(async () => finish());
  expect(await screen.findByRole("status")).toHaveTextContent("Applies to future runs");
  expect(props.onAction).not.toHaveBeenCalled();
});

it("keeps a rejected draft and its original revision across polling", async () => {
  const user = userEvent.setup();
  const save = vi.fn().mockRejectedValue(new Error("automation_chat_conflict"));
  const { rerender } = render(<AutomationDetailDialog {...props} job={job} onChangeChat={save} />);
  await choose();
  await user.type(screen.getByRole("textbox", { name: "Task instructions" }), " Reviewed");
  rerender(<AutomationDetailDialog {...props} job={{ ...job, chat_binding_revision: "rev-2" }} onChangeChat={save} />);
  await user.click(screen.getByRole("button", { name: "Confirm change" }));
  expect(save.mock.calls[0][1].revision).toBe("rev-1");
  expect(await screen.findByRole("alert")).toHaveTextContent("draft is kept");
  expect(screen.getByRole("textbox", { name: "Task instructions" })).toHaveValue("Summarize the work. Reviewed");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("combobox", { name: "Task chat" })).toHaveTextContent("My planning");
});

it("does not send the new request to an old host and locks a pending task", async () => {
  const save = vi.fn();
  const { rerender } = render(<AutomationDetailDialog {...props} job={{ ...job, chat_binding_revision: undefined }} onChangeChat={save} />);
  expect(fetchAutomationChats).not.toHaveBeenCalled();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  rerender(<AutomationDetailDialog {...props} job={{ ...job, state: { pending: true } }} onChangeChat={save} />);
  expect(await screen.findByRole("combobox", { name: "Task chat" })).toBeDisabled();
  expect(save).not.toHaveBeenCalled();
});

it("keeps the current chat visible when discovery fails and permits a retry", async () => {
  const user = userEvent.setup();
  vi.mocked(fetchAutomationChats).mockRejectedValueOnce(new Error("offline"));
  render(<AutomationDetailDialog {...props} job={job} onChangeChat={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: "Retry loading chats" }));
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Task chat" })).toBeEnabled());
  expect(fetchAutomationChats).toHaveBeenCalledTimes(2);
});
