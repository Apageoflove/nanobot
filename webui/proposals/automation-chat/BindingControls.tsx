import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Check, Users } from 'lucide-react';
import { ChannelLogo } from '@/components/settings/channels/ChannelIdentity';
import { Button } from '@/components/ui/button';
import { DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { NanobotFeatureInfo, SessionAutomationJob } from '@/lib/types';

export const targets = {
  weixin: { name: '我的私聊', platform: '微信', channel: 'weixin', group: false },
  feishu: { name: '产品讨论群', platform: '飞书', channel: 'feishu', group: true },
  telegram: { name: '工作群 / 日报', platform: 'Telegram', channel: 'telegram', group: true },
  webui: { name: '天气助手', platform: '网页聊天', channel: 'websocket', group: false },
};
export type Target = keyof typeof targets;
export const legacy = '\n\n投递方式：调用 message 发送到微信。\nchannel="weixin"\nchat_id="demo-person"\ncontent=整理好的天气推送文本';
export const PreviewContext = createContext<{
  mode: string; scenario: string;
  save: (job: SessionAutomationJob, target: Target, message: string) => Promise<void>;
} | null>(null);
const BindingContext = createContext<{
  saved: Target; notice: string; locked: boolean;
  select: (target: Target) => void;
} | null>(null);

export function ConversationIdentity({ target }: { target: Target }) {
  const item = targets[target];
  const feature: NanobotFeatureInfo = {
    name: item.channel, display_name: item.platform, type: 'channel',
    enabled: true, installed: true, ready: true, status: 'ready',
    install_supported: false, requires_restart: false,
  };
  return <span className="flex min-w-0 items-center gap-2.5 text-start">
    <span aria-hidden className="relative h-6 w-6 shrink-0">
      {target === 'webui' ? <img src="/brand/nanobot_mark.svg" alt="" className="h-6 w-6" />
        : <span className="absolute left-0 top-0 origin-top-left scale-75"><ChannelLogo feature={feature} showBrandLogos /></span>}
    </span>
    <span className="min-w-0">
      <span className="block truncate text-[13px] leading-5">{item.name}<span className="ml-2 text-[12px] text-muted-foreground">{item.platform}</span></span>
    </span>
  </span>;
}

// One original dialog owns the complete interaction. The page never unmounts.
export function BindingDialogFrame({ job, children }: { job: SessionAutomationJob; children: ReactNode }) {
  const preview = useContext(PreviewContext)!;
  const saved = (Object.keys(targets) as Target[]).find(key => targets[key].channel === job.origin?.channel) ?? 'webui';
  const [draft, setDraft] = useState(saved);
  const [reviewing, setReviewing] = useState(false);
  const [message, setMessage] = useState(job.payload.message);
  const [ack, setAck] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const returning = useRef(false);
  const locked = Boolean(job.state.pending || preview.scenario === 'oldhost');
  useEffect(() => {
    if (reviewing) heading.current?.focus();
    else if (returning.current) {
      document.querySelector<HTMLButtonElement>('[data-binding-select]')?.focus();
      returning.current = false;
    }
  }, [reviewing]);
  const back = () => { returning.current = true; setReviewing(false); };
  const save = async () => {
    if (!ack || !message.trim() || saving || locked) return;
    setSaving(true); setError('');
    try {
      await preview.save(job, draft, message);
      setNotice('已更换，下次执行时使用这个聊天。'); back();
    } catch { setError('没有保存：任务已被其他操作修改。原设置没变，你填写的内容也还在。'); }
    finally { setSaving(false); }
  };
  if (preview.mode === 'current') return children;
  return <BindingContext.Provider value={{ saved, notice, locked,
    select: target => {
      if (target === saved || locked) return;
      setDraft(target); setNotice(''); setAck(false); setError(''); setReviewing(true);
    },
  }}>
    {!reviewing ? children : <>
      <DialogHeader className="shrink-0 px-6 pb-4 pr-12 pt-5 text-left">
        <DialogTitle ref={heading} tabIndex={-1} className="text-lg font-medium leading-snug tracking-normal">确认更换聊天</DialogTitle>
      </DialogHeader>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-6 pb-4">
        <div className="space-y-3 rounded-control bg-muted/50 p-3">
          <div className="flex items-center gap-3"><span className="w-8 shrink-0 text-[12px] text-muted-foreground">现在</span><ConversationIdentity target={saved} /></div>
          <div className="flex items-center gap-3"><span className="w-8 shrink-0 text-[12px] text-muted-foreground">改为</span><ConversationIdentity target={draft} /></div>
        </div>
        <p className="mt-3 text-[13px] leading-5">下次执行时，nanobot 会参考新聊天的记录，并默认把结果发到那里。</p>
        <p className="mt-2 text-[12px] leading-5 text-muted-foreground">原来的聊天记录不会带过去。执行时间不变，也不会马上运行。</p>
        {targets[draft].group ? <p className="mt-3 flex items-start gap-2 text-[12px] leading-5"><Users className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden/>这是群聊，群里的人可能看到任务涉及的内容和结果。</p> : null}
        <label className="mt-4 block space-y-2"><span className="text-[12px] text-muted-foreground">任务说明（可以修改）</span>
          <Textarea aria-label="任务说明" rows={4} value={message} disabled={saving} onChange={event => { setMessage(event.target.value); setAck(false); }} className="min-h-24 resize-y text-base leading-6 sm:text-[13px] sm:leading-5"/>
        </label>
        {message.includes(legacy.trim()) ? <div className="mt-2 text-[12px] leading-5 text-muted-foreground">
          <p>说明里还要求把结果发到微信。只改上面的聊天，不会删除这条要求。</p>
          <Button variant="link" size="sm" className="h-auto px-0 py-2 text-[12px]" disabled={saving} onClick={() => { setMessage(message.replace(legacy, '')); setAck(false); }}>删除说明里的旧发送要求</Button>
        </div> : null}
        <label className="mt-3 flex min-h-11 items-start gap-2 py-2 text-[12px] leading-5"><input type="checkbox" checked={ack} disabled={saving} onChange={event => setAck(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-current"/><span>我已检查，任务内容可以在这里使用</span></label>
        <p role={error ? 'alert' : 'status'} className={`min-h-5 text-[12px] leading-5 ${error ? 'text-destructive' : 'text-muted-foreground'}`}>{error || (saving ? '正在保存，暂时仍使用原来的聊天。' : '')}</p>
      </div>
      <DialogFooter className="shrink-0 flex-row justify-between gap-2 border-t border-border/45 px-6 py-3">
        <Button variant="ghost" size="sm" disabled={saving} className="h-11 gap-1.5 font-normal text-muted-foreground sm:h-9" onClick={back}><ArrowLeft className="h-3.5 w-3.5" aria-hidden/>返回选择</Button>
        <Button size="sm" className="h-11 min-w-24 sm:h-9" disabled={!ack || !message.trim() || saving || locked} onClick={save}>{saving ? '正在保存…' : '确认更换'}</Button>
      </DialogFooter>
    </>}
  </BindingContext.Provider>;
}

export function BindingControls({ job, currentUi }: { job: SessionAutomationJob; currentUi: ReactNode }) {
  const preview = useContext(PreviewContext);
  const state = useContext(BindingContext);
  if (!state || preview?.mode === 'current' || job.protected) return currentUi;
  return <div className="border-t border-border/45 pt-3">
    <dl><div className="grid min-w-0 grid-cols-1 items-start gap-2 py-1 text-sm min-[420px]:grid-cols-[6rem_minmax(0,1fr)] min-[420px]:gap-4">
      <dt className="text-[13px] text-muted-foreground min-[420px]:pt-3">任务所在聊天</dt>
      <dd className="min-w-0">
        <Select value={state.saved} onValueChange={value => state.select(value as Target)} disabled={state.locked}>
          <SelectTrigger aria-label="任务所在聊天" data-binding-select className="h-auto min-h-11 w-full [&>span:first-child]:min-w-0 [&>span:first-child]:flex-1 [&>span:first-child]:text-start"><SelectValue><ConversationIdentity target={state.saved} /></SelectValue></SelectTrigger>
          <SelectContent>
            {(Object.keys(targets) as Target[]).map(key => <SelectItem key={key} value={key} textValue={`${targets[key].name} ${targets[key].platform}`} className="min-h-11 py-2 [&>span:last-child]:min-w-0 [&>span:last-child]:w-full"><ConversationIdentity target={key} /></SelectItem>)}
            <SelectItem value="offline" disabled className="min-h-11 text-[12px]">值班群 · 飞书（暂时无法连接）</SelectItem>
          </SelectContent>
        </Select>
      </dd>
    </div></dl>
    <p className="mt-2 text-[12px] leading-5 text-muted-foreground">{state.locked ? (job.state.pending ? '任务正在执行或等待执行，暂时不能更换聊天。' : '当前连接的 nanobot 版本还不能更换聊天。') : 'nanobot 会参考这里的聊天记录，完成任务后默认在这里回复。'}</p>
    {state.notice ? <p role="status" className="mt-3 flex items-center gap-1.5 text-[12px] text-muted-foreground"><Check className="h-3.5 w-3.5" aria-hidden/>{state.notice}</p> : null}
  </div>;
}
