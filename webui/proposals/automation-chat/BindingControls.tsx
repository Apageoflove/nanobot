import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, MoreHorizontal, Users } from 'lucide-react';
import { ChannelLogo } from '@/components/settings/channels/ChannelIdentity';
import { Button } from '@/components/ui/button';
import { DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Disclosure } from '@/components/ui/disclosure';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
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
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[13px] leading-5">
      <span className="min-w-0 break-words">{item.name}</span><span className="text-[12px] text-muted-foreground">{item.platform}</span>
    </span>
  </span>;
}

function ChatPicker({ value, disabled, onChange, detail = false }: {
  value: Target; disabled: boolean; onChange: (target: Target) => void; detail?: boolean;
}) {
  return <Select value={value} onValueChange={value => onChange(value as Target)} disabled={disabled}>
    <SelectTrigger aria-label={detail ? '任务所在聊天' : '新聊天'} data-binding-select={detail || undefined}
      className={`h-auto min-h-11 w-full py-2 [&>span:first-child]:min-w-0 [&>span:first-child]:flex-1 [&>span:first-child]:text-start ${detail ? 'border-transparent bg-transparent hover:bg-muted/50' : ''}`}>
      <SelectValue><ConversationIdentity target={value} /></SelectValue>
    </SelectTrigger>
    <SelectContent>
      {(Object.keys(targets) as Target[]).map(key => <SelectItem key={key} value={key} textValue={`${targets[key].name} ${targets[key].platform}`}
        className="h-auto min-h-11 py-2 [&>span:last-child]:min-w-0 [&>span:last-child]:max-w-[calc(100vw-5rem)] [&>span:last-child]:w-full"><ConversationIdentity target={key} /></SelectItem>)}
      <SelectItem value="offline" disabled className="h-auto min-h-11 text-[12px]">值班群 · 飞书（暂时无法连接）</SelectItem>
    </SelectContent>
  </Select>;
}

// One original dialog owns the complete interaction. The page never unmounts.
export function BindingDialogFrame({ job, children }: { job: SessionAutomationJob; children: ReactNode }) {
  const preview = useContext(PreviewContext)!;
  const saved = (Object.keys(targets) as Target[]).find(key => targets[key].channel === job.origin?.channel) ?? 'webui';
  const [draft, setDraft] = useState(saved);
  const [reviewing, setReviewing] = useState(false);
  const [message, setMessage] = useState(job.payload.message);
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
    if (draft === saved || !message.trim() || saving || locked) return;
    setSaving(true); setError('');
    try {
      await preview.save(job, draft, message);
      setNotice('已更换，下次执行生效。'); back();
    } catch { setError('任务已被修改，未保存。原聊天未变，草稿已保留。'); }
    finally { setSaving(false); }
  };
  if (preview.mode === 'current') return children;
  return <BindingContext.Provider value={{ saved, notice, locked,
    select: target => {
      if (target === saved || locked) return;
      setDraft(target); setNotice(''); setError(''); setReviewing(true);
    },
  }}>
    {!reviewing ? children : <>
      <DialogHeader className="shrink-0 px-6 pb-4 pr-12 pt-5 text-left">
        <DialogTitle ref={heading} tabIndex={-1} className="text-lg font-medium leading-snug tracking-normal outline-none">更换聊天</DialogTitle>
      </DialogHeader>
      <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain px-6">
        <div className="space-y-2">
          <ChatPicker value={draft} disabled={saving || locked} onChange={target => { setDraft(target); setError(''); }} />
          <p className="text-[12px] leading-5 text-muted-foreground">原聊天：{targets[saved].name} · {targets[saved].platform}</p>
          <p className="text-[13px] leading-5">后续任务会使用新聊天的记录，结果也默认发到这里。</p>
        </div>
        <div className="space-y-2">
          <label className="block space-y-2"><span className="text-[13px] font-medium">任务说明</span>
            <Textarea aria-label="任务说明" rows={3} value={message} disabled={saving} onChange={event => { setMessage(event.target.value); setError(''); }} className="min-h-20 resize-y text-base leading-6 sm:text-[13px] sm:leading-5"/>
          </label>
          {message.includes(legacy.trim()) ? <div className="flex flex-wrap items-center gap-x-2 text-[12px] leading-5">
            <span className="text-muted-foreground">说明仍要求发到微信。</span>
            <Button variant="link" size="sm" className="h-auto min-h-11 px-0 py-1 text-[12px] sm:min-h-7" disabled={saving} onClick={() => setMessage(message.replace(legacy, ''))}>移除旧指令</Button>
          </div> : null}
          {targets[draft].group ? <p className="flex items-start gap-2 text-[12px] leading-5 text-muted-foreground"><Users className="mt-0.5 h-4 w-4 shrink-0" aria-hidden/>群成员可能看到任务内容和结果。</p> : null}
        </div>
        <Disclosure summary={<><ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-data-[state=open]/disclosure:rotate-180 motion-reduce:transition-none" aria-hidden/>记录和执行时间</>}
          summaryClassName="flex min-h-9 items-center gap-1.5 rounded-control text-[12px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          contentClassName="pt-1 text-[12px] leading-5 text-muted-foreground">
          旧聊天记录不会迁移。执行时间和启用状态不变，也不会立即运行。
        </Disclosure>
        {error ? <p role="alert" className="text-[12px] leading-5 text-destructive">{error}</p> : null}
      </div>
      <DialogFooter className="shrink-0 flex-row justify-end gap-2 px-6 pb-5 pt-3">
        <Button variant="ghost" size="sm" disabled={saving} className="h-11 font-normal text-muted-foreground sm:h-9" onClick={back}>取消</Button>
        <Button size="sm" className="h-11 min-w-24 sm:h-9" disabled={draft === saved || !message.trim() || saving || locked} aria-busy={saving} onClick={save}>{saving ? '正在更换…' : '确认并更换'}</Button>
      </DialogFooter>
    </>}
  </BindingContext.Provider>;
}

export function BindingControls({ job, currentUi }: { job: SessionAutomationJob; currentUi: ReactNode }) {
  const preview = useContext(PreviewContext);
  const state = useContext(BindingContext);
  if (!state || preview?.mode === 'current' || job.protected) return currentUi;
  return <div>
    <dl><div className="grid min-w-0 grid-cols-1 items-start gap-1 py-1 text-sm min-[420px]:grid-cols-[6rem_minmax(0,1fr)] min-[420px]:gap-4">
      <dt className="text-[13px] text-muted-foreground min-[420px]:pt-3">任务所在聊天</dt>
      <dd className="min-w-0">
        <ChatPicker value={state.saved} disabled={state.locked} onChange={state.select} detail />
      </dd>
    </div></dl>
    <p role={state.notice ? 'status' : undefined} className="mt-1 text-[12px] leading-5 text-muted-foreground">{state.locked ? (job.state.pending ? '执行或排队期间不能更换。' : '当前版本暂不支持更换。') : state.notice || '使用这里的聊天记录，结果也默认发到这里。'}</p>
  </div>;
}

export function BindingDetailActions({ job, currentUi, busy, canToggle, canRun, localTrigger, originHref, onToggle, onRun, onEdit, onDelete }: {
  job: SessionAutomationJob; currentUi: ReactNode; busy: boolean; canToggle: boolean; canRun: boolean;
  localTrigger: boolean; originHref: string | null;
  onToggle: () => void; onRun: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const preview = useContext(PreviewContext);
  if (preview?.mode === 'current') return currentUi;
  return <div className="flex shrink-0 items-center gap-2 border-t border-border/45 px-6 py-3">
    {/* The detail dialog already owns the modal lock. */}
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" disabled={busy} aria-label="更多操作" className="h-11 w-11 text-muted-foreground sm:h-9 sm:w-9"><MoreHorizontal className="h-4 w-4" aria-hidden /></Button></DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start">
        <DropdownMenuItem disabled={busy || !canToggle} onSelect={onToggle}>{job.enabled ? '停用任务' : '启用任务'}</DropdownMenuItem>
        {originHref ? <DropdownMenuItem asChild><a href={originHref}>打开聊天</a></DropdownMenuItem> : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem tone="destructive" disabled={busy} onSelect={onDelete}>删除任务</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <div className="ml-auto flex gap-2">
      <Button variant="ghost" size="sm" className="h-11 font-normal sm:h-9" disabled={busy} onClick={onEdit}>编辑</Button>
      {!localTrigger ? <Button variant="secondary" size="sm" className="h-11 font-normal sm:h-9" disabled={busy || !canRun} onClick={onRun}>立即运行</Button> : null}
    </div>
  </div>;
}
