import { useEffect, useId, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, Check, ChevronDown, Copy, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Disclosure, DisclosureContent } from "@/components/ui/disclosure";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useClient } from "@/providers/ClientProvider";
import { copyTextToClipboard } from "@/lib/clipboard";
import { remoteAction } from "@/lib/remote-instances";
import { pairingReturnOrigin, type PairReturn } from "@/lib/remote-pair-return";
import type { ConnectionStatus } from "@/lib/types";
import { useRemoteConnections } from "./RemoteInstances";
import { PairRouteSettings } from "./PairRouteSettings";

type Request = { id: string; command: string; expires: number };
type Preview = { id: string; host: string; hostname: string; fingerprint: string; authorized_until: number; revoke_command: string };

/** Public invitation → encrypted receipt → explicit confirmation. No private key inputs. */
export function QuickPairSetup({ returned, onSSH, onClose }: { returned?: PairReturn | null; onSSH: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  const { client } = useClient();
  const connections = useRemoteConnections();
  const [request, setRequest] = useState<Request | null>(returned ? { id: returned.id, command: "", expires: 0 } : null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [code, setCode] = useState(returned?.code || "");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyVisible, setBusyVisible] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<ConnectionStatus>(client.status);
  const [copied, setCopied] = useState(false);
  const [expired, setExpired] = useState(false);
  const [manual, setManual] = useState(false);
  const [panel, setPanel] = useState<"command" | "help" | null>(null);
  const alive = useRef(true);
  const initialized = useRef(false);
  const requestId = useRef(returned?.id || "");
  const manualInput = useRef<HTMLTextAreaElement>(null);
  const focusManual = useRef(false);
  const codeId = useId();
  const panelId = useId();
  const waitingForLocal = status !== "open";
  const pending = busy || (waitingForLocal && !error);

  useEffect(() => client.onStatus(setStatus), [client]);

  useEffect(() => {
    if (!pending) { setBusyVisible(false); return; }
    // Fast local preparation should not flash a loading label or move the dialog.
    const timer = window.setTimeout(() => setBusyVisible(true), 200);
    return () => window.clearTimeout(timer);
  }, [pending]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // A link opens in a new tab. Closing/reloading the originating page must
      // not destroy its key before the new page can validate the receipt.
      // Pending invitations are bounded and expire in PairStore.
    };
  }, [client]);
  useEffect(() => {
    if (!request?.expires || saved) return;
    const timer = window.setTimeout(() => setExpired(true), Math.max(0, request.expires * 1000 - Date.now()));
    return () => window.clearTimeout(timer);
  }, [request, saved]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await action(); }
    catch (reason) {
      const localFailure = reason instanceof Error && "status" in reason && [503, 504].includes(Number(reason.status));
      if (alive.current) setError(`remote.errors.${localFailure ? "local_connection_unavailable" : reason instanceof Error ? reason.message : "unknown"}`);
    } finally { if (alive.current) setBusy(false); }
  };
  const start = () => run(async () => {
    if (requestId.current) await remoteAction(client, "pair_cancel", { id: requestId.current });
    const result = await remoteAction<Request>(client, "pair_start", { return_origin: pairingReturnOrigin() });
    if (!alive.current) { await remoteAction(client, "pair_cancel", { id: result.id }); return; }
    requestId.current = result.id;
    setRequest(result); setPreview(null); setCode(""); setCopied(false); setExpired(false); setManual(false); setPanel(null);
  });
  const review = () => run(async () => {
    if (!request) return;
    const result = await remoteAction<Preview>(client, "pair_preview", { id: request.id, code });
    if (alive.current) setPreview(result);
  });
  const connect = () => run(async () => {
    if (!request || !preview || !connections) return;
    let id = saved;
    if (!id) {
      const result = await remoteAction<{ id: string }>(client, "pair_finish", { id: request.id, code });
      id = result.id;
      if (!alive.current) return;
      setSaved(id);
    }
    await connections.refresh();
    if (!alive.current) return;
    await connections.connect(id, () => alive.current);
    if (alive.current) onClose();
  });

  useEffect(() => {
    if (initialized.current) return;
    // A return link mounts immediately after bootstrap, before the local socket
    // opens. Wait for it; rejecting here would mislabel a valid link as invalid.
    if (status !== "open") {
      const timer = window.setTimeout(() => setError("remote.errors.local_connection_unavailable"), 10_000);
      return () => window.clearTimeout(timer);
    }
    initialized.current = true;
    if (returned) void review();
    else void start();
    // One invitation per mounted dialog, never one per re-render. The returned
    // receipt is reviewed only; saving/connecting still requires a user click.
  }, [status]);
  const copyCommand = () => {
    if (!request) return;
    void copyTextToClipboard(request.command).then((ok) => {
      if (!alive.current || requestId.current !== request.id || Date.now() >= request.expires * 1000) return;
      if (ok) { setCopied(true); setError(""); setPanel(null); }
      else { setPanel("command"); setError("remote.pair.copyFailed"); }
    });
  };
  const invalidReturn = ["pair_invalid", "pair_expired", "pair_used"].some((code) => error === `remote.errors.${code}`);
  const restartAvailable = !saved && (expired || (!!error && !request?.command && !preview && (!returned || invalidReturn)));
  const reviewingReturn = !!returned && !request?.command && !preview && !manual && !restartAvailable;
  const title = preview ? "remote.pair.confirmTitle" : reviewingReturn ? "remote.pair.review" : restartAvailable ? "remote.add"
    : manual ? "remote.pair.code" : copied ? "remote.pair.copiedTitle" : "remote.add";
  const description = preview || reviewingReturn ? "remote.pair.confirmLinkDescription" : restartAvailable ? "remote.pair.introHint"
    : manual ? "remote.pair.codeHint" : copied ? "remote.pair.afterCopyHint" : "remote.pair.introHint";
  const showCopied = copied && !manual && !preview && !restartAvailable;
  const showBusy = pending && busyVisible;
  const actionLabel = restartAvailable ? "remote.pair.restart" : reviewingReturn ? error ? "remote.retry" : "remote.pair.review" : preview ? saved ? "remote.retry" : "remote.connect"
    : manual ? "remote.pair.review" : copied ? "remote.pair.copyAgain" : "remote.pair.copy";
  const busyLabel = waitingForLocal ? "remote.pair.waitingForLocal" : preview ? "remote.connecting" : !restartAvailable && (manual || returned)
    ? "remote.pair.checkingLink" : "remote.pair.preparing";

  return <>
    <DialogHeader className="shrink-0 pr-5 text-left">
      <div aria-live="polite" aria-atomic="true" className="space-y-1.5">
        <DialogTitle className="flex min-h-5 items-center gap-2">
          {showCopied && <Check aria-hidden="true" className="h-5 w-5 shrink-0 motion-safe:animate-in motion-safe:fade-in duration-150" />}
          {t(title)}
        </DialogTitle>
        <div className="grid">
          <DialogDescription className="col-start-1 row-start-1">{t(description)}</DialogDescription>
          {/* Reserve the longer instruction in either state, including translated text.
              It is only a layout spacer, never a second screen-reader announcement. */}
          {!preview && !manual && !reviewingReturn && <p aria-hidden="true" className="invisible pointer-events-none col-start-1 row-start-1 select-none text-sm">
            {t(showCopied ? "remote.pair.introHint" : "remote.pair.afterCopyHint")}
          </p>}
        </div>
      </div>
    </DialogHeader>
    <div className="-mx-1 min-h-0 space-y-4 overflow-y-auto overscroll-contain px-1">
      {preview ? <div className="space-y-4">
        <div className="rounded-2xl bg-muted/50 p-4">
          <p className="font-medium">{preview.hostname}</p>
          <p className="mt-1 break-all text-xs text-muted-foreground">{preview.host}</p>
        </div>
        <p className="text-[13px] leading-5">{t("remote.pair.access")}</p>
        <p className="text-xs leading-5 text-muted-foreground">{t("remote.pair.expiry", { date: new Date(preview.authorized_until * 1000).toLocaleDateString() })}</p>
        <Disclosure className="text-xs text-muted-foreground" summaryClassName="flex min-h-9 items-center gap-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          summary={<><ChevronDown aria-hidden className="h-3.5 w-3.5 shrink-0 transition-transform group-data-[state=open]/disclosure:rotate-180 motion-reduce:transition-none" />{t("remote.pair.security")}</>}>
          <p className="my-2 leading-5">{t("remote.pair.fingerprint")}</p><code className="block break-all">{preview.fingerprint}</code>
          <p className="mb-2 mt-4 leading-5">{t("remote.pair.revoke")}</p><code className="block break-all">{preview.revoke_command}</code>
        </Disclosure>
        {saved && error && <div className="space-y-2"><p className="text-xs leading-5 text-muted-foreground">{t("remote.pair.retryHint")}</p>
          <Disclosure summaryClassName="flex min-h-9 items-center gap-2 rounded-xl text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" contentClassName="pt-2"
            summary={<><ChevronDown aria-hidden className="h-3.5 w-3.5 shrink-0 transition-transform group-data-[state=open]/disclosure:rotate-180 motion-reduce:transition-none" />{t("remote.pair.route")}</>}><PairRouteSettings id={saved} /></Disclosure>
        </div>}
      </div> : restartAvailable ? null : <>
        {manual && <div className="space-y-2"><label htmlFor={codeId} className="sr-only">{t("remote.pair.code")}</label>
          <Textarea ref={manualInput} id={codeId} value={code} onChange={(event) => { setCode(event.target.value); setError(""); }} placeholder="nbpc1.…" autoComplete="off" spellCheck={false} disabled={busy || expired} className="min-h-20 resize-none break-all font-mono text-xs" />
        </div>}
        <div>
          <DisclosureContent id={panelId} open={panel === "command" && !!request?.command}>
            <div className="rounded-2xl bg-muted/50 p-3">
              <code className="block max-h-32 select-text overflow-y-auto break-all text-[11px] leading-5" aria-label={t("remote.pair.command")}>{request?.command}</code>
            </div>
          </DisclosureContent>
          <DisclosureContent open={panel === "help"}>
            <div className="space-y-2 rounded-2xl bg-muted/50 p-3 text-xs leading-5 text-muted-foreground">
              <p className="font-medium text-foreground">{t("remote.pair.helpTitle")}</p>
              <p>{t("remote.pair.requirements")}</p>
              <p>{t("remote.pair.runHint")}</p>
              <p>{t("remote.pair.validityHint")}</p>
            </div>
          </DisclosureContent>
        </div>
      </>}
      {expired && !saved && <p role="status" className="text-xs leading-5 text-muted-foreground">{t("remote.pair.expired")}</p>}
      {error && <p role="alert" className="flex items-start gap-2 text-[13px] leading-5 text-foreground"><AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />{t(error, { defaultValue: t("remote.errors.unknown") })}</p>}
    </div>
    <div className={preview ? "flex shrink-0 flex-col-reverse gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between" : "flex shrink-0 flex-col gap-2 pt-1"}>
      {preview && (!saved ? <Button variant="ghost" disabled={busy} onClick={() => { setPreview(null); setError(""); if (!request?.command) setManual(true); }}><ArrowLeft className="mr-1 h-4 w-4" />{t("remote.back")}</Button>
          : <Button variant="ghost" onClick={() => { connections?.cancel(); onClose(); }}>{t("common.cancel")}</Button>
      )}
      <Button variant={showCopied ? "outline" : "default"} className={showCopied ? "bg-transparent" : undefined} aria-label={t(showBusy ? busyLabel : actionLabel)} aria-busy={pending} disabled={busy || waitingForLocal || (!restartAvailable && (!request || (!preview && (manual || reviewingReturn ? !code.trim() : !request.command))))} onClick={() => { if (restartAvailable) void start(); else if (preview) void connect(); else if (manual || reviewingReturn) void review(); else copyCommand(); }}>
        {showBusy ? <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" /> : !restartAvailable && !preview && !manual && !reviewingReturn ? <Copy aria-hidden="true" className="mr-2 h-4 w-4 shrink-0" /> : null}
        <span role="status" className="min-w-0 truncate">{t(showBusy ? busyLabel : actionLabel)}</span>
      </Button>
      {!preview && <div className="-mx-3 flex items-center justify-between gap-1">
        {request?.command ? manual ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setManual(false); setPanel(null); setError(""); }}>{t("remote.back")}</Button>
          : <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" disabled={expired} aria-expanded={panel === "command"} aria-controls={panelId} onClick={() => setPanel(panel === "command" ? null : "command")}>{t("remote.pair.showCommand")}</Button> : <span />}
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="text-xs text-muted-foreground">{t("remote.pair.otherWays")}<ChevronDown aria-hidden="true" className="ml-1 h-3.5 w-3.5" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" onCloseAutoFocus={(event) => {
            if (focusManual.current) { event.preventDefault(); focusManual.current = false; manualInput.current?.focus(); }
          }}>
            <DropdownMenuItem disabled={!request || busy || expired || restartAvailable} onSelect={() => { focusManual.current = true; setManual(true); setPanel(null); setError(""); }}>{t("remote.pair.pasteInstead")}</DropdownMenuItem>
            <DropdownMenuItem onSelect={onSSH}>{t("remote.pair.useSSH")}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={restartAvailable} onSelect={() => setPanel(panel === "help" ? null : "help")}>{t("remote.pair.helpTitle")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>}
    </div>
  </>;
}
