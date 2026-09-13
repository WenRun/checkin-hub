import { useState } from 'react';
import {
  LayoutDashboard,
  ListChecks,
  Users,
  ScrollText,
  CalendarClock,
  Settings as SettingsIcon,
  Menu,
  X,
} from 'lucide-react';
import Dashboard from './pages/Dashboard.jsx';
import Tasks from './pages/Tasks.jsx';
import Accounts from './pages/Accounts.jsx';
import Records from './pages/Records.jsx';
import Settings from './pages/Settings.jsx';

const NAV = [
  { id: 'dashboard', label: '总览', icon: LayoutDashboard },
  { id: 'tasks', label: '任务管理', icon: ListChecks },
  { id: 'accounts', label: '账号管理', icon: Users },
  { id: 'records', label: '执行记录', icon: ScrollText },
  { id: 'settings', label: '设置', icon: SettingsIcon },
];

export default function App() {
  const [page, setPage] = useState('dashboard');
  const [menuOpen, setMenuOpen] = useState(false);

  const navItems = NAV.map(({ id, label, icon: Icon }) => ({
    id,
    label,
    Icon,
    active: page === id,
    onClick: () => {
      setPage(id);
      setMenuOpen(false);
    },
  }));

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* 移动端顶栏：标题 + 菜单按钮（点击展开导航） */}
      <header className="flex items-center justify-between border-b border-line bg-panel px-4 py-3 md:hidden">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600/15 text-emerald-400">
            <CalendarClock size={18} />
          </div>
          <div>
            <div className="text-sm font-semibold text-zinc-100">Checkin Hub</div>
            <div className="text-xs text-zinc-500">自动签到任务中心</div>
          </div>
        </div>
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="菜单"
          className="rounded-lg border border-line bg-panel-2 p-2 text-zinc-300 transition-colors active:bg-zinc-700/40"
        >
          {menuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </header>
      {menuOpen && (
        <nav className="border-b border-line bg-panel px-3 py-2 md:hidden">
          {navItems.map(({ id, label, Icon, active, onClick }) => (
            <button
              key={id}
              onClick={onClick}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                active
                  ? 'bg-emerald-600/15 font-medium text-emerald-400'
                  : 'text-zinc-300 hover:bg-zinc-700/30'
              }`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>
      )}

      {/* 桌面端侧边栏 */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-panel md:flex">
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
          {navItems.map(({ id, label, Icon, active, onClick }) => (
            <button
              key={id}
              onClick={onClick}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                active
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
        {page === 'settings' && <Settings />}
      </main>
    </div>
  );
}
