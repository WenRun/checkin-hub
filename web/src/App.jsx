import { useState } from 'react';
import {
  LayoutDashboard,
  ListChecks,
  Users,
  ScrollText,
  CalendarClock,
} from 'lucide-react';
import Dashboard from './pages/Dashboard.jsx';
import Tasks from './pages/Tasks.jsx';
import Accounts from './pages/Accounts.jsx';
import Records from './pages/Records.jsx';

const NAV = [
  { id: 'dashboard', label: '总览', icon: LayoutDashboard },
  { id: 'tasks', label: '任务管理', icon: ListChecks },
  { id: 'accounts', label: '账号管理', icon: Users },
  { id: 'records', label: '执行记录', icon: ScrollText },
];

export default function App() {
  const [page, setPage] = useState('dashboard');

  return (
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-panel">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600/15 text-emerald-400">
            <CalendarClock size={20} />
          </div>
          <div>
            <div className="text-sm font-semibold text-zinc-100">Checkin Hub</div>
            <div className="text-xs text-zinc-500">自动签到任务中心</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setPage(id)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                page === id
                  ? 'bg-emerald-600/15 font-medium text-emerald-400'
                  : 'text-zinc-400 hover:bg-zinc-700/30 hover:text-zinc-200'
              }`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>
        <div className="border-t border-line px-5 py-3 text-xs text-zinc-600">
          数据本地存储 · 无云端依赖
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        {page === 'dashboard' && <Dashboard onNavigate={setPage} />}
        {page === 'tasks' && <Tasks />}
        {page === 'accounts' && <Accounts />}
        {page === 'records' && <Records />}
      </main>
    </div>
  );
}
