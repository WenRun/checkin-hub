// WorkBuddy 积分资源查询（移植自上游 credits.rs）。
//
// WorkBuddy 套餐页使用 summary/paid/free 三个资源接口；旧的
// POST /v2/billing/meter/get-user-resource 仍作为兼容回退。
// 只返回脱敏后的资源摘要，不把 token 或完整响应交给前端。

const { httpRequest } = require('../util/http');
const store = require('../store');

const USER_RESOURCE_PATH = '/v2/billing/meter/get-user-resource';
const WORKBUDDY_WEB_ENDPOINT = 'https://www.workbuddy.cn';
const WORKBUDDY_API_ENDPOINT = 'https://www.codebuddy.cn';
const RESOURCE_SUMMARY_PATH = '/billing/meter/get-user-resource-summary';
const RESOURCE_PAID_PACKAGES_PATH = '/billing/meter/get-user-resource-paid-packages';
const RESOURCE_FREE_PACKAGES_PATH = '/billing/meter/get-user-resource-free-packages';
const PRODUCT_CODE = 'p_tcaca';
const EXPIRING_SOON_DAYS = 7;

// WorkBuddy CN UserCenter 的商品码（来自其公开套餐配置）。上游新增商品时
// 仍可通过 summary/明细返回资源，解析器不依赖这些常量。
const PAID_PACKAGE_CODES = [
  'TCACA_code_002_AkiJS3ZHF5',
  'TCACA_code_023_4xbGhMrE6q',
  'TCACA_code_026_BaESVICNoi',
  'TCACA_code_027_0FCGVA6vSa',
  'TCACA_code_009_0XmEQc2xOf',
  'TCACA_code_038_OhvqZtiPKr',
];
const FREE_PACKAGE_CODES = [
  'TCACA_code_008_cfWoLwvjU4',
  'TCACA_code_007_nzdH5h4Nl0',
  'TCACA_code_028_NtpWi0jzXs',
  'TCACA_code_029_6wCGEWquYy',
  'TCACA_code_030_BjSt89qTvr',
];

// ---------- 通用解析工具 ----------

function firstValue(raw, keys) {
  for (const k of keys) {
    if (raw && raw[k] !== undefined && raw[k] !== null) return raw[k];
  }
  return undefined;
}

function parseNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v.trim()))) {
    return Number(v.trim());
  }
  return null;
}

function firstNumber(raw, keys) {
  for (const k of keys) {
    const n = parseNumber(raw ? raw[k] : undefined);
    if (n !== null) return n;
  }
  return null;
}

function parseTimestampMs(v) {
  if (v === undefined || v === null) return null;
  const n = parseNumber(v);
  if (n !== null) return Math.round(Math.abs(n) < 1e10 ? n * 1000 : n);
  if (typeof v !== 'string' || !v.trim()) return null;
  const text = v.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?/.exec(text);
  if (m) {
    // 无时区标记按本地时区
    return new Date(
      +m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6],
    ).getTime();
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59).getTime();
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

const ACCOUNT_PATHS = [
  ['data', 'Accounts'],
  ['data', 'data', 'Accounts'],
  ['data', 'Response', 'Data', 'Accounts'],
  ['data', 'data', 'Response', 'Data', 'Accounts'],
  ['data', 'accounts'],
  ['data', 'data', 'accounts'],
];
const PACKAGE_PATHS = [
  ['data', 'Packages'],
  ['data', 'data', 'Packages'],
  ['data', 'Response', 'Data', 'Packages'],
  ['data', 'data', 'Response', 'Data', 'Packages'],
  ['data', 'packages'],
  ['data', 'data', 'packages'],
];

function valueAtPath(resp, path) {
  let cur = resp;
  for (const k of path) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}

function resourceAccounts(resp) {
  for (const p of ACCOUNT_PATHS) {
    const v = valueAtPath(resp, p);
    if (Array.isArray(v)) return v;
  }
  return [];
}

function resourcePackages(resp) {
  for (const p of PACKAGE_PATHS) {
    const v = valueAtPath(resp, p);
    if (Array.isArray(v)) return v;
  }
  return [];
}

function hasResourceAccounts(resp) {
  return ACCOUNT_PATHS.some((p) => Array.isArray(valueAtPath(resp, p)));
}

function hasResourcePackages(resp) {
  return PACKAGE_PATHS.some((p) => Array.isArray(valueAtPath(resp, p)));
}

// ---------- 单个资源包的标准化 ----------

function resourceSummary(raw, now) {
  const slice =
    firstValue(raw, ['SlicePeriodUsageDetails', 'slicePeriodUsageDetails'])?.[0] || {};
  const totalKeys = [
    'CycleCapacitySizePrecise', 'CycleCapacitySize', 'CycleTotalCapacity',
    'CapacitySizePrecise', 'CapacitySize',
    'SlicePeriodCapacitySizePrecise', 'SlicePeriodCapacitySize',
  ];
  const remainingKeys = [
    'CycleCapacityRemainPrecise', 'CycleCapacityRemain', 'CycleRemainCapacity',
    'CapacityRemainPrecise', 'CapacityRemain',
    'SlicePeriodCapacityRemainPrecise', 'SlicePeriodCapacityRemain',
  ];
  const usedKeys = [
    'CycleCapacityUsedPrecise', 'CycleCapacityUsed', 'CycleUsedCapacity',
    'CapacityUsedPrecise', 'CapacityUsed',
    'SlicePeriodCapacityUsedPrecise', 'SlicePeriodCapacityUsed',
  ];
  const rawTotal = firstNumber(raw, totalKeys) ?? firstNumber(slice, totalKeys);
  const rawRemaining = firstNumber(raw, remainingKeys) ?? firstNumber(slice, remainingKeys);
  const rawUsed = firstNumber(raw, usedKeys) ?? firstNumber(slice, usedKeys);
  const total = Math.max(
    0,
    rawTotal ??
      (rawRemaining !== null && rawUsed !== null ? rawRemaining + rawUsed : null) ??
      rawRemaining ??
      rawUsed ??
      0,
  );
  const remaining = Math.max(
    0,
    rawRemaining ?? Math.max(0, total - (rawUsed ?? 0)),
  );
  const used = Math.max(0, rawUsed ?? Math.max(0, total - remaining));
  const expireAt = parseTimestampMs(
    firstValue(raw, [
      'DeductionEndTime', 'deductionEndTime',
      'ExpiredTime', 'expiredTime',
      'CycleEndTime', 'cycleEndTime',
    ]),
  );
  const expired = expireAt != null ? expireAt <= now : false;
  const expiringSoon =
    expireAt != null ? expireAt > now && expireAt - now <= EXPIRING_SOON_DAYS * 86400000 : false;
  const status = parseNumber(firstValue(raw, ['Status', 'status']));

  return {
    packageCode: firstValue(raw, ['PackageCode', 'packageCode']) ?? null,
    packageName: firstValue(raw, ['PackageName', 'packageName']) ?? null,
    total,
    remaining,
    used,
    status: status != null ? Math.round(status) : null,
    expireAt,
    expired,
    expiringSoon,
  };
}

// ---------- 响应状态判断 ----------

function parseCodeValue(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v.trim()))) {
    return Number(v.trim());
  }
  return null;
}

function responseCode(resp) {
  if (!resp || typeof resp !== 'object') return null;
  let c = parseCodeValue(resp.code);
  if (c != null) return c;
  if (resp.data && typeof resp.data === 'object') {
    c = parseCodeValue(resp.data.code);
    if (c != null) return c;
  }
  return null;
}

function isSuccess(resp) {
  if (!resp || typeof resp !== 'object') return false;
  const code = responseCode(resp);
  if (code != null) return code === 0 || code === 200;
  return resp.data !== undefined && resp.ok !== false && resp.success !== false;
}

function isUnauthorized(resp) {
  const code = responseCode(resp) ?? -1;
  // 网关 WAF 10085 是客户端指纹拦截，不是 token 过期；刷新无效。
  if (code === 10085) return false;
  if (code === 401 || code === 403) return true;
  const msg = String(
    resp?.message || resp?.msg || resp?.data?.message || resp?.data?.msg || '',
  ).toLowerCase();
  return ['unauthorized', '401', '登录', '失效', '过期', 'token'].some((k) =>
    msg.includes(k),
  );
}

function isTransportError(resp) {
  return (
    responseCode(resp) === -1 &&
    typeof resp?.message === 'string' &&
    resp.message.trim() !== ''
  );
}

function responseError(resp) {
  const nested = resp?.data && typeof resp.data === 'object' ? resp.data : {};
  const code = responseCode(resp) ?? -1;
  const msg = [resp?.message, resp?.msg, nested.message, nested.msg]
    .find((m) => typeof m === 'string' && m.trim());
  return msg
    ? msg.slice(0, 160)
    : `积分查询失败（code=${code}）`;
}

// ---------- 请求链路 ----------

function requestOrigin(url) {
  return url.startsWith(WORKBUDDY_WEB_ENDPOINT) ? WORKBUDDY_WEB_ENDPOINT : WORKBUDDY_API_ENDPOINT;
}

function resourceAuthHeaders(provider, account, url) {
  const origin = requestOrigin(url);
  const headers = provider.buildAuthHeaders(account);
  // WorkBuddy 用户中心 Axios 拦截器始终携带这些头，缺失会被网关当成未知客户端
  headers['X-Client-Platform'] = 'web';
  headers.Accept = 'application/json, text/plain, */*';
  headers.Referer = `${origin}/profile/plans-usage`;
  return headers;
}

async function postWithAccount(provider, account, url, body) {
  const headers = resourceAuthHeaders(provider, account, url);
  let resp = await httpRequest(url, { method: 'POST', body, headers });
  if (isTransportError(resp)) {
    resp = await httpRequest(url, { method: 'POST', body, headers });
  }
  return resp;
}

// 仅在两个已知官方 origin 间选择，不允许账号数据拼出任意主机
function newResourceEndpoint(account) {
  const d = String(account?.domain || '').trim().toLowerCase();
  return d === 'workbuddy.cn' || d === 'www.workbuddy.cn'
    ? WORKBUDDY_WEB_ENDPOINT
    : WORKBUDDY_API_ENDPOINT;
}

function paidPackagesBody() {
  return {
    PageNumber: 1,
    PageSize: 200,
    Status: [0, 3],
    PackageCodes: PAID_PACKAGE_CODES,
    NeedRenewInfo: true,
  };
}

function freePackagesBody() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return {
    PageNumber: 1,
    PageSize: 200,
    Status: [0, 3],
    SlicePeriodStartTime: `${day} 00:00:00`,
    SlicePeriodEndTime: `${day} 23:59:59`,
    PackageCodes: FREE_PACKAGE_CODES,
  };
}

async function retryIfUnauthorized(provider, account, resp, url, body) {
  return isUnauthorized(resp) ? postWithAccount(provider, account, url, body) : resp;
}

// 统一惰性刷新后并行请求三类资源接口；任一路未授权只刷新一次并重试该路
async function fetchNewResourceResponses(provider, account) {
  const working = await provider.ensureFreshToken({ ...account });
  const summaryUrl = `${newResourceEndpoint(working)}${RESOURCE_SUMMARY_PATH}`;
  const paidUrl = `${newResourceEndpoint(working)}${RESOURCE_PAID_PACKAGES_PATH}`;
  const freeUrl = `${newResourceEndpoint(working)}${RESOURCE_FREE_PACKAGES_PATH}`;
  const summaryBody = {};
  const paidBody = paidPackagesBody();
  const freeBody = freePackagesBody();
  let [summary, paid, free] = await Promise.all([
    postWithAccount(provider, working, summaryUrl, summaryBody),
    postWithAccount(provider, working, paidUrl, paidBody),
    postWithAccount(provider, working, freeUrl, freeBody),
  ]);

  const needRefresh =
    [summary, paid, free].some(isUnauthorized) && !!String(working.refresh_token || '').trim();
  if (!needRefresh) {
    return { account: working, summary, paid, free, refreshAttempted: false };
  }
  const refreshed = await provider.refreshToken(working);
  [summary, paid, free] = await Promise.all([
    retryIfUnauthorized(provider, refreshed, summary, summaryUrl, summaryBody),
    retryIfUnauthorized(provider, refreshed, paid, paidUrl, paidBody),
    retryIfUnauthorized(provider, refreshed, free, freeUrl, freeBody),
  ]);
  return { account: refreshed, summary, paid, free, refreshAttempted: true };
}

async function fetchLegacyUserResource(provider, account) {
  const fmt = (d) => {
    const pad = (n) => String(n).padStart(2, '0');
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    );
  };
  const now = new Date();
  const end = new Date(now.getTime() + 365 * 101 * 86400000);
  return postWithAccount(provider, account, `${WORKBUDDY_API_ENDPOINT}${USER_RESOURCE_PATH}`, {
    PageNumber: 1,
    PageSize: 100,
    ProductCode: PRODUCT_CODE,
    Status: [0, 3],
    PackageEndTimeRangeBegin: fmt(now),
    PackageEndTimeRangeEnd: fmt(end),
  });
}

// ---------- 汇总 ----------

function mergeResources(summaryResources, detailResources) {
  const detailCodes = new Set(
    detailResources
      .map((r) => r.packageCode)
      .filter((c) => typeof c === 'string' && c),
  );
  return [
    ...detailResources,
    ...summaryResources.filter(
      (r) => !(typeof r.packageCode === 'string' && detailCodes.has(r.packageCode)),
    ),
  ];
}

function normalizedNewResources(summaryResp, paidResp, freeResp, now) {
  const summaryOk = isSuccess(summaryResp) && hasResourcePackages(summaryResp);
  const paidOk = isSuccess(paidResp) && hasResourceAccounts(paidResp);
  const freeOk = isSuccess(freeResp) && hasResourceAccounts(freeResp);
  if (!(summaryOk || paidOk || freeOk)) return null;
  const summaryResources = summaryOk
    ? resourcePackages(summaryResp).map((r) => resourceSummary(r, now))
    : [];
  const detailResources = [];
  if (paidOk) detailResources.push(...resourceAccounts(paidResp).map((r) => resourceSummary(r, now)));
  if (freeOk) detailResources.push(...resourceAccounts(freeResp).map((r) => resourceSummary(r, now)));
  return mergeResources(summaryResources, detailResources);
}

function creditResult(provider, account, resources, now) {
  const num = (r) => (typeof r.remaining === 'number' ? r.remaining : 0);
  const totalRemaining = resources.reduce((s, r) => s + num(r), 0);
  const totalCapacity = resources.reduce(
    (s, r) => s + (typeof r.total === 'number' ? r.total : 0),
    0,
  );
  const soonestExpireAt = Math.min(
    ...resources.filter((r) => num(r) > 0 && r.expireAt != null).map((r) => r.expireAt),
  );
  const expiringSoonRemaining = resources
    .filter((r) => r.expiringSoon)
    .reduce((s, r) => s + num(r), 0);
  const expiredRemaining = resources
    .filter((r) => r.expired)
    .reduce((s, r) => s + num(r), 0);

  return {
    ok: true,
    accountId: account.id ?? null,
    accountName: provider.displayName(account),
    updatedAt: now,
    totalCapacity,
    totalRemaining: Math.round(totalRemaining * 100) / 100,
    expiringSoonRemaining: Math.round(expiringSoonRemaining * 100) / 100,
    expiredRemaining: Math.round(expiredRemaining * 100) / 100,
    soonestExpireAt: Number.isFinite(soonestExpireAt) ? soonestExpireAt : null,
    expiringSoon: resources.some((r) => r.expiringSoon && num(r) > 0),
    expired: resources.some((r) => r.expired && num(r) > 0),
    resources,
  };
}

// 查询单账号的积分资源及到期时间
async function getCredits(provider, account) {
  const now = Date.now();
  try {
    const responses = await fetchNewResourceResponses(provider, account);
    let resources = normalizedNewResources(responses.summary, responses.paid, responses.free, now);
    if (resources) return creditResult(provider, account, resources, now);

    // 新接口都不认可时回退旧接口；复用已刷新过的账号，避免重复刷新
    let resp = await fetchLegacyUserResource(provider, responses.account);
    if (
      isUnauthorized(resp) &&
      !responses.refreshAttempted &&
      String(account.refresh_token || '').trim()
    ) {
      const refreshed = await provider.refreshToken({ ...responses.account });
      resp = await fetchLegacyUserResource(provider, refreshed);
    }
    if (isSuccess(resp) && hasResourceAccounts(resp)) {
      resources = resourceAccounts(resp).map((r) => resourceSummary(r, now));
      return creditResult(provider, account, resources, now);
    }
    return {
      ok: false,
      accountId: account.id ?? null,
      accountName: provider.displayName(account),
      error: responseError(resp),
    };
  } catch (e) {
    return {
      ok: false,
      accountId: account.id ?? null,
      accountName: provider.displayName(account),
      error: e.message,
    };
  }
}

module.exports = { getCredits };
