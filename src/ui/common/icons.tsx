import type { ReactNode } from 'react';
import type { Priority, Scope, TaskSize, TaskStatus } from '../../domain/types';
import { SIZE_POINTS } from '../../domain/services';

/** Plain-text names (for <option>s and aria labels). */
export const STATUS_NAME: Record<TaskStatus, string> = { todo: 'To do', doing: 'In progress', blocked: 'Blocked', onhold: 'On hold', done: 'Done' };
/** Dropdown / chip text for a size, e.g. "M · 3 pts". */
export const sizeLabel = (s: TaskSize) => `${s} · ${SIZE_POINTS[s]} pt${SIZE_POINTS[s] > 1 ? 's' : ''}`;
export const PRIORITY_NAME: Record<Priority, string> = { high: 'High', medium: 'Medium', low: 'Low' };

/** One colour per status, used by the icon, the board column header and the chips. */
export const STATUS_COLOR: Record<TaskStatus, string> = {
  todo: 'text-ink-400', doing: 'text-sky-500', blocked: 'text-clay-500', onhold: 'text-violet-400', done: 'text-emerald-400',
};

function Svg({ size, children, className = '' }: { size: number; children: ReactNode; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 ${className}`}>
      {children}
    </svg>
  );
}

export function StatusIcon({ status, size = 16 }: { status: TaskStatus; size?: number }) {
  return (
    <span className={`inline-flex ${STATUS_COLOR[status]}`}>
      <Svg size={size}>
        {status === 'done' ? (
          <>
            <circle cx="8" cy="8" r="7" fill="currentColor" stroke="none" />
            <path d="M4.8 8.3l2.2 2.2 4.2-4.6" stroke="#0e1328" strokeWidth={1.8} />
          </>
        ) : (
          <circle cx="8" cy="8" r="6.5" strokeDasharray={status === 'todo' ? '2.2 2.2' : undefined} />
        )}
        {status === 'doing' && <path d="M8 4a4 4 0 010 8z" fill="currentColor" stroke="none" />}
        {status === 'blocked' && <path d="M3.6 12.4l8.8-8.8" />}
        {status === 'onhold' && <path d="M6.2 5.6v4.8M9.8 5.6v4.8" strokeWidth={1.8} />}
      </Svg>
    </span>
  );
}

export function StatusLabel({ status, size = 14 }: { status: TaskStatus; size?: number }) {
  return <span className="inline-flex items-center gap-1.5"><StatusIcon status={status} size={size} />{STATUS_NAME[status]}</span>;
}

const PRIORITY_COLOR: Record<Priority, string> = { high: 'text-clay-500', medium: 'text-moss-400', low: 'text-sky-500' };
const BARS: Record<Priority, number> = { high: 3, medium: 2, low: 1 };

/** Three ascending bars: as many lit as the priority level. */
export function PriorityIcon({ priority, size = 14 }: { priority: Priority; size?: number }) {
  return (
    <span className={`inline-flex ${PRIORITY_COLOR[priority]}`}>
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className="shrink-0">
        {[0, 1, 2].map((i) => (
          <rect key={i} x={2 + i * 4.5} y={10 - i * 3.5} width="3" height={4 + i * 3.5} rx="1" fill="currentColor" opacity={i < BARS[priority] ? 1 : 0.25} />
        ))}
      </svg>
    </span>
  );
}

export function PriorityLabel({ priority }: { priority: Priority }) {
  return <span className="inline-flex items-center gap-1.5"><PriorityIcon priority={priority} />{PRIORITY_NAME[priority]}</span>;
}

/** A small tag showing a task's size and its points. */
export function SizeChip({ size }: { size: TaskSize }) {
  return (
    <span className="chip font-semibold" title={`Size ${size} – ${SIZE_POINTS[size]} story points`}>
      <span className="rounded bg-sky-500/20 px-1 text-[10px] leading-4 text-sky-500">{size}</span>{SIZE_POINTS[size]}
    </span>
  );
}

export function CalendarIcon({ size = 12 }: { size?: number }) {
  return (
    <Svg size={size}>
      <rect x="2" y="3" width="12" height="11" rx="2" />
      <path d="M2 7h12M5.5 1.8v2.6M10.5 1.8v2.6" />
    </Svg>
  );
}

export function AlertIcon({ size = 12 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M8 2l6.2 11H1.8z" />
      <path d="M8 6.6v3M8 11.6v.1" strokeWidth={1.8} />
    </Svg>
  );
}

export function ClockIcon({ size = 12 }: { size?: number }) {
  return (
    <Svg size={size}>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 4.6V8l2.3 1.4" />
    </Svg>
  );
}

export function PlusIcon({ size = 12 }: { size?: number }) {
  return <Svg size={size}><path d="M8 3v10M3 8h10" strokeWidth={1.8} /></Svg>;
}

export function PencilIcon({ size = 12 }: { size?: number }) {
  return <Svg size={size}><path d="M2.5 13.5l.7-3L11 2.7a1.4 1.4 0 012 2L5.5 12.8z" /></Svg>;
}

/** A scope's emoji on its colour, as a small rounded badge. */
export function ScopeBadge({ scope, size = 18 }: { scope: Pick<Scope, 'icon' | 'color'>; size?: number }) {
  return (
    <span
      aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-md leading-none"
      style={{ width: size, height: size, fontSize: size * 0.62, background: `${scope.color}33`, boxShadow: `inset 0 0 0 1px ${scope.color}88` }}
    >
      {scope.icon}
    </span>
  );
}

export const SCOPE_ICONS = ['📁', '💼', '🏠', '🎓', '💡', '🛠️', '🎯', '🧪', '📣', '💰', '❤️', '🌱'];
export const SCOPE_COLORS = ['#62b4ff', '#eba14a', '#34d399', '#a78bfa', '#f472b6', '#ee7d6a', '#2dd4bf', '#facc15'];
