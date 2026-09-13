import { useCallback, useEffect, useState } from 'react';
import { api, fmtTime, ResultBadge } from '../api.jsx';
import { Card, Select, Empty } from '../components/ui.jsx';

export default function Records() {
  const [records, setRecords] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [taskId, setTaskId] = useState('');
  const [result, setResult] = useState('');

  const load = useCallback(() => {
    api.records({ taskId: taskId || undefined, result: result || undefined, limit: 200 })
      .then(setRecords)
      .catch(() => {});
  }, [taskId, result]);

  useEffect(() => {
    api.tasks().then(setTasks).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:space-y-6 md:p-6">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">执行记录</h2>
          <p className="mt-0.5 text-sm text-zinc-500">所有任务的自动 / 手动执行明细（保留最近 5000 条）</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={taskId} onChange={setTaskId} className="w-52">
            <option value="">全部任务</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
          <Select value={result} onChange={setResult} className="w-32">
            <option value="">全部结果</option>
            <option value="success">成功</option>
            <option value="already">已签到</option>
            <option value="error">失败</option>
          </Select>
        </div>
      </div>

      <Card>
        {records === null ? (
          <Empty text="加载中…" />
        ) : records.length === 0 ? (
          <Empty text="暂无执行记录" />
        ) : (
          <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-zinc-500">
                <th className="px-5 py-3 font-medium">时间</th>
                <th className="px-3 py-3 font-medium">任务</th>
                <th className="px-3 py-3 font-medium">账号</th>
                <th className="px-3 py-3 font-medium">结果</th>
                <th className="px-3 py-3 font-medium">详情</th>
                <th className="px-5 py-3 font-medium">耗时</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {records.map((r) => (
                <tr key={r.id} className="hover:bg-panel-2/60">
                  <td className="whitespace-nowrap px-5 py-3 text-xs text-zinc-500">{fmtTime(r.startedAt)}</td>
                  <td className="px-3 py-3 text-zinc-200">{r.taskName}</td>
                  <td className="px-3 py-3 text-xs text-zinc-400">{r.accountName}</td>
                  <td className="px-3 py-3"><ResultBadge result={r.result} /></td>
                  <td className="max-w-96 truncate px-3 py-3 text-xs text-zinc-500" title={r.message}>
                    {r.message || '-'}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-xs text-zinc-500">
                    {r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
