import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChannelLogo } from "@/components/settings/channels/ChannelIdentity";
import { channelUiOwner, channelUiPresentation } from "@/channel-plugins/registry";
import { channelTranslator } from "@/channel-plugins/i18n";
import { Button } from "@/components/ui/button";
import { DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fetchAutomationChats } from "@/lib/api";
import { readLocalPreferences } from "@/lib/local-preferences";
import type { AutomationChat, AutomationChatsPayload, AutomationChatUpdate, NanobotFeatureInfo, SessionAutomationJob } from "@/lib/types";

export type ChangeAutomationChat = (job: SessionAutomationJob, values: AutomationChatUpdate) => Promise<void>;

function ChatIdentity({ chat }: { chat: AutomationChat }) {
  const { t } = useTranslation();
  const owner = channelUiOwner(chat.channel);
  const presentation = channelUiPresentation(chat.channel);
  const platform = chat.channel === "websocket" ? t("settings.automations.chat.web")
    : channelTranslator(t, owner)("displayName", presentation?.displayName ?? chat.channel);
  const feature: NanobotFeatureInfo = {
    name: chat.channel, display_name: platform, type: "channel", enabled: true,
    installed: true, ready: true, status: "ready", install_supported: false, requires_restart: false,
  };
  return <span className="flex min-w-0 items-center gap-2.5 text-start">
    <span aria-hidden className="relative h-6 w-6 shrink-0">
      {chat.channel === "websocket" ? <img src="/brand/nanobot_mark.svg" alt="" className="h-6 w-6" />
        : <span className="absolute left-0 top-0 origin-top-left scale-75"><ChannelLogo feature={feature} showBrandLogos={readLocalPreferences().brandLogos} /></span>}
    </span>
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[13px] leading-5">
      <span className="min-w-0 break-words">{chat.title}</span><span className="text-[12px] text-muted-foreground">{platform}</span>
    </span>
  </span>;
}

export function AutomationChatBinding({ job, token, onSave, children }: {
  job: SessionAutomationJob; token: string; onSave: ChangeAutomationChat;
  children: (picker: ReactNode) => ReactNode;
}) {
  const { t } = useTranslation();
  const tx = (key: string, values?: Record<string, string>) => t(`settings.automations.chat.${key}`, values);
  const [data, setData] = useState<AutomationChatsPayload | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [draft, setDraft] = useState<{ target: AutomationChat; previous: AutomationChat; revision: string; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<{ target: AutomationChat; previous: AutomationChat } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const returning = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoadError(false);
    void fetchAutomationChats(token, job.id, controller.signal).then(value => {
      if (!controller.signal.aborted) setData(value);
    }).catch(() => { if (!controller.signal.aborted) setLoadError(true); });
    return () => controller.abort();
  }, [token, job.id, job.chat_binding_revision, reload]);
  const reviewing = draft !== null;
  const locked = saving || Boolean(job.state.pending);
  const pickerDisabled = locked || !data?.chats.length || loadError || (!reviewing && data.revision !== job.chat_binding_revision);
  useEffect(() => {
    if (reviewing) heading.current?.focus();
  }, [reviewing]);
  useEffect(() => {
    if (!reviewing && !pickerDisabled && returning.current) {
      trigger.current?.focus(); returning.current = false;
    }
  }, [reviewing, pickerDisabled]);
  const back = () => { returning.current = true; setDraft(null); };
  const current = data?.current;
  const fallback: AutomationChat = { id: "current", title: job.origin?.title || tx("current"), channel: job.origin?.channel || "websocket" };
  const targetUnavailable = Boolean(draft && data && !data.chats.some(chat => chat.id === draft.target.id && !chat.unavailable));
  const picker = (review: boolean) => <Select value={review ? draft?.target.id : current?.id ?? "current"}
    disabled={pickerDisabled} onValueChange={id => {
      const target = data?.chats.find(chat => chat.id === id);
      if (!target || target.unavailable || id === current?.id) return;
      setError(""); setSaved(null);
      setDraft(previous => previous ? { ...previous, target } : {
        target, previous: current ?? fallback,
        revision: job.chat_binding_revision!, message: job.payload.message,
      });
    }}>
    <SelectTrigger ref={review ? undefined : trigger} aria-label={tx(review ? "new" : "label")}
      className="h-auto min-h-11 w-full py-2 [&>span:first-child]:min-w-0 [&>span:first-child]:flex-1 [&>span:first-child]:text-start">
      <SelectValue><ChatIdentity chat={(review ? draft?.target : current) ?? fallback} /></SelectValue>
    </SelectTrigger>
    <SelectContent>
      {!current ? <SelectItem value="current" disabled><ChatIdentity chat={fallback} /></SelectItem> : null}
      {data?.chats.map(chat => <SelectItem key={chat.id} value={chat.id} textValue={`${chat.title} ${chat.channel}`}
        disabled={chat.unavailable || (review && chat.id === current?.id)}
        className="h-auto min-h-11 py-2 [&>span:first-child]:min-w-0 [&>span:first-child]:max-w-[calc(100vw-5rem)] [&>span:first-child]:w-full"><ChatIdentity chat={chat} /></SelectItem>)}
    </SelectContent>
  </Select>;
  const save = async () => {
    if (!draft || locked || targetUnavailable || !draft.message.trim()) return;
    setSaving(true); setError("");
    try {
      await onSave(job, { target_id: draft.target.id, revision: draft.revision, message: draft.message });
      setData(previous => previous ? { ...previous, current: draft.target } : previous);
      setSaved({ target: draft.target, previous: draft.previous }); back(); setReload(value => value + 1);
    } catch (cause) {
      const reasons: Record<string, string> = {
        automation_chat_conflict: "conflict", automation_chat_busy: "schedulerBusy",
        automation_chat_unavailable: "unavailable",
      };
      setError(tx(cause instanceof Error ? reasons[cause.message] ?? "failed" : "failed"));
    } finally { setSaving(false); }
  };
  if (!draft) return children(<div className="space-y-2">
    <p className="text-[13px] font-medium">{tx("label")}</p>
    {picker(false)}
    <p role={saved ? "status" : undefined} className="text-[12px] leading-5 text-muted-foreground">
      {job.state.pending ? tx("busy") : saved ? tx("saved", { chat: saved.target.title }) : tx("hint")}
    </p>
    {saved && current?.id === saved.target.id && data?.chats.some(chat => chat.id === saved.previous.id && !chat.unavailable) ? (
      <Button variant="link" size="sm" className="h-11 justify-start whitespace-normal p-0 text-start text-[12px] sm:h-auto" disabled={pickerDisabled}
        onClick={() => {
          setError("");
          setDraft({ target: saved.previous, previous: current, revision: data.revision, message: job.payload.message });
        }}>{tx("changeBack", { chat: saved.previous.title })}</Button>
    ) : null}
    {loadError ? <Button variant="link" size="sm" onClick={() => setReload(value => value + 1)}>{tx("retry")}</Button> : null}
    {data && data.chats.length <= (current ? 1 : 0) ? <p className="text-[12px] leading-5 text-muted-foreground">{tx("available")}</p> : null}
  </div>);
  return <>
    <DialogHeader className="shrink-0 px-6 pb-4 pr-12 pt-5 text-left">
      <DialogTitle ref={heading} tabIndex={-1} className="break-words text-lg font-medium leading-snug tracking-normal outline-none">{tx("change")}</DialogTitle>
    </DialogHeader>
    <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain px-6">
      <div className="space-y-2">
        <div role="group" aria-label={tx("previous")} className="flex min-w-0 items-start gap-3 pb-1 text-muted-foreground">
          <span className="shrink-0 text-[12px] leading-6">{tx("previous")}</span>
          <ChatIdentity chat={draft.previous} />
        </div>
        <p className="text-[13px] font-medium">{tx("new")}</p>
        {picker(true)}
      </div>
      <div className="space-y-1">
        <p className="text-[13px] leading-5">{tx("effect")}</p>
        <p className="text-[12px] leading-5 text-muted-foreground">{tx("history")}</p>
      </div>
      <label className="block space-y-2"><span className="text-[13px] font-medium">{tx("message")}</span>
        <Textarea rows={3} value={draft.message} disabled={saving} onChange={event => setDraft({ ...draft, message: event.target.value })}
          className="min-h-20 resize-y text-base leading-6 sm:text-[13px] sm:leading-5" />
      </label>
      <p className="text-[12px] leading-5 text-muted-foreground">{tx("review")}</p>
      {error || targetUnavailable ? <p role="alert" className="text-[12px] leading-5 text-destructive">{error || tx("unavailable")}</p> : null}
    </div>
    <DialogFooter className="shrink-0 flex-row justify-end gap-2 px-6 pb-5 pt-3">
      <Button variant="ghost" size="sm" disabled={saving} className="h-11 font-normal text-muted-foreground sm:h-9" onClick={back}>{t("settings.automations.cancel")}</Button>
      <Button size="sm" className="h-11 sm:h-9" disabled={locked || targetUnavailable || !draft.message.trim()} aria-busy={saving} onClick={() => void save()}>{tx(saving ? "saving" : "confirm")}</Button>
    </DialogFooter>
  </>;
}
