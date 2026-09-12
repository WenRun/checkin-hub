// 任务调度器：负责按任务配置（每天定时 / 固定间隔 / Cron 表达式）执行签到任务。
//
// 设计：
// - 每 20 秒 tick 一次，遍历 enabled 且 nextRunAt <= now 的任务并执行；
// - 服务重启时对错过的任务立即补跑一次（catch-up），然后继续按计划排期；
// - 手动"立即执行"与自动调度共用同一 runTask，执行结果统一写入执行记录。

const cronParser = require('cron-parser');

const store = require('./store');
const { getProvider } = require('./providers');

const TICK_MS = 20 * 1000;
const runningTasks = new Set();
let timer = null;

function scheduleDescription(task) {
  const s = task.schedule || {};
  if (s.type === 'daily') {
    return `每天 ${((s.times || []).length ? s.times : ['09:00']).join(' / ')}`;
  }
  if (s.type === 'interval') {
    const m = Math.max(1, Number(s.everyMinutes) || 30);
    return m % 60 === 0 ? `每 ${m / 60} 小时` : `每 ${m} 分钟`;
  }
  if (s.type === 'cron') return `Cron: ${s.expression || '-'}`;
  return '未配置';
}

function jitterMs(task) {
  const j = Math.max(0, Number(task.jitterMinutes) || 0);
  return j ? Math.floor(Math.random() * j * 60 * 1000) : 0;
}

// 计算任务的下次执行时间（本地时区）
function computeNextRun(task, from = Date.now()) {
  const s = task.schedule || {};
  try {
    if (s.type === 'interval') {
      const every = Math.max(1, Number(s.everyMinutes) || 30) * 60 * 1000;
      return from + every + jitterMs(task);
    }
    if (s.type === 'daily') {
      const times = (s.times || []).length ? s.times : ['09:00'];
      let best = null;
      for (const t of times) {
        const [h, m] = String(t).split(':').map(Number);
        if (!Number.isFinite(h) || !Number.isFinite(m)) continue;
        for (const day of [0, 1]) {
          const d = new Date(from);
          d.setDate(d.getDate() + day);
          d.setHours(h, m, 0, 0);
          const ts = d.getTime();
          if (ts > from && (best === null || ts < best)) best = ts;
        }
      }
      return best === null ? from + 60 * 60 * 1000 : best + jitterMs(task);
    }
    if (s.type === 'cron' && s.expression) {
      const next = cronParser.parseExpression(s.expression, { date: new Date(from) }).next();
      return next.getTime() + jitterMs(task);
    }
  } catch {
    // 表达式非法等情况：1 小时后重试，避免调度静默卡死
  }
  return from + 60 * 60 * 1000;
}

function resolveAccounts(task) {
  const provider = getProvider(task.site);
  if (!provider) return { accounts: [], error: `未知的站点类型: ${task.site}` };
  const all = store.loadAccounts().filter((a) => a.provider === task.site);
  if (task.accountId && task.accountId !== '*') {
    const acc = all.find((a) => a.id === task.accountId);
    if (!acc) return { accounts: [], error: '任务绑定的账号不存在或已删除' };
    return { accounts: [acc] };
  }
  return { accounts: all };
}

// 执行一个任务（自动调度与手动触发共用）。返回写入了哪些记录。
async function runTask(task, trigger = 'auto') {
  if (runningTasks.has(task.id)) return { skipped: 'already_running' };
  runningTasks.add(task.id);
  const startedAt = Date.now();
  const results = [];
  try {
    const { accounts, error } = resolveAccounts(task);
    if (error) {
      results.push({
        result: 'error',
        accountName: '-',
        message: error,
      });
    } else if (accounts.length === 0) {
      results.push({ result: 'error', accountName: '-', message: '没有可用账号' });
    } else {
      const provider = getProvider(task.site);
      for (const account of accounts) {
        const t0 = Date.now();
        let outcome;
        try {
          outcome = await provider.checkin(account, task.providerOptions || {});
        } catch (e) {
          outcome = { result: 'error', message: e.message };
        }
        results.push({
          result: outcome.result || 'error',
          accountName: provider.displayName(account),
          message: outcome.message || '',
          durationMs: Date.now() - t0,
        });
      }
    }

    for (const r of results) {
      store.addRecord({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        taskId: task.id,
        taskName: task.name,
        site: task.site,
        accountName: r.accountName,
        trigger,
        result: r.result,
        message: r.message || '',
        startedAt,
        durationMs: r.durationMs || 0,
      });
    }

    const hasError = results.some((r) => r.result === 'error');
    const allOk = results.every((r) => r.result === 'success' || r.result === 'already');
    task.lastRunAt = startedAt;
    task.lastResult = hasError ? 'error' : allOk ? 'success' : 'partial';
    task.lastMessage = results
      .map((r) => `${r.accountName}: ${r.result}${r.message ? `（${r.message}）` : ''}`)
      .join('；');
    task.nextRunAt = computeNextRun(task, Date.now());
    store.upsertTask(task);
    return { ok: true, results };
  } finally {
    runningTasks.delete(task.id);
  }
}

function tick() {
  const now = Date.now();
  for (const task of store.loadTasks()) {
    if (!task.enabled) continue;
    const next = Number(task.nextRunAt) || 0;
    if (next > now) continue;
    // 异步执行，不阻塞 tick；runningTasks 锁防止下一轮重复进入
    runTask(task, 'auto').catch(() => {});
  }
}

function start() {
  // 启动补跑：错过排期的任务立即执行一次，再按计划继续
  const now = Date.now();
  let stagger = 0;
  for (const task of store.loadTasks()) {
    if (!task.enabled) continue;
    if (Number(task.nextRunAt) > now) continue;
    const t = task;
    setTimeout(() => runTask(t, 'catchup').catch(() => {}), stagger);
    stagger += 3000;
  }
  timer = setInterval(tick, TICK_MS);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

// 新建/修改任务后调用：重置排期
function reschedule(task) {
  task.nextRunAt = computeNextRun(task, Date.now());
  return store.upsertTask(task);
}

module.exports = { start, stop, runTask, reschedule, computeNextRun, scheduleDescription };
