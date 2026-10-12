import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import { useStore } from '../state/store';
import { useToday } from '../state/hooks';
import { agendaItems, dailyProgress, goalProgress, plantGrowth, projectProgress, isOpen } from '../domain/services';
import { drawCalendarTexture, drawMonitorTexture } from './textures';
import { Interactive } from './Interactive';

const PALETTE = ['#7d8f6a', '#a65f4a', '#4f6b7d', '#b58b4a', '#6b5a7a', '#3f5e52', '#c18a6b', '#5b6f8a', '#8b6b4a'];
const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const WOOD = '#a97b4f';
const WOOD_DARK = '#6e4b30';

/* ───────────────────────── Desk (Daily HQ) ───────────────────────── */

export function Desk({ reduceMotion, evening }: { reduceMotion: boolean; evening: boolean }) {
  const tasks = useStore((s) => s.data.tasks);
  const today = useToday();
  const prog = useMemo(() => dailyProgress(tasks, today), [tasks, today]);
  const sheets = Math.min(9, tasks.filter(isOpen).length);

  const texRef = useRef<THREE.CanvasTexture | null>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  useEffect(() => {
    texRef.current = drawMonitorTexture(texRef.current, prog.done, prog.total, prog.ratio);
    if (matRef.current) { matRef.current.map = texRef.current; matRef.current.needsUpdate = true; }
  }, [prog.done, prog.total, prog.ratio]);

  return (
    <Interactive
      id="desk" label="Daily HQ" hint="Today's tasks & priorities" reduceMotion={reduceMotion}
      box={{ size: [2.6, 1.55, 2.2], center: [-0.3, 0.8, -1.55] }} pin={[-0.3, 2.0, -2.3]}
    >
      <group position={[-0.3, 0, -2.0]}>
        {/* top, legs, drawer */}
        <RoundedBox args={[2.4, 0.07, 1.0]} radius={0.025} smoothness={3} position={[0, 0.76, 0]} castShadow receiveShadow>
          <meshStandardMaterial color={WOOD} roughness={0.55} />
        </RoundedBox>
        {[[-1.12, -0.42], [1.12, -0.42], [-1.12, 0.42], [1.12, 0.42]].map(([x, z], i) => (
          <mesh key={i} position={[x, 0.38, z]} castShadow>
            <boxGeometry args={[0.06, 0.76, 0.06]} /><meshStandardMaterial color={WOOD_DARK} roughness={0.6} />
          </mesh>
        ))}
        <mesh position={[0.7, 0.62, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.8, 0.28, 0.85]} /><meshStandardMaterial color={WOOD} roughness={0.6} />
        </mesh>
        <mesh position={[0.7, 0.62, 0.43]}><boxGeometry args={[0.2, 0.025, 0.02]} /><meshStandardMaterial color="#2a2520" metalness={0.6} roughness={0.3} /></mesh>

        {/* monitor */}
        <group position={[-0.1, 0.8, -0.28]}>
          <mesh position={[0, 0.02, 0]} castShadow><boxGeometry args={[0.35, 0.02, 0.2]} /><meshStandardMaterial color="#2c2c2c" roughness={0.4} metalness={0.5} /></mesh>
          <mesh position={[0, 0.17, -0.02]} castShadow><boxGeometry args={[0.05, 0.3, 0.04]} /><meshStandardMaterial color="#2c2c2c" roughness={0.4} metalness={0.5} /></mesh>
          <RoundedBox args={[1.0, 0.6, 0.04]} radius={0.015} smoothness={3} position={[0, 0.56, 0]} castShadow>
            <meshStandardMaterial color="#232323" roughness={0.35} metalness={0.4} />
          </RoundedBox>
          <mesh position={[0, 0.56, 0.023]}>
            <planeGeometry args={[0.93, 0.53]} />
            <meshBasicMaterial ref={matRef} color="#ffffff" toneMapped={false} />
          </mesh>
        </group>

        {/* keyboard + mouse */}
        <RoundedBox args={[0.46, 0.02, 0.15]} radius={0.008} position={[-0.1, 0.81, 0.25]} castShadow><meshStandardMaterial color="#d9d3c6" roughness={0.6} /></RoundedBox>
        <RoundedBox args={[0.07, 0.025, 0.11]} radius={0.01} position={[0.3, 0.81, 0.25]} castShadow><meshStandardMaterial color="#d9d3c6" roughness={0.6} /></RoundedBox>

        {/* lamp */}
        <group position={[-0.95, 0.795, -0.25]}>
          <mesh castShadow><cylinderGeometry args={[0.1, 0.12, 0.03, 24]} /><meshStandardMaterial color="#2a2a2a" metalness={0.6} roughness={0.35} /></mesh>
          <mesh position={[0, 0.25, 0]} rotation={[0, 0, 0.12]} castShadow><cylinderGeometry args={[0.01, 0.01, 0.5, 8]} /><meshStandardMaterial color="#2a2a2a" metalness={0.6} roughness={0.35} /></mesh>
          <mesh position={[0.05, 0.5, 0.05]} rotation={[0.35, 0, 0.1]} castShadow>
            <coneGeometry args={[0.14, 0.17, 24, 1, true]} /><meshStandardMaterial color="#d7a66a" side={THREE.DoubleSide} emissive="#ffb050" emissiveIntensity={evening ? 4 : 0.35} toneMapped={false} roughness={0.7} />
          </mesh>
          <pointLight position={[0.06, 0.45, 0.12]} color="#ffc27a" intensity={evening ? 1 : 0.8} distance={4} decay={2} />
        </group>

        {/* mug */}
        <group position={[0.55, 0.795, 0.25]}>
          <mesh castShadow><cylinderGeometry args={[0.05, 0.045, 0.1, 20]} /><meshStandardMaterial color="#f1ece0" roughness={0.3} /></mesh>
          <mesh position={[0, 0.045, 0]}><cylinderGeometry args={[0.042, 0.042, 0.01, 20]} /><meshStandardMaterial color="#4a2e1e" roughness={0.4} /></mesh>
          <mesh position={[0.06, 0, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.025, 0.007, 8, 14, Math.PI]} /><meshStandardMaterial color="#f1ece0" roughness={0.3} /></mesh>
        </group>

        {/* open-task paper stack: one sheet per open task (max 9) */}
        <group position={[-0.78, 0.8, 0.22]}>
          {Array.from({ length: sheets }, (_, i) => (
            <mesh key={i} position={[(i % 2) * 0.004, 0.004 + i * 0.0045, 0]} rotation={[0, ((i * 37) % 11) * 0.03 - 0.15, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.28, 0.004, 0.38]} /><meshStandardMaterial color="#fbf8f2" roughness={0.9} />
            </mesh>
          ))}
        </group>

        {/* chair */}
        <group position={[0, 0, 0.95]} rotation={[0, 0.12, 0]}>
          <RoundedBox args={[0.56, 0.08, 0.54]} radius={0.03} smoothness={3} position={[0, 0.48, 0]} castShadow receiveShadow><meshStandardMaterial color="#6f7f62" roughness={0.85} /></RoundedBox>
          <RoundedBox args={[0.54, 0.55, 0.07]} radius={0.03} smoothness={3} position={[0, 0.85, 0.26]} rotation={[-0.08, 0, 0]} castShadow><meshStandardMaterial color="#6f7f62" roughness={0.85} /></RoundedBox>
          <mesh position={[0, 0.25, 0]} castShadow><cylinderGeometry args={[0.03, 0.03, 0.4, 10]} /><meshStandardMaterial color="#2a2a2a" metalness={0.6} roughness={0.4} /></mesh>
          {[0, 1, 2, 3, 4].map((i) => (
            <mesh key={i} position={[Math.cos((i / 5) * 6.283) * 0.18, 0.04, Math.sin((i / 5) * 6.283) * 0.18]} rotation={[0, -(i / 5) * 6.283, 0]} castShadow>
              <boxGeometry args={[0.36, 0.03, 0.04]} /><meshStandardMaterial color="#2a2a2a" metalness={0.6} roughness={0.4} />
            </mesh>
          ))}
        </group>
      </group>
    </Interactive>
  );
}

/* ───────────────────────── Notebook ───────────────────────── */

export function Notebook({ reduceMotion }: { reduceMotion: boolean }) {
  const count = useStore((s) => s.data.notes.length);
  const t = 0.022 + Math.min(count, 40) * 0.0026;
  return (
    <Interactive
      id="notebook" label="Notebook" hint="Notes, journal & reviews" reduceMotion={reduceMotion}
      box={{ size: [0.62, 0.22, 0.78], center: [0.55, 0.9, -1.8] }} pin={[0.55, 1.25, -1.8]} hit={{ size: [0.7, 0.3, 0.85], center: [0.55, 0.93, -1.8] }}
    >
      <group position={[0.55, 0.795, -1.8]} rotation={[0, -0.28, 0]} scale={1.2}>
        <RoundedBox args={[0.4, t, 0.55]} radius={0.008} smoothness={3} position={[0, t / 2, 0]} castShadow receiveShadow><meshStandardMaterial color="#3f5e52" roughness={0.65} /></RoundedBox>
        <mesh position={[0.012, t + 0.001, 0]}><boxGeometry args={[0.37, 0.004, 0.52]} /><meshStandardMaterial color="#4b6e60" roughness={0.65} /></mesh>
        <mesh position={[0.1, t + 0.004, 0]}><boxGeometry args={[0.018, 0.004, 0.55]} /><meshStandardMaterial color="#d4a84b" roughness={0.4} metalness={0.4} /></mesh>
        <mesh position={[-0.01, t + 0.005, 0.15]}><boxGeometry args={[0.1, 0.002, 0.07]} /><meshStandardMaterial color="#f1e6cd" roughness={0.9} /></mesh>
        <mesh position={[0, -0.001 + t / 2, 0.278]}><boxGeometry args={[0.38, t * 0.82, 0.006]} /><meshStandardMaterial color="#f4ecd8" roughness={0.95} /></mesh>
        {/* pen */}
        <mesh position={[-0.28, 0.015, 0.1]} rotation={[Math.PI / 2, 0, 0.35]} castShadow><cylinderGeometry args={[0.009, 0.009, 0.3, 10]} /><meshStandardMaterial color="#c06c46" roughness={0.4} /></mesh>
      </group>
    </Interactive>
  );
}

/* ───────────────────────── Bookshelf (Projects & goals) ───────────────────────── */

const FILLER = ['#5b2e2a', '#2f4a5e', '#6b4a2a', '#3a3a5e', '#7a5a2f', '#2d4b3f', '#8a4a3a', '#3d3350', '#a37b3c'];

/** Deterministic row of decorative books (and the odd leaning/flat one) between x=from..to. */
function FillerBooks({ y, from, to, seed }: { y: number; from: number; to: number; seed: number }) {
  const items = useMemo(() => {
    let r = seed * 9301 + 49297;
    const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
    const out: { x: number; th: number; h: number; c: string; lean: number; flat: boolean }[] = [];
    let x = from;
    while (x < to - 0.06) {
      const th = 0.06 + rnd() * 0.08;
      if (x + th > to) break;
      const flat = rnd() < 0.08 && to - x > 0.3;
      out.push({ x: x + th / 2, th, h: 0.3 + rnd() * 0.25, c: FILLER[Math.floor(rnd() * FILLER.length)], lean: rnd() < 0.07 ? 0.22 : 0, flat });
      x += flat ? 0.3 : th + 0.006;
    }
    return out;
  }, [from, to, seed]);
  return (
    <group position={[0, y, 0.02]}>
      {items.map((b, i) => b.flat ? (
        <group key={i} position={[b.x + 0.12, 0.03, 0]}>
          <mesh castShadow><boxGeometry args={[0.26, 0.04, 0.2]} /><meshStandardMaterial color={b.c} roughness={0.7} /></mesh>
          <mesh position={[0, 0.045, 0]} castShadow><boxGeometry args={[0.24, 0.04, 0.19]} /><meshStandardMaterial color={FILLER[(i + 3) % FILLER.length]} roughness={0.7} /></mesh>
        </group>
      ) : (
        <group key={i} position={[b.x, b.h / 2, 0]} rotation={[0, 0, b.lean]}>
          <mesh castShadow receiveShadow><boxGeometry args={[b.th, b.h, 0.26]} /><meshStandardMaterial color={b.c} roughness={0.75} /></mesh>
          <mesh position={[0, b.h * 0.25, 0.132]}><boxGeometry args={[b.th * 0.9, 0.012, 0.004]} /><meshStandardMaterial color="#d9c08a" roughness={0.5} /></mesh>
        </group>
      ))}
    </group>
  );
}

export function Bookshelf({ reduceMotion }: { reduceMotion: boolean }) {
  const { projects, tasks, milestones, goals } = useStore((s) => s.data);

  const { books, ends } = useMemo(() => {
    const ordered = [...projects].sort((a, b) => (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0)).slice(0, 16);
    let x = -0.85, shelf = 0;
    const list = ordered.map((p) => {
      const pr = projectProgress(p, tasks, milestones);
      const th = 0.09 + Math.min(pr.total, 12) * 0.012;
      const h = 0.4 + (hash(p.id) % 5) * 0.04;
      if (x + th > 0.88) { x = -0.85; shelf++; }
      const bx = x + th / 2;
      x += th + 0.012;
      return { p, pr, th, h, x: bx, shelf: Math.min(shelf, 1) };
    });
    // where free space begins on each of the two middle shelves (ornamental filler books go after it)
    const ends: [number, number] = shelf >= 1 ? [0.9, x] : [x, -0.85];
    return { books: list, ends };
  }, [projects, tasks, milestones]);

  const jars = useMemo(() => goals.slice(0, 5).map((g) => ({ g, pr: goalProgress(g) })), [goals]);
  const SHELF_Y = [0.05, 0.68, 1.31, 1.94, 2.57];

  return (
    <Interactive
      id="bookshelf" label="Projects & Goals" hint="Books = projects · jars = goals" reduceMotion={reduceMotion}
      box={{ size: [2.1, 2.65, 0.55], center: [-2.9, 1.32, -3.22] }} pin={[-2.9, 3.15, -3.1]}
    >
      <group position={[-2.9, 0, -3.22]}>
        {/* carcass */}
        {[-0.98, 0.98].map((x) => (
          <mesh key={x} position={[x, 1.3, 0]} castShadow receiveShadow><boxGeometry args={[0.06, 2.6, 0.45]} /><meshStandardMaterial color={WOOD_DARK} roughness={0.6} /></mesh>
        ))}
        {SHELF_Y.map((y) => (
          <mesh key={y} position={[0, y, 0]} castShadow receiveShadow><boxGeometry args={[2.0, 0.05, 0.45]} /><meshStandardMaterial color={WOOD_DARK} roughness={0.6} /></mesh>
        ))}
        <mesh position={[0, 1.3, -0.215]} receiveShadow><boxGeometry args={[1.95, 2.55, 0.02]} /><meshStandardMaterial color="#8a6340" roughness={0.8} /></mesh>

        {/* project books: height & thickness grow with content, lit band = progress */}
        {books.map(({ p, pr, th, h, x, shelf }) => {
          const color = PALETTE[hash(p.id) % PALETTE.length];
          const paused = p.status === 'paused';
          const y = SHELF_Y[shelf + 1] + 0.025 + h / 2; // books live on the two middle shelves
          return (
            <group key={p.id} position={[x, y, paused ? -0.04 : 0.02]}>
              <mesh castShadow receiveShadow><boxGeometry args={[th, h, 0.28]} /><meshStandardMaterial color={color} roughness={0.7} transparent={paused} opacity={paused ? 0.75 : 1} /></mesh>
              {pr.ratio > 0 && (
                <mesh position={[0, -h / 2 + (h * pr.ratio) / 2, 0.142]}>
                  <boxGeometry args={[th * 0.9, h * pr.ratio, 0.006]} /><meshStandardMaterial color="#f1e3bf" roughness={0.6} emissive="#f1e3bf" emissiveIntensity={0.12} />
                </mesh>
              )}
              <mesh position={[0, h / 2 - 0.06, 0.145]}><boxGeometry args={[th * 0.9, 0.012, 0.006]} /><meshStandardMaterial color="#e9d9a8" /></mesh>
              {p.status === 'done' && (
                <mesh position={[0, -h / 2 - 0.03, 0.12]}><boxGeometry args={[0.02, 0.1, 0.01]} /><meshStandardMaterial color="#d4a84b" metalness={0.5} roughness={0.35} /></mesh>
              )}
            </group>
          );
        })}

        {/* goal jars fill with progress */}
        {jars.map(({ g, pr }, i) => (
          <group key={g.id} position={[-0.68 + i * 0.34, SHELF_Y[3] + 0.025, 0.02]}>
            <mesh position={[0, 0.14, 0]}><cylinderGeometry args={[0.1, 0.1, 0.28, 24]} /><meshPhysicalMaterial color="#e6f0ee" transparent opacity={0.28} roughness={0.05} transmission={0} /></mesh>
            {pr > 0 && (
              <mesh position={[0, 0.01 + (0.25 * pr) / 2, 0]}>
                <cylinderGeometry args={[0.085, 0.085, 0.25 * pr, 24]} /><meshStandardMaterial color={pr >= 1 ? '#d4a84b' : '#8bb27a'} roughness={0.5} />
              </mesh>
            )}
            <mesh position={[0, 0.3, 0]}><cylinderGeometry args={[0.065, 0.075, 0.04, 16]} /><meshStandardMaterial color={WOOD} roughness={0.6} /></mesh>
          </group>
        ))}

        {/* ornamental filler books make the shelves feel lived-in (plain spines: no progress band = not data) */}
        <FillerBooks y={SHELF_Y[1] + 0.025} from={ends[0] + 0.03} to={0.9} seed={1} />
        <FillerBooks y={SHELF_Y[2] + 0.025} from={ends[1] + 0.03} to={0.9} seed={2} />
        <FillerBooks y={SHELF_Y[0] + 0.025} from={-0.88} to={-0.12} seed={3} />
        <FillerBooks y={SHELF_Y[3] + 0.025} from={0.82} to={0.92} seed={5} />

        {/* decor: always-there ornaments, not data */}
        <mesh position={[0.62, SHELF_Y[4] + 0.17, 0.0]} castShadow><cylinderGeometry args={[0.07, 0.1, 0.3, 20]} /><meshStandardMaterial color="#d6cdb8" roughness={0.4} /></mesh>
        <mesh position={[0.55, 0.025 + 0.12, 0.02]} castShadow><boxGeometry args={[0.4, 0.22, 0.3]} /><meshStandardMaterial color="#b89a72" roughness={0.9} /></mesh>
        <mesh position={[0.1, 0.025 + 0.11, 0.02]} castShadow><boxGeometry args={[0.35, 0.2, 0.3]} /><meshStandardMaterial color="#9c7e58" roughness={0.9} /></mesh>
      </group>
    </Interactive>
  );
}

/* ───────────────────────── Plants (Habits) ───────────────────────── */

const LEAF_GEO = new THREE.SphereGeometry(1, 10, 8);

function PlantModel({ size, vigor, stage, phase, reduceMotion, scale = 1 }: { size: number; vigor: number; stage: number; phase: number; reduceMotion: boolean; scale?: number }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (g.current && !reduceMotion) g.current.rotation.z = Math.sin(clock.elapsedTime * 0.8 + phase) * 0.025 * (0.3 + size);
  });
  const color = useMemo(() => new THREE.Color('#a3b86a').lerp(new THREE.Color('#4f8a4c'), (vigor - 0.7) / 0.3), [vigor]);
  const stemH = 0.1 + size * 0.55;
  const n = stage === 0 ? 0 : 3 + Math.round(size * 11);
  const leaves = useMemo(() => Array.from({ length: n }, (_, i) => {
    const f = n > 1 ? i / (n - 1) : 0;
    const a = i * 2.4;
    const r = 0.03 + (0.04 + size * 0.1) * (1 - f * 0.5);
    return { a, y: stemH * (0.3 + 0.7 * f), r, s: (0.06 + size * 0.07) * (1 - f * 0.35) };
  }), [n, size, stemH]);
  return (
    <group ref={g} scale={scale}>
      {stage === 0 ? (
        <mesh position={[0, 0.005, 0]} scale={[1, 0.5, 1]}><sphereGeometry args={[0.025, 10, 8]} /><meshStandardMaterial color="#5a3d28" roughness={1} /></mesh>
      ) : (
        <>
          <mesh position={[0, stemH / 2, 0]} castShadow><cylinderGeometry args={[0.008, 0.013, stemH, 8]} /><meshStandardMaterial color="#5f7d4a" roughness={0.8} /></mesh>
          {leaves.map((l, i) => (
            <mesh key={i} geometry={LEAF_GEO} position={[Math.cos(l.a) * l.r, l.y, Math.sin(l.a) * l.r]} rotation={[0, -l.a, 0.55]} scale={[l.s, l.s * 0.22, l.s * 0.6]} castShadow>
              <meshStandardMaterial color={color} roughness={0.7} />
            </mesh>
          ))}
          {stage >= 4 && (
            <mesh position={[0, stemH + 0.02, 0]}><sphereGeometry args={[0.035, 12, 10]} /><meshStandardMaterial color="#e8a79a" roughness={0.5} emissive="#e8a79a" emissiveIntensity={0.15} /></mesh>
          )}
        </>
      )}
    </group>
  );
}

function Pot({ r = 0.115, h = 0.17, color = '#c9a07a' }: { r?: number; h?: number; color?: string }) {
  return (
    <>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow><cylinderGeometry args={[r, r * 0.75, h, 20]} /><meshStandardMaterial color={color} roughness={0.75} /></mesh>
      <mesh position={[0, h - 0.004, 0]}><cylinderGeometry args={[r * 0.92, r * 0.92, 0.012, 20]} /><meshStandardMaterial color="#4a3426" roughness={1} /></mesh>
    </>
  );
}

export function Plants({ reduceMotion }: { reduceMotion: boolean }) {
  const { habits, habitLogs } = useStore((s) => s.data);
  const today = useToday();
  const shown = useMemo(
    () => habits.filter((h) => !h.archived).slice(0, 8).map((h) => ({ h, g: plantGrowth(h, habitLogs, today) })),
    [habits, habitLogs, today],
  );
  const hero = useMemo(() => {
    if (!shown.length) return { size: 0.25, vigor: 0.85, stage: 1 };
    const avg = shown.reduce((a, s) => a + s.g.size, 0) / shown.length;
    const vig = shown.reduce((a, s) => a + s.g.vigor, 0) / shown.length;
    return { size: Math.min(1, 0.25 + avg * 0.75), vigor: vig, stage: avg > 0.85 ? 4 : 2 };
  }, [shown]);
  const pots = ['#c9a07a', '#b9b3a2', '#d9cdb4', '#a98f78'];

  return (
    <Interactive
      id="plants" label="Habits & Routines" hint="Plants grow as you stay consistent" reduceMotion={reduceMotion}
      box={{ size: [2.5, 1.15, 0.7], center: [2.4, 0.7, -3.15] }} pin={[2.4, 1.55, -3.0]} hit={{ size: [2.5, 0.95, 0.6], center: [2.4, 0.85, -3.15] }}
    >
      <group>
        {/* bench */}
        <mesh position={[2.4, 0.43, -3.15]} castShadow receiveShadow><boxGeometry args={[2.5, 0.05, 0.5]} /><meshStandardMaterial color={WOOD} roughness={0.55} /></mesh>
        {[-1.15, 1.15].map((dx) => (
          <mesh key={dx} position={[2.4 + dx, 0.2, -3.15]} castShadow><boxGeometry args={[0.05, 0.4, 0.44]} /><meshStandardMaterial color={WOOD_DARK} roughness={0.6} /></mesh>
        ))}
        {shown.map(({ h, g }, i) => {
          const x = 2.4 - 1.05 + (i * 2.1) / Math.max(7, shown.length - 1);
          return (
            <group key={h.id} position={[x, 0.455, -3.15 + (i % 2) * 0.05]}>
              <Pot color={pots[hash(h.id) % pots.length]} />
              <group position={[0, 0.17, 0]}><PlantModel size={g.size} vigor={g.vigor} stage={g.stage} phase={i * 1.7} reduceMotion={reduceMotion} /></group>
            </group>
          );
        })}
        {shown.length === 0 && (
          <group position={[2.4, 0.455, -3.15]}><Pot /><mesh position={[0, 0.19, 0]}><sphereGeometry args={[0.02, 8, 6]} /><meshStandardMaterial color="#5a3d28" /></mesh></group>
        )}
        {/* floor plant: grows with your overall consistency */}
        <group position={[3.5, 0, -1.6]}>
          <Pot r={0.22} h={0.34} color="#d5c8b0" />
          <group position={[0, 0.34, 0]}><PlantModel size={hero.size} vigor={hero.vigor} stage={hero.stage} phase={0.5} reduceMotion={reduceMotion} scale={2.6} /></group>
        </group>
      </group>
    </Interactive>
  );
}

/* ───────────────────────── Wall calendar ───────────────────────── */

export function WallCalendar({ reduceMotion }: { reduceMotion: boolean }) {
  const data = useStore((s) => s.data);
  const today = useToday();
  const texRef = useRef<THREE.CanvasTexture | null>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const items = useMemo(() => agendaItems(data), [data]);
  useEffect(() => {
    texRef.current = drawCalendarTexture(texRef.current, data, today);
    if (matRef.current) { matRef.current.map = texRef.current; matRef.current.needsUpdate = true; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, today]);
  return (
    <Interactive
      id="calendar" label="Schedule" hint="Events, deadlines & reminders" reduceMotion={reduceMotion}
      box={{ size: [2.4, 1.8, 0.2], center: [2.4, 2.4, -3.4] }} pin={[2.4, 3.55, -3.3]}
    >
      <group position={[2.4, 2.4, -3.44]}>
        <RoundedBox args={[2.4, 1.78, 0.05]} radius={0.02} smoothness={3} castShadow receiveShadow><meshStandardMaterial color={WOOD_DARK} roughness={0.55} /></RoundedBox>
        <mesh position={[0, 0, 0.028]}><planeGeometry args={[2.28, 1.66]} /><meshBasicMaterial ref={matRef} color="#a9a7b8" toneMapped={false} /></mesh>
        <mesh position={[0, 0.92, 0.02]}><cylinderGeometry args={[0.025, 0.025, 0.05, 10]} /><meshStandardMaterial color="#d4a84b" metalness={0.6} roughness={0.35} /></mesh>
      </group>
    </Interactive>
  );
}
