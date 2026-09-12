// Provider 注册表：新站点签到在这里注册。
// 每个 provider 需要实现：id / name / checkin(account) / refreshToken(account)。
// checkin(account) 返回 { result: 'success'|'already'|'error', message? }。

const workbuddy = require('./workbuddy');

const providers = new Map();
for (const p of [workbuddy]) {
  providers.set(p.id, p);
}

function getProvider(id) {
  return providers.get(id) || null;
}

function listProviders() {
  return [...providers.values()].map(({ id, name, siteUrl }) => ({ id, name, siteUrl }));
}

module.exports = { getProvider, listProviders };
