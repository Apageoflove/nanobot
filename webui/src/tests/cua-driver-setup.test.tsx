import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CuaDriverSetupPanel, CUA_CAPABILITY, CUA_SETUP_CAPABILITY } from "@/components/settings/system/CuaDriverSetupPanel";
import i18n from "@/i18n";
import type { McpPresetInfo } from "@/lib/types";

export const cuaPreset: McpPresetInfo = {
  name: "cua-driver", display_name: "Cua Driver", category: "computer",
  description: "Computer use", docs_url: "https://cua.ai/docs/cua-driver/quickstart",
  transport: "stdio", requires: "", note: "", install_supported: true,
  installed: false, configured: false, available: false, status: "not_installed",
  required_fields: [], connection_summary: "", source: "preset",
  driver_setup: {
    schema: 1, version: "0.33.4", platform: "Darwin", machine: "test-gateway",
    supported: true, installed: false, managed: true, mode: "off",
  },
};

describe("managed Cua Driver setup", () => {
  beforeEach(async () => { await i18n.changeLanguage("en"); });
  afterEach(() => vi.useRealTimers());

  it("asks separately for install and desktop access, defaulting to observation", () => {
    const action = vi.fn();
    const props = { capabilities: [CUA_CAPABILITY], actionKey: null, error: null, onAction: action };
    const view = render(<CuaDriverSetupPanel preset={cuaPreset} {...props} />);
    const dialog = view.container;
    expect(within(dialog).getByText(/test-gateway/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Download & install" }));
    expect(action).toHaveBeenCalledWith("install", "cua-driver", { consent: `${CUA_CAPABILITY}:install` });
    expect(action).toHaveBeenCalledTimes(1);
    view.rerender(<CuaDriverSetupPanel preset={{ ...cuaPreset, driver_setup: { ...cuaPreset.driver_setup!, installed: true } }} {...props} />);
    expect(within(dialog).getByText(/Screenshots may be sent/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Allow & connect" }));
    expect(action).toHaveBeenLastCalledWith("enable", "cua-driver", { mode: "observe", consent: `${CUA_CAPABILITY}:observe` });
    fireEvent.click(within(dialog).getByRole("button", { name: "Observe & control" }));
    expect(action).toHaveBeenCalledTimes(2); // A mode selection alone never enables access.
  });

  it.each([
    [undefined, cuaPreset.driver_setup],
    [[], cuaPreset.driver_setup],
    [[CUA_CAPABILITY], { ...cuaPreset.driver_setup, schema: 2 }],
    [[CUA_CAPABILITY], { ...cuaPreset.driver_setup, installed: "yes" }],
    [[CUA_CAPABILITY], null],
  ])("does not offer mutations for missing or unrecognized optional support (%j)", (capabilities, setup) => {
    const view = render(<CuaDriverSetupPanel preset={{ ...cuaPreset, driver_setup: setup as McpPresetInfo["driver_setup"] }}
      capabilities={capabilities} actionKey={null} error={null} onAction={vi.fn()} />);
    const dialog = view.container;
    expect(within(dialog).getByText(/not confirmed/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Download & install" })).not.toBeInTheDocument();
  });

  it("accepts unrelated future capabilities without relaxing desktop consent", () => {
    render(<CuaDriverSetupPanel preset={cuaPreset} capabilities={[CUA_CAPABILITY, "future.v9"]}
      actionKey={null} error={null} onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Download & install" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Allow & connect" })).not.toBeInTheDocument();
  });

  it("does not label a connection check as screen-capture or model acceptance", () => {
    const action = vi.fn();
    render(<CuaDriverSetupPanel preset={{ ...cuaPreset, configured: true, driver_setup: { ...cuaPreset.driver_setup!, installed: true, mode: "observe" } }}
      capabilities={[CUA_CAPABILITY]} actionKey={null} error={null} onAction={action}
      check={{ connected: true, accessibility: true, screen_recording: null, capture_verified: false }} />);
    expect(screen.getAllByText(/have not been verified/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Screen Recording: unknown/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Connection settings"));
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    expect(action).toHaveBeenCalledWith("disable", "cua-driver", {});
  });

  it("requires fresh consent when changing enabled access, but not just to inspect the connection", () => {
    const action = vi.fn();
    render(<CuaDriverSetupPanel preset={{ ...cuaPreset, configured: true, driver_setup: { ...cuaPreset.driver_setup!, installed: true, mode: "observe" } }}
      capabilities={[CUA_CAPABILITY]} actionKey={null} error={null} onAction={action} />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check connection" }).closest("details")).not.toHaveAttribute("open");
    fireEvent.click(screen.getByLabelText("Connection settings"));
    fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
    expect(action).toHaveBeenLastCalledWith("test", "cua-driver", {});
    fireEvent.click(screen.getByRole("button", { name: "Observe & control" }));
    expect(action).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Observe only" }));
    fireEvent.click(screen.getByRole("button", { name: "Observe & control" }));
    expect(action).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Allow & connect" }));
    expect(action).toHaveBeenLastCalledWith("enable", "cua-driver", { mode: "control", consent: `${CUA_CAPABILITY}:control` });
  });

  it("shows only unconfirmed grants and hides native actions on older hosts", () => {
    const action = vi.fn();
    const preset = { ...cuaPreset, configured: true, driver_setup: { ...cuaPreset.driver_setup!, installed: true, mode: "observe" as const } };
    const props = { actionKey: null, error: null, onAction: action, check: { connected: true, accessibility: true, screen_recording: false, capture_verified: false } };
    const view = render(<CuaDriverSetupPanel preset={preset} capabilities={[CUA_CAPABILITY, CUA_SETUP_CAPABILITY]} {...props} />);
    expect(screen.queryByRole("button", { name: "Open Accessibility settings" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Screen Recording settings" }));
    expect(action).toHaveBeenLastCalledWith("setup", "cua-driver", { target: "screen_recording" });
    fireEvent.click(screen.getByText("Can’t find CuaDriver?"));
    fireEvent.click(screen.getByRole("button", { name: "Show in Finder" }));
    expect(action).toHaveBeenLastCalledWith("setup", "cua-driver", { target: "finder" });
    view.rerender(<CuaDriverSetupPanel preset={preset} capabilities={[CUA_CAPABILITY]} {...props} />);
    expect(screen.queryByRole("button", { name: /Open .* settings/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Connection settings"));
    expect(screen.getByRole("button", { name: "Check connection" })).toBeInTheDocument();
  });

  it("serially checks after enable finishes, stops on close and never auto-enables", async () => {
    vi.useFakeTimers();
    let finish: () => void = () => {};
    const action = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const preset = { ...cuaPreset, configured: true, driver_setup: { ...cuaPreset.driver_setup!, installed: true, mode: "observe" as const } };
    const props = { capabilities: [CUA_CAPABILITY, CUA_SETUP_CAPABILITY], error: null, onAction: action };
    const view = render(<CuaDriverSetupPanel preset={preset} actionKey="enable:cua-driver" {...props} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(action).not.toHaveBeenCalled();
    view.rerender(<CuaDriverSetupPanel preset={preset} actionKey={null} {...props} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith("test", "cua-driver", { quiet: "true" });
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(action).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => { finish(); await vi.advanceTimersByTimeAsync(10000); });
    fireEvent.focus(window);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("stops the guide after verified connection and keeps granted access without re-consent", async () => {
    vi.useFakeTimers();
    const action = vi.fn(async () => {});
    const preset = { ...cuaPreset, configured: true, runtime_status: "connected" as const, driver_setup: { ...cuaPreset.driver_setup!, installed: true, mode: "observe" as const } };
    const view = render(<CuaDriverSetupPanel preset={preset} capabilities={[CUA_CAPABILITY, CUA_SETUP_CAPABILITY]} actionKey={null} error={null} onAction={action}
      check={{ connected: true, accessibility: true, screen_recording: true, capture_verified: false }} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(action).toHaveBeenCalledTimes(1); // Fresh check even when opening cached setup.
    expect(screen.getByRole("heading", { name: "Connected" })).toBeInTheDocument();
    expect(screen.getByLabelText("Connection settings")).toHaveTextContent("Observe only");
    expect(screen.queryByRole("button", { name: /Open .* settings/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Allow & connect" })).not.toBeInTheDocument();
    view.unmount();
  });

  it("keeps checking when reopening a previously connected driver finds a revoked grant", async () => {
    vi.useFakeTimers();
    const action = vi.fn(async () => {});
    const preset = { ...cuaPreset, configured: true, runtime_status: "connected" as const, driver_setup: { ...cuaPreset.driver_setup!, installed: true, mode: "observe" as const } };
    const props = { preset, capabilities: [CUA_CAPABILITY, CUA_SETUP_CAPABILITY], actionKey: null, error: null, onAction: action };
    const check = { connected: true, accessibility: true, screen_recording: true, capture_verified: false };
    const view = render(<CuaDriverSetupPanel {...props} check={check} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    view.rerender(<CuaDriverSetupPanel {...props} check={{ ...check, screen_recording: false }} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(action).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Open Screen Recording settings" })).toBeInTheDocument();
    view.unmount();
  });
});
