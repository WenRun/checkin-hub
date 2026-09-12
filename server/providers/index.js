// Provider 注册表：新站点签到在这里注册。
// 每个 provider 需要实现：id / name / checkin(account) / refreshToken(account)。
// checkin(account) 返回 { result: 'success'|'already'|'error', message? }。

const workbuddy = require('./workbuddy');
const tokenbom = require('./tokenbom');

const providers = new Map();
for (const p of [workbuddy, tokenbom]) {
  providers.set(p.id, p);
}

function getProvider(id) {
  return providers.get(id) || null;
}

function listProviders() {
  return [...providers.values()].map((p) => ({
    id: p.id,
    name: p.name,
    siteUrl: p.siteUrl,
    // 账号手动添加表单的字段声明（前端按此动态渲染）
    manualFields: Array.isArray(p.manualFields) ? p.manualFields : null,
    // 前端据此决定各平台子菜单里展示哪些操作入口
    capabilities: {
      oauth: typeof p.oauthStart === 'function',
      importLocal: typeof p.importLocal === 'function',
      manual: true,
      credits: typeof p.getCredits === 'function',
      relogin: typeof p.reloginWithCaptcha === 'function',
    },
  }));
}

module.exports = { getProvider, listProviders };
