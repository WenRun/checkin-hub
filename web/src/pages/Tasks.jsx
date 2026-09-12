import { useCallback, useEffect, useState } from 'react';
import { Play, Pencil, Trash2, History, Plus } from 'lucide-react';
import { api, fmtTime, fmtSchedule, ResultBadge } from '../api.jsx';
import {
  Card, Button, Switch, Badge, Modal, Field, Input, Select, Empty,
} from '../components/ui.jsx';

const SCHEDULE_TYPES = [
  { id: 'daily', label: '每天定时', desc: '在每天的指定时间点执行，如 09:00 和 21:30' },
  { id: 'interval', label: '固定间隔', desc: '每隔 N 分钟执行一次' },
  { id: 'cron', label: 'Cron 表达式', desc: '5 位 Cron 表达式（分 时 日 月 周），如 0 9 * * *' },
];

const emptyForm = {
  name: '',
  site: 'workbuddy',
  accountId: '*',
  scheduleType: 'daily',
  times: '09:00',
  everyMinutes: 30,
  expression: '0 9 * * *',
  jitterMinutes: 0,
  enabled: true,
};

function toPayload(form) {
  const schedule =
    form.scheduleType === 'daily'
      ? { type: 'daily', times: form.times.split(/[,，]/).map((s) => s.trim()).filter(Boolean) }
      : form.scheduleType === 'interval'
        ? { type: 'interval', everyMinutes: Number(form.everyMinutes) }
        : { type: 'cron', expression: form.expression.trim() };
  return {
    name: form.name,
    site: form.site,
    accountId: form.accountId,
    schedule,
    jitterMinutes: Number(form.jitterMinutes) || 0,
    enabled: form.enabled,
  };
}

function TaskFormDialog({ open, onClose, onSaved, providers, accounts, editing }) {
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    if (editing) {
      const s = editing.schedule || {};
      setForm({
        name: editing.name,
        site: editing.site,
        accountId: editing.accountId || '*',
        scheduleType: s.type || 'daily',
        times: (s.times || ['09:00']).join(','),
        everyMinutes: s.everyMinutes || 30,
        expression: s.expression || '0 9 * * *',
        jitterMinutes: editing.jitterMinutes || 0,
        enabled: editing.enabled,
      });
    } else {
      setForm(emptyForm);
    }
  }, [open, editing]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = toPayload(form);
      if (editing) await api.updateTask(editing.id, payload);
      else await api.addTask(payload);
      onSaved();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const activeType = SCHEDULE_TYPES.find((t) => t.id === form.scheduleType);

  return (
    <Modal open={open} onClose={onClose} title={editing ? '编辑任务' : '新建签到任务'}>
      <div className="space-y-4">
        <Field label="任务名称">
          <Input value={form.name} onChange={set('name')} placeholder="如：WorkBuddy 每日签到" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="站点">
            <Select value={form.site} onChange={(v) => setForm((f) => ({ ...f, site: v }))} disabled={!!editing}>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="账号">
            <Select value={form.accountId} onChange={(v) => setForm((f) => ({ ...f, accountId: v }))}>
              <option value="*">全部账号</option>
              {accounts
                .filter((a) => a.provider === form.site)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.email || a.nickname || a.uid || a.id}
                  </option>
                ))}
            </Select>
          </Field>
        </div>

        <Field label="调度方式" hint={activeType?.desc}>
          <div className="grid grid-cols-3 gap-2">
            {SCHEDULE_TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setForm((f) => ({ ...f, scheduleType: t.id }))}
                className={`rounded-lg border px-3 py-2 text-xs transition-colors ${
                  form.scheduleType === t.id
                    ? 'border-emerald-600/60 bg-emerald-600/10 text-emerald-400'
                    : 'border-line bg-panel-2 text-zinc-400 hover:border-zinc-600'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </Field>

        {form.scheduleType === 'daily' && (
          <Field label="执行时间点" hint="多个时间用逗号分隔，24 小时制">
            <Input value={form.times} onChange={set('times')} placeholder="09:00, 21:30" />
          </Field>
        )}
        {form.scheduleType === 'interval' && (
          <Field label="执行间隔（分钟）" hint="最小 1 分钟，建议不低于 5 分钟">
            <Input type="number" min="1" value={form.everyMinutes} onChange={set('everyMinutes')} />
          </Field>
        )}
        {form.scheduleType === 'cron' && (
          <Field label="Cron 表达式" hint="分 时 日 月 周，例如 30 8 * * 1-5 表示工作日 08:30">
            <Input value={form.expression} onChange={set('expression')} />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field label="随机延迟（分钟）" hint="0 表示准时执行，可错开高峰">
            <Input type="number" min="0" value={form.jitterMinutes} onChange={set('jitterMinutes')} />
          </Field>
          <Field label="启用状态">
            <div className="flex h-9 items-center gap-2">
              <Switch checked={form.enabled} onChange={(v) => setForm((f) => ({ ...f, enabled: v }))} />
              <span className="text-sm text-zinc-400">{form.enabled ? '启用' : '停用'}</span>
            </div>
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

function RecordsDialog({ task, onClose }) {
  const [records, setRecords] = useState([]);
  useEffect(() => {
    if (!task) return;
    let alive = true;
    const load = () => api.records({ taskId: task.id, limit: 50 }).then((r) => alive && setRecords(r));
    load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [task]);

  return (
    <Modal open={!!task} onClose={onClose} title={`执行记录 · ${task?.name || ''}`} wide>
      {records.length === 0 ? (
        <Empty text="该任务还没有执行记录" />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500">
              <th className="pb-2 font-medium">时间</th>
              <th className="pb-2 font-medium">账号</th>
              <th className="pb-2 font-medium">结果</th>
              <th className="pb-2 font-medium">详情</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {records.map((r) => (
              <tr key={r.id}>
                <td className="py-2 pr-3 text-xs text-zinc-500">{fmtTime(r.startedAt)}</td>
                <td className="py-2 pr-3 text-zinc-300">{r.accountName}</td>
                <td className="py-2 pr-3"><ResultBadge result={r.result} /></td>
                <td className="py-2 text-xs text-zinc-500">{r.message || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

export default function Tasks() {
  const [tasks, setTasks] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [providers, setProviders] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [recordsTask, setRecordsTask] = useState(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    api.tasks().then(setTasks).catch(() => {});
    api.accounts().then(setAccounts).catch(() => {});
    api.providers().then(setProviders).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  const flash = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 3000);
  };

  const siteName = (id) => providers.find((p) => p.id === id)?.name || id;
  const accountLabel = (id) =>
    id === '*' ? '全部账号' : (() => {
      const a = accounts.find((x) => x.id === id);
      return a ? a.email || a.nickname || a.uid || a.id : '（已删除）';
    })();

  const runNow = async (task) => {
    flash(`正在执行「${task.name}」…`);
    try {
      const r = await api.runTask(task.id);
      if (r.skipped) flash('任务正在执行中，请稍后再试');
      else flash(`执行完成：${r.results.map((x) => `${x.accountName} ${x.result}`).join('，')}`);
      load();
    } catch (e) {
      flash(`执行失败: ${e.message}`);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">任务管理</h2>
          <p className="mt-0.5 text-sm text-zinc-500">配置签到任务的执行计划，查看每次执行结果</p>
        </div>
        <Button variant="primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
          <Plus size={15} /> 新建任务
        </Button>
      </div>

      {notice && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-400">
          {notice}
        </div>
      )}

      <Card>
        {tasks.length === 0 ? (
          <Empty text="还没有任务，点击右上角「新建任务」创建第一个签到任务" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-zinc-500">
                <th className="px-5 py-3 font-medium">任务</th>
                <th className="px-3 py-3 font-medium">站点 / 账号</th>
                <th className="px-3 py-3 font-medium">计划</th>
                <th className="px-3 py-3 font-medium">下次执行</th>
                <th className="px-3 py-3 font-medium">上次结果</th>
                <th className="px-3 py-3 font-medium">启用</th>
                <th className="px-5 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {tasks.map((t) => (
                <tr key={t.id} className="hover:bg-panel-2/60">
                  <td className="px-5 py-3">
                    <div className="font-medium text-zinc-200">{t.name}</div>
                  </td>
                  <td className="px-3 py-3 text-xs text-zinc-400">
                    <div>{siteName(t.site)}</div>
                    <div className="mt-0.5 text-zinc-500">{accountLabel(t.accountId)}</div>
                  </td>
                  <td className="px-3 py-3 text-xs text-zinc-300">{fmtSchedule(t)}</td>
                  <td className="px-3 py-3 text-xs text-zinc-400">
                    {t.enabled ? fmtTime(t.nextRunAt) : '—'}
                  </td>
                  <td className="px-3 py-3">
                    {t.lastResult ? (
                      <div>
                        <ResultBadge result={t.lastResult} />
                        <div className="mt-1 max-w-56 truncate text-xs text-zinc-600" title={t.lastMessage}>
                          {t.lastMessage || '-'}
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-600">未执行</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <Switch checked={t.enabled} onChange={() => api.toggleTask(t.id).then(load)} />
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" title="立即执行" onClick={() => runNow(t)}>
                        <Play size={14} />
                      </Button>
                      <Button size="sm" variant="ghost" title="执行记录" onClick={() => setRecordsTask(t)}>
                        <History size={14} />
                      </Button>
                      <Button size="sm" variant="ghost" title="编辑" onClick={() => { setEditing(t); setFormOpen(true); }}>
                        <Pencil size={14} />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="删除"
                        className="text-red-400 hover:bg-red-500/10"
                        onClick={() => window.confirm(`确认删除任务「${t.name}」？`) && api.deleteTask(t.id).then(load)}
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

      <TaskFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={load}
        providers={providers}
        accounts={accounts}
        editing={editing}
      />
      <RecordsDialog task={recordsTask} onClose={() => setRecordsTask(null)} />
    </div>
  );
}
