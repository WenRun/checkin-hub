# Checkin Hub · 自动签到任务中心

一个可扩展的多站点自动签到平台。目前已内置 **WorkBuddy（腾讯 AI 编程助手）** 的签到、token 自动续期与保活逻辑，后续可按同样的 provider 接口接入其他中转站 / 网站的签到。

签到核心逻辑移植自 [changexbc/workbuddy-switch](https://github.com/changexbc/workbuddy-switch)（MIT），在其"每 30 分钟轮询"的基础上重构为**可配置的任务调度系统**。

## 功能

- **任务管理**：每个任务绑定一个站点账号（或全部账号），可配置三种调度方式：
  - 每天定时：指定一个或多个时间点（如 `09:00, 21:30`）
  - 固定间隔：每隔 N 分钟执行
  - Cron 表达式：5 位表达式（分 时 日 月 周）
  - 可选随机延迟（0~N 分钟），避免整点请求
- **执行记录**：每次执行（自动 / 手动 / 补跑）都会写入记录，包含账号、结果、详情、耗时，可在任务详情或全局记录页查看，自动/手动执行一目了然
- **账号管理**：支持从本机 WorkBuddy 客户端一键导入登录凭据，或手动填入 token；执行签到前自动检查 token 有效期，剩余不足 24 小时自动刷新（长期保活）
- **错过补跑**：服务重启后，错过的任务会立即补跑一次，再按计划继续排期
- **纯本地**：数据（账号 token、任务配置、执行记录）全部存在项目 `data/` 目录，无云端依赖

## 快速开始

```bash
npm install
npm run build     # 构建前端
npm start         # 启动服务，访问 http://127.0.0.1:57891
```

开发模式（前后端热更新）：

```bash
npm run dev
```

端口/环境变量：`PORT`（默认 57891）。

## 部署为常驻服务

Windows 上推荐用 [pm2](https://pm2.keymetrics.io/) 或 [NSSM](https://nssm.cc/)：

```bash
npm i -g pm2
pm2 start server/index.js --name checkin-hub
pm2 save
```

Linux 服务器（systemd）：

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

## WorkBuddy 账号接入

1. **扫码登录**（推荐）：点「账号管理 → 扫码登录」，在打开的官方登录页用手机扫码完成登录，账号自动入库（含 refresh token）。OAuth 流程对齐官方 cockpit：`POST /v2/plugin/auth/state` 申请 state → 打开登录页 → 轮询 `GET /v2/plugin/auth/token?state=` → 拉取 `/v2/plugin/login/account` 账号信息。
2. **从本机导入**：本机安装并登录 WorkBuddy 客户端后，点击「账号管理 → 从本机导入」，程序会读取官方凭据文件 `%LOCALAPPDATA%\CodeBuddyExtension\Data\Public\auth\workbuddy-desktop.info`。
3. **手动添加**：浏览器登录 codebuddy.cn 后，从开发者工具任意请求的请求头中复制 `Authorization: Bearer xxx` 中的 token 与 `refresh_token`（如有）。

## 签到接口（WorkBuddy）

- 查询状态：`POST https://www.codebuddy.cn/v2/billing/meter/checkin-activity-status`（失败回退 `/checkin-status`），字段 `today_checked_in`
- 提交签到：`POST /v2/billing/meter/daily-checkin`，返回"已签到"按成功处理
- token 刷新：`POST /v2/plugin/auth/token/refresh`，请求头 `X-Refresh-Token`
- 请求头对齐官方客户端：`Authorization`、`X-User-Id`、`X-Enterprise-Id` / `X-Tenant-Id`、`X-Domain`

## 接入新站点

在 `server/providers/` 下新建文件并导出以下接口，然后在 `server/providers/index.js` 注册即可：

```js
module.exports = {
  id: 'my-site',                    // 站点唯一标识
  name: '某站点',
  siteUrl: 'https://example.com',
  displayName: (account) => account.email,
  async checkin(account) {
    // 执行签到，返回 { result: 'success'|'already'|'error', message? }
  },
  async refreshToken(account) {
    // 刷新 token 并落盘（store.upsertAccount），失败时标记 needs_relogin
  },
};
```

## 目录结构

```
server/
  index.js            # Express API + 静态资源托管
  scheduler.js        # 任务调度（定时/间隔/Cron + 补跑）
  store.js            # JSON 文件存储（data/*.json，原子写入）
  providers/
    index.js          # provider 注册表
    workbuddy.js      # WorkBuddy 签到/刷新/本机导入
web/                  # React + Vite + Tailwind 前端
data/                 # 运行时数据（git 忽略）
```

## License

MIT
