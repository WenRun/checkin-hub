// 基础 UI 组件（风格对齐 workbuddy-switch：深色卡片 + 细边框 + 圆角）
import { Children, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

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
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${className}`}
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
        className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0'
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
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/60 p-4"
      onClick={onClose}
    >
      <div className="flex min-h-full items-center justify-center">
        <div
          onClick={(e) => e.stopPropagation()}
          className={`relative w-full rounded-xl border border-line bg-panel shadow-2xl ${wide ? 'max-w-2xl' : 'max-w-lg'}`}
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

// 自定义下拉选择：胶囊触发器 + 主题化弹出选项面板（原生 option 无法定制样式）
// 接口：value / onChange(value) / disabled / className；选项通过 <option> 子元素传入
export function Select({ value, onChange, children, className = '', disabled }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState({ top: 0, left: 0, width: 0 });
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  // Children.toArray 会拍平 JSX 中嵌套数组形式的 children（如 {list.map(...)}）
  const items = Children.toArray(children)
    .map((el) =>
      el && el.type === 'option'
        ? { value: el.props.value, label: el.props.children, disabled: el.props.disabled }
        : null,
    )
    .filter(Boolean);
  const current = items.find((i) => String(i.value) === String(value)) || items[0];

  const openMenu = () => {
    if (disabled) return;
    const r = btnRef.current.getBoundingClientRect();
    setRect({ top: r.bottom + 4, left: r.left, width: r.width });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!btnRef.current?.contains(e.target) && !menuRef.current?.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    const onReposition = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('resize', onReposition);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-full border border-line bg-panel-2 py-2 pl-4 pr-3.5 text-sm text-zinc-100 outline-none transition-colors hover:border-zinc-600 focus:border-emerald-600/60 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      >
        <span className="truncate">{current ? current.label : '\u00A0'}</span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: 'fixed', top: rect.top, left: rect.left, minWidth: rect.width }}
            className="z-[60] max-h-64 overflow-y-auto rounded-xl border border-line bg-panel py-1 shadow-2xl"
          >
            {items.map((item) => {
              const selected = String(item.value) === String(current?.value);
              return (
                <button
                  key={String(item.value)}
                  type="button"
                  disabled={item.disabled}
                  onClick={() => {
                    onChange(item.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm transition-colors ${
                    selected
                      ? 'bg-emerald-600/10 font-medium text-emerald-400'
                      : 'text-zinc-300 hover:bg-zinc-700/40'
                  } disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  <span className="min-w-0 whitespace-nowrap pr-2">{item.label}</span>
                  {selected && <Check size={14} className="shrink-0" />}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}

export function Textarea(props) {
  return <textarea className={inputCls} {...props} />;
}

export function Empty({ text = '暂无数据' }) {
  return <div className="py-10 text-center text-sm text-zinc-600">{text}</div>;
}
