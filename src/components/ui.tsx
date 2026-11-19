import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router';

export function PageHead({ kicker, title, desc, actions }: { kicker: string; title: string; desc?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <div className="kicker">{kicker}</div>
        <h1 className="mt-1 text-[1.65rem] leading-snug font-extrabold tracking-tight md:text-[2rem]">{title}</h1>
        {desc && <p className="mt-1 text-sm text-muted">{desc}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function CardHead({ title, right, as: As = 'h2' }: { title: ReactNode; right?: ReactNode; as?: 'h2' | 'h3' }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <As className="m-0 text-base font-bold">{title}</As>
      {right}
    </div>
  );
}

export function ProgressBar({ value, label, tone = 'primary' }: { value: number; label: string; tone?: 'primary' | 'ok' | 'bad' }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const color = tone === 'ok' ? 'var(--c-ok-bar)' : tone === 'bad' ? 'var(--c-bad-bar)' : 'var(--c-primary)';
  return (
    <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} aria-label={label}>
      <span style={{ width: `${v}%`, background: color }} />
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="px-3 py-10 text-center text-muted">
      {icon && <div className="mb-2 flex justify-center text-primary" aria-hidden>{icon}</div>}
      <h3 className="mb-1 text-base font-bold text-ink">{title}</h3>
      {children && <div className="mx-auto max-w-md text-sm">{children}</div>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="card !p-4 md:!p-5">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-extrabold tracking-tight md:text-[1.8rem]">{value}</div>
      {note && <div className="text-[0.72rem] text-muted">{note}</div>}
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = '確認',
  cancelLabel = '取消',
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onCancel]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={onCancel}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="card w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="mb-2 text-lg font-bold">
          {title}
        </h2>
        <div className="text-sm text-muted">{children}</div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button ref={ref} type="button" className="btn btn-secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className={`btn ${danger ? 'btn-danger' : ''}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function OfficialDisclaimer({ compact }: { compact?: boolean }) {
  return (
    <p className={`notice ${compact ? '!text-[0.72rem]' : ''}`}>
      獨立學習工具，<strong>非 iPAS 官方平台</strong>，與主辦單位無關。講義與題目為本站自編，考試規則請以
      <a href="https://ipd.nat.gov.tw/ipas/certification/AIAP/exam-info" target="_blank" rel="noopener noreferrer">
        官方考試資訊
      </a>
      為準。
    </p>
  );
}

export function TextLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link className="link" to={to}>
      {children}
    </Link>
  );
}

