// 基础 UI 组件（风格对齐 workbuddy-switch：深色卡片 + 细边框 + 圆角）

export function Card({ children, className = '' }) {
  return (
    <div className={`rounded-xl border border-line bg-panel ${className}`}>{children}</div>
  );
}

export function CardHeader({ title, desc, children }) {
  return (
    <div className="flex items-center justify-between border-b border-line px-5 py-4">
      <div>
        <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
        {desc && <p className="mt-0.5 text-xs text-zinc-500">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

export function Button({ variant = 'default', size = 'md', className = '', ...props }) {
  const variants = {
    default: 'bg-zinc-700/60 hover:bg-zinc-600/60 text-zinc-100 border-transparent',
    primary: 'bg-emerald-600 hover:bg-emerald-500 text-white border-transparent',
    danger: 'bg-transparent hover:bg-red-500/10 text-red-400 border-red-500/30',
    ghost: 'bg-transparent hover:bg-zinc-700/40 text-zinc-300 border-transparent',
  };
  const sizes = { sm: 'h-7 px-2.5 text-xs', md: 'h-9 px-4 text-sm' };
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  );
}

export function Switch({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
        checked ? 'bg-emerald-600' : 'bg-zinc-700'
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-4.5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export function Badge({ children, className = '' }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}

export function Modal({ open, onClose, title, children, wide = false }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className={`relative max-h-[85vh] w-full overflow-y-auto rounded-xl border border-line bg-panel shadow-2xl ${
          wide ? 'max-w-2xl' : 'max-w-lg'
        }`}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-line bg-panel px-5 py-4">
          <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-700/40 hover:text-zinc-200"
          >
            ✕
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-zinc-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-zinc-600">{hint}</span>}
    </label>
  );
}

const inputCls =
  'w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-600/60';

export function Input(props) {
  return <input className={inputCls} {...props} />;
}

export function Select(props) {
  return <select className={inputCls} {...props} />;
}

export function Textarea(props) {
  return <textarea className={inputCls} {...props} />;
}

export function Empty({ text = '暂无数据' }) {
  return <div className="py-10 text-center text-sm text-zinc-600">{text}</div>;
}
