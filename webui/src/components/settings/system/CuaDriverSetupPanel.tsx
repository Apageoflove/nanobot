import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Download, ExternalLink, Eye, Loader2, Monitor, MousePointer2, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

import computerUseIcon from "@/assets/apps/computer-use.webp";
import cuaBlackLogo from "@/assets/apps/cua-black.svg";
import cuaWhiteLogo from "@/assets/apps/cua-white.svg";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { CuaDriverCheck, CuaDriverSetup, McpPresetAction, McpPresetInfo } from "@/lib/types";

export const CUA_CAPABILITY = "webui.cua-driver.v1";
export const CUA_SETUP_CAPABILITY = "webui.cua-driver-guided-setup.v1";

/** nanobot's capability icon; the upstream driver keeps its own attribution. */
export function ComputerUseIcon() {
  return <img src={computerUseIcon} alt="" aria-hidden draggable={false} width={40} height={40} className="h-full w-full rounded-control object-cover" />;
}

// An optional feature is authorized by its named capability and a recognized
// shape, not by a matching package version or an optimistic type assertion.
export function cuaDriverSetup(value: unknown, capabilities: unknown): CuaDriverSetup | null {
  if (!Array.isArray(capabilities) || !capabilities.includes(CUA_CAPABILITY)
    || !value || typeof value !== "object") return null;
  const setup = value as Record<string, unknown>;
  if (setup.schema !== 1 || typeof setup.version !== "string" || typeof setup.platform !== "string"
    || typeof setup.machine !== "string" || typeof setup.supported !== "boolean"
    || typeof setup.installed !== "boolean" || typeof setup.managed !== "boolean"
    || !["observe", "control", "custom", "off"].includes(String(setup.mode))) return null;
  return setup as unknown as CuaDriverSetup;
}

export function CuaDriverOverview({ docsUrl }: { docsUrl: string }) {
  const { t } = useTranslation();
  return <div>
    <ul className="space-y-5 rounded-panel bg-muted/35 p-4 sm:p-5">
      {[
        { icon: Eye, title: "seeTitle", description: "seeDescription" },
        { icon: MousePointer2, title: "actTitle", description: "actDescription" },
        { icon: ShieldCheck, title: "chooseTitle", description: "chooseDescription" },
      ].map(({ icon: Icon, title, description }) => <li key={title} className="flex items-start gap-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <h3 className="text-[13px] font-medium leading-5">{t(`cuaDriver.${title}`)}</h3>
          <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{t(`cuaDriver.${description}`)}</p>
        </div>
      </li>)}
    </ul>
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
      <div className="flex min-w-0 flex-[1_1_12rem] items-center gap-2">
        <span className="h-5 w-5 shrink-0" aria-hidden>
          <img src={cuaBlackLogo} alt="" className="h-full w-full object-contain dark:hidden" />
          <img src={cuaWhiteLogo} alt="" className="hidden h-full w-full object-contain dark:block" />
        </span>
        <p className="text-[11px] leading-4 text-muted-foreground">{t("cuaDriver.attribution")}</p>
      </div>
      {docsUrl && <a href={docsUrl} target="_blank" rel="noopener noreferrer" className="touch-target inline-flex shrink-0 items-center gap-1 rounded-compact text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {t("settings.mcp.openDocs")}<ExternalLink className="h-3 w-3" aria-hidden />
      </a>}
    </div>
  </div>;
}

export function CuaDriverSetupPanel({ preset, capabilities, actionKey, check, error, onAction }: {
  preset: McpPresetInfo;
  capabilities: unknown;
  actionKey: string | null;
  check?: CuaDriverCheck;
  error: string | null;
  onAction: (action: McpPresetAction, name: string, values?: Record<string, string>) => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"observe" | "control">(preset.driver_setup?.mode === "control" ? "control" : "observe");
  const setup = cuaDriverSetup(preset.driver_setup, capabilities);
  const busy = Boolean(actionKey?.endsWith(":cua-driver"));
  const enabled = Boolean(setup && setup.mode !== "off" && preset.configured);
  const needsConsent = !enabled || setup?.mode !== mode;
  const canManage = Boolean(setup?.supported && setup.managed);
  const guided = canManage && Array.isArray(capabilities) && capabilities.includes(CUA_SETUP_CAPABILITY);
  const mac = setup?.platform === "Darwin";
  const permissionsReady = !mac || (check?.accessibility === true && check?.screen_recording === true);
  const ready = enabled && check?.connected === true && permissionsReady && preset.runtime_status === "connected";
  const polling = useRef({ busy, ready, onAction });
  polling.current = { busy, ready, onAction };

  useEffect(() => {
    if (!guided || !enabled) return;
    let disposed = false;
    let pending = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    const inspect = async () => {
      if (disposed || pending || document.visibilityState === "hidden") return;
      if (attempts > 0 && polling.current.ready) return;
      if (polling.current.busy) {
        timer = setTimeout(inspect, 5000);
        return;
      }
      pending = true;
      attempts += 1;
      try {
        await polling.current.onAction("test", preset.name, { quiet: "true" });
      } finally {
        pending = false;
        // Serial, bounded checks; a closed dialog or changed host owns no timer.
        if (!disposed && attempts < 24) timer = setTimeout(inspect, 5000);
      }
    };
    const resume = () => {
      clearTimeout(timer);
      if (!polling.current.ready) void inspect();
    };
    timer = setTimeout(inspect, 0);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [guided, enabled, preset.name]);

  const act = (action: McpPresetAction) => {
    onAction(action, preset.name, action === "install"
      ? { consent: `${CUA_CAPABILITY}:install` }
      : action === "enable" ? { mode, consent: `${CUA_CAPABILITY}:${mode}` } : {});
  };
  const accessOptions = <fieldset disabled={busy}>
    <legend className="mb-2 font-medium">{t("cuaDriver.access")}</legend>
    <SegmentedControl value={mode} itemClassName="touch-target whitespace-normal" ariaLabel={t("cuaDriver.access")} onChange={(value) => { if (!busy) setMode(value as "observe" | "control"); }}
      options={[{ value: "observe", label: t("cuaDriver.observe") }, { value: "control", label: t("cuaDriver.control") }]} />
    <p className="mt-2 text-muted-foreground">{t(mode === "observe" ? "cuaDriver.observeHint" : "cuaDriver.controlHint")}</p>
  </fieldset>;

  return <div className="flex min-h-0 flex-1 flex-col text-[13px] leading-5">
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 pb-4 pt-3 scrollbar-thin scrollbar-track-transparent sm:px-6">
      {!setup ? <p role="status">{t("cuaDriver.unconfirmed")}</p> : <>
        {!setup.supported && <p role="status">{t("cuaDriver.unsupported")}</p>}
        {!setup.managed && <p role="status">{t("cuaDriver.manual")}</p>}
        {canManage && <>
          {setup.installed && <>
            {!enabled && accessOptions}
            {mac && guided && enabled && !permissionsReady && <section aria-label={t("cuaDriver.finishSetup")}>
              <h3 className="text-base font-medium tracking-[-0.01em]">{t("cuaDriver.finishSetup")}</h3>
              <p className="mt-1.5 text-muted-foreground">{t("cuaDriver.onceHint")}</p>
              <div className="mt-4 divide-y divide-border/45">
                {(["accessibility", "screen_recording"] as const).filter(key => check?.[key] !== true).map((key, index) => <div key={key} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0">
                  <span className="flex min-w-0 flex-[1_1_8rem] items-center gap-3">
                    {key === "accessibility" ? <MousePointer2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /> : <Monitor className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
                    <span className="min-w-0">
                      <span className="block font-medium">{t(key === "accessibility" ? "cuaDriver.accessibility" : "cuaDriver.screenRecording")}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{t(key === "accessibility" ? "cuaDriver.accessibilityPurpose" : "cuaDriver.screenPurpose")}</span>
                    </span>
                  </span>
                  <Button variant={index === 0 ? "default" : "outline"} size="sm" className="touch-target ml-auto shrink-0 rounded-full text-xs" disabled={busy} aria-label={t("cuaDriver.openPermission", { permission: t(key === "accessibility" ? "cuaDriver.accessibility" : "cuaDriver.screenRecording") })}
                    onClick={() => onAction("setup", preset.name, { target: key })}>
                    {t("cuaDriver.openSettings")}<ExternalLink className="ml-1.5 h-3 w-3 shrink-0" aria-hidden />
                  </Button>
                </div>)}
              </div>
              <details className="group/help text-xs text-muted-foreground">
                <summary className="touch-target flex cursor-pointer list-none items-center gap-1.5 rounded-compact focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                  {t("cuaDriver.missingApp")}<ChevronDown className="h-3 w-3 shrink-0 transition-transform group-open/help:rotate-180 motion-reduce:transition-none" aria-hidden />
                </summary>
                <p className="mt-1">{t("cuaDriver.dragHint")}</p>
                <Button variant="link" size="sm" className="touch-target px-0 text-xs" disabled={busy} onClick={() => onAction("setup", preset.name, { target: "finder" })}>{t("cuaDriver.showFinder")}</Button>
              </details>
            </section>}
            {guided && ready && <div role="status" className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted/60"><Check className="h-4 w-4" aria-hidden /></span>
              <div><h3 className="font-medium">{t("cuaDriver.ready")}</h3><p className="mt-1 text-muted-foreground">{t("cuaDriver.checked")}</p></div>
            </div>}
            {(!mac || !guided) && <p className="text-muted-foreground">{t(mac ? "cuaDriver.permissions" : "cuaDriver.desktopSession")}</p>}
          </>}
          {!setup.installed && <p className="text-muted-foreground">{t("cuaDriver.installOnly")}</p>}
          {guided && enabled && !ready && <p role="status" className="text-xs text-muted-foreground">{t("cuaDriver.autoCheck")}</p>}
          {!guided && setup.installed && check && !error && !busy && <div role="status" className="rounded-control bg-muted/45 px-3 py-2.5 text-muted-foreground">
            <p>{t("cuaDriver.checked")}</p>
            {setup.platform === "Darwin" && <p className="mt-1">{t("cuaDriver.grants", {
              accessibility: t(check.accessibility === true ? "cuaDriver.granted" : check.accessibility === false ? "cuaDriver.needed" : "cuaDriver.unknown"),
              screen: t(check.screen_recording === true ? "cuaDriver.granted" : check.screen_recording === false ? "cuaDriver.needed" : "cuaDriver.unknown"),
            })}</p>}
          </div>}
        </>}
        {canManage && setup.installed && needsConsent && <p className="text-muted-foreground">{t("cuaDriver.allowHint")}</p>}
        <details className="group/connection border-t border-border/45 pt-2">
          <summary aria-label={t("cuaDriver.connectionSettings")} className="touch-target flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 rounded-compact py-2 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <Monitor className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 break-words">{t("cuaDriver.gateway", { machine: setup.machine, platform: mac ? "macOS" : setup.platform })}</span>
            {enabled && <span>{t(setup.mode === "control" ? "cuaDriver.control" : setup.mode === "observe" ? "cuaDriver.observe" : "cuaDriver.custom")}</span>}
            <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open/connection:rotate-180 motion-reduce:transition-none" aria-hidden />
          </summary>
          <div className="space-y-4 pb-2 pt-2">
            <p className="text-muted-foreground">{t("cuaDriver.gatewayHint")}</p>
            {canManage && enabled && <>
              {accessOptions}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" className="touch-target" disabled={busy} onClick={() => act("test")}>{t("cuaDriver.check")}</Button>
                <Button variant="ghost" size="sm" className="touch-target text-muted-foreground" disabled={busy} onClick={() => act("disable")}>{t("cuaDriver.disable")}</Button>
              </div>
            </>}
            <div className="space-y-2 text-xs leading-5 text-muted-foreground">
              <p>Cua Driver {setup.version}</p>
              {guided && check && !ready && <p>{t("cuaDriver.checked")}</p>}
              {setup.installed && <p className="flex items-start gap-1.5"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{t("cuaDriver.verified")}</p>}
              <p>{t("cuaDriver.installHint")}</p>
              <a className="touch-target inline-flex items-center gap-1.5 underline underline-offset-4" href="https://cua.ai/docs/cua-driver/quickstart" target="_blank" rel="noopener noreferrer">{t("cuaDriver.docs")}<ExternalLink className="h-3 w-3" aria-hidden /></a>
            </div>
          </div>
        </details>
      </>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {busy && !actionKey?.startsWith("test:") && !actionKey?.startsWith("setup:") && <p role="status" className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />{t(actionKey?.startsWith("install:") ? "cuaDriver.installing" : "cuaDriver.working")}</p>}
    </div>
    {canManage && needsConsent && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border/45 bg-background/95 px-5 py-3 sm:px-6">
      <Button size="sm" className="touch-target rounded-full px-5" disabled={busy} onClick={() => act(setup?.installed ? "enable" : "install")}>
        {!setup?.installed && <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
        {t(setup?.installed ? "cuaDriver.allowConnect" : "cuaDriver.install")}
      </Button>
    </div>}
  </div>;
}
