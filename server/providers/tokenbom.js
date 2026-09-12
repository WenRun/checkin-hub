// TokenBom（tokenbom.com 闲置 API 额度共享市场）签到 provider。
//
// 接口逆向自其前端包（base https://tokenbom.com/api）：
// - GET  /checkin/status            签到状态（enabled/todayCheckedIn/currentStreak/tomorrowReward/requiresCallToday）
// - POST /checkin                   签到 → creditsAwarded；失败码 checkin_requires_call 表示当天需先有一次成功 API 调用
// - POST /checkin/makeup {date}     补签（消耗补签卡）→ creditsAwarded
// - GET  /checkin/dates?year&month  签到日历
// - GET  /credits                   积分余额
// - POST /auth/refresh {refreshToken}  双 token 轮换（refresh token 一次性，必须立即落盘）
// - OpenAI 兼容网关: https://tokenbom.com/v1（虚拟 Key，sk-sub- 前缀）
//
// 请求头：Bearer accessToken + x-device-fingerprint（随机 UUID，持久化）+ x-env-signature（环境 JSON）。

const crypto = require('crypto');

const { httpRequest } = require('../util/http');
const store = require('../store');

const API_BASE = 'https://tokenbom.com/api';
const GATEWAY_BASE = 'https://tokenbom.com/v1';
const ERR_REQUIRES_CALL = 'checkin_requires_call';
// 自动调用兜底模型：最便宜档（0.015 积分/K tokens），max_tokens 限 1，成本可忽略
const DEFAULT_CALL_MODEL = 'glm-5.3-flash';

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

// 设备指纹：首次生成后持久化（官方前端同样是随机 UUID 存 localStorage）
function deviceId(account) {
  let id = getStr(account, 'device_id');
  if (!id) {
    id = crypto.randomUUID();
    account.device_id = id;
    store.upsertAccount(account);
  }
  return id;
}

function envSignature() {
  return JSON.stringify({
    timezone: 'Asia/Shanghai',
    language: 'zh-CN',
    platform: 'Win32',
    hardwareConcurrency: 8,
    maxTouchPoints: 0,
    colorDepth: 24,
    screenWidth: 1920,
    screenHeight: 1080,
    pixelRatio: 1,
  });
}

function buildAuthHeaders(account) {
  return {
    Authorization: `Bearer ${getStr(account, 'access_token') || ''}`,
    Accept: 'application/json',
    'x-device-fingerprint': deviceId(account),
    'x-env-signature': envSignature(),
  };
}

// 统一响应解包：官方有的接口包 {code,data}，有的直接返回对象
function unwrap(resp) {
  if (
    resp &&
    typeof resp === 'object' &&
    resp.data &&
    typeof resp.data === 'object' &&
    !Array.isArray(resp.data) &&
    (resp.code !== undefined || resp.data.enabled !== undefined || resp.data.balance !== undefined)
  ) {
    return resp.data;
  }
  return resp;
}

function isSuccess(resp) {
  if (!resp || typeof resp !== 'object') return false;
  if (resp.error) return false; // OpenAI 风格错误体 {error:{message}}
  if (resp.httpStatus && resp.httpStatus >= 400) return false;
  if (resp.ok === true || resp.success === true) return true;
  const code = resp.code;
  if (code === undefined || code === null) return true; // 无业务码且无错误标志
  return code === 0 || code === 200;
}

function isUnauthorized(resp) {
  const code = Number(resp && resp.httpStatus) || 0;
  if (code === 401 || code === 403) return true;
  const msg = String((resp && (resp.message || resp.msg || resp.error)) || '').toLowerCase();
  return ['unauthorized', '401', '登录', '失效', '过期', 'token'].some((k) => msg.includes(k));
}

function extractError(resp) {
  // 错误体可能是字符串，也可能是 OpenAI 风格的嵌套对象 {error:{message}}
  let e = resp && (resp.message || resp.msg || resp.error || resp.body);
  if (e && typeof e === 'object') e = e.message || e.msg || JSON.stringify(e);
  return e && String(e).trim()
    ? String(e).slice(0, 160)
    : `请求失败（HTTP ${(resp && resp.httpStatus) || '?'}）`;
}

// ---------- token 刷新（轮换制：响应中的双 token 必须立即落盘） ----------

// 账密登录：无需验证码（滑块/Turnstile 仅在多次失败后升级触发）
async function relogin(account) {
  const email = getStr(account, 'email');
  const password = getStr(account, 'password');
  if (!email || !password) {
    account.needs_relogin = true;
    account.needs_relogin_reason = '未配置邮箱/密码，无法自动重新登录';
    store.upsertAccount(account);
    return account;
  }
  const resp = await httpRequest(`${API_BASE}/auth/login`, {
    method: 'POST',
    body: { email, password },
  });
  const data = unwrap(resp);
  const newAccess = getStr(data, 'accessToken') || getStr(data, 'access_token');
  if (!isSuccess(resp) || !newAccess) {
    account.needs_relogin = true;
    if (resp.requireCaptcha || /验证码/.test(String(resp.error?.message || resp.message || resp.error || ''))) {
      // 触发滑块验证：自动通道关闭，需在账号管理里拖动滑块人工恢复一次
      account.needs_captcha = true;
      account.needs_relogin_reason = '登录触发滑块验证，请到账号管理点击「恢复登录」拖动滑块完成';
    } else {
      account.needs_relogin_reason = `自动重新登录失败: ${extractError(resp)}`;
    }
    store.upsertAccount(account);
    return account;
  }
  account.access_token = newAccess;
  const newRt = getStr(data, 'refreshToken') || getStr(data, 'refresh_token');
  if (newRt) account.refresh_token = newRt;
  const user = data.user && typeof data.user === 'object' ? data.user : null;
  if (user) {
    if (getStr(user, 'email')) account.email = getStr(user, 'email');
    if (getStr(user, 'nickname') || getStr(user, 'name')) {
      account.nickname = getStr(user, 'nickname') || getStr(user, 'name');
    }
  }
  account.refreshedAt = Date.now();
  delete account.needs_relogin;
  delete account.needs_relogin_reason;
  store.upsertAccount(account);
  return account;
}

async function refreshToken(account) {
  const rt = getStr(account, 'refresh_token');
  if (!rt) {
    if (!(getStr(account, 'email') && getStr(account, 'password'))) {
      account.needs_relogin = true;
      account.needs_relogin_reason = '缺少 refreshToken 且未配置邮箱/密码，无法恢复，需重新添加账号';
      store.upsertAccount(account);
      return account;
    }
    return relogin(account);
  }
  const resp = await httpRequest(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    body: { refreshToken: rt },
  });
  const data = unwrap(resp);
  const newAccess = getStr(data, 'accessToken') || getStr(data, 'access_token');
  if (!isSuccess(resp) || !newAccess) {
    // 轮换 token 已失效（如被浏览器轮换掉）：配置了账密则自动重登录兜底
    if (getStr(account, 'email') && getStr(account, 'password')) {
      return relogin(account);
    }
    account.needs_relogin = true;
    account.needs_relogin_reason = `刷新失败: ${extractError(resp)}`;
    store.upsertAccount(account);
    return account;
  }
  account.access_token = newAccess;
  const newRt = getStr(data, 'refreshToken') || getStr(data, 'refresh_token');
  if (newRt) account.refresh_token = newRt;
  account.refreshedAt = Date.now();
  delete account.needs_relogin;
  delete account.needs_relogin_reason;
  store.upsertAccount(account);
  return account;
}

// 带鉴权请求：401 时先刷新 token，失败且配置了账密则自动重登录，各自重试一次。
// 已标记 needs_relogin 的账号不再自动尝试，避免反复失败触发更严风控；走滑块人工恢复。
async function authedRequest(account, pathName, { method = 'GET', body } = {}) {
  let acc = account;
  let resp = await httpRequest(`${API_BASE}${pathName}`, {
    method,
    body,
    headers: buildAuthHeaders(acc),
  });
  resp.httpStatus = Number(resp && resp.httpStatus) || (isSuccess(resp) ? 200 : 0);
  const canRecover =
    !acc.needs_relogin &&
    (!!getStr(acc, 'refresh_token') ||
      (!!getStr(acc, 'email') && !!getStr(acc, 'password')));
  if (isUnauthorized(resp) && canRecover) {
    acc = await refreshToken({ ...acc });
    resp = await httpRequest(`${API_BASE}${pathName}`, {
      method,
      body,
      headers: buildAuthHeaders(acc),
    });
    resp.httpStatus = Number(resp && resp.httpStatus) || (isSuccess(resp) ? 200 : 0);
  }
  return { resp, account: acc };
}

// ---------- 滑块验证人工恢复 ----------
// 登录触发滑块验证时，前端渲染滑块（数据来自 captchaStart），用户拖动后提交。

// 获取滑块验证码数据（绑定期望的请求指纹）
async function captchaStart(account) {
  const resp = await httpRequest(`${API_BASE}/auth/captcha?fallback=slider`, {
    headers: buildAuthHeaders(account),
  });
  if (resp.kind !== 'slider' || !resp.captchaId) {
    // 默认是 Turnstile（需要浏览器环境），只有 fallback 滑块可在我们网页里渲染
    return { ok: false, error: '验证码类型不支持（turnstile），请稍后重试' };
  }
  return {
    ok: true,
    payload: {
      captchaId: resp.captchaId,
      bgSvg: resp.bgSvg,
      pieceSvg: resp.pieceSvg,
      pieceY: resp.pieceY,
      panelWidth: resp.panelWidth,
      panelHeight: resp.panelHeight,
      pieceWidth: resp.pieceWidth,
      expiresIn: resp.expiresIn,
    },
  };
}

// 带滑块验证码重新登录：captcha 由前端滑块组件产生
async function reloginWithCaptcha(account, { captchaId, captchaX, captchaElapsedMs } = {}) {
  const email = getStr(account, 'email');
  const password = getStr(account, 'password');
  if (!email || !password) return { ok: false, error: '未配置邮箱/密码' };
  if (!captchaId || captchaX === undefined) return { ok: false, error: '缺少滑块验证数据' };
  const resp = await httpRequest(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: buildAuthHeaders(account),
    body: {
      email,
      password,
      captchaId,
      captchaX,
      captchaElapsedMs: captchaElapsedMs || 1500,
    },
  });
  const data = unwrap(resp);
  const newAccess = getStr(data, 'accessToken') || getStr(data, 'access_token');
  if (!isSuccess(resp) || !newAccess) {
    return { ok: false, error: extractError(resp) };
  }
  account.access_token = newAccess;
  const newRt = getStr(data, 'refreshToken') || getStr(data, 'refresh_token');
  if (newRt) account.refresh_token = newRt;
  const user = data.user && typeof data.user === 'object' ? data.user : null;
  if (user) {
    if (getStr(user, 'email')) account.email = getStr(user, 'email');
    if (getStr(user, 'nickname') || getStr(user, 'name')) {
      account.nickname = getStr(user, 'nickname') || getStr(user, 'name');
    }
  }
  account.refreshedAt = Date.now();
  delete account.needs_relogin;
  delete account.needs_captcha;
  delete account.needs_relogin_reason;
  store.upsertAccount(account);
  return { ok: true };
}

// ---------- 自动调用（满足 requiresCall） ----------

// 用账号的虚拟 Key 走 OpenAI 兼容网关发一次最小调用；成功即满足当天调用条件
async function makeGatewayCall(account, callModel) {
  const key = getStr(account, 'virtual_key');
  if (!key) return { ok: false, error: '账号未配置虚拟 Key，无法自动调用' };
  const resp = await httpRequest(`${GATEWAY_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: {
      model: callModel || DEFAULT_CALL_MODEL,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1,
      stream: false,
    },
    timeoutMs: 30000,
  });
  const ok =
    resp &&
    typeof resp === 'object' &&
    (resp.httpStatus === 200 ||
      (resp.choices && Array.isArray(resp.choices)) ||
      (resp.id && resp.object === 'chat.completion'));
  if (ok) return { ok: true };
  return { ok: false, error: `网关调用失败: ${extractError(resp)}` };
}

// ---------- 自动补签 ----------

function extractMakeupDates(calendar, today) {
  // 日历结构未完全确认，做宽容解析：收集"未签到且可补签"的历史日期
  const dates = [];
  const push = (v) => {
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && v < today.slice(0, 10)) {
      dates.push(v);
    }
  };
  const walk = (node) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const checked = node.checkedIn ?? node.checked_in ?? node.todayCheckedIn;
    const eligible = node.canMakeup ?? node.can_makeup ?? node.makeupEligible;
    const date = node.date || node.day || node.dateStr;
    if (date && checked === false && (eligible === undefined || eligible === true)) {
      push(typeof date === 'string' ? date : null);
      return;
    }
    Object.values(node).forEach(walk);
  };
  walk(calendar);
  return dates;
}

async function runAutoMakeup(account, makeupCards) {
  const now = new Date();
  const out = [];
  if (makeupCards != null && makeupCards <= 0) return out;
  let cardsLeft = makeupCards == null ? Infinity : makeupCards;
  for (const month of [now, new Date(now.getFullYear(), now.getMonth() - 1, 1)]) {
    if (cardsLeft <= 0) break;
    const year = month.getFullYear();
    const m = month.getMonth() + 1;
    const { resp } = await authedRequest(
      account,
      `/checkin/dates?year=${year}&month=${m}`,
    );
    if (!isSuccess(resp)) continue;
    const dates = extractMakeupDates(unwrap(resp), now.toISOString());
    for (const date of dates) {
      if (cardsLeft <= 0) break;
      const { resp: mk } = await authedRequest(account, '/checkin/makeup', {
        method: 'POST',
        body: { date },
      });
      if (isSuccess(mk)) {
        const data = unwrap(mk) || {};
        const awarded = Number(data.creditsAwarded ?? resp.creditsAwarded ?? 0);
        out.push(`${date.slice(5)} 补签${awarded ? ` +${awarded} 积分` : ''}`);
        if (makeupCards != null) cardsLeft--;
      }
    }
  }
  return out;
}

// ---------- 签到主流程 ----------

// options: { autoCall: boolean, autoMakeup: boolean, callModel: string }
async function checkin(account, options = {}) {
  const autoCall = options.autoCall !== false;
  const autoMakeup = options.autoMakeup !== false;
  const callModel = options.callModel || DEFAULT_CALL_MODEL;

  const { resp: statusResp } = await authedRequest(account, '/checkin/status');
  if (isUnauthorized(statusResp)) {
    return {
      result: 'error',
      message:
        `查询签到状态失败（token 失效）: ${extractError(statusResp)}` +
        (account.needs_relogin ? '；请到「账号管理」点击「恢复登录」' : ''),
    };
  }
  const status = unwrap(statusResp) || {};
  if (status.enabled === false) {
    return { result: 'skipped', message: '签到功能未启用' };
  }
  if (status.todayCheckedIn === true) {
    return {
      result: 'already',
      message: `今日已签到${status.currentStreak ? `（连签 ${status.currentStreak} 天）` : ''}`,
    };
  }

  let extra = '';
  if (status.requiresCallToday === true && autoCall) {
    const call = await makeGatewayCall(account, callModel);
    if (!call.ok) {
      return {
        result: 'skipped',
        message: `今日需先完成一次 API 调用后才能签到；自动调用未成功（${call.error}）`,
      };
    }
    extra = '（已自动完成前置调用）';
  } else if (status.requiresCallToday === true) {
    return { result: 'skipped', message: '今日需先完成一次 API 调用后才能签到（未启用自动调用）' };
  }

  const { resp: checkResp } = await authedRequest(account, '/checkin', { method: 'POST' });
  if (isSuccess(checkResp)) {
    const data = unwrap(checkResp) || {};
    const awarded = Number(data.creditsAwarded ?? 0);
    let message = `签到成功${awarded ? ` +${awarded} 积分` : ''}${extra}`;
    if (autoMakeup) {
      try {
        const makeupCards =
          status.makeupCards ?? status.makeup_cards ?? (status.makeup && status.makeup.cards);
        const makeup = await runAutoMakeup(account, makeupCards);
        if (makeup.length) message += `；${makeup.join('，')}`;
      } catch {
        /* 补签失败不影响主签到结果 */
      }
    }
    return { result: 'success', message };
  }

  // 签到接口报错：区分 requires_call（可能是状态查询后才变化）与其他错误
  const bodyCode = (checkResp && (checkResp.code || checkResp.error)) || '';
  if (bodyCode === ERR_REQUIRES_CALL) {
    return { result: 'skipped', message: '今日需先完成一次 API 调用后才能签到' };
  }
  const msg = extractError(checkResp);
  if (msg.includes('已签到')) {
    return { result: 'already', message: '今日已签到（服务端确认）' };
  }
  return { result: 'error', message: msg };
}

// ---------- 积分余额 ----------

// 余额 + 签到状态（连签/明日奖励/补签卡），反映 TokenBom "签到赚分、调用耗分" 的模型
async function getCredits(account) {
  const base = {
    accountId: account.id ?? null,
    accountName: displayName(account),
    provider: account.provider ?? 'tokenbom',
    updatedAt: Date.now(),
    kind: 'balance',
    resources: [],
  };
  const [creditsRes, statusRes] = await Promise.all([
    authedRequest(account, '/credits'),
    authedRequest(account, '/checkin/status'),
  ]);
  const { resp } = creditsRes;
  if (!isSuccess(resp)) {
    return { ...base, ok: false, error: extractError(resp) };
  }
  const data = unwrap(resp) || {};
  const balance = Number(data.balance ?? data.credits ?? data.remaining ?? resp.balance ?? 0);
  const status = isSuccess(statusRes.resp) ? unwrap(statusRes.resp) || {} : {};
  const streak = Number(status.currentStreak ?? status.current_streak) || null;
  return {
    ...base,
    ok: true,
    kind: 'balance',
    balance: Math.round(balance * 100) / 100,
    totalRemaining: Math.round(balance * 100) / 100,
    streak,
    todayCheckedIn: status.todayCheckedIn === true,
    tomorrowReward: status.tomorrowReward ?? status.tomorrow_reward ?? null,
    requiresCallToday: status.requiresCallToday === true,
    makeupCards: Number(status.makeupCards ?? status.makeup_cards ?? 0) || 0,
  };
}

// 账号手动添加表单字段声明（前端按此渲染）
const manualFields = [
  {
    key: 'access_token',
    label: 'accessToken（必填）',
    required: true,
    hint: '浏览器登录 tokenbom.com 后 F12 → Application → Local Storage 复制 accessToken',
    placeholder: 'eyJhbGci...',
  },
  {
    key: 'refresh_token',
    label: 'refreshToken（建议填写）',
    required: false,
    hint: '同位置复制 refreshToken。轮换制失效后若已配置邮箱/密码会自动重新登录',
    placeholder: '',
  },
  {
    key: 'email',
    label: '邮箱（同时用于自动重新登录）',
    required: false,
    hint: '配置邮箱+密码后，token 失效时系统会用账密自动重新登录恢复',
    placeholder: 'you@example.com',
  },
  {
    key: 'password',
    label: '密码（用于自动重新登录）',
    required: false,
    hint: '明文保存在本地 data 目录（私有部署可接受）。谷歌注册的账号需先在平台设置中设置密码',
    placeholder: '',
  },
  {
    key: 'virtual_key',
    label: '虚拟 Key（自动调用用）',
    required: false,
    hint: 'sk-sub- 开头，平台「虚拟 Key」页创建。签到日要求先调用 API 时自动使用',
    placeholder: 'sk-sub-...',
  },
];

module.exports = {
  id: 'tokenbom',
  name: 'TokenBom（积分市场）',
  siteUrl: 'https://tokenbom.com',
  displayName,
  checkin,
  refreshToken,
  reloginWithCaptcha,
  captchaStart,
  getCredits,
  creditsHint: 'TokenBom 为单一积分余额：每日签到赚积分，调用模型消耗。卡片展示余额、连签天数与今日签到状态',
  manualFields,
  buildAuthHeaders,
};
