import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Menu, Moon, Sun, SlidersHorizontal } from 'lucide-react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from '@/i18n/locales/zh-CN/common.json';
import { Sidebar } from '@/components/Sidebar';
import { AutomationsSettings, AutomationEditDialog, AutomationDeleteDialog } from '@/components/settings/system/AutomationsSettings';
import { Button } from '@/components/ui/button';
import { DialogLayoutContext } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { ClientProvider } from '@/providers/ClientProvider';
import { NanobotClient } from '@/lib/nanobot-client';
import type { ChatSummary, SessionAutomationJob } from '@/lib/types';
import { PreviewContext, targets, legacy, type Target } from './BindingControls';
import '@/globals.css';

const params = new URLSearchParams(location.search);
void i18n.use(initReactI18next).init({ lng: 'zh-CN', fallbackLng: 'zh-CN', resources: { 'zh-CN': { translation: zhCN, 'channel-weixin': { displayName: '微信' }, 'channel-feishu': { displayName: '飞书' }, 'channel-telegram': { displayName: 'Telegram' } } }, interpolation: { escapeValue: false }, initAsync: false });
// Required by the real sidebar. Never connect this client to a gateway.
const client = new NanobotClient({ url: 'ws://127.0.0.1:1/preview-disabled', reconnect: false });
const now = Date.now();
const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(8, 0, 0, 0);
const weather: SessionAutomationJob = {
  id: 'demo-weather-changde', name: '天气推送·常德', enabled: true,
  schedule: { kind: 'cron', expr: '0 8 * * *', tz: 'Asia/Shanghai' },
  payload: { message: '查询常德未来一小时天气，整理一条简短推送，重点写：\n- 天气现象、气温/体感、降水概率\n- 穿衣、带伞、防晒与出行建议\n\n口语化、简短，不照抄原始输出，不加多余分析。' + legacy },
  state: { next_run_at_ms: tomorrow.getTime(), last_run_at_ms: tomorrow.getTime() - 86400000, last_status: 'ok', run_history: [1, 2, 3].map(day => ({ run_at_ms: tomorrow.getTime() - (day + 1) * 86400000, status: 'ok', duration_ms: 16000 })) },
  origin: { channel: 'weixin', chat_id: 'demo-person', session_key: 'weixin:demo-person', title: '我的私聊' },
  created_at_ms: now - 7 * 86400000,
};
const initialJobs: SessionAutomationJob[] = [weather,
  { ...weather, id: 'demo-daily', name: '产品进展日报', schedule: { kind: 'cron', expr: '0 18 * * 1-5', tz: 'Asia/Shanghai' }, payload: { message: '整理今日产品进展、待解决问题和明日安排，发一条简短日报。' }, origin: { channel: 'feishu', chat_id: 'demo-product', session_key: 'feishu:demo-product', title: '产品讨论群' }, state: { next_run_at_ms: tomorrow.getTime() + 36000000, last_status: 'ok' } },
  { ...weather, id: 'demo-weekly', name: '每周阅读回顾', enabled: false, schedule: { kind: 'cron', expr: '0 20 * * 0', tz: 'Asia/Shanghai' }, payload: { message: '回顾本周阅读笔记，挑选三条值得保留的观点。' }, origin: { channel: 'websocket', chat_id: 'demo-reading', session_key: 'websocket:demo-reading', title: '天气助手' }, state: {} },
];
const sessions: ChatSummary[] = [
  ['websocket:demo-weather', '天气助手', '整理天气推送'],
  ['websocket:demo-product', '产品计划', '本周开发进展'],
  ['websocket:demo-reading', '阅读笔记', '整理近期阅读'],
].map(([key, title, preview]) => ({ key, title, preview, channel: 'websocket', chatId: key.split(':')[1], createdAt: new Date(now - 86400000).toISOString(), updatedAt: new Date(now).toISOString() }));

function Preview() {
  const [mode, setMode] = useState(params.get('mode') || 'proposal');
  const [scenario, setScenario] = useState(params.get('scenario') || 'ready');
  const [dark, setDark] = useState(params.has('theme') ? params.get('theme') === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
  const [jobs, setJobs] = useState(initialJobs);
  const [filter, setFilter] = useState<'all' | 'active' | 'paused' | 'failed' | 'system'>('all');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const [editJob, setEditJob] = useState<SessionAutomationJob | null>(null);
  const [deleteJob, setDeleteJob] = useState<SessionAutomationJob | null>(null);
  const [returnJob, setReturnJob] = useState<SessionAutomationJob | null>(params.has('detail') ? weather : null);
  const [notice, setNotice] = useState('');
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);
  const demoOnly = () => { setMobileOpen(false); setNotice('此预览仅开放自动任务及关联会话流程，其他页面未接入。'); };
  const payload = { jobs: jobs.map(job => ({ ...job, state: { ...job.state, pending: scenario === 'pending' } })) };
  const save = async (job: SessionAutomationJob, target: Target, message: string) => {
    // Latency exists only in the slow-ack demo, never as a decorative minimum.
    if (scenario === 'slow') await new Promise(resolve => setTimeout(resolve, 2200));
    if (scenario === 'conflict') throw new Error('Simulated revision conflict');
    setJobs(current => current.map(item => item.id !== job.id ? item : { ...item,
      payload: { ...item.payload, message },
      origin: { channel: targets[target].channel, chat_id: `demo-${target}`, session_key: `${targets[target].channel}:demo-${target}`, title: targets[target].name },
    }));
  };
  const sidebar = (mobile = false) => <Sidebar sessions={sessions} activeKey={null} loading={false} newChatActive={false} activeUtility="automations"
    collapsed={!mobile && !sidebarOpen} containActionMenus={mobile} onCollapse={() => mobile ? setMobileOpen(false) : setSidebarOpen(false)} onExpand={() => setSidebarOpen(true)}
    onNewChat={demoOnly} onSelect={demoOnly} onRequestDelete={demoOnly} onTogglePin={demoOnly} onRequestRename={demoOnly} onToggleArchive={demoOnly} onToggleGroup={demoOnly} onRequestRenameProject={demoOnly} onNewChatInProject={demoOnly}
    onOpenSettings={demoOnly} onOpenApps={demoOnly} onOpenSkills={demoOnly} onOpenChannels={demoOnly} onOpenSearch={demoOnly} onToggleArchived={demoOnly}
    onOpenAutomations={() => { setMobileOpen(false); setNotice(''); }}/>
  return <ClientProvider client={client} token=""><PreviewContext.Provider value={{ mode, scenario, save }}>
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border/45 bg-sidebar px-4">
        <div className="flex min-w-0 items-center gap-3 text-[12px]"><span className="shrink-0 font-medium">自动任务 · 交互预览</span><span className="hidden truncate text-muted-foreground sm:inline">合成数据 · 不运行任务，不投递消息</span></div>
        <div className="flex shrink-0 gap-1">
          <Popover><PopoverTrigger asChild><Button variant="ghost" size="sm" className="h-8 gap-1.5 text-[12px] font-normal"><SlidersHorizontal className="h-3.5 w-3.5" aria-hidden/><span>预览选项</span></Button></PopoverTrigger>
            <PopoverContent align="end" className="w-64 space-y-4 text-[13px]">
              <label className="block space-y-2"><span className="text-muted-foreground">界面</span><Select value={mode} onValueChange={setMode}><SelectTrigger aria-label="界面版本"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="proposal">拟议改动</SelectItem><SelectItem value="current">当前代码</SelectItem></SelectContent></Select></label>
              <label className="block space-y-2"><span className="text-muted-foreground">模拟状态</span><Select value={scenario} onValueChange={setScenario}><SelectTrigger aria-label="模拟状态"><SelectValue/></SelectTrigger><SelectContent>{[['ready','正常'],['slow','保存较慢'],['conflict','版本冲突'],['pending','任务已排队'],['oldhost','旧主机']].map(([value,label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></label>
              <p className="text-[12px] leading-5 text-muted-foreground">仅模拟 UI。真实保存还需 gateway 接口与能力校验。</p>
            </PopoverContent>
          </Popover>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={dark ? '切换浅色' : '切换深色'} onClick={() => setDark(!dark)}>{dark ? <Sun className="h-4 w-4"/> : <Moon className="h-4 w-4"/>}</Button>
        </div>
      </header>
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <aside className="relative z-20 hidden h-full shrink-0 overflow-hidden lg:block" style={{ width: sidebarOpen ? 256 : 56 }}>{sidebar()}</aside>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}><SheetContent side="left" showCloseButton={false} aria-describedby={undefined} className="w-[280px] max-w-[85vw] p-0 lg:hidden"><SheetTitle className="sr-only">侧边栏</SheetTitle>{sidebar(true)}</SheetContent></Sheet>
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-settings-canvas">
          <div className="flex h-12 shrink-0 items-center gap-2 px-3 lg:hidden"><Button variant="ghost" size="icon" aria-label="打开侧边栏" onClick={() => setMobileOpen(true)}><Menu className="h-4 w-4"/></Button><span className="text-[13px]">nanobot</span></div>
          <DialogLayoutContext.Provider value={anchor}>
            <div className="min-w-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
              <div ref={setAnchor} data-settings-section="automations" data-main-navigation-expanded={sidebarOpen} className="settings-grid settings-feature-page settings-automations-grid mx-auto w-full py-6 sm:py-8 lg:py-12">
                <AutomationsSettings payload={payload} loading={false} filter={filter} actionKey={null} error={null} onFilterChange={setFilter}
                  onStartChat={() => { setNotice('仅演示：创建请求未发送。输入草稿仍保留。'); return false; }} onManageModels={demoOnly}
                  onAction={(action, job) => { if (action === 'enable' || action === 'disable') setJobs(current => current.map(item => item.id === job.id ? { ...item, enabled: action === 'enable' } : item)); else setNotice('仅演示：没有运行任务或投递消息。'); }}
                  onRequestEdit={setEditJob} onRequestDelete={setDeleteJob} returnToDetailJob={returnJob} onReturnToDetailHandled={() => setReturnJob(null)}/>
                {notice ? <p role="status" className="mt-4 text-[12px] leading-5 text-muted-foreground">{notice}</p> : null}
              </div>
            </div>
            <AutomationEditDialog job={editJob} saving={false} onOpenChange={open => { if (!open) { setReturnJob(editJob); setEditJob(null); } }} onCancel={() => { setReturnJob(editJob); setEditJob(null); }} onSave={(job, values) => {
              setJobs(current => current.map(item => item.id !== job.id ? item : { ...item, name: values.name ?? item.name, payload: { ...item.payload, message: values.message ?? item.payload.message }, schedule: { ...item.schedule, ...values.schedule } }));
              setReturnJob(job); setEditJob(null);
            }}/>
            <AutomationDeleteDialog job={deleteJob} deleting={false} onOpenChange={open => { if (!open) { setReturnJob(deleteJob); setDeleteJob(null); } }} onConfirm={() => { setNotice('仅演示：任务没有删除。'); setReturnJob(deleteJob); setDeleteJob(null); }}/>
          </DialogLayoutContext.Provider>
        </main>
      </div>
    </div>
  </PreviewContext.Provider></ClientProvider>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
