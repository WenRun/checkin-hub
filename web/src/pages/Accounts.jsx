import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Trash2, Plus, Download, AlertTriangle, QrCode, ExternalLink } from 'lucide-react';
import { api, fmtTime } from '../api.jsx';
import { Card, Button, Badge, Modal, Field, Input, Empty } from '../components/ui.jsx';

function OAuthDialog({ open, onClose, onSaved }) {
  const [session, setSession] = useState(null); // { loginId, verificationUri, expiresIn }
  const [status, setStatus] = useState('loading'); // loading | waiting | done | error
  const [message, setMessage] = useState('');
  const [remain, setRemain] = useState(0);
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
      .oauthStart()
      .then((s) => {
        if (!alive) return;
        setSession(s);
        setRemain(s.expiresIn);
        setStatus('waiting');
        timerRef.current = setInterval(async () => {
          setRemain((r) => Math.max(0, r - 3));
          try {
            const r = await api.oauthPoll(s.loginId);
            if (!alive || !r.done) return;
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
  }, [open, onSaved]);

  return (
    <Modal open={open} onClose={onClose} title="扫码登录 WorkBuddy">
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
            <li>1. 点击下方按钮打开 WorkBuddy 官方登录页（新标签页）</li>
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
        </div>
      )}
    </Modal>
  );
}

function AccountFormDialog({ open, onClose, onSaved }) {
  const [form, setForm] = useState({ access_token: '', refresh_token: '', email: '', uid: '', enterpriseId: '', domain: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ access_token: '', refresh_token: '', email: '', uid: '', enterpriseId: '', domain: '' });
      setError('');
    }
  }, [open]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      await api.addAccount(form);
      onSaved();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="添加 WorkBuddy 账号">
      <div className="space-y-4">
        <Field label="access_token（必填）" hint="抓包 codebuddy.cn 请求头 Authorization Bearer 后面的值">
          <Input value={form.access_token} onChange={set('access_token')} placeholder="eyJhbGci..." />
        </Field>
        <Field label="refresh_token（建议填写）" hint="用于 token 过期后自动续期，长期保活必备">
          <Input value={form.refresh_token} onChange={set('refresh_token')} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="邮箱（选填，用于展示）">
            <Input value={form.email} onChange={set('email')} />
          </Field>
          <Field label="UID（选填）">
            <Input value={form.uid} onChange={set('uid')} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="enterpriseId（企业账号选填）">
            <Input value={form.enterpriseId} onChange={set('enterpriseId')} />
          </Field>
          <Field label="domain（选填）">
            <Input value={form.domain} onChange={set('domain')} />
          </Field>
        </div>
        {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={submit} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default function Accounts() {
  const [accounts, setAccounts] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [oauthOpen, setOauthOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    api.accounts().then(setAccounts).catch(() => {});
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

  const importLocal = async () => {
    setBusyId('import');
    try {
      const a = await api.importLocal();
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">账号管理</h2>
          <p className="mt-0.5 text-sm text-zinc-500">签到任务使用的账号凭据，token 只保存在本机</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={importLocal} disabled={busyId === 'import'}>
            <Download size={15} /> {busyId === 'import' ? '导入中…' : '从本机导入'}
          </Button>
          <Button onClick={() => setOauthOpen(true)}>
            <QrCode size={15} /> 扫码登录
          </Button>
          <Button variant="primary" onClick={() => setFormOpen(true)}>
            <Plus size={15} /> 手动添加
          </Button>
        </div>
      </div>

      {notice && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-400">
          {notice}
        </div>
      )}

      <Card>
        {accounts.length === 0 ? (
          <Empty text="还没有账号。推荐点「扫码登录」直接登录添加；本机装了 WorkBuddy 也可以「从本机导入」；或「手动添加」填入 token" />
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
              {accounts.map((a) => (
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

      <div className="flex items-start gap-2 rounded-lg border border-line bg-panel px-4 py-3 text-xs text-zinc-500">
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
        <div>
          「从本机导入」读取本机 WorkBuddy 客户端的登录凭据文件
          （<code className="text-zinc-400">%LOCALAPPDATA%\CodeBuddyExtension\Data\Public\auth\workbuddy-desktop.info</code>），
          需要本机已登录 WorkBuddy。手动添加则需要在浏览器登录 codebuddy.cn 后从请求头中复制 token。
          每次任务执行前会自动检查 token 有效期，剩余不足 24 小时自动刷新。
        </div>
      </div>

      <AccountFormDialog open={formOpen} onClose={() => setFormOpen(false)} onSaved={load} />
      <OAuthDialog open={oauthOpen} onClose={() => setOauthOpen(false)} onSaved={load} />
    </div>
  );
}
