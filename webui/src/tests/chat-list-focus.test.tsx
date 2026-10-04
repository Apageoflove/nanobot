import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatList } from "@/components/ChatList";
import { RenameChatDialog } from "@/components/RenameChatDialog";
import type { ChatSummary } from "@/lib/types";
import { mockBrowserFocus } from "./browser-focus";

const topic: ChatSummary = {
  key: "websocket:review", chatId: "review", channel: "websocket",
  title: "Review", preview: "", createdAt: "2026-10-04T10:00:00Z",
  updatedAt: "2026-10-04T10:00:00Z",
};

function SidebarFocusCase() {
  const [rename, setRename] = useState<string | null>(null);
  return <>
    <ChatList
      sessions={[topic, {
        ...topic, key: "websocket:group", chatId: "group", title: "Group",
      }, {
        ...topic, key: "websocket:project", chatId: "project", title: "Project task",
        workspaceScope: { project_path: "/workspace/photos", project_name: "Photos", access_mode: "restricted" },
      }]}
      activeKey={topic.key}
      paneGroups={{
        "websocket:group": {
          tabKey: "websocket:group", title: "Group", activePaneKey: "websocket:group",
          panes: [
            { key: "websocket:group", chatId: "group", title: "Group" },
            { key: "websocket:research", chatId: "research", title: "Research" },
          ],
        },
      }}
      onSelect={vi.fn()}
      onRequestDelete={vi.fn()}
      onTogglePin={vi.fn()}
      onToggleArchive={vi.fn()}
      onRequestRename={(_key, title) => setRename(title)}
      onRequestRenameTab={(_key, title) => setRename(title)}
      onRequestRenameProject={(_key, title) => setRename(title)}
    />
    <button>Outside destination</button>
    <RenameChatDialog open={rename !== null} title={rename ?? ""}
      onCancel={() => setRename(null)} onConfirm={() => setRename(null)} />
  </>;
}

describe("sidebar action focus", () => {
  let restoreBrowserFocus: () => void;
  beforeEach(() => { restoreBrowserFocus = mockBrowserFocus(); });
  afterEach(() => {
    restoreBrowserFocus();
    localStorage.removeItem("nanobot-webui.collapsed-pane-groups.v1");
  });

  it.each([
    "Topic actions for Review",
    "Topic actions for Group",
    "Research pane actions",
    "Topic actions for Photos",
  ])("returns Escape focus to %s and allows continued tabbing", async (name) => {
    const user = userEvent.setup();
    render(<SidebarFocusCase />);
    const trigger = screen.getByRole("button", { name, exact: true });
    trigger.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("menu");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.tab();
    expect(trigger).not.toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });

  it("does not reuse Escape focus restoration when the next action opens Rename", async () => {
    const user = userEvent.setup();
    render(<SidebarFocusCase />);
    const trigger = screen.getByRole("button", { name: "Topic actions for Review" });
    trigger.focus();
    await user.keyboard("{Enter}{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("menuitem", { name: "Rename", exact: true }));
    const input = await screen.findByPlaceholderText("Topic name");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    await waitFor(() => expect(input).toHaveFocus());
    await user.keyboard("Updated");
    expect(input).toHaveValue("ReviewUpdated");
  });

  it("keeps an outside click focused on its destination", async () => {
    const user = userEvent.setup();
    render(<SidebarFocusCase />);
    const trigger = screen.getByRole("button", { name: "Topic actions for Review" });
    trigger.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("menu");
    const outside = screen.getByRole("button", { name: "Outside destination" });
    await user.click(outside);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(outside).toHaveFocus();
  });

  it("allows Select to remove the trigger without restoring focus to it", async () => {
    const user = userEvent.setup();
    render(<SidebarFocusCase />);
    const trigger = screen.getByRole("button", { name: "Topic actions for Review" });
    trigger.focus();
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("menuitem", { name: "Select", exact: true }));
    await waitFor(() => expect(trigger).not.toBeInTheDocument());
    expect(trigger).not.toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Topic actions for Review" })).toBeInTheDocument();
  });
});
