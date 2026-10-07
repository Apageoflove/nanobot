import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CUA_CAPABILITY } from "@/components/settings/system/CuaDriverSetupPanel";
import type { McpPresetInfo } from "@/lib/types";
import { installSettingsViewTestHooks, jsonResponse, renderSettingsView, requestMutationMock, settingsPayload } from "@/tests/settings-test-utils";

describe("Cua Driver through Apps settings", () => {
  installSettingsViewTestHooks();

  it("routes download, observation, checking and disable through the owning gateway transport", async () => {
    let preset: McpPresetInfo = {
      name: "cua-driver", display_name: "Cua Driver", category: "computer", description: "", docs_url: "",
      transport: "stdio", requires: "", note: "", install_supported: true, installed: false,
      configured: false, available: false, status: "not_installed", required_fields: [], connection_summary: "",
      source: "preset", driver_setup: {
        schema: 1, version: "0.33.4", platform: "Darwin", machine: "remote-mac",
        supported: true, installed: false, managed: true, mode: "off",
      },
    };
    const payload = () => ({ presets: [preset], capabilities: [CUA_CAPABILITY], installed_count: Number(preset.configured) });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/settings") return jsonResponse(settingsPayload());
      if (path === "/api/settings/mcp-presets") return jsonResponse(payload());
      if (path === "/api/settings/cli-apps") return jsonResponse({ apps: [], installed_count: 0 });
      return { ok: false, status: 404, text: async () => "Not found" } as Response;
    }));
    requestMutationMock.mockImplementation(async (action: string) => {
      if (action === "settings.mcp.install") preset = { ...preset, driver_setup: { ...preset.driver_setup!, installed: true } };
      if (action === "settings.mcp.enable") preset = { ...preset, configured: true, installed: true, runtime_status: "connected", driver_setup: { ...preset.driver_setup!, mode: "observe" } };
      if (action === "settings.mcp.disable") preset = { ...preset, configured: false, installed: false, driver_setup: { ...preset.driver_setup!, mode: "off" } };
      return { ...payload(), requires_restart: false, last_action: { ok: true, message: "Done" } };
    });
    renderSettingsView({ initialSection: "apps" });
    fireEvent.click(await screen.findByRole("button", { name: "MCP" }));
    const row = (await screen.findByRole("heading", { name: "Computer use" })).closest("article")!;
    fireEvent.click(within(row).getByRole("button", { name: "Computer use" }));
    const dialog = screen.getByRole("dialog", { name: "Computer use" });
    expect(within(dialog).getByText("Powered by Cua Driver · Integrated by nanobot")).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "See what’s on screen" })).toBeInTheDocument();
    expect(requestMutationMock).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: /^Install$/ }));
    expect(within(dialog).getByRole("region", { name: "Connection" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Overview" })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole("button", { name: "Overview" }));
    expect(within(dialog).getByRole("heading", { name: "See what’s on screen" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /^Install$/ })).toHaveFocus();
    expect(requestMutationMock).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: /^Install$/ }));
    expect(within(dialog).getByRole("button", { name: "Download & install" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Download & install" }));
    await waitFor(() => expect(requestMutationMock).toHaveBeenCalledWith("settings.mcp.install", {
      name: "cua-driver", consent: `${CUA_CAPABILITY}:install`,
    }, 660_000));
    fireEvent.click(await screen.findByRole("button", { name: "Allow & connect" }));
    await waitFor(() => expect(requestMutationMock).toHaveBeenCalledWith("settings.mcp.enable", {
      name: "cua-driver", mode: "observe", consent: `${CUA_CAPABILITY}:observe`,
    }, 60_000));
    fireEvent.click(screen.getByLabelText("Connection settings"));
    fireEvent.click(await screen.findByRole("button", { name: "Check connection" }));
    await waitFor(() => expect(requestMutationMock).toHaveBeenCalledWith("settings.mcp.test", { name: "cua-driver" }, 60_000));
    await waitFor(() => expect(screen.getByRole("button", { name: "Disable" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    await waitFor(() => expect(requestMutationMock).toHaveBeenCalledWith("settings.mcp.disable", { name: "cua-driver" }, 60_000));
    expect(requestMutationMock.mock.calls.map(call => call[0])).toEqual([
      "settings.mcp.install", "settings.mcp.enable", "settings.mcp.test", "settings.mcp.disable",
    ]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(within(row).getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });
});
