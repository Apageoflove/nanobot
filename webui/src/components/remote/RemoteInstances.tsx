import { createContext, useContext, useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { Loader2, PlugZap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { needsRemoteSetup, type RemoteDirectory } from "@/lib/remote-instances";
import { useHostSessions } from "./useHostSessions";
import { HostNavigationContext, HostSwitcher, RemoteHostMenu, type HostPicker } from "./HostSwitcher";
import { useSidebarHostBridge } from "./useSidebarHostBridge";
import { readPairReturn, subscribePairReturn } from "@/lib/remote-pair-return";

const RemoteContext = createContext<{
  available: boolean;
  localActive: boolean;
  openHostIds: string[];
  directory: RemoteDirectory | null;
  directoryError: boolean;
  refresh: () => Promise<RemoteDirectory>;
  connect: (id: string, stillWanted?: () => boolean) => Promise<void>;
  disconnect: (id: string) => Promise<void>;
  cancel: () => void;
} | null>(null);
export function useRemoteConnections() { return useContext(RemoteContext); }

/** Keep host views alive; navigation belongs in each view's sidebar, not a second header. */
export function RemoteInstances({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const hosts = useHostSessions();
  const returnedPair = useSyncExternalStore(subscribePairReturn, readPairReturn);
  const returnLocal = hosts.local;
  useEffect(() => { if (returnedPair) returnLocal(); }, [returnedPair, returnLocal]);
  const { selected, pending, frames, directory, error } = hosts;
  const localPanel = useRef<HTMLDivElement>(null);
  const lastLocalFocus = useRef<HTMLElement | null>(null);
  const frameNodes = useRef(new Map<string, HTMLIFrameElement>());
  const activeHostId = useRef(selected?.id);
  activeHostId.current = selected?.id;
  const restoreLocalFocus = () => {
    if (lastLocalFocus.current?.isConnected) lastLocalFocus.current.focus({ preventScroll: true });
  };
  const message = error ? t(`remote.errors.${error}`, { defaultValue: t("remote.errors.unknown") }) : "";
  const bridge = useSidebarHostBridge(frames, selected?.id, frameNodes, restoreLocalFocus, { pendingName: pending?.name, error: message });
  useEffect(() => {
    // A verified remote app can be interactive before optional images/fonts
    // finish loading. Older bundles still use the iframe load fallback.
    for (const id of bridge.readyIds) hosts.loaded(id);
  }, [bridge.readyIds, hosts.loaded]);
  const restoreFocus = () => {
    if (activeHostId.current) bridge.focus(activeHostId.current);
    else restoreLocalFocus();
  };
  const available = directory?.available === true || hosts.directoryError;
  const activeFrame = frames.find((frame) => frame.connection.id === selected?.id);
  const offline = !!selected && (activeFrame?.offline || (!activeFrame && pending?.id !== selected.id));
  const recoveryCode = (hosts.errorId === selected?.id ? error : "") || activeFrame?.error || "";
  const recoveryMessage = recoveryCode ? t(`remote.errors.${recoveryCode}`, { defaultValue: t("remote.errors.unknown") }) : t("remote.noFallback");
  const manage = () => { hosts.local(); window.location.hash = "/remote"; };
  const switchHost = (id: string) => {
    // The session module owns attempt-scoped errors, including cancelled work.
    void hosts.connect(id).catch(() => {});
  };
  const picker: HostPicker = {
    kind: "shell", name: selected?.name || t("remote.localShort"), hostname: selected?.hostname || directory?.machine_name || "nanobot",
    localName: directory?.machine_name || "nanobot", currentId: selected?.id || null, recentIds: hosts.recentIds,
    profiles: (directory?.profiles || []).map(({ id, name, host }) => ({ id, name, host,
      ready: frames.some((frame) => frame.connection.id === id && !frame.offline && frame.loaded) })),
    pending, error: message, offline: !!offline, select: (id) => { if (id) switchHost(id); else hosts.local(); },
    manage,
    cancel: hosts.cancel, clearError: hosts.clearError, restoreFocus,
  };
  useEffect(() => { if (selected) document.title = `${selected.name} · nanobot`; }, [selected]);
  useEffect(() => {
    const rememberFocus = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && localPanel.current?.contains(event.target)
        && !event.target.closest("[data-host-switcher]")) lastLocalFocus.current = event.target;
    };
    document.addEventListener("focusin", rememberFocus);
    return () => document.removeEventListener("focusin", rememberFocus);
  }, []);
  useLayoutEffect(() => {
    if (selected) frameNodes.current.get(selected.id)?.focus({ preventScroll: true });
    else restoreLocalFocus();
  }, [selected]);
  useEffect(() => {
    if (!selected) return;
    const stop = (event: KeyboardEvent) => event.stopPropagation();
    document.addEventListener("keydown", stop);
    document.addEventListener("keyup", stop);
    return () => { document.removeEventListener("keydown", stop); document.removeEventListener("keyup", stop); };
  }, [selected]);

  return <RemoteContext.Provider value={{ available, localActive: !selected, directory,
    openHostIds: frames.map((frame) => frame.connection.id),
    directoryError: hosts.directoryError, refresh: hosts.refresh, connect: hosts.connect, disconnect: hosts.disconnect, cancel: hosts.cancel }}>
    <HostNavigationContext.Provider value={bridge.embedded || (available || selected ? picker : null)}>
      <div className="flex h-full min-h-0 flex-col bg-background">
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div ref={localPanel} data-host-view="local" aria-hidden={!!selected} {...(selected ? { inert: "" } : {})}
            style={{ visibility: selected ? "hidden" : "visible" }}
            className={`absolute inset-0 transition-opacity duration-150 motion-reduce:transition-none ${selected ? "invisible pointer-events-none opacity-0" : "visible opacity-100"}`}>
            {children}
          </div>
          {frames.map((frame) => {
            const active = selected?.id === frame.connection.id;
            return <div key={`${frame.connection.id}:${frame.connection.gateway_id}:${frame.connection.view_id || ""}`} data-host-view={frame.connection.id} aria-hidden={!active || offline}
              {...(!active || offline ? { inert: "" } : {})} style={{ visibility: active ? "visible" : "hidden" }}
              className={`absolute inset-0 transition-opacity duration-150 motion-reduce:transition-none ${active ? "visible opacity-100" : "invisible pointer-events-none opacity-0"}`}>
              <iframe ref={(node) => { if (node) frameNodes.current.set(frame.connection.id, node); else frameNodes.current.delete(frame.connection.id); }}
                src={frame.connection.url} title={t("remote.frameTitle", { name: frame.connection.name })}
                className="h-full w-full border-0" referrerPolicy="no-referrer"
                sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox"
                onLoad={() => { bridge.initialize(frame.connection.id); hosts.loaded(frame.connection.id); }} />
            </div>;
          })}
          {selected && (offline || !activeFrame?.loaded) && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background px-6 text-center">
            {offline ? <PlugZap className="h-7 w-7 text-muted-foreground" /> : <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
            <p className="max-w-full break-words text-xs text-muted-foreground">{selected.name} · {selected.hostname}</p>
            <p className="font-medium">{t(offline ? "remote.offline" : "remote.opening")}</p>
            <p className="max-w-sm text-sm text-muted-foreground">{recoveryMessage}</p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {offline && (needsRemoteSetup(recoveryCode) ? <Button onClick={manage}>{t("remote.manageConnections")}</Button> : <Button disabled={!!pending} aria-busy={!!pending} onClick={() => switchHost(selected.id)}>
                {pending && <Loader2 aria-hidden className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />}{t(pending ? "remote.connecting" : "remote.reconnect")}
              </Button>)}
              <Button variant="ghost" onClick={hosts.local}>{t("remote.returnLocal")}</Button>
            </div>
          </div>}
        </div>
        {/* Older remote bundles cannot host the control. Keep an explicit exit
            in a compact bottom strip, never cover their sidebar controls. */}
        {selected && (!bridge.readyIds.includes(selected.id) || offline) && <div data-testid="legacy-host-footer" className="flex shrink-0 items-center border-t border-border/50 bg-sidebar px-2.5 py-1">
          <div className="flex w-52 min-w-0"><HostSwitcher /></div>
        </div>}
        <RemoteHostMenu picker={picker} anchor={bridge.anchor} onClose={bridge.close} />
      </div>
    </HostNavigationContext.Provider>
  </RemoteContext.Provider>;
}
