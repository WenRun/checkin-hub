# Checkin Hub · 自动签到任务中心

一个可扩展的多平台自动签到系统。基于**任务调度 + 平台插件（provider）**架构：每个平台的签到逻辑封装为独立插件，平台子菜单、账号表单、任务选项、积分卡片全部由插件声明自动生成。

## 已内置平台

| 平台 | 签到机制 | 恢复能力 | 积分形态 |
|---|---|---|---|
| **WorkBuddy**（腾讯 AI 编程助手） | OAuth 授权 / 每日接口 | refresh token 长效 + 惰性刷新 | 积分包（含到期提醒） |
| **TokenBom**（tokenbom.com 积分市场） | 每日签到 + 补签卡 + 前置 API 调用 | 账密自动重登录；滑块验证网页内人工恢复 | 单一余额 + 连签/明日奖励/补签卡 |
| **AgentRouter**（agentrouter.org，New API 架构） | 每日登录即签到（DailyCheckinQuota） | 账密自动重登录（无验证码，可无限恢复） | 剩余额度（$，按 500000 quota = $1） |

### 各平台接入说明

**WorkBuddy**
1. 「从本机导入」：本机登录 WorkBuddy 客户端后一键读取官方凭据文件
   （`%LOCALAPPDATA%\CodeBuddyExtension\Data\Public\auth\workbuddy-desktop.info`）
2. 「扫码登录」：OAuth 设备码流程，手机扫码后自动入库
3. 「手动添加」：浏览器登录 codebuddy.cn 后复制请求头中的 Bearer token

**TokenBom**
1. 「扫码登录」：官方 OAuth 流程，登录后 token 自动入库
2. 浏览器登录 tokenbom.com 后 F12 → Application → Local Storage 复制 accessToken / refreshToken
3. 建议同时配置邮箱+密码：refreshToken 为一次性轮换制，被浏览器轮换掉时系统自动用账密重登录恢复；
   自动登录若触发滑块验证，账号管理里会出现「恢复登录」按钮，拖一次滑块即可
4. 可选填虚拟 Key（`sk-sub-`）：部分签到日要求"当天先有一次成功 API 调用"，任务选项开启
   「前置自动调用」后会自动发一次 `max_tokens=1` 的最小调用满足条件

**AgentRouter**
1. 「手动添加」填入控制台的登录用户名/密码即可（登录接口无验证码）
2. 每日自动登录即自动领取 `DailyCheckinQuota` 签到额度
3. 该域名在国内被 DNS 污染，需要在「设置」里配置代理（见下文）

## 功能

### 任务调度
- 三种计划：**每天定时**（多时间点）/ **固定间隔**（N 分钟）/ **Cron 表达式**（分 时 日 月 周）
- 可选随机延迟（0~N 分钟）错开整点
- **失败自动补试**：自动调度失败后 30 分钟重试，每天最多 5 次（应对代理抖动等瞬时故障）
- 服务重启后错过的任务立即补跑一次
- 每次执行（自动/手动/补跑）写入执行记录：账号、结果（成功/已签到/需人工/失败）、详情、耗时

### 账号管理（按平台子菜单）
- 子菜单、添加表单、操作按钮全部由 provider 声明**动态生成**，接入新平台零前端改动
- 凭据回显：编辑弹窗自动带出已保存的 token/密码（本地部署场景）
- TokenBom 登录触发滑块验证时，提供与官方一致的**网页内拖动滑块恢复**流程

### 积分概况（按平台积分模型渲染）
- **积分包形态**（WorkBuddy）：余额、积分包明细、近期到期列表（7 天内标红）
- **余额形态**（TokenBom / AgentRouter）：余额大字 + 平台特有指标（连签天数、明日奖励、补签卡 / 已用额度、请求次数）+ 原始单位脚注

### 设置
- **网络代理**：全局代理地址（`http://主机:端口`），用于访问被 DNS 污染/拦截的站点。
  优先级：设置页配置 > 环境变量 `AGENTROUTER_PROXY` > Windows 系统代理自动探测 > 直连。
  部署到服务器后，在此填服务器侧代理地址即可，保存立即生效

## 快速开始

```bash
npm install
npm run build     # 构建前端
npm start         # 启动服务，访问 http://127.0.0.1:57891
```

开发模式（前后端热更新）：`npm run dev`

数据（账号凭据、任务配置、执行记录、设置）全部保存在本地 `data/` 目录，无云端依赖。

## 部署

Windows 用 pm2 或 NSSM 注册为常驻服务；Linux 用 systemd：

```ini
[Unit]
Description=Checkin Hub
After=network.target

[Service]
WorkingDirectory=/opt/checkin-hub
ExecStart=/usr/bin/node server/index.js
Restart=always

[Install]
WantedBy=multi-user.target
```

部署后进「设置」页配置该机器可用的代理地址（AgentRouter 等被污染站点需要）。

## WorkBuddy 签到接口

- 查询状态：`POST https://www.codebuddy.cn/v2/billing/meter/checkin-activity-status`（失败回退 `/checkin-status`）
- 提交签到：`POST /v2/billing/meter/daily-checkin`，返回"已签到"按成功处理
- token 刷新：`POST /v2/plugin/auth/token/refresh`，请求头 `X-Refresh-Token`
- 请求头对齐官方客户端：`Authorization`、`X-User-Id`、`X-Enterprise-Id` / `X-Tenant-Id`、`X-Domain`

## 接入新平台

在 `server/providers/` 下新建文件并导出以下接口，然后在 `server/providers/index.js` 注册即可，
账号管理子菜单 / 添加表单 / 任务站点下拉 / 积分卡片全部自动出现：

```js
module.exports = {
  id: 'my-site',                      // 站点唯一标识
  name: '某站点',
  siteUrl: 'https://example.com',
  displayName: (account) => account.email,

  // 可选：手动添加表单字段声明（required 校验、hint 说明、密钥类字段自动掩码）
  manualFields: [
    { key: 'username', label: '用户名', required: true, hint: '...' },
    { key: 'password', label: '密码', required: true },
  ],

  // 必选：执行签到。options 为任务表单里的 providerOptions（平台专属配置）
  // 返回 { result: 'success'|'already'|'skipped'|'error', message? }
  async checkin(account, options) {},

  // 必选：刷新凭据并落盘（store.upsertAccount），失败时标记 needs_relogin
  async refreshToken(account) {},

  // 可选：积分查询
  // 积分包形态返回 { ok, kind: 'packages', balance, balanceLabel, resources: [{total, remaining, expireAt, expiringSoon, packageName}] }
  // 余额形态返回 { ok, kind: 'balance', balance, balanceLabel, badge?, stats?, footnote? }
  // async getCredits(account) {},

  // 可选：声明后账号管理显示对应按钮
  // oauthStart / oauthPoll / importLocal / reloginWithCaptcha / captchaStart
  // creditsHint: '积分概况区块的说明文案',
};
```

## 目录结构

```
server/
  index.js            # Express API + 静态资源托管 + 全局异常兜底
  scheduler.js        # 任务调度（定时/间隔/Cron + 失败补试 + 重启补跑）
  store.js            # JSON 文件存储（data/*.json，原子写入）
  providers/
    index.js          # provider 注册表（能力/表单字段/积分说明元数据）
    workbuddy.js      # WorkBuddy 签到/扫码/本机导入/积分包查询
    workbuddy-credits.js  # WorkBuddy 三接口积分查询与解析
    tokenbom.js       # TokenBom 签到/前置调用/补签/OAuth/滑块恢复/余额
    agentrouter.js    # AgentRouter 登录签到/代理隧道/余额
web/                  # React + Vite + Tailwind 前端
data/                 # 运行时数据（git 忽略）
```

## License

MIT
