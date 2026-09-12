// checkin-hub 服务端入口：提供 REST API + 生产模式下托管前端构建产物。

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');

const store = require('./store');
const scheduler = require('./scheduler');
const { getProvider, listProviders } = require('./providers');

const PORT = Number(process.env.PORT) || 57891;
const app = express();
app.use(express.json());

// ---------- 站点 ----------
app.get('/api/providers', (_req, res) => {
  res.json(listProviders());
});

// ---------- 账号 ----------
app.get('/api/accounts', (_req, res) => {
  res.json(store.loadAccounts().map(store.accountMeta));
});

app.post('/api/accounts', async (req, res) => {
  const { provider: providerId = 'workbuddy', access_token, ...rest } = req.body || {};
  const provider = getProvider(providerId);
  if (!provider) return res.status(400).json({ error: '未知的站点类型' });
  if (!access_token || !String(access_token).trim()) {
    return res.status(400).json({ error: 'access_token 不能为空' });
  }
  const account = {
    id: crypto.randomUUID(),
    provider: providerId,
    access_token: String(access_token).trim(),
    refresh_token: rest.refresh_token ? String(rest.refresh_token).trim() : '',
    uid: rest.uid || '',
    email: rest.email || '',
    nickname: rest.nickname || '',
    enterpriseId: rest.enterpriseId || '',
    domain: rest.domain || '',
    expiresAt: Number(rest.expiresAt) || null,
    refreshExpiresAt: Number(rest.refreshExpiresAt) || null,
    createdAt: Date.now(),
  };
  // provider 声明的扩展字段（如 tokenbom 的 virtual_key）透传保存
  const handled = new Set([
    'provider', 'access_token', 'refresh_token', 'uid', 'email', 'nickname',
    'enterpriseId', 'domain', 'expiresAt', 'refreshExpiresAt',
  ]);
  for (const f of provider.manualFields || []) {
    if (handled.has(f.key)) continue;
    if (rest[f.key] !== undefined) account[f.key] = String(rest[f.key]).trim();
  }
  store.upsertAccount(account);
  res.json(store.accountMeta(account));
});

// 从本机 WorkBuddy 认证文件导入当前登录账号
app.post('/api/accounts/import-local', async (req, res) => {
  const provider = getProvider(req.body?.provider || 'workbuddy');
  if (!provider || !provider.importLocal) {
    return res.status(400).json({ error: '该站点不支持本机导入' });
  }
  try {
    const account = await provider.importLocal();
    res.json(store.accountMeta(account));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 更新已有账号的凭据/展示字段：空值 = 保持不变（token 类字段留空即不改）
app.put('/api/accounts/:id', (req, res) => {
  const account = store.findAccount(req.params.id);
  if (!account) return res.status(404).json({ error: '账号不存在' });
  const provider = getProvider(account.provider);
  if (!provider) return res.status(400).json({ error: '未知的站点类型' });
  for (const f of provider.manualFields || []) {
    const v = req.body?.[f.key];
    if (v === undefined || String(v).trim() === '') continue;
    account[f.key] = String(v).trim();
    // 凭据更新后清除重登录标记
    if (f.key === 'access_token' || f.key === 'refresh_token' || f.key === 'password') {
      delete account.needs_relogin;
      delete account.needs_relogin_reason;
    }
  }
  store.upsertAccount(account);
  res.json(store.accountMeta(account));
});

app.post('/api/accounts/:id/refresh', async (req, res) => {
  const account = store.findAccount(req.params.id);
  if (!account) return res.status(404).json({ error: '账号不存在' });
  const provider = getProvider(account.provider);
  if (!provider) return res.status(400).json({ error: '未知的站点类型' });
  const updated = await provider.refreshToken(account);
  const meta = store.accountMeta(updated);
  if (updated.needs_relogin) {
    return res.json({ ...meta, needsRelogin: true, needsReloginReason: updated.needs_relogin_reason });
  }
  res.json(meta);
});

app.delete('/api/accounts/:id', (req, res) => {
  if (!store.deleteAccount(req.params.id)) {
    return res.status(404).json({ error: '账号不存在' });
  }
  res.json({ ok: true });
});

// ---------- OAuth 扫码登录 ----------
app.post('/api/oauth/start', async (req, res) => {
  const provider = getProvider(req.body?.provider || 'workbuddy');
  if (!provider || !provider.oauthStart) {
    return res.status(400).json({ error: '该站点不支持扫码登录' });
  }
  try {
    res.json(await provider.oauthStart());
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/oauth/poll/:loginId', async (req, res) => {
  const provider = getProvider(req.query.provider || 'workbuddy');
  if (!provider || !provider.oauthPoll) {
    return res.status(400).json({ error: '该站点不支持扫码登录' });
  }
  try {
    res.json(await provider.oauthPoll(req.params.loginId));
  } catch (e) {
    res.json({ done: true, error: e.message });
  }
});

// 诊断用：查看进行中的登录会话及官方最近一次响应
app.get('/api/oauth/debug', (_req, res) => {
  const provider = getProvider('workbuddy');
  res.json(provider ? provider.oauthDebug() : []);
});

// ---------- 任务 ----------
function validateSchedule(schedule) {
  const s = schedule || {};
  if (s.type === 'daily') {
    const times = Array.isArray(s.times) ? s.times.filter((t) => /^\d{1,2}:\d{2}$/.test(t)) : [];
    if (!times.length) return { error: '每天定时模式至少需要一个有效时间点（HH:MM）' };
    return { schedule: { type: 'daily', times } };
  }
  if (s.type === 'interval') {
    const m = Number(s.everyMinutes);
    if (!Number.isFinite(m) || m < 1) return { error: '间隔模式需要有效的分钟数（>=1）' };
    return { schedule: { type: 'interval', everyMinutes: Math.floor(m) } };
  }
  if (s.type === 'cron') {
    const expr = String(s.expression || '').trim();
    try {
      require('cron-parser').parseExpression(expr);
    } catch (e) {
      return { error: `Cron 表达式无效: ${e.message}` };
    }
    return { schedule: { type: 'cron', expression: expr } };
  }
  return { error: 'schedule.type 必须是 daily / interval / cron' };
}

// provider 专属任务选项（如 tokenbom 的 autoCall/autoMakeup/callModel）
function sanitizeProviderOptions(po) {
  if (!po || typeof po !== 'object') return undefined;
  return {
    autoCall: po.autoCall !== false,
    autoMakeup: po.autoMakeup !== false,
    callModel: typeof po.callModel === 'string' ? po.callModel.trim().slice(0, 80) : '',
  };
}

app.get('/api/tasks', (_req, res) => {
  res.json(store.loadTasks());
});

app.post('/api/tasks', (req, res) => {
  const { name, site = 'workbuddy', accountId = '*', enabled = true, jitterMinutes = 0 } =
    req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: '任务名称不能为空' });
  if (!getProvider(site)) return res.status(400).json({ error: '未知的站点类型' });
  const { schedule, error } = validateSchedule(req.body?.schedule);
  if (error) return res.status(400).json({ error });
  const po = sanitizeProviderOptions(req.body?.providerOptions);
  const task = {
    id: crypto.randomUUID(),
    name: String(name).trim(),
    site,
    accountId,
    enabled: !!enabled,
    schedule,
    jitterMinutes: Math.max(0, Number(jitterMinutes) || 0),
    ...(po ? { providerOptions: po } : {}),
    createdAt: Date.now(),
    lastRunAt: null,
    lastResult: null,
    lastMessage: '',
    nextRunAt: null,
  };
  scheduler.reschedule(task);
  res.json(task);
});

app.put('/api/tasks/:id', (req, res) => {
  const task = store.findTask(req.params.id);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  const body = req.body || {};
  if (body.name !== undefined) {
    if (!String(body.name).trim()) return res.status(400).json({ error: '任务名称不能为空' });
    task.name = String(body.name).trim();
  }
  if (body.accountId !== undefined) task.accountId = body.accountId;
  if (body.jitterMinutes !== undefined) {
    task.jitterMinutes = Math.max(0, Number(body.jitterMinutes) || 0);
  }
  if (body.enabled !== undefined) task.enabled = !!body.enabled;
  if (body.schedule !== undefined) {
    const { schedule, error } = validateSchedule(body.schedule);
    if (error) return res.status(400).json({ error });
    task.schedule = schedule;
  }
  if (body.providerOptions !== undefined) {
    const po = sanitizeProviderOptions(body.providerOptions);
    if (po) task.providerOptions = po;
    else delete task.providerOptions;
  }
  scheduler.reschedule(task);
  res.json(task);
});

app.post('/api/tasks/:id/toggle', (req, res) => {
  const task = store.findTask(req.params.id);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  task.enabled = !task.enabled;
  scheduler.reschedule(task);
  res.json(task);
});

app.post('/api/tasks/:id/run', async (req, res) => {
  const task = store.findTask(req.params.id);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  const result = await scheduler.runTask(task, 'manual');
  if (result.skipped) return res.json({ skipped: result.skipped });
  res.json({ ok: true, results: result.results });
});

app.delete('/api/tasks/:id', (req, res) => {
  if (!store.deleteTask(req.params.id)) return res.status(404).json({ error: '任务不存在' });
  res.json({ ok: true });
});

// ---------- 执行记录 ----------
app.get('/api/records', (req, res) => {
  res.json(
    store.queryRecords({
      taskId: req.query.taskId || undefined,
      result: req.query.result || undefined,
      limit: Math.min(500, Number(req.query.limit) || 100),
    }),
  );
});

// ---------- 总览 ----------
app.get('/api/overview', (_req, res) => {
  const accounts = store.loadAccounts();
  const tasks = store.loadTasks();
  const records = store.loadRecords();
  const today = new Date().toDateString();
  const todayRecords = records.filter(
    (r) => new Date(r.startedAt).toDateString() === today,
  );
  res.json({
    accounts: accounts.length,
    accountsNeedRelogin: accounts.filter((a) => a.needs_relogin).length,
    tasksTotal: tasks.length,
    tasksEnabled: tasks.filter((t) => t.enabled).length,
    todaySuccess: todayRecords.filter((r) => r.result === 'success' || r.result === 'already').length,
    todayError: todayRecords.filter((r) => r.result === 'error').length,
    nextTasks: tasks
      .filter((t) => t.enabled && t.nextRunAt)
      .sort((a, b) => a.nextRunAt - b.nextRunAt)
      .slice(0, 5)
      .map((t) => ({ id: t.id, name: t.name, nextRunAt: t.nextRunAt, schedule: scheduler.scheduleDescription(t) })),
    recentRecords: records.slice(-10).reverse(),
  });
});

// ---------- 积分 ----------
// 查询（支持积分的）账号的资源包与到期时间；不支持的站点直接跳过
app.get('/api/credits', async (req, res) => {
  const accounts = store.loadAccounts().filter((a) => {
    if (req.query.accountId && a.id !== req.query.accountId) return false;
    const provider = getProvider(a.provider);
    return provider && typeof provider.getCredits === 'function';
  });
  const results = await Promise.all(
    accounts.map((account) => getProvider(account.provider).getCredits(account)),
  );
  res.json(results);
});

// ---------- 前端静态资源（生产模式） ----------
const distDir = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`checkin-hub 已启动: http://127.0.0.1:${PORT}`);
  console.log(`数据目录: ${store.DATA_DIR}`);
  scheduler.start();
});
