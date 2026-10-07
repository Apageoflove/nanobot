import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceProjectPicker } from "@/components/thread/WorkspaceControls";
import type { WorkspaceDirectoriesPayload, WorkspacesPayload } from "@/lib/types";

const scope = { project_path: "/srv/workspace", access_mode: "restricted" as const };
const catalog: WorkspacesPayload = {
  schema_version: 1,
  default_access_mode: "default",
  default_scope: scope,
  recent_projects: [{ name: "alpha", path: "/srv/alpha" }, { name: "beta", path: "/srv/beta" }],
  host: { name: "dev-server", platform: "Linux" },
  controls: { can_change_project: true, can_use_full_access: false, can_browse_directories: true },
};
const directory: WorkspaceDirectoriesPayload = {
  path: "/srv/workspace", parent: "/srv", entries: [{ name: "alpha", path: "/srv/workspace/alpha" }],
  truncated: false, host: "dev-server", platform: "Linux",
};

describe("Workspace project picker", () => {
  it("keeps saved locations separate from directory filtering", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onBrowse = vi.fn().mockResolvedValue(directory);
    render(<WorkspaceProjectPicker isHero scope={scope} defaultScope={scope} controls={catalog.controls} onLoadProjects={vi.fn().mockResolvedValue(catalog)} onBrowseDirectories={onBrowse} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Switch working directory" }));
    const shortcut = await screen.findByRole("button", { name: "/srv/beta" });
    await user.clear(screen.getByRole("combobox"));
    await user.type(screen.getByRole("combobox"), "al");
    await waitFor(() => expect(onBrowse).toHaveBeenLastCalledWith("/srv/workspace", "al", false, true));
    expect(shortcut).toBeInTheDocument();
    expect(screen.getAllByRole("listbox")).toHaveLength(1);
    onBrowse.mockResolvedValue({ ...directory, path: "/srv/beta", entries: [] });
    await user.click(shortcut);
    await waitFor(() => expect(screen.getByRole("button", { name: "Select" })).toBeEnabled());
    expect(screen.getAllByRole("listbox")).toHaveLength(1);
    expect(screen.getByRole("combobox")).toHaveValue("/srv/beta/");
    expect(onChange).not.toHaveBeenCalled();
    await user.clear(screen.getByRole("combobox"));
    await user.type(screen.getByRole("combobox"), "oth");
    await waitFor(() => expect(onBrowse).toHaveBeenLastCalledWith("/srv/beta", "oth", false, true));
    expect(shortcut).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Select" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Select" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ project_path: "/srv/beta", access_mode: "restricted" }));
  });

  it("shows cached directories without loading again when revisiting or reopening", async () => {
    const user = userEvent.setup();
    const onBrowse = vi.fn((path: string) => Promise.resolve(path.replace(/\/$/, "") === scope.project_path
      ? directory : { ...directory, path: "/srv/workspace/alpha", entries: [] }));
    render(<WorkspaceProjectPicker isHero scope={scope} defaultScope={scope} controls={catalog.controls} onBrowseDirectories={onBrowse} onChange={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Switch working directory" }));
    await user.click(await screen.findByRole("option", { name: "/srv/workspace/alpha" }));
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(onBrowse).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", { name: "/srv/workspace" }));
    expect(screen.getByRole("option", { name: "/srv/workspace/alpha" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(onBrowse).toHaveBeenCalledTimes(2);
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Switch working directory" }));
    expect(screen.getByRole("option", { name: "/srv/workspace/alpha" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(onBrowse).toHaveBeenCalledTimes(2);
  });

  it("scrolls deep directory columns horizontally with Shift and preserves ordinary wheel events", async () => {
    const user = userEvent.setup();
    const onBrowse = vi.fn((path: string) => Promise.resolve(path.replace(/\/$/, "") === scope.project_path
      ? directory : { ...directory, path: "/srv/workspace/alpha", entries: [] }));
    render(<WorkspaceProjectPicker isHero scope={scope} defaultScope={scope} controls={catalog.controls} onBrowseDirectories={onBrowse} onChange={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Switch working directory" }));
    await user.click(await screen.findByRole("option", { name: "/srv/workspace/alpha" }));
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    const viewport = screen.getAllByRole("listbox")[0].closest("[data-workspace-columns]") as HTMLElement;
    Object.defineProperties(viewport, { clientWidth: { value: 300 }, scrollWidth: { value: 600 } });
    viewport.scrollLeft = 0;
    const wheel = (options: WheelEventInit) => fireEvent(viewport, Object.assign(
      new Event("wheel", { bubbles: true, cancelable: true }),
      { deltaX: 0, deltaY: 0, deltaMode: 0, shiftKey: false, ctrlKey: false, metaKey: false, ...options },
    ));
    expect(wheel({ deltaY: 120, shiftKey: true })).toBe(false);
    expect(viewport.scrollLeft).toBe(120);
    expect(wheel({ deltaY: -2, deltaMode: 1, shiftKey: true })).toBe(false);
    expect(viewport.scrollLeft).toBe(88);
    wheel({ deltaY: 120 });
    expect(viewport.scrollLeft).toBe(88);
    wheel({ deltaY: 120, shiftKey: true, ctrlKey: true });
    expect(viewport.scrollLeft).toBe(88);
  });

  it("browses folders immediately, toggles hidden entries, and selects the resolved directory", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onBrowse = vi.fn().mockResolvedValue(directory);
    render(<WorkspaceProjectPicker isHero scope={scope} defaultScope={scope} controls={catalog.controls} onBrowseDirectories={onBrowse} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Switch working directory" }));
    await screen.findByRole("option", { name: "/srv/workspace/alpha" });
    expect(onBrowse).toHaveBeenLastCalledWith("/srv/workspace/", "", false, true);
    await user.click(screen.getByRole("switch", { name: "Show hidden folders" }));
    await waitFor(() => expect(onBrowse).toHaveBeenLastCalledWith("/srv/workspace/", "", true, true));
    onBrowse.mockResolvedValue({ ...directory, path: "/srv/workspace/alpha", entries: [] });
    await user.click(screen.getByRole("option", { name: "/srv/workspace/alpha" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Select" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Select" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ project_path: "/srv/workspace/alpha" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Switch working directory" })).not.toHaveFocus());
  });

  it("keeps invalid paths editable and validates the project before closing", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onResolve = vi.fn().mockRejectedValueOnce(new Error("project_path must be an existing directory"))
      .mockResolvedValueOnce({ name: "alpha", path: "/srv/alpha" });
    render(<WorkspaceProjectPicker isHero scope={scope} defaultScope={scope} controls={{ ...catalog.controls, can_resolve_project: true }} onResolveProject={onResolve} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Switch working directory" }));
    await user.clear(screen.getByRole("combobox"));
    await user.type(screen.getByRole("combobox"), "/srv/missing");
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("existing directory");
    expect(screen.getByRole("combobox")).toHaveValue("/srv/missing");
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveFocus());
    expect(onChange).not.toHaveBeenCalled();
    await user.clear(screen.getByRole("combobox"));
    await user.type(screen.getByRole("combobox"), "/srv/alpha");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ project_path: "/srv/alpha" })));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("uses manual paths without new requests on a host missing optional capabilities", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onBrowse = vi.fn();
    const onResolve = vi.fn();
    render(<WorkspaceProjectPicker isHero scope={scope} defaultScope={scope} controls={{ can_change_project: true, can_use_full_access: false }} onBrowseDirectories={onBrowse} onResolveProject={onResolve} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Switch working directory" }));
    expect(screen.queryByRole("option", { name: "Browse folders…" })).not.toBeInTheDocument();
    await user.clear(screen.getByRole("combobox"));
    await user.type(screen.getByRole("combobox"), "/srv/alpha");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ project_path: "/srv/alpha" }));
    expect(onBrowse).not.toHaveBeenCalled();
    expect(onResolve).not.toHaveBeenCalled();
  });

  it("does not apply a directory response after closing the dialog", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    let finish!: (value: WorkspaceDirectoriesPayload) => void;
    const onBrowse = vi.fn(() => new Promise<WorkspaceDirectoriesPayload>((resolve) => { finish = resolve; }));
    render(<WorkspaceProjectPicker isHero scope={scope} defaultScope={scope} controls={catalog.controls} onBrowseDirectories={onBrowse} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Switch working directory" }));
    await waitFor(() => expect(onBrowse).toHaveBeenCalled());
    await user.keyboard("{Escape}");
    finish(directory);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
  it("pins folders without selecting and keeps favorites ahead of recent projects", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const favorites = [{ name: "beta", path: "/srv/beta" }];
    const onFavorite = vi.fn().mockResolvedValueOnce(favorites).mockRejectedValueOnce(new Error("disk full")).mockResolvedValueOnce([]);
    render(<WorkspaceProjectPicker isHero scope={scope} defaultScope={scope} controls={catalog.controls} onLoadProjects={vi.fn().mockResolvedValue({ ...catalog, controls: { ...catalog.controls, can_manage_favorites: true } })} onFavoriteProject={onFavorite} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Switch working directory" }));
    async function openFavoriteMenu(name: string) {
      fireEvent.contextMenu(await screen.findByRole("button", { name: "/srv/beta" }), { clientX: 100, clientY: 100 });
      return screen.findByRole("menuitem", { name });
    }
    await user.click(await openFavoriteMenu("Pin beta"));
    expect(onFavorite).toHaveBeenLastCalledWith("/srv/beta", true);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(screen.getByRole("navigation")).toHaveTextContent("Favorites/srv/betaRecent projects");
    expect(screen.getByRole("combobox")).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
    await user.click(await openFavoriteMenu("Unpin beta"));
    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
    await user.click(await openFavoriteMenu("Unpin beta"));
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(await openFavoriteMenu("Pin beta")).toBeInTheDocument();
    expect(onFavorite).toHaveBeenLastCalledWith("/srv/beta", false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([
    ["/srv/al", "/srv/alpha", "/srv/alpha/"],
    ["C:\\Projects\\al", "C:\\Projects\\alpha", "C:\\Projects\\alpha\\"],
    ["\\\\server\\share\\al", "\\\\server\\share\\alpha", "\\\\server\\share\\alpha\\"],
  ])("completes paths in the same input: %s", async (draft, completed, expected) => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onBrowse = vi.fn((path: string) => Promise.resolve({ ...directory, path: completed, partial: path === draft, entries: path === draft ? [{ name: "alpha", path: completed }] : [] }));
    render(<WorkspaceProjectPicker isHero scope={scope} defaultScope={scope} controls={catalog.controls} onBrowseDirectories={onBrowse} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Switch working directory" }));
    const input = screen.getByRole("combobox");
    await user.clear(input);
    await user.type(input, draft);
    await screen.findByRole("option", { name: completed });
    await user.keyboard("{Tab}");
    expect(input).toHaveValue(expected);
    expect(input).toHaveFocus();
    expect(screen.getByRole("combobox")).toBe(input);
    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Select" })).toBeEnabled());
    expect(fireEvent.keyDown(input, { key: "Tab", shiftKey: true })).toBe(true);
    await user.click(screen.getByRole("button", { name: "Select" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ project_path: completed }));
  });

  it("uses one list for partial paths and keyboard completion", async () => {
    const user = userEvent.setup();
    const onBrowse = vi.fn((path: string) => Promise.resolve({ ...directory, path: path === "/srv/al" ? "/srv" : path, parent: "/srv", partial: path === "/srv/al", entries: path === "/srv/al" ? [{ name: "alpha", path: "/srv/alpha" }, { name: "alpine", path: "/srv/alpine" }] : [] }));
    render(<WorkspaceProjectPicker isHero scope={scope} defaultScope={scope} controls={catalog.controls} onBrowseDirectories={onBrowse} onChange={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Switch working directory" }));
    const input = screen.getByRole("combobox");
    await user.clear(input);
    await user.type(input, "/srv/al");
    await screen.findByRole("option", { name: "/srv/alpine" });
    expect(screen.getByRole("button", { name: "Select" })).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.keyboard("{ArrowDown}{Tab}");
    expect(input).toHaveValue("/srv/alpine/");
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.getAllByRole("listbox")).toHaveLength(2);
    await waitFor(() => expect(screen.getByRole("button", { name: "Select" })).toBeEnabled());
    expect(input).toHaveFocus();
  });

  it("ignores a Tab completion after the user changes the path", async () => {
    const user = userEvent.setup();
    let finish!: (value: WorkspaceDirectoriesPayload) => void;
    const onBrowse = vi.fn((_path: string, query: string) => query ? new Promise<WorkspaceDirectoriesPayload>(resolve => { finish = resolve; }) : Promise.resolve({ ...directory, entries: [] }));
    render(<WorkspaceProjectPicker isHero scope={scope} defaultScope={scope} controls={catalog.controls} onBrowseDirectories={onBrowse} onChange={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Switch working directory" }));
    const input = screen.getByRole("combobox");
    await user.clear(input);
    await user.type(input, "/srv/al");
    await user.keyboard("{Tab}");
    await user.type(input, "ternative");
    finish({ ...directory, entries: [{ name: "alpha", path: "/srv/alpha" }] });
    await waitFor(() => expect(input).toHaveValue("/srv/alternative"));
    expect(input).toHaveFocus();
  });

  it("updates folders while typing and ignores results from older paths", async () => {
    const user = userEvent.setup();
    let finishOld!: (value: WorkspaceDirectoriesPayload) => void;
    const onBrowse = vi.fn((path: string) => path === "/srv/old/" ? new Promise<WorkspaceDirectoriesPayload>(resolve => { finishOld = resolve; }) : Promise.resolve({ ...directory, path, entries: [{ name: path === "/srv/new/" ? "new-child" : "initial-child", path: `${path.replace(/\/$/, "")}/child` }] }));
    const onChange = vi.fn();
    render(<WorkspaceProjectPicker isHero scope={scope} defaultScope={scope} controls={catalog.controls} onBrowseDirectories={onBrowse} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Switch working directory" }));
    await screen.findByRole("option", { name: "/srv/workspace/child" });
    const input = screen.getByRole("combobox");
    await user.clear(input);
    await user.type(input, "/srv/old/");
    expect(screen.queryByRole("option", { name: "/srv/workspace/child" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select" })).toBeDisabled();
    await waitFor(() => expect(onBrowse).toHaveBeenCalledWith("/srv/old/", "", false, true));
    await user.clear(input);
    await user.type(input, "/srv/new/");
    await screen.findByRole("option", { name: "/srv/new/child" });
    finishOld({ ...directory, path: "/srv/old/", entries: [{ name: "stale-child", path: "/srv/old/child" }] });
    await waitFor(() => expect(screen.queryByRole("option", { name: "/srv/old/child" })).not.toBeInTheDocument());
    expect(screen.getByRole("combobox")).toBe(input);
    expect(input).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Select" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ project_path: "/srv/new/" }));
  });

  it("filters the current directory by name without a second browser view", async () => {
    const user = userEvent.setup();
    const onBrowse = vi.fn().mockResolvedValue(directory);
    render(<WorkspaceProjectPicker isHero scope={scope} defaultScope={scope} controls={catalog.controls} onBrowseDirectories={onBrowse} onChange={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Switch working directory" }));
    await screen.findByRole("option", { name: "/srv/workspace/alpha" });
    const input = screen.getByRole("combobox");
    await user.clear(input);
    await user.type(input, "alp");
    await waitFor(() => expect(onBrowse).toHaveBeenLastCalledWith("/srv/workspace", "alp", false, true));
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.queryByText("Browse folders…")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Filter folders…")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });
  it("keeps ancestor columns and replaces descendants when another folder is opened", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onBrowse = vi.fn((rawPath: string, _query: string, showHidden: boolean) => {
      const path = rawPath.replace(/\/$/, "");
      const names = path === scope.project_path ? ["alpha", "beta"] : path.endsWith("/alpha") ? ["child"] : path.endsWith("/beta") ? ["other"] : [];
      if (showHidden) names.push(".hidden");
      return Promise.resolve({ ...directory, path, entries: names.map(name => ({ name, path: `${path}/${name}` })) });
    });
    render(<WorkspaceProjectPicker isHero scope={scope} defaultScope={scope} controls={catalog.controls} onBrowseDirectories={onBrowse} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Switch working directory" }));
    await user.click(await screen.findByRole("option", { name: "/srv/workspace/alpha" }));
    await user.click(await screen.findByRole("option", { name: "/srv/workspace/alpha/child" }));
    expect(screen.getAllByRole("listbox")).toHaveLength(3);
    expect(screen.getByRole("option", { name: "/srv/workspace/alpha" })).toHaveAttribute("aria-selected", "true");
    expect(onChange).not.toHaveBeenCalled();
    expect(onBrowse.mock.calls.filter(call => call[0].replace(/\/$/, "") === scope.project_path)).toHaveLength(1);
    await user.click(screen.getByRole("switch", { name: "Show hidden folders" }));
    await screen.findByRole("option", { name: "/srv/workspace/.hidden" });
    await screen.findByRole("option", { name: "/srv/workspace/alpha/.hidden" });
    await screen.findByRole("option", { name: "/srv/workspace/alpha/child/.hidden" });
    await user.click(screen.getByRole("option", { name: "/srv/workspace/beta" }));
    await screen.findByRole("option", { name: "/srv/workspace/beta/other" });
    expect(screen.getAllByRole("listbox")).toHaveLength(2);
    expect(screen.queryByRole("option", { name: "/srv/workspace/alpha/child" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Select" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ project_path: "/srv/workspace/beta" }));
  });

});
