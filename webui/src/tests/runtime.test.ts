import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getRuntimeHost,
  initializeLoopbackRuntimeHost,
  isNativeRuntime,
} from "@/lib/runtime";

afterEach(() => {
  Reflect.deleteProperty(window, "nanobotHost");
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  initializeLoopbackRuntimeHost();
});

describe("runtime host facade", () => {
  it("defaults to browser runtime without host actions", () => {
    const host = getRuntimeHost();

    expect(host.surface).toBe("browser");
    expect(host.restartEngine).toBeUndefined();
    expect(isNativeRuntime()).toBe(false);
  });

  it("wraps native host actions behind the runtime facade", async () => {
    const restartEngine = vi.fn(async () => undefined);
    const openLogs = vi.fn(async () => undefined);
    const exportDiagnostics = vi.fn(async () => "/tmp/diagnostics.txt");
    Object.defineProperty(window, "nanobotHost", {
      configurable: true,
      value: {
        getRuntimeInfo: vi.fn(),
        restartEngine,
        openLogs,
        exportDiagnostics,
      },
    });

    const host = getRuntimeHost();

    expect(host.surface).toBe("native");
    expect(isNativeRuntime()).toBe(true);
    await host.restartEngine?.();
    await host.openLogs?.();
    await expect(host.exportDiagnostics?.()).resolves.toBe("/tmp/diagnostics.txt");
    expect(restartEngine).toHaveBeenCalledTimes(1);
    expect(openLogs).toHaveBeenCalledTimes(1);
    expect(exportDiagnostics).toHaveBeenCalledTimes(1);
  });

  it("treats server-reported native surface as native for UI labels", () => {
    expect(isNativeRuntime("native")).toBe(true);
  });

  it("recognizes an external native host across refresh and consumes its URL bootstrap", () => {
    const token = "a".repeat(43);
    window.history.replaceState(
      null,
      "",
      `/#/new?bootstrapSecret=secret&nativeHostPort=43123&nativeHostToken=${token}`,
    );

    expect(initializeLoopbackRuntimeHost()).toBe(true);
    expect(window.location.hash).toBe("#/new?bootstrapSecret=secret");
    expect(isNativeRuntime()).toBe(true);
    expect(getRuntimeHost().surface).toBe("native");

    window.history.replaceState(null, "", "/#/new");
    expect(initializeLoopbackRuntimeHost()).toBe(true);
    expect(getRuntimeHost().surface).toBe("native");
    expect(isNativeRuntime()).toBe(true);
  });

  it("rejects invalid loopback bridge bootstrap values", () => {
    window.history.replaceState(
      null,
      "",
      "/#/new?nativeHostPort=70000&nativeHostToken=too-short",
    );

    expect(initializeLoopbackRuntimeHost()).toBe(false);
    expect(window.location.hash).toBe("#/new");
    expect(getRuntimeHost().surface).toBe("browser");
    expect(isNativeRuntime()).toBe(false);
  });
});
