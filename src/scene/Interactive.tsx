import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html, Sparkles } from '@react-three/drei';
import type { SceneObjectId } from '../domain/types';
import { useStore } from '../state/store';
import { useMedia } from '../state/hooks';
import { PIN_ICON, useFirstRun, useRoomInfo } from './roomInfo';

interface Props {
  id: SceneObjectId;
  label: string;
  hint?: string;
  /** Rough bounds; only used to size the celebration sparkles. */
  box: { size: [number, number, number]; center: [number, number, number] };
  /** World position of the hotspot pin. */
  pin: [number, number, number];
  /** Optional invisible, slightly larger hit area — only for small objects that are hard to click. */
  hit?: { size: [number, number, number]; center: [number, number, number] };
  reduceMotion: boolean;
  children: ReactNode;
}

const RIM = new THREE.Color('#ff9a3c');

/**
 * A clickable room object. The object itself warms with a soft amber glow on hover/selection
 * (no outline box), and a precise DOM hotspot pin gives a reliable, keyboard-focusable click target
 * with a live preview card. It only reads UI state; it never stores personal data.
 */
export function Interactive({ id, label, box, pin, hit, reduceMotion, children }: Props) {
  const selected = useStore((s) => s.selected === id);
  const hovered = useStore((s) => s.hovered === id);
  const pulse = useStore((s) => s.pulse[id]);
  const select = useStore((s) => s.select);
  const hover = useStore((s) => s.hover);
  const info = useRoomInfo(id);
  const firstRun = useFirstRun();
  const group = useRef<THREE.Group>(null);
  const glow = useRef(0);
  const pulseStart = useRef(-10);
  const [celebrating, setCelebrating] = useState(false);

  // The pin is DOM inside the canvas container. R3F listens natively on that container, so a click on the pin
  // would also register as a 'missed' click and deselect. Handle it natively and stop it there. (Html mounts its
  // children asynchronously, so bind from a callback ref rather than an effect.)
  const bindPin = (el: HTMLButtonElement | null) => {
    if (!el || el.dataset.bound) return;
    el.dataset.bound = '1';
    const stop = (e: Event) => e.stopPropagation();
    el.addEventListener('pointerdown', stop);
    el.addEventListener('pointerup', stop);
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const st = useStore.getState();
      st.select(st.selected === id ? null : id);
    });
  };

  useEffect(() => {
    document.body.style.cursor = hovered ? 'pointer' : '';
    return () => { document.body.style.cursor = ''; };
  }, [hovered]);

  useEffect(() => {
    if (!pulse) return;
    pulseStart.current = performance.now() / 1000;
    if (pulse.celebrate && !reduceMotion) {
      setCelebrating(true);
      const t = setTimeout(() => setCelebrating(false), 2800);
      return () => clearTimeout(t);
    }
  }, [pulse, reduceMotion]);

  useFrame(({ invalidate }, dt) => {
    const since = performance.now() / 1000 - pulseStart.current;
    const pulsing = since < 1.6 && !reduceMotion;
    const target = Math.max(selected ? 0.3 : hovered ? 0.6 : 0, pulsing ? Math.sin((since / 1.6) * Math.PI) : 0);
    const before = glow.current;
    glow.current += (target - before) * Math.min(1, dt * 8);
    if (Math.abs(target - glow.current) < 0.004) glow.current = target;
    const g = glow.current;
    if (g === 0 && before === 0) return;
    group.current?.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (!(o as THREE.Mesh).isMesh || !m || !m.isMeshStandardMaterial) return;
      if (m.userData.skipGlow === undefined) m.userData.skipGlow = m.emissiveIntensity > 0.05 && m.emissive.getHex() !== 0;
      if (m.userData.skipGlow) return;
      if (g === 0) { m.emissive.setRGB(0, 0, 0); m.emissiveIntensity = 1; }
      else { m.emissive.copy(RIM); m.emissiveIntensity = g * 0.28; }
    });
    if (g !== target) invalidate();
  });

  const wide = useMedia('(min-width: 640px)');
  const anyHover = useStore((s) => s.hovered !== null);
  const anySelected = useStore((s) => s.selected !== null);
  // Hints appear only on hover/focus. A brand-new room shows just one starting prompt (on the desk, not on phones where pins are close together),
  // and it steps aside as soon as anything is hovered or opened.
  const showChip = hovered || (wide && firstRun && id === 'desk' && !!info.prompt && !anyHover && !anySelected);
  const pinProps = {
    onMouseEnter: () => hover(id),
    onMouseLeave: () => hover(null),
    onFocus: () => hover(id),
    onBlur: () => hover(null),
  };

  return (
    <group
      ref={group}
      onPointerOver={(e) => { e.stopPropagation(); hover(id); }}
      onPointerOut={() => hover(null)}
      onClick={(e) => { e.stopPropagation(); select(selected ? null : id); }}
    >
      {children}
      {hit && (
        <mesh position={hit.center}>
          <boxGeometry args={hit.size} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </mesh>
      )}
      <Html position={pin} center zIndexRange={hovered ? [40, 30] : [12, 0]} style={{ pointerEvents: 'none', display: anySelected && !wide ? 'none' : undefined }}>
        <div className="relative flex flex-col items-center">
          <button
            type="button" ref={bindPin} {...pinProps} aria-label={`${label}: ${info.summary}`} aria-pressed={selected} tabIndex={-1}
            className={`room-pin ${selected ? 'is-selected' : ''} ${reduceMotion ? 'no-motion' : ''} ${anyHover && !hovered ? 'is-dimmed' : ''}`}
          >
            <span aria-hidden>{PIN_ICON[id]}</span>
          </button>
          {showChip && !selected && (
            <div className="room-chip" role="tooltip">
              <strong>{label}</strong>
              <span>{firstRun && info.prompt ? info.prompt : info.summary}</span>
            </div>
          )}
        </div>
      </Html>
      {celebrating && (
        <Sparkles count={26} scale={[box.size[0] * 1.1, box.size[1] * 1.1, box.size[2] * 1.1]} position={box.center} size={4} speed={0.5} color="#f7e2a8" opacity={0.9} />
      )}
    </group>
  );
}

