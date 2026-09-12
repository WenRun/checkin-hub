// 账号积分卡片（原「积分统计」页内容，现嵌入账号管理页）
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Coins, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { api, fmtTime } from '../api.jsx';
import { Card, Button, Badge, Empty } from './ui.jsx';

function fmtAmount(n) {
  if (typeof n !== 'number') return '-';
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

function fmtExpire(ms) {
  if (!ms) return '—';
  const d = new Date(Number(ms));
  const p = (n) => String(n).padStart(2, '0');
  const md = `${p(d.getMonth() + 1)}/${p(d.getDate())}`;
  // 当年内只显示 月/日，跨年显示完整日期
  return d.getFullYear() === new Date().getFullYear() ? md : `${d.getFullYear()}/${md}`;
}

function PackageRow({ pkg, warn }) {
  const pct =
    pkg.total > 0 ? Math.min(100, Math.round((pkg.remaining / pkg.total) * 100)) : 0;
  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex min-w-0 items-center gap-2">
          <Badge className="shrink-0 border-zinc-600/40 bg-zinc-600/15 text-zinc-300">
            {fmtAmount(pkg.remaining)} 积分
          </Badge>
          <span className="truncate text-zinc-400" title={pkg.packageName || ''}>
            {pkg.packageName || pkg.packageCode || '未命名积分包'}
          </span>
        </div>
        <span className={`shrink-0 ${warn ? 'font-medium text-red-400' : 'text-zinc-500'}`}>
          {pkg.expired ? '已过期' : `${fmtExpire(pkg.expireAt)} 到期`}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-700/50">
        <div
          className={`h-full rounded-full ${pkg.expired ? 'bg-zinc-600' : warn ? 'bg-amber-500' : 'bg-emerald-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function AccountCreditsCard({ data }) {
  const [expanded, setExpanded] = useState(false);
  if (!data.ok) {
    return (
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-zinc-200">{data.accountName}</span>
          <Badge className="border-red-500/30 bg-red-500/10 text-red-400">查询失败</Badge>
        </div>
        <div className="mt-2 flex items-start gap-1.5 text-xs text-zinc-500">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-500" />
          {data.error || '未知错误'}
        </div>
      </Card>
    );
  }

  // 余额形态（如 TokenBom：单一积分余额，无积分包）
  if (data.kind === 'balance') {
    return (
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-zinc-200">{data.accountName}</span>
          {data.streak ? (
            <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
              连签 {data.streak} 天
            </Badge>
          ) : null}
        </div>
        <div className="mt-3 flex items-end justify-between">
          <div>
            <div className="flex items-baseline gap-1.5">
              <Coins size={18} className="text-emerald-400" />
              <span className="text-3xl font-semibold tracking-tight text-zinc-100">
                {fmtAmount(data.balance ?? data.totalRemaining)}
              </span>
            </div>
            <div className="mt-1 text-xs text-zinc-500">积分余额</div>
          </div>
          <span className="text-xs text-zinc-600">{fmtTime(data.updatedAt).slice(5, 16)} 更新</span>
        </div>
      </Card>
    );
  }

  const usable = data.resources
    .filter((r) => r.remaining > 0 && !r.expired && r.expireAt)
    .sort((a, b) => a.expireAt - b.expireAt);
  const expiring = usable.slice(0, 3);
  const rest = usable.slice(3);

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-200">{data.accountName}</span>
        {data.expiringSoon && (
          <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-400">积分即将到期</Badge>
        )}
      </div>
      <div className="mt-3 flex items-end justify-between">
        <div>
          <div className="flex items-baseline gap-1.5">
            <Coins size={18} className="text-emerald-400" />
            <span className="text-3xl font-semibold tracking-tight text-zinc-100">
              {fmtAmount(data.totalRemaining)}
            </span>
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            共 {data.resources.length} 个积分包
            {data.expiredRemaining > 0 && ` · ${fmtAmount(data.expiredRemaining)} 即将过期浪费`}
          </div>
        </div>
        <span className="text-xs text-zinc-600">{fmtTime(data.updatedAt).slice(5, 16)} 更新</span>
      </div>

      <div className="mt-4 border-t border-line pt-1">
        <div className="pb-1 text-xs font-medium text-zinc-500">近期到期</div>
        {expiring.length === 0 && <div className="py-2 text-xs text-zinc-600">没有可用积分包</div>}
        {expiring.map((pkg, i) => (
          <PackageRow key={pkg.packageCode || i} pkg={pkg} warn={pkg.expiringSoon} />
        ))}
        {rest.length > 0 && (
          <>
            <button
              className="mt-1 flex items-center gap-1 text-xs text-emerald-400 hover:underline"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? '收起全部积分包' : `查看全部积分包（${data.resources.length}）`}
              {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
            {expanded && (
              <div className="mt-1 border-t border-line pt-1">
                {data.resources
                  .slice()
                  .sort((a, b) => (a.expireAt ?? Infinity) - (b.expireAt ?? Infinity))
                  .map((pkg, i) => (
                    <PackageRow key={pkg.packageCode || i} pkg={pkg} warn={pkg.expiringSoon} />
                  ))}
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

// 嵌入账号管理页的积分概况区块（site 传入时只显示该平台的账号）
export function CreditsSection({ site }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      let data = await api.credits();
      if (site) data = data.filter((item) => item.provider === site || !item.provider);
      setList(data);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  }, [site]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">积分概况</h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            每个账号的积分余额与积分包到期情况，7 天内到期的会标红提醒，优先用完
          </p>
        </div>
        <Button size="sm" onClick={load} disabled={refreshing}>
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? '查询中…' : '刷新'}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">
          {error}
        </div>
      )}

      {!list ? (
        <Empty text="加载中…" />
      ) : list.length === 0 ? (
        <Empty text="还没有账号" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {list.map((item) => (
            <AccountCreditsCard key={item.accountId || item.accountName} data={item} />
          ))}
        </div>
      )}
    </div>
  );
}
