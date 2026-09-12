async function request(path, options = {}) {
  const resp = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `请求失败(${resp.status})`);
  return data;
}

export const api = {
  overview: () => request('/api/overview'),
  providers: () => request('/api/providers'),
  accounts: () => request('/api/accounts'),
  addAccount: (body) => request('/api/accounts', { method: 'POST', body }),
  importLocal: (provider = 'workbuddy') =>
    request('/api/accounts/import-local', { method: 'POST', body: { provider } }),
  refreshAccount: (id) => request(`/api/accounts/${id}/refresh`, { method: 'POST' }),
  deleteAccount: (id) => request(`/api/accounts/${id}`, { method: 'DELETE' }),

  tasks: () => request('/api/tasks'),
  addTask: (body) => request('/api/tasks', { method: 'POST', body }),
  updateTask: (id, body) => request(`/api/tasks/${id}`, { method: 'PUT', body }),
  toggleTask: (id) => request(`/api/tasks/${id}/toggle`, { method: 'POST' }),
  runTask: (id) => request(`/api/tasks/${id}/run`, { method: 'POST' }),
  deleteTask: (id) => request(`/api/tasks/${id}`, { method: 'DELETE' }),

  records: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/records${qs ? `?${qs}` : ''}`);
  },
};

export function fmtTime(ms) {
  if (!ms) return '-';
  const d = new Date(Number(ms));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function fmtSchedule(task) {
  const s = task.schedule || {};
  if (s.type === 'daily') return `每天 ${(s.times || []).join(' / ')}`;
  if (s.type === 'interval') {
    const m = Math.max(1, Number(s.everyMinutes) || 30);
    return m % 60 === 0 ? `每 ${m / 60} 小时` : `每 ${m} 分钟`;
  }
  if (s.type === 'cron') return `Cron: ${s.expression}`;
  return '-';
}

export const RESULT_META = {
  success: { label: '成功', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  already: { label: '已签到', cls: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
  error: { label: '失败', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
  partial: { label: '部分成功', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
};

export function ResultBadge({ result }) {
  const meta = RESULT_META[result] || { label: result || '-', cls: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30' };
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${meta.cls}`}>
      {meta.label}
    </span>
  );
}
