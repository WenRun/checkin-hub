import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Trash2, Plus, Download, AlertTriangle, QrCode, ExternalLink, Pencil, KeyRound } from 'lucide-react';
import { api, fmtTime } from '../api.jsx';
import { Card, Button, Badge, Modal, Field, Input, Empty } from '../components/ui.jsx';
import { CreditsSection } from '../components/AccountCredits.jsx';

// ---------- OAuth 扫码登录弹窗 ----------

function OAuthDialog({ open, onClose, onSaved, provider }) {
  const [session, setSession] = useState(null); // { loginId, verificationUri, expiresIn }
  const [status, setStatus] = useState('loading'); // loading | waiting | done | error
  const [message, setMessage] = useState('');
  const [remain, setRemain] = useState(0);
  const [debugInfo, setDebugInfo] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setStatus('loading');
    setMessage('');
    setSession(null);

    const stopPolling = () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
    stopPolling();

    api
      .oauthStart(provider)
      .then((s) => {
        if (!alive) return;
        setSession(s);
        setRemain(s.expiresIn);
        setStatus('waiting');
        timerRef.current = setInterval(async () => {
          setRemain((r) => Math.max(0, r - 3));
          try {
            const r = await api.oauthPoll(s.loginId, provider);
            if (!alive || !r.done) {
              if (r && r.debug) setDebugInfo(r.debug);
              return;
            }
            stopPolling();
            if (r.error) {
              setStatus('error');
              setMessage(r.error);
            } else {
              setStatus('done');
              setMessage(`账号 ${r.result.email || r.result.nickname || r.result.uid || ''} 添加成功`);
              onSaved();
            }
          } catch {
            /* 网络抖动时下个周期继续轮询 */
          }
        }, 3000);
      })
      .catch((e) => {
        if (alive) {
          setStatus('error');
          setMessage(e.message);
        }
      });

    return () => {
      alive = false;
      stopPolling();
    };
  }, [open, onSaved, provider]);

  return (
    <Modal open={open} onClose={onClose} title={`扫码登录 · ${provider?.name || ''}`}>
      {status === 'loading' && <Empty text="正在向官方申请登录会话…" />}
      {status === 'error' && (
        <div className="space-y-3">
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{message}</div>
          <div className="flex justify-end">
            <Button variant="ghost" onClick={onClose}>关闭</Button>
          </div>
        </div>
      )}
      {status === 'done' && (
        <div className="space-y-3">
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">{message}</div>
          <div className="flex justify-end">
            <Button variant="primary" onClick={onClose}>完成</Button>
          </div>
        </div>
      )}
      {status === 'waiting' && session && (
        <div className="space-y-4">
          <ol className="space-y-2 text-sm text-zinc-300">
            <li>1. 点击下方按钮打开官方登录页（新标签页）</li>
            <li>2. 在登录页用手机扫码或输入账号完成登录</li>
            <li>3. 登录成功后本页会自动检测并保存账号，无需其他操作</li>
          </ol>
          <div className="flex items-center gap-2">
            <Button variant="primary" onClick={() => window.open(session.verificationUri, '_blank', 'noopener')}>
              <ExternalLink size={15} /> 打开登录页
            </Button>
            <Button variant="ghost" onClick={() => { navigator.clipboard.writeText(session.verificationUri); }}>
              复制链接
            </Button>
          </div>
          <div className="truncate rounded-lg border border-line bg-panel-2 px-3 py-2 text-xs text-zinc-500" title={session.verificationUri}>
            {session.verificationUri}
          </div>
          <div className="text-xs text-zinc-500">
            等待登录中… 剩余 {Math.floor(remain / 60)}:{String(remain % 60).padStart(2, '0')}
            {remain <= 0 && '（已超时，请关闭后重试）'}
          </div>
          {debugInfo && (
            <details className="text-xs text-zinc-600">
              <summary className="cursor-pointer select-none">官方接口最近响应（诊断信息）</summary>
              <div className="mt-1 break-all rounded border border-line bg-panel-2 p-2 font-mono">
                {JSON.stringify(debugInfo)}
              </div>
            </details>
          )}
        </div>
      )}
    </Modal>
  );
}

// ---------- 手动添加账号弹窗（字段由 provider 的 manualFields 动态渲染） ----------

const SECRET_HINTS = ['token', 'key', 'password'];

function AccountFormDialog({ open, onClose, onSaved, provider, editing }) {
  const fields = provider?.manualFields || [];
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    if (editing) {
      // 编辑模式：拉取凭据回显全部字段（含 token/密码），保存时原样提交
      setLoading(true);
      api
        .accountCredentials(editing.id)
        .then((creds) => {
          const next = {};
          for (const f of fields) next[f.key] = creds[f.key] || '';
          setForm(next);
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    } else {
      setForm({});
    }
  }, [open, editing, fields]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const isSecret = (key) => SECRET_HINTS.some((s) => key.toLowerCase().includes(s));

  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      if (editing) await api.updateAccount(editing.id, form);
      else await api.addAccount({ provider: provider?.id, ...form });
      onSaved();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${editing ? '更新凭据' : '添加账号'} · ${provider?.name || ''}`}
    >
      <div className="space-y-4">
        {fields.length === 0 && <Empty text="该平台暂未配置账号表单" />}
        {loading && <Empty text="正在加载已保存的凭据…" />}
        {!loading && editing && (
          <div className="flex items-start gap-2 rounded-lg border border-line bg-panel-2 px-3 py-2 text-xs text-zinc-500">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-500" />
            <span>
              已回显当前保存的凭据，修改后点保存即可。
              {editing.needs_relogin && (
                <span className="ml-1 text-amber-400">该账号当前为「需重新登录」状态，更新凭据保存后即恢复。</span>
              )}
            </span>
          </div>
        )}
        {!loading &&
          fields.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint}>
              <Input
                value={form[f.key] || ''}
                onChange={set(f.key)}
                placeholder={f.placeholder || ''}
                required={!editing && f.required}
                type={isSecret(f.key) ? 'password' : 'text'}
              />
            </Field>
          ))}
        {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={submit} disabled={saving || loading || fields.length === 0}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- 滑块验证恢复登录弹窗 ----------

function RecoveryDialog({ open, onClose, onSaved, account }) {
  const [payload, setPayload] = useState(null); // {captchaId, bgSvg, pieceSvg, pieceY, panelWidth, panelHeight, pieceWidth}
  const [error, setError] = useState('');
  const [status, setStatus] = useState('loading'); // loading | solving | success
  const [offsetX, setOffsetX] = useState(0);
  const [solved, setSolved] = useState(false);
  const dragRef = useRef({ active: false, startX: 0, baseX: 0, startedAt: 0 });
  const [busy, setBusy] = useState(false);

  const loadCaptcha = useCallback(async () => {
    setStatus('loading');
    setError('');
    setOffsetX(0);
    setSolved(false);
    try {
      const data = await api.accountCaptcha(account.id);
      if (!data.ok) throw new Error(data.error || '验证码获取失败');
      setPayload(data.payload);
      setStatus('solving');
    } catch (e) {
      setError(e.message);
    }
  }, [account?.id]);

  useEffect(() => {
    if (open && account) loadCaptcha();
  }, [open, account, loadCaptcha]);

  if (!account) return null;
  const maxX = payload ? payload.panelWidth - payload.pieceWidth : 240;

  const onPointerDown = (e) => {
    if (solved || busy) return;
    dragRef.current = { active: true, startX: e.clientX, baseX: offsetX, startedAt: Date.now() };
    e.target.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!dragRef.current.active) return;
    const next = Math.min(maxX, Math.max(0, dragRef.current.baseX + e.clientX - dragRef.current.startX));
    setOffsetX(next);
  };
  const onPointerUp = async () => {
    if (!dragRef.current.active || solved || busy) return;
    dragRef.current.active = false;
    const elapsed = Date.now() - dragRef.current.startedAt;
    setBusy(true);
    try {
      await api.accountRelogin(account.id, {
        captchaId: payload.captchaId,
        captchaX: Math.round(offsetX),
        captchaElapsedMs: elapsed,
      });
      setSolved(true);
      setStatus('success');
      onSaved();
    } catch (e2) {
      setError(`${e2.message}（已自动更换验证码，请重试）`);
      loadCaptcha();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`恢复登录 · ${account.email || account.nickname || ''}`}>
      {status === 'loading' && <Empty text="正在获取滑块验证码…" />}
      {status === 'error' && (
        <div className="space-y-3">
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={loadCaptcha}>重试</Button>
            <Button variant="primary" onClick={onClose}>关闭</Button>
          </div>
        </div>
      )}
      {status === 'solving' && payload && (
        <div className="space-y-3">
          <p className="text-sm text-zinc-300">
            拖动滑块，把拼图块对齐到背景图的缺口位置，松手后自动完成登录恢复。
          </p>
          <div
            className="relative mx-auto overflow-hidden rounded-lg border border-line"
            style={{ width: payload.panelWidth, height: payload.panelHeight }}
          >
            <div dangerouslySetInnerHTML={{ __html: payload.bgSvg }} />
            <div
              className="absolute"
              style={{
                transform: `translateX(${offsetX}px)`,
                top: payload.pieceY - 2,
                left: -2,
                width: payload.pieceWidth + 4,
                height: payload.pieceWidth + 4,
              }}
              dangerouslySetInnerHTML={{ __html: payload.pieceSvg }}
            />
          </div>
          <div
            className={`relative mx-auto flex h-10 items-center rounded-full border px-2 ${
              solved ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-line bg-panel-2'
            }`}
            style={{ width: payload.panelWidth }}
          >
            {!solved && (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-zinc-500">
                {busy ? '验证中…' : '拖动滑块完成拼图'}
              </span>
            )}
            {solved && (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-emerald-400">
                验证通过，登录已恢复
              </span>
            )}
            <div
              role="slider"
              aria-valuenow={Math.round(offsetX)}
              tabIndex={0}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              className={`flex h-8 w-8 cursor-grab items-center justify-center rounded-full bg-emerald-600 text-white shadow ${solved ? 'opacity-60' : 'active:cursor-grabbing'}`}
              style={{ transform: `translateX(${offsetX}px)` }}
            >
              <KeyRound size={14} />
            </div>
          </div>
          {error && !solved && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</div>
          )}
          {status === 'success' && (
            <div className="flex justify-end">
              <Button variant="primary" onClick={onClose}>完成</Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ---------- 账号管理（按平台子菜单） ----------

export default function Accounts() {
  const [providers, setProviders] = useState([]);
  const [tab, setTab] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [oauthOpen, setOauthOpen] = useState(false);
  const [recoveryAccount, setRecoveryAccount] = useState(null);
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    api.accounts().then(setAccounts).catch(() => {});
  }, []);

  useEffect(() => {
    api.providers().then((ps) => {
      setProviders(ps);
      setTab((t) => t || ps[0]?.id || '');
    }).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const flash = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 4000);
  };

  const active = providers.find((p) => p.id === tab) || providers[0] || null;
  const caps = active?.capabilities || {};
  const siteAccounts = accounts.filter((a) => a.provider === active?.id);

  const importLocal = async () => {
    setBusyId('import');
    try {
      const a = await api.importLocal(active.id);
      flash(`已导入本机账号: ${a.email || a.nickname || a.uid || a.id}`);
      load();
    } catch (e) {
      flash(`导入失败: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const refreshToken = async (acc) => {
    setBusyId(acc.id);
    try {
      const meta = await api.refreshAccount(acc.id);
      flash(meta.needsRelogin ? `刷新失败: ${meta.needsReloginReason}` : 'token 刷新成功');
      load();
    } catch (e) {
      flash(`刷新失败: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const tokenStatus = (a) => {
    if (a.needs_relogin) return <Badge className="border-red-500/30 bg-red-500/10 text-red-400">需重新登录</Badge>;
    if (!a.expiresAt) return <Badge className="border-zinc-500/30 bg-zinc-500/10 text-zinc-400">过期时间未知</Badge>;
    const remain = a.expiresAt - Date.now();
    if (remain <= 0) return <Badge className="border-red-500/30 bg-red-500/10 text-red-400">已过期</Badge>;
    const hours = Math.floor(remain / 3600000);
    if (hours < 24) return <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-400">{hours} 小时后过期</Badge>;
    return <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">{Math.floor(hours / 24)} 天后过期</Badge>;
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">账号管理</h2>
          <p className="mt-0.5 text-sm text-zinc-500">按平台管理各站点的账号凭据，token 只保存在本机</p>
        </div>
        <div className="flex gap-2">
          {caps.importLocal && (
            <Button onClick={importLocal} disabled={busyId === 'import'}>
              <Download size={15} /> {busyId === 'import' ? '导入中…' : '从本机导入'}
            </Button>
          )}
          {caps.oauth && (
            <Button onClick={() => setOauthOpen(true)}>
              <QrCode size={15} /> 扫码登录
            </Button>
          )}
          {caps.manual && (
            <Button variant="primary" onClick={() => { setEditingAccount(null); setFormOpen(true); }}>
              <Plus size={15} /> 手动添加
            </Button>
          )}
        </div>
      </div>

      {/* 平台子菜单 */}
      <div className="flex flex-wrap gap-2">
        {providers.map((p) => (
          <button
            key={p.id}
            onClick={() => setTab(p.id)}
            className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
              p.id === active?.id
                ? 'border-emerald-600/60 bg-emerald-600/15 font-medium text-emerald-400'
                : 'border-line bg-panel text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
            }`}
          >
            {p.name}
            <span className="ml-2 text-xs text-zinc-600">
              {accounts.filter((a) => a.provider === p.id).length}
            </span>
          </button>
        ))}
        {providers.length === 0 && <span className="text-sm text-zinc-600">加载中…</span>}
      </div>

      {notice && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-400">
          {notice}
        </div>
      )}

      <Card>
        {siteAccounts.length === 0 ? (
          <Empty text={`还没有 ${active?.name || ''} 账号。${caps.oauth ? '推荐点「扫码登录」直接登录添加；' : ''}${caps.importLocal ? '本机装了客户端也可以「从本机导入」；' : ''}或「手动添加」填入 token`} />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-zinc-500">
                <th className="px-5 py-3 font-medium">账号</th>
                <th className="px-3 py-3 font-medium">token 状态</th>
                <th className="px-3 py-3 font-medium">refresh token 过期</th>
                <th className="px-3 py-3 font-medium">最近刷新</th>
                <th className="px-5 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {siteAccounts.map((a) => (
                <tr key={a.id} className="hover:bg-panel-2/60">
                  <td className="px-5 py-3">
                    <div className="font-medium text-zinc-200">{a.email || a.nickname || a.uid || a.id}</div>
                    <div className="mt-0.5 text-xs text-zinc-500">
                      {a.nickname && a.email && a.nickname !== a.email ? `${a.nickname} · ` : ''}
                      {a.provider}
                    </div>
                  </td>
                  <td className="px-3 py-3">{tokenStatus(a)}</td>
                  <td className="px-3 py-3 text-xs text-zinc-400">
                    {a.refreshExpiresAt ? fmtTime(a.refreshExpiresAt) : '—'}
                  </td>
                  <td className="px-3 py-3 text-xs text-zinc-400">{fmtTime(a.refreshedAt)}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {a.needs_relogin && caps.relogin && (
                        <Button
                          size="sm"
                          variant="primary"
                          title="恢复登录（拖动滑块验证）"
                          onClick={() => setRecoveryAccount(a)}
                        >
                          <KeyRound size={14} /> 恢复登录
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        title="更新凭据"
                        onClick={() => { setEditingAccount(a); setFormOpen(true); }}
                      >
                        <Pencil size={14} />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="刷新 token"
                        disabled={busyId === a.id}
                        onClick={() => refreshToken(a)}
                      >
                        <RefreshCw size={14} className={busyId === a.id ? 'animate-spin' : ''} />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="删除"
                        className="text-red-400 hover:bg-red-500/10"
                        onClick={() =>
                          window.confirm(`确认删除账号「${a.email || a.nickname || a.uid || a.id}」？`) &&
                          api.deleteAccount(a.id).then(load)
                        }
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {caps.importLocal && (
        <div className="flex items-start gap-2 rounded-lg border border-line bg-panel px-4 py-3 text-xs text-zinc-500">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
          <div>
            「从本机导入」读取本机 WorkBuddy 客户端的登录凭据文件
            （<code className="text-zinc-400">%LOCALAPPDATA%\CodeBuddyExtension\Data\Public\auth\workbuddy-desktop.info</code>），
            需要本机已登录 WorkBuddy。手动添加则需要在浏览器登录 codebuddy.cn 后从请求头中复制 token。
            每次任务执行前会自动检查 token 有效期，剩余不足 24 小时自动刷新。
          </div>
        </div>
      )}

      {caps.credits && (
        <Card className="p-5">
          <CreditsSection site={active.id} />
        </Card>
      )}

      {active && (
        <>
          <AccountFormDialog
            open={formOpen}
            onClose={() => { setFormOpen(false); setEditingAccount(null); }}
            onSaved={load}
            provider={active}
            editing={editingAccount}
          />
          <OAuthDialog open={oauthOpen} onClose={() => setOauthOpen(false)} onSaved={load} provider={active} />
          <RecoveryDialog
            open={!!recoveryAccount}
            onClose={() => setRecoveryAccount(null)}
            onSaved={load}
            account={recoveryAccount}
          />
        </>
      )}
    </div>
  );
}
