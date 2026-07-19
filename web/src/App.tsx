import { Children, cloneElement, isValidElement, useCallback, useEffect, useId, useState } from 'react'
import type { ReactElement } from 'react'
import {
  Activity, AlertTriangle, ArrowLeft, ArrowRight, Bell, Check, ChevronRight, CircleDollarSign,
  Clock3, Cloud, Copy, Database, Eye, EyeOff, FileClock, Gauge, History as HistoryIcon,
  KeyRound, LoaderCircle, LockKeyhole, LogOut, Mail, Menu, Play, Plus, Power, RefreshCw,
  Save, Server, Settings, ShieldCheck, Square, Trash2, Webhook, X, Zap,
} from 'lucide-react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { APIError, api, waitForJob } from './api'
import {
  APIKeyRecord, Account, AccountSummary, Config, History, Job, LogEntry, StatusResponse,
  defaultConfig, emptyAccount,
} from './types'

type Phase = 'loading' | 'setup' | 'login' | 'dashboard' | 'fatal'
type Toast = { id: number; tone: 'success' | 'error' | 'info'; message: string }

const regions = [
  ['cn-hongkong', '中国香港'], ['cn-hangzhou', '华东 1（杭州）'], ['cn-shanghai', '华东 2（上海）'],
  ['cn-qingdao', '华北 1（青岛）'], ['cn-beijing', '华北 2（北京）'], ['cn-zhangjiakou', '华北 3（张家口）'],
  ['cn-huhehaote', '华北 5（呼和浩特）'], ['cn-wulanchabu', '华北 6（乌兰察布）'], ['cn-shenzhen', '华南 1（深圳）'],
  ['cn-heyuan', '华南 2（河源）'], ['cn-guangzhou', '华南 3（广州）'], ['cn-chengdu', '西南 1（成都）'],
  ['ap-southeast-1', '新加坡'], ['ap-northeast-1', '日本（东京）'], ['us-west-1', '美国（硅谷）'], ['us-east-1', '美国（弗吉尼亚）'],
]

export default function App() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [status, setStatus] = useState<StatusResponse>({ accounts: [], system_last_run: '' })
  const [config, setConfig] = useState<Config | null>(null)
  const [fatal, setFatal] = useState('')
  const [toasts, setToasts] = useState<Toast[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [historyAccount, setHistoryAccount] = useState<AccountSummary | null>(null)

  const notify = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((current) => [...current, { id, message, tone }])
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 4000)
  }, [])

  const loadDashboard = useCallback(async () => {
    const [nextStatus, nextConfig] = await Promise.all([
      api<StatusResponse>('/api/v1/status'),
      api<Config>('/api/v1/config'),
    ])
    setStatus(nextStatus)
    setConfig(nextConfig)
    setPhase('dashboard')
  }, [])

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api<StatusResponse>('/api/v1/status'))
    } catch (error) {
      if (error instanceof APIError && error.status === 401) setPhase('login')
    }
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const init = await api<{ initialized: boolean }>('/api/v1/system/init-status')
        if (!init.initialized) {
          setPhase('setup')
          return
        }
        try {
          await loadDashboard()
        } catch (error) {
          if (error instanceof APIError && error.status === 401) setPhase('login')
          else throw error
        }
      } catch (error) {
        setFatal(error instanceof Error ? error.message : '服务初始化失败')
        setPhase('fatal')
      }
    })()
  }, [loadDashboard])

  useEffect(() => {
    if (phase !== 'dashboard') return
    const timer = window.setInterval(() => void refreshStatus(), 30_000)
    return () => window.clearInterval(timer)
  }, [phase, refreshStatus])

  if (phase === 'loading') return <LoadingScreen />
  if (phase === 'fatal') return <FatalScreen message={fatal} />
  if (phase === 'setup') return <SetupWizard onComplete={loadDashboard} notify={notify} />
  if (phase === 'login') return <Login onComplete={loadDashboard} />

  return (
    <>
      <Dashboard
        status={status}
        config={config!}
        onRefresh={refreshStatus}
        onSettings={() => setSettingsOpen(true)}
        onHistory={setHistoryAccount}
        notify={notify}
        onLogout={() => setPhase('login')}
      />
      {settingsOpen && config && (
        <SettingsPanel
          initial={config}
          onClose={() => setSettingsOpen(false)}
          onSaved={(next) => { setConfig(next); setSettingsOpen(false); void refreshStatus() }}
          notify={notify}
        />
      )}
      {historyAccount && <HistoryModal account={historyAccount} onClose={() => setHistoryAccount(null)} />}
      <ToastStack items={toasts} />
    </>
  )
}

function LoadingScreen() {
  return (
    <main className="center-stage">
      <div className="brand-lockup brand-lockup--center"><BrandMark /><div><b>CDT MONITOR</b><span>CONTROL PLANE</span></div></div>
      <LoaderCircle className="spin loading-glyph" aria-label="加载中" />
    </main>
  )
}

function FatalScreen({ message }: { message: string }) {
  return (
    <main className="center-stage">
      <section className="glass-card auth-card" role="alert">
        <div className="large-icon large-icon--danger"><AlertTriangle /></div>
        <p className="eyebrow">SERVICE ERROR</p>
        <h1>控制台暂时不可用</h1>
        <p className="muted">{message}</p>
        <button className="button button--primary" onClick={() => location.reload()}><RefreshCw size={18} />重新连接</button>
      </section>
    </main>
  )
}

function SetupWizard({ onComplete, notify }: { onComplete: () => Promise<void>; notify: (message: string, tone?: Toast['tone']) => void }) {
  const [step, setStep] = useState(0)
  const [config, setConfig] = useState<Config>(() => ({ ...defaultConfig(), accounts: [emptyAccount()] }))
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const strength = Math.min(4, [password.length >= 10, /[A-Z]/.test(password), /[0-9]/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length)

  const next = () => {
    setError('')
    if (step === 0 && (password.length < 10 || password !== confirm)) {
      setError(password.length < 10 ? '管理员密码至少需要 10 个字符' : '两次输入的密码不一致')
      return
    }
    setStep((value) => Math.min(2, value + 1))
  }
  const finish = async () => {
    setBusy(true); setError('')
    try {
      const cleaned = structuredClone(config)
      cleaned.admin_password = password
      cleaned.accounts = cleaned.accounts.filter((account) => account.access_key_id.trim())
      await api('/api/v1/setup', { method: 'POST', body: JSON.stringify(cleaned) })
      notify('系统初始化完成', 'success')
      await onComplete()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '初始化失败')
    } finally { setBusy(false) }
  }

  return (
    <main className="setup-shell">
      <header className="setup-header"><div className="brand-lockup"><BrandMark /><div><b>CDT MONITOR</b><span>SECURE SETUP</span></div></div><StepDots current={step} /></header>
      <section className="glass-card setup-card">
        <div className="setup-copy">
          <p className="eyebrow">STEP {step + 1} OF 3</p>
          <h1>{['创建安全边界', '设定自动化策略', '连接云端实例'][step]}</h1>
          <p className="muted">{['凭据将使用本机主密钥加密保存。', '默认策略可在控制台中随时调整。', 'AccessKey 仅在服务端解密使用。'][step]}</p>
        </div>

        {step === 0 && (
          <div className="form-stack">
            <PasswordField label="管理员密码" value={password} visible={visible} onVisible={() => setVisible(!visible)} onChange={setPassword} autoComplete="new-password" />
            <div className="strength" aria-label={`密码强度 ${strength}/4`}>{[0, 1, 2, 3].map((index) => <i key={index} className={index < strength ? 'active' : ''} />)}</div>
            <PasswordField label="确认密码" value={confirm} visible={visible} onVisible={() => setVisible(!visible)} onChange={setConfirm} autoComplete="new-password" />
            <div className="security-note"><ShieldCheck size={20} /><span>Argon2id 哈希 · AES-GCM 凭据加密 · SameSite Session</span></div>
          </div>
        )}
        {step === 1 && (
          <div className="form-grid">
            <Field label="流量告警阈值"><input type="number" min={1} max={100} value={config.traffic_threshold} onChange={(event) => setConfig({ ...config, traffic_threshold: Number(event.target.value) })} /><span className="suffix">%</span></Field>
            <Field label="状态刷新频率"><select value={config.api_interval} onChange={(event) => setConfig({ ...config, api_interval: Number(event.target.value) })}><option value={60}>1 分钟</option><option value={300}>5 分钟</option><option value={600}>10 分钟</option><option value={1800}>30 分钟</option></select></Field>
            <div className="field field--wide"><label>停机模式</label><Segmented value={config.shutdown_mode} options={[['KeepCharging', '普通停机'], ['StopCharging', '节省停机']]} onChange={(value) => setConfig({ ...config, shutdown_mode: value as Config['shutdown_mode'] })} /></div>
            <ToggleRow title="抢占式实例保活" icon={<Activity />} checked={config.keep_alive} onChange={(checked) => setConfig({ ...config, keep_alive: checked })} />
            <ToggleRow title="账单与余额显示" icon={<CircleDollarSign />} checked={config.enable_billing} onChange={(checked) => setConfig({ ...config, enable_billing: checked })} />
          </div>
        )}
        {step === 2 && (
          <AccountFields account={config.accounts[0]} onChange={(account) => setConfig({ ...config, accounts: [account] })} compact />
        )}

        {error && <div className="inline-error"><AlertTriangle size={16} />{error}</div>}
        <footer className="setup-actions">
          <button className="button button--secondary" onClick={() => setStep((value) => Math.max(0, value - 1))} disabled={step === 0 || busy}><ArrowLeft size={18} />返回</button>
          {step < 2 ? <button className="button button--primary" onClick={next}>继续<ArrowRight size={18} /></button> : <button className="button button--primary" onClick={() => void finish()} disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <Check size={18} />}完成安装</button>}
        </footer>
      </section>
    </main>
  )
}

function Login({ onComplete }: { onComplete: () => Promise<void> }) {
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('')
    try {
      await api('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ password }) })
      await onComplete()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '登录失败') }
    finally { setBusy(false) }
  }
  return (
    <main className="login-shell">
      <div className="login-card-stack">
        <div className="login-brand"><div className="brand-lockup"><BrandMark /><div><b>CDT MONITOR</b><span>CONTROL PLANE</span></div></div><p>阿里云 CDT 流量与实例自动化控制台</p></div>
        <form className="glass-card auth-card" onSubmit={submit}>
          <div className="large-icon"><LockKeyhole /></div>
          <p className="eyebrow">ADMIN ACCESS</p><h1>欢迎回来</h1><p className="muted">使用管理员凭据进入控制台</p>
          <PasswordField label="管理员密码" value={password} visible={visible} onVisible={() => setVisible(!visible)} onChange={setPassword} autoComplete="current-password" />
          {error && <div className="inline-error"><AlertTriangle size={16} />{error}</div>}
          <button className="button button--primary button--full" disabled={busy || !password}>{busy ? <LoaderCircle className="spin" size={18} /> : <ArrowRight size={18} />}安全登录</button>
        </form>
      </div>
    </main>
  )
}

function Dashboard({ status, config, onRefresh, onSettings, onHistory, notify, onLogout }: {
  status: StatusResponse; config: Config; onRefresh: () => Promise<void>; onSettings: () => void; onHistory: (account: AccountSummary) => void; notify: (message: string, tone?: Toast['tone']) => void; onLogout: () => void
}) {
  const [busy, setBusy] = useState<Record<number, string>>({})
  const [mobileMenu, setMobileMenu] = useState(false)
  const running = status.accounts.filter((account) => account.instance_status === 'Running').length
  const warning = status.accounts.filter((account) => account.over_threshold).length
  const used = status.accounts.reduce((sum, account) => sum + account.flow_used, 0)
  const heartbeatAge = status.system_last_run ? Math.floor((Date.now() - new Date(status.system_last_run).getTime()) / 1000) : Infinity

  const runAction = async (account: AccountSummary, action: 'start' | 'stop' | 'refresh') => {
    if (action === 'stop' && config.keep_alive) { notify('保活启用时不能手动关机', 'error'); return }
    setBusy((value) => ({ ...value, [account.id]: action }))
    try {
      const path = action === 'refresh' ? `/api/v1/accounts/${account.id}/refresh` : `/api/v1/accounts/${account.id}/actions/${action}`
      const job = await api<Job>(path, { method: 'POST', body: '{}' })
      await waitForJob(job.id)
      await onRefresh()
      notify(action === 'refresh' ? '实例状态已刷新' : `已发送${action === 'start' ? '开机' : '关机'}指令`, 'success')
    } catch (error) { notify(error instanceof Error ? error.message : '操作失败', 'error') }
    finally { setBusy((value) => { const next = { ...value }; delete next[account.id]; return next }) }
  }
  const logout = async () => {
    await api('/api/v1/auth/logout', { method: 'POST', body: '{}' }).catch(() => undefined)
    onLogout()
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup"><BrandMark /><div><b>CDT MONITOR</b><span>CONTROL PLANE</span></div></div>
        <div className={`topbar-actions ${mobileMenu ? 'open' : ''}`}>
          <div className={`heartbeat ${heartbeatAge > 180 ? 'heartbeat--warn' : ''}`}><i />{heartbeatAge > 180 ? '监控任务延迟' : '自动化运行中'}</div>
          <IconButton label="刷新" onClick={() => void onRefresh()}><RefreshCw size={18} /></IconButton>
          <IconButton label="设置" onClick={onSettings}><Settings size={18} /></IconButton>
          <IconButton label="退出" onClick={() => void logout()}><LogOut size={18} /></IconButton>
        </div>
        <IconButton label="菜单" className="mobile-menu" onClick={() => setMobileMenu(!mobileMenu)}>{mobileMenu ? <X /> : <Menu />}</IconButton>
      </header>

      <section className="overview-head"><div><p className="eyebrow">LIVE INFRASTRUCTURE</p><h1>资源控制台</h1><p className="muted">{new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</p></div><div className="overview-time"><Clock3 size={17} /><span>上次任务</span><b>{status.system_last_run ? formatTime(status.system_last_run) : '尚未运行'}</b></div></section>
      <section className="metric-strip">
        <Metric icon={<Server />} label="实例总数" value={`${status.accounts.length}`} suffix="台" />
        <Metric icon={<Activity />} label="运行中" value={`${running}`} suffix="台" tone="green" />
        <Metric icon={<Gauge />} label="累计流量" value={used.toFixed(1)} suffix="GB" />
        <Metric icon={<AlertTriangle />} label="阈值告警" value={`${warning}`} suffix="项" tone={warning ? 'red' : 'neutral'} />
      </section>

      <div className="section-heading"><div><p className="eyebrow">MANAGED INSTANCES</p><h2>实例与流量</h2></div><span>{status.accounts.length} 个配置</span></div>
      {status.accounts.length === 0 ? (
        <button className="empty-state" onClick={onSettings}><Cloud /><h3>添加第一个云端实例</h3><p>进入设置完成 AccessKey 与实例信息配置</p><span>打开设置<ChevronRight size={16} /></span></button>
      ) : (
        <section className="account-grid">
          {status.accounts.map((account) => <AccountCard key={account.id} account={account} busy={busy[account.id]} keepAlive={config.keep_alive} billingEnabled={config.enable_billing} onAction={(action) => void runAction(account, action)} onHistory={() => onHistory(account)} />)}
        </section>
      )}
    </main>
  )
}

function AccountCard({ account, busy, keepAlive, billingEnabled, onAction, onHistory }: { account: AccountSummary; busy?: string; keepAlive: boolean; billingEnabled: boolean; onAction: (action: 'start' | 'stop' | 'refresh') => void; onHistory: () => void }) {
  const statusTone = statusClass(account.instance_status)
  const currency = account.currency === 'USD' ? '$' : '¥'
  const hasBilling = account.monthly_cost !== undefined || account.balance !== undefined
  return (
    <article className={`glass-card account-card ${account.over_threshold ? 'account-card--alert' : ''}`}>
      <header className="account-card__header">
        <div className={`status-icon ${statusTone}`}><Server size={20} /></div>
        <div className="account-title"><h3>{account.remark || account.account}</h3><span>{account.region_name}</span></div>
        <div className="account-card__side">
          <div className={`status-pill ${statusTone}`}><i />{statusLabel(account.instance_status)}</div>
          {billingEnabled && <div className="account-billing" aria-label="账单与余额"><div><span>本月费用</span><b>{account.monthly_cost === undefined ? '待同步' : `${currency}${account.monthly_cost.toFixed(2)}`}</b></div><div><span>账户余额</span><b>{account.balance === undefined ? '待同步' : `${currency}${account.balance.toFixed(2)}`}</b></div><small className={account.billing_error ? 'billing-error' : ''}>{account.billing_error || (hasBilling ? '已同步' : '待同步')}</small></div>}
        </div>
      </header>
      <div className="traffic-value"><div><span>本月 CDT 流量</span><strong>{account.flow_used.toFixed(2)}</strong><small> / {account.flow_total.toFixed(0)} GB</small></div><button className="mini-icon" onClick={onHistory} aria-label="查看历史流量"><HistoryIcon size={17} /></button></div>
      <div className="progress-track"><i style={{ width: `${Math.min(100, account.percentage)}%` }} className={account.over_threshold ? 'danger' : account.percentage >= account.threshold * .8 ? 'warning' : ''} /></div>
      <div className="progress-meta"><span>{account.percentage.toFixed(2)}% 已使用</span><span>阈值 {account.threshold}%</span></div>
      <footer className="account-card__footer">
        <span className={account.stale ? 'stale' : ''}><Clock3 size={14} />{account.last_updated ? formatTime(account.last_updated) : '等待首次同步'}</span>
        <div className="control-group">
          <IconButton label="刷新实例" disabled={!!busy} onClick={() => onAction('refresh')}>{busy === 'refresh' ? <LoaderCircle className="spin" /> : <RefreshCw />}</IconButton>
          {account.instance_status === 'Stopped' && <IconButton label="开机" disabled={!!busy} tone="positive" onClick={() => onAction('start')}>{busy === 'start' ? <LoaderCircle className="spin" /> : <Play />}</IconButton>}
          {account.instance_status === 'Running' && <IconButton label={keepAlive ? '保活启用，不能关机' : '关机'} disabled={!!busy || keepAlive} tone="danger" onClick={() => onAction('stop')}>{busy === 'stop' ? <LoaderCircle className="spin" /> : <Power />}</IconButton>}
        </div>
      </footer>
    </article>
  )
}

function SettingsPanel({ initial, onClose, onSaved, notify }: { initial: Config; onClose: () => void; onSaved: (config: Config) => void; notify: (message: string, tone?: Toast['tone']) => void }) {
  const [tab, setTab] = useState<'general' | 'accounts' | 'notify' | 'keys' | 'logs'>('general')
  const [config, setConfig] = useState<Config>(() => structuredClone(initial))
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      await api('/api/v1/config', { method: 'PUT', body: JSON.stringify(config) })
      if (config.enable_billing && !initial.enable_billing) {
        const refreshes = config.accounts.filter((account) => account.id > 0).map((account) => api(`/api/v1/accounts/${account.id}/refresh`, { method: 'POST', body: '{}' }))
        const results = await Promise.allSettled(refreshes)
        if (results.some((result) => result.status === 'fulfilled')) notify('配置已保存，账单同步已开始', 'success')
        else notify('配置已保存，账单将在下次同步时更新', 'info')
      } else {
        notify('配置已安全保存', 'success')
      }
      onSaved(config)
    } catch (error) { notify(error instanceof Error ? error.message : '保存失败', 'error') }
    finally { setBusy(false) }
  }
  const tabs = [
    ['general', <Settings />, '系统'], ['accounts', <Server />, '实例'], ['notify', <Bell />, '通知'], ['keys', <KeyRound />, 'API Key'], ['logs', <FileClock />, '日志'],
  ] as const
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label="系统设置">
      <div className="modal-scrim" onClick={onClose} />
      <section className="settings-panel">
        <header><div><p className="eyebrow">SYSTEM PREFERENCES</p><h2>控制台设置</h2></div><IconButton label="关闭" onClick={onClose}><X /></IconButton></header>
        <nav className="settings-tabs">{tabs.map(([value, icon, label]) => <button key={value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{icon}{label}</button>)}</nav>
        <div className="settings-content">
          {tab === 'general' && <GeneralSettings config={config} onChange={setConfig} />}
          {tab === 'accounts' && <AccountSettings config={config} onChange={setConfig} />}
          {tab === 'notify' && <NotificationSettings config={config} onChange={setConfig} notify={notify} />}
          {tab === 'keys' && <APIKeySettings notify={notify} />}
          {tab === 'logs' && <LogSettings notify={notify} />}
        </div>
        {(tab === 'general' || tab === 'accounts' || tab === 'notify') && <footer className="settings-footer"><button className="button button--primary" onClick={() => void save()} disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <Save />}保存更改</button></footer>}
      </section>
    </div>
  )
}

function GeneralSettings({ config, onChange }: { config: Config; onChange: (config: Config) => void }) {
  return <div className="settings-section"><SectionTitle icon={<Gauge />} title="监控策略" subtitle="AUTOMATION POLICY" />
    <div className="form-grid settings-form">
      <Field label="告警阈值"><input type="number" min={1} max={100} value={config.traffic_threshold} onChange={(event) => onChange({ ...config, traffic_threshold: Number(event.target.value) })} /><span className="suffix">%</span></Field>
      <Field label="API 刷新间隔"><select value={config.api_interval} onChange={(event) => onChange({ ...config, api_interval: Number(event.target.value) })}><option value={60}>1 分钟</option><option value={300}>5 分钟</option><option value={600}>10 分钟</option><option value={1800}>30 分钟</option><option value={3600}>1 小时</option></select></Field>
      <Field label="系统时区"><input value={config.timezone} onChange={(event) => onChange({ ...config, timezone: event.target.value })} /></Field>
      <div className="field"><label>阈值动作</label><Segmented value={config.threshold_action} options={[['stop_and_notify', '停机并通知'], ['notify_only', '仅通知']]} onChange={(value) => onChange({ ...config, threshold_action: value as Config['threshold_action'] })} /></div>
      <div className="field field--wide"><label>停机模式</label><Segmented value={config.shutdown_mode} options={[['KeepCharging', '普通停机'], ['StopCharging', '节省停机']]} onChange={(value) => onChange({ ...config, shutdown_mode: value as Config['shutdown_mode'] })} /></div>
    </div>
    <div className="toggle-list">
      <ToggleRow title="抢占式实例保活" icon={<Activity />} checked={config.keep_alive} onChange={(checked) => onChange({ ...config, keep_alive: checked })} />
      <ToggleRow title="定时任务通知" icon={<Bell />} checked={config.enable_schedule_notification} onChange={(checked) => onChange({ ...config, enable_schedule_notification: checked })} />
      <ToggleRow title="账单与余额" icon={<CircleDollarSign />} checked={config.enable_billing} onChange={(checked) => onChange({ ...config, enable_billing: checked })} />
    </div>
  </div>
}

function AccountSettings({ config, onChange }: { config: Config; onChange: (config: Config) => void }) {
  const update = (index: number, account: Account) => { const accounts = [...config.accounts]; accounts[index] = account; onChange({ ...config, accounts }) }
  const remove = (index: number) => onChange({ ...config, accounts: config.accounts.filter((_, current) => current !== index) })
  return <div className="settings-section"><div className="section-title-row"><SectionTitle icon={<Server />} title="云端实例" subtitle="ALIYUN ACCOUNTS" /><button className="button button--secondary button--small" onClick={() => onChange({ ...config, accounts: [...config.accounts, emptyAccount()] })}><Plus />添加实例</button></div>
    <div className="account-settings-list">{config.accounts.length === 0 && <div className="subtle-empty"><Database />尚未配置实例</div>}{config.accounts.map((account, index) => <div className="account-editor" key={account.id || `new-${index}`}><div className="account-editor__head"><span>{account.remark || `实例 ${index + 1}`}</span><IconButton label="删除" tone="danger" onClick={() => remove(index)}><Trash2 /></IconButton></div><AccountFields account={account} onChange={(next) => update(index, next)} /></div>)}</div>
  </div>
}

function AccountFields({ account, onChange, compact = false }: { account: Account; onChange: (account: Account) => void; compact?: boolean }) {
  return <div className={`form-grid account-fields ${compact ? 'compact' : ''}`}>
    <Field label="AccessKey ID"><input autoComplete="off" value={account.access_key_id} onChange={(event) => onChange({ ...account, access_key_id: event.target.value })} placeholder="LTAI5t…" /></Field>
    <Field label={`AccessKey Secret${account.secret_configured ? ' · 已配置' : ''}`}><input type="password" autoComplete="new-password" value={account.access_key_secret || ''} onChange={(event) => onChange({ ...account, access_key_secret: event.target.value })} placeholder={account.secret_configured ? '留空保持不变' : '输入 Secret'} /></Field>
    <Field label="实例 ID"><input value={account.instance_id} onChange={(event) => onChange({ ...account, instance_id: event.target.value })} placeholder="i-bp…" /></Field>
    <Field label="地域"><select value={account.region_id} onChange={(event) => onChange({ ...account, region_id: event.target.value })}>{regions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field>
    <Field label="流量额度"><input type="number" min={1} value={account.max_traffic} onChange={(event) => onChange({ ...account, max_traffic: Number(event.target.value) })} /><span className="suffix">GB</span></Field>
    <Field label="站点类型"><select value={account.site_type} onChange={(event) => onChange({ ...account, site_type: event.target.value as Account['site_type'] })}><option value="china">中国站 · CNY</option><option value="international">国际站 · USD</option></select></Field>
    <Field label="备注"><input value={account.remark} onChange={(event) => onChange({ ...account, remark: event.target.value })} placeholder="香港主节点" /></Field>
    <ToggleRow title="每日定时开关机" icon={<Clock3 />} checked={account.schedule_enabled} onChange={(checked) => onChange({ ...account, schedule_enabled: checked })} />
    {account.schedule_enabled && <><Field label="开机时间"><input type="time" value={account.start_time} onChange={(event) => onChange({ ...account, start_time: event.target.value })} /></Field><Field label="关机时间"><input type="time" value={account.stop_time} onChange={(event) => onChange({ ...account, stop_time: event.target.value })} /></Field></>}
  </div>
}

function NotificationSettings({ config, onChange, notify }: { config: Config; onChange: (config: Config) => void; notify: (message: string, tone?: Toast['tone']) => void }) {
  const [channel, setChannel] = useState<'email' | 'telegram' | 'webhook'>('email')
  const [testing, setTesting] = useState(false)
  const test = async () => {
    setTesting(true)
    try { const job = await api<Job>(`/api/v1/notifications/test/${channel}`, { method: 'POST', body: '{}' }); await waitForJob(job.id); notify('测试通知已送达', 'success') }
    catch (error) { notify(error instanceof Error ? error.message : '测试失败', 'error') }
    finally { setTesting(false) }
  }
  const n = config.notifications
  return <div className="settings-section"><SectionTitle icon={<Bell />} title="通知通道" subtitle="DELIVERY CHANNELS" />
    <div className="channel-tabs"><button className={channel === 'email' ? 'active' : ''} onClick={() => setChannel('email')}><Mail />Email</button><button className={channel === 'telegram' ? 'active' : ''} onClick={() => setChannel('telegram')}><Zap />Telegram</button><button className={channel === 'webhook' ? 'active' : ''} onClick={() => setChannel('webhook')}><Webhook />Webhook</button></div>
    {channel === 'email' && <div className="form-grid settings-form"><ToggleRow title="启用 Email" icon={<Mail />} checked={n.email.enabled} onChange={(enabled) => onChange({ ...config, notifications: { ...n, email: { ...n.email, enabled } } })} /><Field label="接收邮箱"><input type="email" value={n.email.to} onChange={(event) => onChange({ ...config, notifications: { ...n, email: { ...n.email, to: event.target.value } } })} /></Field><Field label="SMTP Host"><input value={n.email.host} onChange={(event) => onChange({ ...config, notifications: { ...n, email: { ...n.email, host: event.target.value } } })} /></Field><Field label="端口"><input type="number" value={n.email.port} onChange={(event) => onChange({ ...config, notifications: { ...n, email: { ...n.email, port: Number(event.target.value) } } })} /></Field><Field label="安全模式"><select value={n.email.security} onChange={(event) => onChange({ ...config, notifications: { ...n, email: { ...n.email, security: event.target.value } } })}><option value="ssl">SSL</option><option value="tls">STARTTLS</option><option value="none">无</option></select></Field><Field label="用户名"><input value={n.email.username} onChange={(event) => onChange({ ...config, notifications: { ...n, email: { ...n.email, username: event.target.value } } })} /></Field><Field label={`密码${n.email.password_configured ? ' · 已配置' : ''}`}><input type="password" value={n.email.password || ''} placeholder={n.email.password_configured ? '留空保持不变' : ''} onChange={(event) => onChange({ ...config, notifications: { ...n, email: { ...n.email, password: event.target.value } } })} /></Field></div>}
    {channel === 'telegram' && <div className="form-grid settings-form"><ToggleRow title="启用 Telegram" icon={<Zap />} checked={n.telegram.enabled} onChange={(enabled) => onChange({ ...config, notifications: { ...n, telegram: { ...n.telegram, enabled } } })} /><Field label={`Bot Token${n.telegram.token_configured ? ' · 已配置' : ''}`}><input type="password" value={n.telegram.token || ''} placeholder={n.telegram.token_configured ? '留空保持不变' : ''} onChange={(event) => onChange({ ...config, notifications: { ...n, telegram: { ...n.telegram, token: event.target.value } } })} /></Field><Field label="Chat ID"><input value={n.telegram.chat_id} onChange={(event) => onChange({ ...config, notifications: { ...n, telegram: { ...n.telegram, chat_id: event.target.value } } })} /></Field><Field label="代理类型"><select value={n.telegram.proxy_type} onChange={(event) => onChange({ ...config, notifications: { ...n, telegram: { ...n.telegram, proxy_type: event.target.value } } })}><option value="none">直连</option><option value="custom">自定义反代</option><option value="socks5">SOCKS5</option></select></Field>{n.telegram.proxy_type === 'custom' && <Field label="反代 URL"><input value={n.telegram.proxy_url} onChange={(event) => onChange({ ...config, notifications: { ...n, telegram: { ...n.telegram, proxy_url: event.target.value } } })} /></Field>}{n.telegram.proxy_type === 'socks5' && <><Field label="代理 IP"><input value={n.telegram.proxy_ip} onChange={(event) => onChange({ ...config, notifications: { ...n, telegram: { ...n.telegram, proxy_ip: event.target.value } } })} /></Field><Field label="代理端口"><input value={n.telegram.proxy_port} onChange={(event) => onChange({ ...config, notifications: { ...n, telegram: { ...n.telegram, proxy_port: event.target.value } } })} /></Field><Field label="代理账号"><input value={n.telegram.proxy_user} onChange={(event) => onChange({ ...config, notifications: { ...n, telegram: { ...n.telegram, proxy_user: event.target.value } } })} /></Field><Field label={`代理密码${n.telegram.proxy_password_configured ? ' · 已配置' : ''}`}><input type="password" value={n.telegram.proxy_pass || ''} onChange={(event) => onChange({ ...config, notifications: { ...n, telegram: { ...n.telegram, proxy_pass: event.target.value } } })} /></Field></>}</div>}
    {channel === 'webhook' && <div className="form-grid settings-form"><ToggleRow title="启用 Webhook" icon={<Webhook />} checked={n.webhook.enabled} onChange={(enabled) => onChange({ ...config, notifications: { ...n, webhook: { ...n.webhook, enabled } } })} /><Field label="Webhook URL"><input value={n.webhook.url} onChange={(event) => onChange({ ...config, notifications: { ...n, webhook: { ...n.webhook, url: event.target.value } } })} /></Field><Field label="请求方式"><select value={n.webhook.method} onChange={(event) => onChange({ ...config, notifications: { ...n, webhook: { ...n.webhook, method: event.target.value } } })}><option>GET</option><option>POST</option></select></Field><Field label="请求类型"><select value={n.webhook.request_type} onChange={(event) => onChange({ ...config, notifications: { ...n, webhook: { ...n.webhook, request_type: event.target.value } } })}><option>JSON</option><option>FORM</option></select></Field><Field label="自定义 Headers"><textarea value={n.webhook.headers || ''} onChange={(event) => onChange({ ...config, notifications: { ...n, webhook: { ...n.webhook, headers: event.target.value } } })} placeholder='{"Authorization":"Bearer …"}' /></Field><Field label="Body 模板"><textarea value={n.webhook.body} onChange={(event) => onChange({ ...config, notifications: { ...n, webhook: { ...n.webhook, body: event.target.value } } })} placeholder='{"title":"#TITLE#","message":"#MSG#"}' /></Field></div>}
    <button className="button button--secondary" disabled={testing} onClick={() => void test()}>{testing ? <LoaderCircle className="spin" /> : <Bell />}发送测试</button>
  </div>
}

function APIKeySettings({ notify }: { notify: (message: string, tone?: Toast['tone']) => void }) {
  const [keys, setKeys] = useState<APIKeyRecord[]>([])
  const [name, setName] = useState('桌面小组件')
  const [scopes, setScopes] = useState(['widget:read'])
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const value = await api<{ keys?: APIKeyRecord[] }>('/api/v1/api-keys')
      setKeys(Array.isArray(value.keys) ? value.keys : [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'API Key 列表加载失败')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])
  const create = async () => {
    try { const result = await api<{ token: string }>('/api/v1/api-keys', { method: 'POST', body: JSON.stringify({ name, scopes }) }); setToken(result.token); await load() }
    catch (error) { notify(error instanceof Error ? error.message : '创建失败', 'error') }
  }
  const toggle = (scope: string) => setScopes((current) => current.includes(scope) ? current.filter((value) => value !== scope) : [...current, scope])
  const revoke = async (id: number) => { try { await api(`/api/v1/api-keys/${id}`, { method: 'DELETE', body: '{}' }); await load(); notify('API Key 已撤销', 'success') } catch (cause) { notify(cause instanceof Error ? cause.message : '撤销失败', 'error') } }
  return <div className="settings-section"><SectionTitle icon={<KeyRound />} title="API Key" subtitle="MOBILE & WIDGET ACCESS" />
    <div className="key-create"><Field label="名称"><input value={name} onChange={(event) => setName(event.target.value)} /></Field><div className="scope-row">{[['widget:read', '读取状态'], ['instance:control', '控制实例'], ['cron:run', '触发任务']].map(([scope, label]) => <label key={scope} className={scopes.includes(scope) ? 'scope-chip active' : 'scope-chip'}><input type="checkbox" checked={scopes.includes(scope)} onChange={() => toggle(scope)} />{label}</label>)}</div><button className="button button--primary" disabled={!name || scopes.length === 0} onClick={() => void create()}><Plus />创建 Key</button></div>
    {token && <div className="token-reveal"><ShieldCheck /><div><b>仅显示一次</b><code>{token}</code></div><IconButton label="复制" onClick={() => { void navigator.clipboard.writeText(token); notify('已复制到剪贴板', 'success') }}><Copy /></IconButton></div>}
    {error && <div className="inline-error"><AlertTriangle size={16} />{error}<button className="text-button" onClick={() => void load()}>重试</button></div>}
    {loading ? <div className="subtle-empty"><LoaderCircle className="spin" />加载 API Key</div> : <div className="key-list">{keys.map((key) => <div className={`key-row ${key.revoked_at ? 'disabled' : ''}`} key={key.id}><div className="key-icon"><KeyRound /></div><div><b>{key.name}</b><span>{(Array.isArray(key.scopes) ? key.scopes : []).join(' · ') || '未配置权限'}</span></div><time>{key.last_used_at ? `最近使用 ${formatDate(key.last_used_at)}` : `创建于 ${formatDate(key.created_at)}`}</time>{!key.revoked_at && <IconButton label="撤销" tone="danger" onClick={() => void revoke(key.id)}><Trash2 /></IconButton>}</div>)}</div>}
  </div>
}

function LogSettings({ notify }: { notify: (message: string, tone?: Toast['tone']) => void }) {
  const [tab, setTab] = useState<'action' | 'heartbeat'>('action')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const load = useCallback(async () => {
    try {
      const value = await api<{ logs?: LogEntry[] | null }>(`/api/v1/logs?tab=${tab}`)
      setLogs(Array.isArray(value.logs) ? value.logs : [])
    } catch (cause) {
      setLogs([])
      notify(cause instanceof Error ? cause.message : '日志加载失败', 'error')
    }
  }, [notify, tab])
  useEffect(() => { void load() }, [load])
  const clear = async () => { try { await api(`/api/v1/logs?tab=${tab}`, { method: 'DELETE', body: '{}' }); setLogs([]); await load(); notify('日志已清空', 'success') } catch (cause) { notify(cause instanceof Error ? cause.message : '日志清理失败', 'error') } }
  return <div className="settings-section"><div className="section-title-row"><SectionTitle icon={<FileClock />} title="运行日志" subtitle="EVENT STREAM" /><div className="log-actions"><Segmented value={tab} options={[['action', '动作'], ['heartbeat', '心跳']]} onChange={(value) => setTab(value as typeof tab)} /><IconButton label="清空" tone="danger" onClick={() => void clear()}><Trash2 /></IconButton></div></div><div className="log-list">{logs.length === 0 && <div className="subtle-empty"><FileClock />暂无日志</div>}{logs.map((log) => <div className="log-row" key={log.id}><i className={`log-dot log-dot--${log.type}`} /><div><p>{log.message}</p><span>{formatDate(log.created_at)} · {log.type.toUpperCase()}</span></div></div>)}</div></div>
}

function HistoryModal({ account, onClose }: { account: AccountSummary; onClose: () => void }) {
  const [history, setHistory] = useState<History | null>(null)
  const [range, setRange] = useState<'hourly' | 'daily'>('hourly')
  useEffect(() => { void api<History>(`/api/v1/accounts/${account.id}/history`).then(setHistory) }, [account.id])
  const data = (history?.[range] || []).map((point) => ({ name: range === 'hourly' ? new Date(point.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : new Date(point.at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }), traffic: Math.round(point.traffic * 1000) / 1000 }))
  const tooltip = { contentStyle: { borderRadius: 14, border: '1px solid #e5e5ea' }, formatter: (value: number | string) => [typeof value === 'number' ? value.toFixed(3) : value, '流量 (GB)'] as [string | number, string] }
  return <div className="modal-layer" role="dialog" aria-modal="true"><div className="modal-scrim" onClick={onClose} /><section className="chart-modal glass-card"><header><div><p className="eyebrow">TRAFFIC HISTORY</p><h2>{account.remark || account.account}</h2></div><IconButton label="关闭" onClick={onClose}><X /></IconButton></header><Segmented value={range} options={[['hourly', '24 小时'], ['daily', '30 天']]} onChange={(value) => setRange(value as typeof range)} /><div className="chart-area">{!history ? <LoaderCircle className="spin chart-loader" /> : data.length === 0 ? <div className="subtle-empty"><HistoryIcon />等待采样数据</div> : <ResponsiveContainer width="100%" height="100%">{range === 'hourly' ? <AreaChart data={data}><CartesianGrid stroke="#e5e5ea" vertical={false} /><XAxis dataKey="name" tickLine={false} axisLine={false} /><YAxis tickLine={false} axisLine={false} /><Tooltip {...tooltip} /><Area type="monotone" dataKey="traffic" stroke="#1c1c1e" fill="#d1d1d6" strokeWidth={2} /></AreaChart> : <BarChart data={data}><CartesianGrid stroke="#e5e5ea" vertical={false} /><XAxis dataKey="name" tickLine={false} axisLine={false} /><YAxis tickLine={false} axisLine={false} /><Tooltip {...tooltip} /><Bar dataKey="traffic" fill="#1c1c1e" radius={[5, 5, 0, 0]} /></BarChart>}</ResponsiveContainer>}</div></section></div>
}

function BrandMark() { return <span className="brand-mark"><Cloud size={21} /></span> }
function StepDots({ current }: { current: number }) { return <div className="step-dots">{[0, 1, 2].map((step) => <i className={step <= current ? 'active' : ''} key={step} />)}</div> }
function Metric({ icon, label, value, suffix, tone = 'neutral' }: { icon: React.ReactNode; label: string; value: string; suffix: string; tone?: string }) { return <article className={`metric metric--${tone}`}><span className="metric-icon">{icon}</span><div><label>{label}</label><strong>{value}<small>{suffix}</small></strong></div></article> }
function SectionTitle({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) { return <div className="section-title"><span>{icon}</span><div><p>{subtitle}</p><h3>{title}</h3></div></div> }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId()
  const isSelect = Children.toArray(children).some((child) => isValidElement(child) && child.type === 'select')
  const linked = Children.map(children, (child) => {
    if (!isValidElement(child) || !['input', 'select', 'textarea'].includes(String(child.type))) return child
    const element = child as ReactElement<{ id?: string }>
    return cloneElement(element, { id: element.props.id || id })
  })
  return <div className="field"><label htmlFor={id}>{label}</label><div className={`input-shell ${isSelect ? 'input-shell--select' : ''}`}>{linked}</div></div>
}
function PasswordField({ label, value, visible, onVisible, onChange, autoComplete }: { label: string; value: string; visible: boolean; onVisible: () => void; onChange: (value: string) => void; autoComplete: string }) { return <Field label={label}><LockKeyhole size={17} /><input type={visible ? 'text' : 'password'} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={autoComplete} /><button type="button" className="input-action" onClick={onVisible} aria-label={visible ? '隐藏密码' : '显示密码'}>{visible ? <EyeOff /> : <Eye />}</button></Field> }
function Segmented({ value, options, onChange }: { value: string; options: readonly (readonly [string, string])[]; onChange: (value: string) => void }) { return <div className="segmented">{options.map(([key, label]) => <button type="button" className={value === key ? 'active' : ''} key={key} onClick={() => onChange(key)}>{label}</button>)}</div> }
function ToggleRow({ title, icon, checked, onChange }: { title: string; icon: React.ReactNode; checked: boolean; onChange: (checked: boolean) => void }) { return <label className="toggle-row"><span>{icon}</span><b>{title}</b><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i className="toggle"><em /></i></label> }
function IconButton({ label, children, onClick, disabled, tone = 'default', className = '' }: { label: string; children: React.ReactNode; onClick: () => void; disabled?: boolean; tone?: string; className?: string }) { return <button className={`icon-button icon-button--${tone} ${className}`} aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button> }
function ToastStack({ items }: { items: Toast[] }) { return <div className="toast-stack" aria-live="polite">{items.map((toast) => <div className={`toast toast--${toast.tone}`} key={toast.id}>{toast.tone === 'success' ? <Check /> : toast.tone === 'error' ? <AlertTriangle /> : <Activity />}{toast.message}</div>)}</div> }

function statusClass(status: string) { if (status === 'Running') return 'positive'; if (status === 'Stopped') return 'negative'; if (status === 'Starting' || status === 'Stopping' || status === 'Pending') return 'warning'; return 'neutral' }
function statusLabel(status: string) { return ({ Running: '运行中', Stopped: '已停止', Starting: '启动中', Stopping: '停止中', Pending: '等待中', Unknown: '未知' } as Record<string, string>)[status] || status }
function formatTime(value: string) { return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }
function formatDate(value: string) { return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
