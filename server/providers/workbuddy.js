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
const credits = require('./workbuddy-credits');

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
  const code = respCode(resp);
  if (code === 401 || code === 403) return true;
  const msg = String((resp && (resp.message || resp.msg)) || '').toLowerCase();
  return ['unauthorized', '401', '登录', '失效', '过期', 'token'].some((k) =>
    msg.includes(k),
  );
}

// 官方业务码：0 表示成功。注意不能用 `Number(x) || -1`——0 是合法成功码会被误判。
function respCode(resp) {
  const n = Number(resp && resp.code);
  return Number.isFinite(n) ? n : -1;
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
  const code = respCode(resp);
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
  let code = respCode(resp);
  if (code === 0 || code === 200) {
    const data = resp.data || {};
    return {
      ok: true,
      todayCheckedIn: data.today_checked_in ?? data.todayCheckedIn ?? false,
    };
  }
  // 新接口失败回退旧接口
  const fallback = await checkinRequest(`${CHECKIN_PREFIX}/checkin-status`, account);
  code = respCode(fallback.resp);
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
  const code = respCode(resp);
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

// ---------- OAuth 扫码登录（移植自上游 oauth.rs，复刻官方 cockpit 流程） ----------

const OAUTH_TIMEOUT_SECONDS = 600;
const oauthStates = new Map(); // loginId -> { state, expiresAt, done, result, error }

// 与上游 save_collected_account 一致：按 uid（优先）/邮箱合并已有账号，保留原 id
function saveOAuthAccount(account) {
  const accounts = store.loadAccounts();
  const existing = accounts.find(
    (a) =>
      (account.uid && a.uid === account.uid) ||
      (account.email && a.email && account.email && a.email.toLowerCase() === account.email.toLowerCase()),
  );
  if (existing) {
    account.id = existing.id;
    account.createdAt = existing.createdAt;
  }
  return store.upsertAccount(account);
}

// 发起登录：向官方申请 state，返回 loginId / verificationUri / expiresIn
async function oauthStart() {
  const loginId = `wb_${crypto.randomBytes(16).toString('hex')}`;
  const resp = await httpRequest(`${ENDPOINT}${API_PREFIX}/auth/state?platform=workbuddy`, {
    method: 'POST',
    body: {},
  });
  const data = (resp && resp.data) || {};
  const state = getStr(data, 'state');
  if (!state) {
    throw new Error(`auth/state 响应缺少 state: ${JSON.stringify(resp).slice(0, 300)}`);
  }
  const authUrl =
    getStr(data, 'authUrl') ||
    getStr(data, 'auth_url') ||
    getStr(data, 'url') ||
    `${ENDPOINT}/login?state=${state}`;
  oauthStates.set(loginId, {
    state,
    expiresAt: Math.floor(Date.now() / 1000) + OAUTH_TIMEOUT_SECONDS,
    done: false,
    result: null,
    error: null,
  });
  return { loginId, verificationUri: authUrl, expiresIn: OAUTH_TIMEOUT_SECONDS };
}

// 轮询一次官方 token 接口；未完成返回 { done: false }，完成则账号入库并返回 { done: true, result }
async function oauthPoll(loginId) {
  const info = oauthStates.get(loginId);
  if (!info) return { done: true, error: '登录请求不存在' };
  if (info.done) return { done: true, result: info.result, error: info.error };
  if (Math.floor(Date.now() / 1000) > info.expiresAt) {
    info.done = true;
    info.error = '登录超时，请重新发起';
    return { done: true, error: info.error };
  }

  const url = `${ENDPOINT}${API_PREFIX}/auth/token?state=${info.state}`;
  const resp = await httpRequest(url, { method: 'GET' });
  // 记录原始响应便于排查（官方待扫码/已扫码/已完成返回不同 code）
  info.lastPoll = {
    at: new Date().toISOString(),
    httpCode: respCode(resp),
    keys: resp && typeof resp === 'object' ? Object.keys(resp) : [],
    snippet: JSON.stringify(resp).slice(0, 400),
  };
  const code = respCode(resp);
  if (code !== 0 && code !== 200) {
    return { done: false, debug: info.lastPoll };
  }

  const data = (resp && resp.data) || {};
  // 兼容字段可能在顶层或 data 内两种返回形态
  const pick = (...keys) => {
    for (const k of keys) {
      const v = getStr(data, k) || getStr(resp, k);
      if (v) return v;
    }
    return null;
  };
  const access_token = pick('accessToken', 'access_token');
  if (!access_token) {
    info.done = true;
    info.error = `登录响应缺少 accessToken: ${JSON.stringify(resp).slice(0, 300)}`;
    return { done: true, error: info.error };
  }

  // 拉取账号信息
  const profileHeaders = { Authorization: `Bearer ${access_token}` };
  const domain = getStr(data, 'domain') || '';
  if (domain) profileHeaders['X-Domain'] = domain;
  const accResp = await httpRequest(
    `${ENDPOINT}${API_PREFIX}/login/account?state=${info.state}`,
    { method: 'GET', headers: profileHeaders },
  );
  const accData = (accResp && accResp.data) || {};

  const expiresAt =
    normTs(data.expiresAt || data.expires_at) ||
    (Number.isFinite(Number(data.expiresIn)) ? nowMs() + Number(data.expiresIn) * 1000 : null);
  const refreshExpiresAt =
    normTs(data.refreshExpiresAt || data.refresh_expires_at) ||
    (Number.isFinite(Number(data.refreshExpiresIn))
      ? nowMs() + Number(data.refreshExpiresIn) * 1000
      : null);

  const account = {
    id: crypto.randomUUID(),
    provider: 'workbuddy',
    uid: getStr(accData, 'uid'),
    nickname: getStr(accData, 'nickname'),
    email: getStr(accData, 'email'),
    enterpriseName: getStr(accData, 'enterpriseName'),
    enterpriseId: getStr(accData, 'enterpriseId'),
    access_token,
    refresh_token:
      pick('refreshToken', 'refresh_token') ||
      getStr(accData, 'refreshToken') ||
      getStr(accData, 'refresh_token'),
    token_type: pick('tokenType', 'token_type') || 'Bearer',
    domain: domain || getStr(accData, 'domain'),
    expiresAt:
      normTs(data.expiresAt || data.expires_at || resp.expiresAt || resp.expires_at) ||
      (Number.isFinite(Number(data.expiresIn ?? resp.expiresIn))
        ? nowMs() + Number(data.expiresIn ?? resp.expiresIn) * 1000
        : null),
    refreshExpiresAt:
      normTs(
        data.refreshExpiresAt || data.refresh_expires_at || resp.refreshExpiresAt,
      ) ||
      (Number.isFinite(Number(data.refreshExpiresIn ?? resp.refreshExpiresIn))
        ? nowMs() + Number(data.refreshExpiresIn ?? resp.refreshExpiresIn) * 1000
        : null),
    createdAt: nowMs(),
  };

  const saved = saveOAuthAccount(account);
  info.done = true;
  info.result = store.accountMeta(saved);
  return { done: true, result: info.result };
}

// 诊断用：列出进行中的登录会话与最近一次官方响应
function oauthDebug() {
  return [...oauthStates.entries()].map(([id, info]) => ({
    loginId: id,
    done: info.done,
    expiresAt: info.expiresAt,
    lastPoll: info.lastPoll || null,
  }));
}

// 账号手动添加表单字段声明（前端按此渲染）
const manualFields = [
  {
    key: 'access_token',
    label: 'access_token（必填）',
    required: true,
    hint: '抓包 codebuddy.cn 请求头 Authorization Bearer 后面的值',
    placeholder: 'eyJhbGci...',
  },
  {
    key: 'refresh_token',
    label: 'refresh_token（建议填写）',
    required: false,
    hint: '用于 token 过期后自动续期，长期保活必备',
  },
  { key: 'email', label: '邮箱（选填，用于展示）', required: false },
  { key: 'uid', label: 'UID（选填）', required: false },
  { key: 'enterpriseId', label: 'enterpriseId（企业账号选填）', required: false },
  { key: 'domain', label: 'domain（选填）', required: false },
];

module.exports = {
  id: 'workbuddy',
  name: 'WorkBuddy（腾讯 AI 编程助手）',
  siteUrl: 'https://www.codebuddy.cn',
  displayName,
  checkin,
  refreshToken,
  ensureFreshToken,
  importLocal,
  oauthStart,
  oauthPoll,
  oauthDebug,
  getCredits: (account) => credits.getCredits(module.exports, account),
  manualFields,
  buildAuthHeaders,
};
