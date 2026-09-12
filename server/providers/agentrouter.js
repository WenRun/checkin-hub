// AgentRouter（agentrouter.org，基于开源 New API 搭建的 LLM 中转站）签到 provider。
//
// 机制：管理端配置了 DailyCheckinQuota（每日签到赠送额度），**每次登录自动发放**，
// 登录响应带 checked_in 标志（true = 本次登录发了奖励）。因此签到动作 = 每天登录一次。
//
// 网络特殊性：该域名被 DNS 污染（系统 DNS 返回假 IP）且 CDN 拦截非浏览器 TLS 指纹，
// 直连不可用。走本机 Clash 代理的 CONNECT 隧道（浏览器同款路径）即可正常访问。
// 代理地址自动从 Windows 注册表读取（系统代理），可用环境变量 AGENTROUTER_PROXY 覆盖。
//
// 鉴权：登录后下发 session cookie（HttpOnly，约 30 天），API 凭 Cookie 访问。
// 账密登录接口无验证码（Turnstile 关闭），cookie 过期后自动重新登录即可，无轮换负担。

const net = require('net');
const tls = require('tls');
const { execSync } = require('child_process');

const store = require('../store');

const API_HOST = 'agentrouter.org';
const API_BASE = 'https://agentrouter.org/api';
const DEFAULT_PROXY = '127.0.0.1:2080';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ---------- 代理探测 ----------
// 优先级：设置页配置的代理 > 环境变量 AGENTROUTER_PROXY > Windows 系统代理（自动探测）> 直连

let cachedRegistryProxy;

function detectProxy() {
  const settings = store.loadSettings();
  if (settings.proxyUrl) return settings.proxyUrl;
  if (process.env.AGENTROUTER_PROXY !== undefined) {
    return process.env.AGENTROUTER_PROXY || null;
  }
  if (cachedRegistryProxy === undefined) {
    try {
      const out = execSync(
        'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"',
        { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      const enabled = /ProxyEnable\s+REG_DWORD\s+0x1/.test(out);
      const server = /ProxyServer\s+REG_SZ\s+([^\r\n]+)/.exec(out);
      cachedRegistryProxy = enabled && server ? server[1].trim() : null;
    } catch {
      cachedRegistryProxy = null; // 非 Windows 或读取失败：直连
    }
  }
  return cachedRegistryProxy;
}

function proxyTarget(proxy) {
  try {
    const u = new URL(proxy.includes('://') ? proxy : `http://${proxy}`);
    return { host: u.hostname, port: Number(u.port) || 80 };
  } catch {
    return null;
  }
}

// ---------- 极简 HTTP 客户端（CONNECT 隧道 + TLS + 手写 HTTP/1.1） ----------

function decodeChunked(buf) {
  const out = [];
  let pos = 0;
  while (pos < buf.length) {
    const lineEnd = buf.indexOf('\r\n', pos);
    if (lineEnd === -1) break;
    const size = parseInt(buf.slice(pos, lineEnd).toString('latin1').split(';')[0], 16);
    if (!size) break;
    out.push(buf.slice(lineEnd + 2, lineEnd + 2 + size));
    pos = lineEnd + 2 + size + 2;
  }
  return Buffer.concat(out);
}

function parseHttpResponse(buf) {
  const idx = buf.indexOf('\r\n\r\n');
  if (idx === -1) throw new Error('HTTP 响应解析失败');
  const head = buf.slice(0, idx).toString('latin1');
  const lines = head.split('\r\n');
  const httpStatus = Number(lines[0].split(' ')[1]) || 0;
  const headers = {};
  const setCookie = [];
  for (let i = 1; i < lines.length; i++) {
    const sep = lines[i].indexOf(':');
    if (sep === -1) continue;
    const key = lines[i].slice(0, sep).trim().toLowerCase();
    const value = lines[i].slice(sep + 1).trim();
    if (key === 'set-cookie') setCookie.push(value);
    else headers[key] = value;
  }
  let bodyBuf = buf.slice(idx + 4);
  if (/chunked/i.test(headers['transfer-encoding'] || '')) {
    bodyBuf = decodeChunked(bodyBuf);
  }
  const text = bodyBuf.toString('utf8');
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { httpStatus, headers, setCookie, text, json };
}

// 走本机代理隧道发起 HTTPS 请求；代理节点可能不稳定，自动重试并在代理/直连间切换
function tunneledRequest(pathName, { method = 'GET', headers = {}, body, timeoutMs = 25000 } = {}) {
  const proxy = detectProxy();
  const target = proxy ? proxyTarget(proxy) : null;
  const bodyStr =
    body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);

  const viaTunnel = () =>
    new Promise((resolve, reject) => {
      if (!target) return reject(new Error('代理地址无效'));
      const socket = net.connect({ host: target.host, port: target.port });
      socket.setTimeout(timeoutMs);
      let stage = 'connecting';
      let tlsSock = null;
      let buf = Buffer.alloc(0);
      const fail = (message) => {
        socket.destroy();
        if (tlsSock) tlsSock.destroy();
        reject(new Error(message));
      };
      socket.on('error', (e) => fail('代理连接失败: ' + e.message));
      socket.on('timeout', () => fail('请求超时'));
      socket.on('data', function onData(d) {
        buf = Buffer.concat([buf, d]);
        if (stage === 'connecting') {
          const headText = buf.toString('latin1');
          const idx = headText.indexOf('\r\n\r\n');
          if (idx === -1) return;
          const ok = /^HTTP\/1\.[01] 200/.test(headText);
          const rest = buf.slice(idx + 4);
          buf = Buffer.alloc(0);
          if (!ok) return fail('代理 CONNECT 失败: ' + headText.split('\r\n')[0]);
          stage = 'tls';
          socket.removeListener('data', onData);
          // CONNECT 应答之后不会有服务器先发的数据，剩余字节交由 TLS 层处理
          tlsSock = tls.connect({ socket, servername: API_HOST }, () => {
            stage = 'http';
            const h = { Host: API_HOST, 'User-Agent': UA, Accept: 'application/json', Connection: 'close', ...headers };
            if (bodyStr) h['Content-Length'] = Buffer.byteLength(bodyStr);
            let req = `${method} ${pathName} HTTP/1.1\r\n`;
            for (const [k, v] of Object.entries(h)) req += `${k}: ${v}\r\n`;
            req += '\r\n';
            tlsSock.write(req, 'latin1');
            if (bodyStr) tlsSock.write(bodyStr, 'utf8');
          });
          if (rest.length) tlsSock.emit('data', rest); // 罕见：CONNECT 与 TLS 报文同包
          tlsSock.on('data', (d2) => {
            buf = Buffer.concat([buf, d2]);
          });
          tlsSock.on('end', () => {
            try {
              resolve(parseHttpResponse(buf));
            } catch (e) {
              fail(e.message);
            }
          });
          tlsSock.on('error', (e) => fail('TLS 失败: ' + e.message));
        }
      });
    });

  const direct = () => httpRequestDirect(pathName, { method, headers, body, timeoutMs });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 代理节点可能抖动：代理 → 直连 → 代理 共三轮
  return (async () => {
    const errors = [];
    for (let round = 0; round < 3; round++) {
      try {
        if (proxy) return await viaTunnel();
      } catch (e) {
        errors.push(e.message);
      }
      try {
        return await direct();
      } catch (e) {
        errors.push(e.message);
      }
      await sleep(1500);
    }
    throw new Error('代理与直连均失败：' + errors.join(' / '));
  })();
}

// 直连兜底（无污染网络环境下可用）
function httpRequestDirect(pathName, { method = 'GET', headers = {}, body, timeoutMs = 25000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: API_HOST, port: 443, servername: API_HOST }, () => {
      const bodyStr = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
      const h = { Host: API_HOST, 'User-Agent': UA, Accept: 'application/json', Connection: 'close', ...headers };
      if (bodyStr) h['Content-Length'] = Buffer.byteLength(bodyStr);
      let req = `${method} ${pathName} HTTP/1.1\r\n`;
      for (const [k, v] of Object.entries(h)) req += `${k}: ${v}\r\n`;
      req += '\r\n';
      socket.write(req, 'latin1');
      if (bodyStr) socket.write(bodyStr, 'utf8');
    });
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      reject(new Error('直连请求超时（域名可能被污染，需代理）'));
    });
    let buf = Buffer.alloc(0);
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
    });
    socket.on('end', () => {
      try {
        resolve(parseHttpResponse(buf));
      } catch (e) {
        reject(e);
      }
    });
    socket.on('error', (e) => reject(new Error('直连失败: ' + e.message)));
  });
}

// ---------- 账号工具 ----------

function getStr(obj, key) {
  const v = obj && obj[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function displayName(account) {
  return (
    getStr(account, 'email') ||
    getStr(account, 'username') ||
    getStr(account, 'nickname') ||
    'unknown'
  );
}

function buildHeaders(account) {
  const headers = {
    'x-device-fingerprint': getStr(account, 'device_id') || 'fp-' + Date.now(),
  };
  const cookie = getStr(account, 'session_cookie');
  if (cookie) headers.Cookie = cookie;
  return headers;
}

function extractError(resp) {
  let e =
    resp && (resp.message || resp.error || (resp.data && resp.data.message));
  if (e && typeof e === 'object') e = e.message || JSON.stringify(e);
  return e ? String(e).slice(0, 160) : `请求失败（HTTP ${(resp && resp.httpStatus) || '?'}）`;
}

function saveSession(account, resp) {
  const cookies = (resp.setCookie || [])
    .map((c) => c.split(';')[0])
    .filter((c) => c.trim());
  if (cookies.length) account.session_cookie = cookies.join('; ');
  const user = (resp.json && (resp.json.data || resp.json.user)) || null;
  if (user && typeof user === 'object') {
    if (getStr(user, 'username')) account.uid = getStr(user, 'username');
    if (user.quota !== undefined) account.last_quota = user.quota;
  }
  account.refreshedAt = Date.now();
  delete account.needs_relogin;
  delete account.needs_relogin_reason;
  store.upsertAccount(account);
  return account;
}

// ---------- 登录（登录即签到） ----------

async function login(account) {
  const username = getStr(account, 'username');
  const password = getStr(account, 'password');
  if (!username || !password) {
    account.needs_relogin = true;
    account.needs_relogin_reason = '未配置用户名/密码，无法自动登录';
    store.upsertAccount(account);
    return { ok: false, error: '未配置用户名/密码', checkedIn: false };
  }
  const resp = await tunneledRequest('/api/user/login', {
    method: 'POST',
    headers: buildHeaders(account),
    body: { username, password },
  });
  const json = resp.json || {};
  const user = json.data && typeof json.data === 'object' ? json.data : {};
  if (resp.httpStatus === 200 && json.success) {
    saveSession(account, resp);
    return {
      ok: true,
      checkedIn: user.checked_in === true,
      user,
    };
  }
  const error = extractError({ message: json.message || json.error, httpStatus: resp.httpStatus });
  if (/验证码|captcha/i.test(error)) {
    account.needs_captcha = true;
  }
  account.needs_relogin = true;
  account.needs_relogin_reason = `自动登录失败: ${error}`;
  store.upsertAccount(account);
  return { ok: false, error, checkedIn: false };
}

// 签到 = 登录一次（服务端在登录时发放 DailyCheckinQuota）
async function checkin(account) {
  const result = await login(account);
  if (!result.ok) {
    return { result: 'error', message: result.error };
  }
  if (result.checkedIn) {
    return { result: 'success', message: '签到成功，新增额度已到账' };
  }
  return { result: 'already', message: '登录成功（今日奖励已领取）' };
}

// 「刷新 token」按钮 = 重新登录换新会话
async function refreshToken(account) {
  const result = await login(account);
  if (!result.ok) {
    account.needs_relogin = true;
    account.needs_relogin_reason = `自动登录失败: ${result.error}`;
    store.upsertAccount(account);
  }
  return account;
}

// ---------- 余额 ----------

async function getCredits(account) {
  const base = {
    accountId: account.id ?? null,
    accountName: displayName(account),
    provider: account.provider ?? 'agentrouter',
    updatedAt: Date.now(),
    kind: 'balance',
    resources: [],
  };
  const { resp } = await authedRequest(account, '/api/user/self');
  if (!resp.json || resp.json.success !== true) {
    return { ...base, ok: false, error: extractError({ message: resp.json?.message || resp.text, httpStatus: resp.httpStatus }) };
  }
  const user = resp.json.data || {};
  const quota = Number(user.quota ?? 0);
  return {
    ...base,
    ok: true,
    kind: 'balance',
    balance: quota,
    totalRemaining: quota,
    todayCheckedIn: user.checked_in === true,
    usedQuota: Number(user.used_quota ?? 0) || 0,
  };
}

// 带会话请求；401/未登录时自动重新登录一次
async function authedRequest(account, pathName) {
  let acc = account;
  let resp = await tunneledRequest(pathName, { headers: buildHeaders(acc) });
  const unauthorized =
    resp.httpStatus === 401 ||
    (resp.json && resp.json.success === false && /未登录|无权|login/i.test(resp.json.message || ''));
  if (unauthorized) {
    const r = await login({ ...acc });
    if (!r.ok) return { resp, account: acc };
    acc = store.findAccount(account.id) || acc;
    resp = await tunneledRequest(pathName, { headers: buildHeaders(acc) });
  }
  return { resp, account: acc };
}

// 账号手动添加表单字段声明
const manualFields = [
  {
    key: 'username',
    label: '用户名 / 邮箱（必填）',
    required: true,
    hint: 'Agent Router 控制台的登录账号',
    placeholder: 'you@example.com',
  },
  {
    key: 'password',
    label: '密码（必填）',
    required: true,
    hint: '明文保存在本地 data 目录。每日自动登录即自动领取签到额度',
    placeholder: '',
  },
];

module.exports = {
  id: 'agentrouter',
  name: 'AgentRouter（API 中转）',
  siteUrl: 'https://agentrouter.org',
  displayName,
  checkin,
  refreshToken,
  getCredits,
  manualFields,
  buildAuthHeaders: buildHeaders,
};
