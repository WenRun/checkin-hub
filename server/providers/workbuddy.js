// WorkBuddy（腾讯 AI 编程助手）签到 provider。
//
// 签到/token 刷新逻辑移植自 changexbc/workbuddy-switch（wb-switch-core）：
// - 状态查询: POST /v2/billing/meter/checkin-activity-status（失败回退 checkin-status）
// - 提交签到: POST /v2/billing/meter/daily-checkin（返回"已签到"按成功处理）
// - token 刷新: POST /v2/plugin/auth/token/refresh，请求头带 X-Refresh-Token
// - 本机导入: 读取官方认证文件 workbuddy-desktop.info（四段 JSON）

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { httpRequest } = require('../util/http');
const store = require('../store');

const ENDPOINT = 'https://www.codebuddy.cn';
const API_PREFIX = '/v2/plugin';
const CHECKIN_PREFIX = '/v2/billing/meter';

// ---------- 账号工具 ----------

function getStr(obj, key) {
  const v = obj && obj[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function displayName(account) {
  return (
    getStr(account, 'email') ||
    getStr(account, 'nickname') ||
    getStr(account, 'uid') ||
    'unknown'
  );
}

function buildAuthHeaders(account) {
  const headers = {
    Authorization: `Bearer ${getStr(account, 'access_token') || ''}`,
    Accept: 'application/json',
  };
  const uid = getStr(account, 'uid');
  if (uid) headers['X-User-Id'] = uid;
  const eid = getStr(account, 'enterpriseId') || getStr(account, 'enterprise_id');
  if (eid) {
    headers['X-Enterprise-Id'] = eid;
    headers['X-Tenant-Id'] = eid;
  }
  const domain = getStr(account, 'domain');
  if (domain) headers['X-Domain'] = domain;
  return headers;
}

function isUnauthorized(resp) {
  const code = Number(resp && resp.code) || -1;
  if (code === 401 || code === 403) return true;
  const msg = String((resp && (resp.message || resp.msg)) || '').toLowerCase();
  return ['unauthorized', '401', '登录', '失效', '过期', 'token'].some((k) =>
    msg.includes(k),
  );
}

// 与上游 norm_ts 一致：兼容秒/毫秒时间戳
function normTs(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}

function nowMs() {
  return Date.now();
}

// ---------- token 刷新 ----------

// 刷新单账号 token；成功落盘并返回新账号，失败标记 needs_relogin。
async function refreshToken(account) {
  const rt = getStr(account, 'refresh_token') || '';
  if (!rt) {
    account.needs_relogin = true;
    account.needs_relogin_reason = '缺少 refresh token，无法刷新，需重新登录';
    store.upsertAccount(account);
    return account;
  }

  const headers = buildAuthHeaders(account);
  headers['X-Refresh-Token'] = rt;
  const resp = await httpRequest(`${ENDPOINT}${API_PREFIX}/auth/token/refresh`, {
    method: 'POST',
    body: {},
    headers,
  });
  const code = Number(resp && resp.code) || -1;
  if (code !== 0 && code !== 200) {
    account.needs_relogin = true;
    account.needs_relogin_reason = `刷新失败(code=${code}): ${
      (resp && (resp.message || resp.msg)) || '未知错误'
    }`;
    store.upsertAccount(account);
    return account;
  }

  const data = (resp && resp.data) || {};
  const newAccess = getStr(data, 'accessToken') || getStr(data, 'access_token');
  if (!newAccess) {
    account.needs_relogin = true;
    account.needs_relogin_reason = '刷新响应缺少 accessToken';
    store.upsertAccount(account);
    return account;
  }

  account.access_token = newAccess;
  const newRefresh = getStr(data, 'refreshToken') || getStr(data, 'refresh_token');
  if (newRefresh) account.refresh_token = newRefresh;

  // 官方接口只返回相对 expiresIn（秒）时换算为绝对时间戳
  const exp = normTs(data.expiresAt || data.expires_at);
  if (exp) account.expiresAt = exp;
  else if (Number.isFinite(Number(data.expiresIn))) {
    account.expiresAt = nowMs() + Number(data.expiresIn) * 1000;
  }

  const rtExp =
    normTs(data.refreshExpiresAt || data.refresh_expires_at) ||
    normTs(account.auth_raw && account.auth_raw.refreshExpiresAt);
  if (rtExp) account.refreshExpiresAt = rtExp;
  else if (Number.isFinite(Number(data.refreshExpiresIn))) {
    account.refreshExpiresAt = nowMs() + Number(data.refreshExpiresIn) * 1000;
  }

  account.refreshedAt = nowMs();
  delete account.needs_relogin;
  delete account.needs_relogin_reason;
  store.upsertAccount(account);
  return account;
}

// 惰性刷新：expiresAt 缺失或剩余不足 lazyHours 则刷新。
async function ensureFreshToken(account, lazyHours = 24) {
  const exp = Number(account.expiresAt) || null;
  const stale = !exp || nowMs() >= exp || exp - nowMs() < lazyHours * 3600 * 1000;
  if (stale && getStr(account, 'refresh_token')) {
    return refreshToken(account);
  }
  return account;
}

// ---------- 签到 ----------

// 发签到请求；未授权且有 refresh token 时刷新一次并重试。
async function checkinRequest(pathName, account) {
  const url = `${ENDPOINT}${pathName}`;
  const headers = buildAuthHeaders(account);
  let resp = await httpRequest(url, { method: 'POST', body: {}, headers });
  if (isUnauthorized(resp) && getStr(account, 'refresh_token')) {
    const refreshed = await refreshToken({ ...account });
    resp = await httpRequest(url, {
      method: 'POST',
      body: {},
      headers: buildAuthHeaders(refreshed),
    });
    return { resp, refreshed };
  }
  return { resp, refreshed: account };
}

async function getCheckinStatus(account) {
  const { resp } = await checkinRequest(`${CHECKIN_PREFIX}/checkin-activity-status`, account);
  let code = Number(resp && resp.code) || -1;
  if (code === 0 || code === 200) {
    const data = resp.data || {};
    return {
      ok: true,
      todayCheckedIn: data.today_checked_in ?? data.todayCheckedIn ?? false,
    };
  }
  // 新接口失败回退旧接口
  const fallback = await checkinRequest(`${CHECKIN_PREFIX}/checkin-status`, account);
  code = Number(fallback.resp && fallback.resp.code) || -1;
  if (code === 0 || code === 200) {
    const data = fallback.resp.data || {};
    return {
      ok: true,
      todayCheckedIn: data.today_checked_in ?? data.todayCheckedIn ?? false,
    };
  }
  return {
    ok: false,
    error:
      (fallback.resp && (fallback.resp.message || fallback.resp.msg)) || `code=${code}`,
  };
}

async function performCheckin(account) {
  const { resp } = await checkinRequest(`${CHECKIN_PREFIX}/daily-checkin`, account);
  const code = Number(resp && resp.code) || -1;
  if (code === 0 || code === 200) return { ok: true };
  const msg = String((resp && (resp.message || resp.msg)) || `code=${code}`);
  if (msg.includes('已签到') || msg.toLowerCase().includes('repeat')) {
    return { ok: true, already: true, message: msg };
  }
  return { ok: false, error: msg };
}

// 单账号完整签到流程：惰性刷新 → 查状态 → 未签到才提交。
// 返回 { result: 'success' | 'already' | 'error', message?, raw? }
async function checkin(account) {
  const acc = await ensureFreshToken(account);
  const status = await getCheckinStatus(acc);
  if (!status.ok) {
    return { result: 'error', message: `查询签到状态失败: ${status.error}` };
  }
  if (status.todayCheckedIn) {
    return { result: 'already', message: '今日已签到（服务端确认）' };
  }
  const res = await performCheckin(acc);
  if (res.ok) {
    return {
      result: res.already ? 'already' : 'success',
      message: res.already ? res.message : '签到成功',
    };
  }
  return { result: 'error', message: res.error };
}

// ---------- 本机导入（从官方认证文件） ----------

function authFilePath() {
  if (process.platform === 'darwin') {
    return path.join(
      os.homedir(),
      'Library/Application Support/CodeBuddyExtension/Data/Public/auth/workbuddy-desktop.info',
    );
  }
  if (process.platform === 'win32') {
    return path.join(
      os.homedir(),
      'AppData/Local/CodeBuddyExtension/Data/Public/auth/workbuddy-desktop.info',
    );
  }
  return path.join(os.homedir(), '.local/share/CodeBuddyExtension/Data/Public/auth/workbuddy-desktop.info');
}

function parseTs(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}

// 从认证文件四段 JSON 中提取账号字段（对照上游 imported_account_from_root）
function accountFromAuthRoot(root) {
  if (!root || typeof root !== 'object') return null;
  const accountObj = root.account && typeof root.account === 'object' ? root.account : {};
  const authObj = root.auth && typeof root.auth === 'object' ? root.auth : {};

  const uid = getStr(root, 'uid') || getStr(accountObj, 'uid') || getStr(accountObj, 'id');
  const nickname =
    getStr(root, 'nickname') ||
    getStr(root, 'name') ||
    getStr(accountObj, 'nickname') ||
    getStr(accountObj, 'label');
  const email = getStr(root, 'email') || getStr(accountObj, 'email') || getStr(authObj, 'email');
  const access_token =
    getStr(authObj, 'accessToken') ||
    getStr(authObj, 'access_token') ||
    getStr(root, 'accessToken') ||
    getStr(root, 'access_token');
  if (!access_token) return null;
  const refresh_token =
    getStr(authObj, 'refreshToken') ||
    getStr(authObj, 'refresh_token') ||
    getStr(root, 'refreshToken') ||
    getStr(root, 'refresh_token');

  return {
    id: crypto.randomUUID(),
    provider: 'workbuddy',
    uid,
    nickname,
    email,
    enterpriseName:
      getStr(root, 'enterpriseName') ||
      getStr(root, 'enterprise_name') ||
      getStr(accountObj, 'enterpriseName') ||
      getStr(accountObj, 'enterprise_name'),
    enterpriseId:
      getStr(root, 'enterpriseId') ||
      getStr(root, 'enterprise_id') ||
      getStr(accountObj, 'enterpriseId') ||
      getStr(accountObj, 'enterprise_id'),
    access_token,
    refresh_token,
    domain: getStr(root, 'domain') || getStr(authObj, 'domain'),
    expiresAt: parseTs(root.expiresAt || authObj.expiresAt),
    refreshExpiresAt: parseTs(root.refreshExpiresAt || authObj.refreshExpiresAt),
    createdAt: nowMs(),
  };
}

async function importLocal() {
  const p = authFilePath();
  let root = null;
  try {
    root = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    throw new Error(`未读取到本机 WorkBuddy 登录信息（尝试路径: ${p}）`);
  }
  const account = accountFromAuthRoot(root);
  if (!account) throw new Error('认证文件中缺少 accessToken，无法导入');
  return store.upsertAccount(account);
}

module.exports = {
  id: 'workbuddy',
  name: 'WorkBuddy（腾讯 AI 编程助手）',
  siteUrl: 'https://www.codebuddy.cn',
  displayName,
  checkin,
  refreshToken,
  ensureFreshToken,
  importLocal,
  buildAuthHeaders,
};
