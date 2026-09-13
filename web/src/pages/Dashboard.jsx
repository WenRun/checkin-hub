import { useEffect, useState } from 'react';
import { Users, ListChecks, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { api, fmtTime, ResultBadge } from '../api.jsx';
import { Card, CardHeader, Empty } from '../components/ui.jsx';

function StatCard({ icon: Icon, label, value, tone = 'text-zinc-100' }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-500">{label}</span>
        <Icon size={16} className="text-zinc-600" />
      </div>
      <div className={`mt-2 text-2xl font-semibold ${tone}`}>{value}</div>
    </Card>
  );
}

export default function Dashboard({ onNavigate }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .overview()
        .then((d) => alive && setData(d))
        .catch((e) => alive && setError(e.message));
    load();
    const t = setInterval(load, 10000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (error) return <Empty text={`加载失败: ${error}`} />;
  if (!data) return <Empty text="加载中…" />;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:space-y-6 md:p-6">
      <div>
        <h2 className="text-lg font-semibold text-zinc-100">总览</h2>
        <p className="mt-0.5 text-sm text-zinc-500">签到任务运行状态一览</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Users} label="账号总数" value={data.accounts} />
        <StatCard
          icon={ListChecks}
          label="启用任务"
          value={`${data.tasksEnabled} / ${data.tasksTotal}`}
        />
        <StatCard
          icon={CheckCircle2}
          label="今日成功"
          value={data.todaySuccess}
          tone="text-emerald-400"
        />
        <StatCard
          icon={XCircle}
          label="今日失败"
          value={data.todayError}
          tone={data.todayError > 0 ? 'text-red-400' : 'text-zinc-100'}
        />
      </div>

      {data.accountsNeedRelogin > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
          有 {data.accountsNeedRelogin} 个账号 token 刷新失败，需要重新登录获取新 token。
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="即将执行" desc="按下次执行时间排序的前 5 个任务" />
          <div className="divide-y divide-line">
            {data.nextTasks.length === 0 && <Empty text="没有启用中的任务" />}
            {data.nextTasks.map((t) => (
              <div key={t.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <div className="text-sm text-zinc-200">{t.name}</div>
                  <div className="mt-0.5 text-xs text-zinc-500">{t.schedule}</div>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                  <Clock size={13} />
                  {fmtTime(t.nextRunAt)}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="最近执行记录"
            desc="最近 10 条"
          >
            <button
              className="text-xs text-emerald-400 hover:underline"
              onClick={() => onNavigate('records')}
            >
              查看全部
            </button>
          </CardHeader>
          <div className="divide-y divide-line">
            {data.recentRecords.length === 0 && <Empty text="暂无执行记录" />}
            {data.recentRecords.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm text-zinc-200">{r.taskName}</span>
                    <ResultBadge result={r.result} />
                  </div>
                  <div className="mt-0.5 truncate text-xs text-zinc-500">
                    {r.accountName}
                    {r.message ? ` · ${r.message}` : ''}
                  </div>
                </div>
                <div className="shrink-0 text-xs text-zinc-600">{fmtTime(r.startedAt)}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
