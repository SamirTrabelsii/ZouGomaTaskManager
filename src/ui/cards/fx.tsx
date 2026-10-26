import { useEffect, useState, type RefObject } from 'react';

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Tilts an element toward the pointer (or with the phone's tilt) and exposes where the light hits it as CSS variables
 * for the holographic layers: --mx/--my (0–100%), --rx/--ry (degrees) and --hyp (0 in the middle, 1 at the edges).
 */
export function useTilt(ref: RefObject<HTMLElement>, enabled: boolean, maxDeg = 16) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const set = (x: number, y: number) => {
      el.style.setProperty('--mx', `${x * 100}%`);
      el.style.setProperty('--my', `${y * 100}%`);
      el.style.setProperty('--rx', `${(x - 0.5) * maxDeg}deg`);
      el.style.setProperty('--ry', `${(0.5 - y) * maxDeg}deg`);
      el.style.setProperty('--hyp', String(clamp(Math.hypot(x - 0.5, y - 0.5) * 2, 0, 1)));
    };
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      el.classList.add('is-tilting');
      set(clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1));
    };
    const leave = () => { el.classList.remove('is-tilting'); set(0.5, 0.5); };
    // phones: tilting the device moves the light (where the browser allows it without asking)
    const orient = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      set(0.5 + clamp(e.gamma / 50, -0.5, 0.5), 0.5 + clamp((e.beta - 45) / 50, -0.5, 0.5));
    };
    leave();
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    const touch = window.matchMedia?.('(pointer: coarse)').matches;
    if (touch) window.addEventListener('deviceorientation', orient);
    return () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
      window.removeEventListener('deviceorientation', orient);
    };
  }, [ref, enabled, maxDeg]);
}

export type BurstKind = 'tear' | 'gold' | 'rainbow' | 'stars';
const COLORS: Record<BurstKind, string[]> = {
  tear: ['#f6ead3', '#d9c9aa', '#ffd78c', '#ffffff'],
  gold: ['#ffe08a', '#ffc94d', '#fff3c4', '#f2b96a'],
  rainbow: ['#ff6b6b', '#ffd93d', '#6bff95', '#6bc8ff', '#c86bff', '#ffffff'],
  stars: ['#ffd93d', '#ffffff', '#ff9a6b'],
};

/** A one-shot spray of particles from a point (percent of its box): wrapper scraps, sparks, or stars. */
export function Burst({ kind, count = 18, x = 50, y = 50, spread = 160 }: { kind: BurstKind; count?: number; x?: number; y?: number; spread?: number }) {
  // drawn once per mount: the parent remounts it (with a key) for a new burst
  const [parts] = useState(() => Array.from({ length: count }, (_, i) => {
    const angle = kind === 'tear' ? -Math.PI / 2 + (Math.random() - 0.5) * 2.2 : (i / count) * Math.PI * 2 + Math.random() * 0.5;
    const dist = spread * (0.45 + Math.random() * 0.75);
    return {
      dx: Math.cos(angle) * dist, dy: Math.sin(angle) * dist + (kind === 'tear' ? 40 : 0),
      rot: (Math.random() - 0.5) * 720, delay: Math.random() * 120, dur: 650 + Math.random() * 500,
      size: kind === 'stars' ? 10 + Math.random() * 6 : 4 + Math.random() * 6,
      color: COLORS[kind][i % COLORS[kind].length],
    };
  }));
  return (
    <div aria-hidden className={`tcg-burst tcg-burst-${kind}`} style={{ left: `${x}%`, top: `${y}%` }}>
      {parts.map((p, i) => (
        <span key={i} style={{
          ['--dx' as string]: `${p.dx}px`, ['--dy' as string]: `${p.dy}px`, ['--rot' as string]: `${p.rot}deg`,
          width: p.size, height: kind === 'tear' ? p.size * 1.6 : p.size, background: kind === 'stars' ? 'none' : p.color, color: p.color,
          animationDelay: `${p.delay}ms`, animationDuration: `${p.dur}ms`,
        }}>{kind === 'stars' ? '✦' : null}</span>
      ))}
    </div>
  );
}
