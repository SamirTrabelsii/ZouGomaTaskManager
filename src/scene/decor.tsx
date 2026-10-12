import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { CozyExtras } from './cozy';
import { PirateGoodies } from './onepiece';


/**
 * Purely decorative props that make the room feel lived-in. They carry no data and are not clickable
 * (raycast disabled), so they never get in the way of the five interactive objects.
 */
const noRay = () => null;

export function Decor({ evening, reduceMotion, rain }: { evening: boolean; reduceMotion: boolean; rain: boolean }) {
  return (
    <group>
      <SleepingCat reduceMotion={reduceMotion} />
      <FloorCorner evening={evening} />
      <Steam reduceMotion={reduceMotion} />
      <DeskExtras />
      <WallExtras reduceMotion={reduceMotion} />
      <Candle reduceMotion={reduceMotion} />
      <CozyExtras evening={evening} reduceMotion={reduceMotion} />
      <PirateGoodies evening={evening} reduceMotion={reduceMotion} />
      {rain && <Rain reduceMotion={reduceMotion} />}
    </group>
  );
}

/* ───────── Cat napping on the rug ───────── */
function SleepingCat({ reduceMotion }: { reduceMotion: boolean }) {
  const body = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (body.current && !reduceMotion) body.current.scale.y = 0.14 * (1 + Math.sin(clock.elapsedTime * 1.4) * 0.05);
  });
  const fur = '#c98a52', light = '#f1dcc0';
  return (
    <group position={[0.85, 0.006, -0.35]} rotation={[0, 0.7, 0]} raycast={noRay}>
      <mesh ref={body} position={[0, 0.12, 0]} scale={[0.3, 0.14, 0.2]} castShadow><sphereGeometry args={[1, 20, 14]} /><meshStandardMaterial color={fur} roughness={0.9} /></mesh>
      <mesh position={[0.27, 0.12, 0.1]} castShadow><sphereGeometry args={[0.11, 16, 12]} /><meshStandardMaterial color={fur} roughness={0.9} /></mesh>
      <mesh position={[0.34, 0.1, 0.15]} scale={[1, 0.7, 1]}><sphereGeometry args={[0.055, 12, 10]} /><meshStandardMaterial color={light} roughness={0.9} /></mesh>
      {[0.07, 0.15].map((z, i) => (
        <mesh key={i} position={[0.25, 0.22, z + 0.02]} rotation={[0.2, 0, i ? -0.2 : 0.2]}><coneGeometry args={[0.04, 0.07, 4]} /><meshStandardMaterial color={fur} roughness={0.9} /></mesh>
      ))}
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={i} position={[-0.3 - i * 0.05, 0.05 + i * 0.012, 0.1 + Math.sin(i * 0.9) * 0.1]} castShadow><sphereGeometry args={[0.05 - i * 0.004, 10, 8]} /><meshStandardMaterial color={i === 4 ? light : fur} roughness={0.9} /></mesh>
      ))}
      <mesh position={[0.1, 0.06, 0.2]} scale={[0.1, 0.04, 0.05]}><sphereGeometry args={[1, 10, 8]} /><meshStandardMaterial color={light} roughness={0.9} /></mesh>
    </group>
  );
}

/* ───────── Reading corner: cushion + floor lamp ───────── */
function FloorCorner({ evening }: { evening: boolean }) {
  return (
    <group raycast={noRay}>
      <mesh position={[-2.55, 0.1, 0.55]} scale={[1, 0.45, 1]} castShadow receiveShadow><cylinderGeometry args={[0.42, 0.45, 0.3, 28]} /><meshStandardMaterial color="#7a4b5e" roughness={0.95} /></mesh>
      <mesh position={[-2.55, 0.235, 0.55]} scale={[1, 0.3, 1]}><cylinderGeometry args={[0.3, 0.38, 0.1, 28]} /><meshStandardMaterial color="#8f5a6e" roughness={0.95} /></mesh>
      <group position={[-3.45, 0, 1.0]}>
        <mesh position={[0, 0.02, 0]} castShadow><cylinderGeometry args={[0.16, 0.18, 0.04, 20]} /><meshStandardMaterial color="#2a2a2a" metalness={0.6} roughness={0.4} /></mesh>
        <mesh position={[0, 0.75, 0]} castShadow><cylinderGeometry args={[0.014, 0.014, 1.5, 8]} /><meshStandardMaterial color="#2a2a2a" metalness={0.6} roughness={0.4} /></mesh>
        <mesh position={[0, 1.55, 0]} castShadow><cylinderGeometry args={[0.15, 0.25, 0.3, 24, 1, true]} /><meshStandardMaterial color="#e7c28a" side={THREE.DoubleSide} emissive="#ffb050" emissiveIntensity={evening ? 2.2 : 0.2} roughness={0.8} toneMapped={false} /></mesh>
        {evening && <pointLight position={[0, 1.45, 0]} color="#ffb264" intensity={3.2} distance={3.2} decay={2} />}
      </group>
      {/* a small stack of books on the rug */}
      {[[0, 0.03, 0.34, '#3d3350', 0.1], [0.02, 0.085, 0.3, '#8a4a3a', -0.15], [-0.01, 0.135, 0.26, '#2d4b3f', 0.2]].map(([x, y, w, c, r], i) => (
        <mesh key={i} position={[1.15 + (x as number), y as number, 0.45]} rotation={[0, r as number, 0]} castShadow receiveShadow>
          <boxGeometry args={[w as number, 0.05, 0.24]} /><meshStandardMaterial color={c as string} roughness={0.75} />
        </mesh>
      ))}
    </group>
  );
}

/* ───────── Steam rising from the mug ───────── */
function Steam({ reduceMotion }: { reduceMotion: boolean }) {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(({ clock }) => {
    refs.current.forEach((m, i) => {
      if (!m) return;
      const p = reduceMotion ? 0.3 : (clock.elapsedTime * 0.18 + i / 4) % 1;
      m.position.set(0.25 + Math.sin(p * 6 + i) * 0.02, 0.92 + p * 0.3, -1.75 + Math.cos(p * 5 + i) * 0.015);
      m.scale.setScalar(0.5 + p * 1.4);
      (m.material as THREE.MeshBasicMaterial).opacity = Math.sin(p * Math.PI) * 0.22;
    });
  });
  return (
    <group raycast={noRay}>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} ref={(el) => { refs.current[i] = el; }} raycast={noRay}>
          <sphereGeometry args={[0.025, 8, 6]} /><meshBasicMaterial color="#e8eefc" transparent opacity={0.15} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

/* ───────── Desk knick-knacks ───────── */
function DeskExtras() {
  return (
    <group raycast={noRay}>
      {/* tiny desk plant */}
      <group position={[0.78, 0.795, -2.3]}>
        <mesh position={[0, 0.04, 0]} castShadow><cylinderGeometry args={[0.045, 0.035, 0.08, 14]} /><meshStandardMaterial color="#d9cdb4" roughness={0.7} /></mesh>
        {[0, 1, 2, 3, 4].map((i) => (
          <mesh key={i} position={[Math.cos(i * 1.3) * 0.03, 0.12 + (i % 2) * 0.03, Math.sin(i * 1.3) * 0.03]} rotation={[0.5, i, 0.4]} scale={[0.04, 0.012, 0.025]} castShadow><sphereGeometry args={[1, 8, 6]} /><meshStandardMaterial color="#5f9a58" roughness={0.7} /></mesh>
        ))}
      </group>
      {/* photo frame */}
      <group position={[-0.72, 0.795, -2.36]} rotation={[-0.15, 0.25, 0]}>
        <mesh position={[0, 0.07, 0]} castShadow><boxGeometry args={[0.13, 0.15, 0.015]} /><meshStandardMaterial color="#6e4b30" roughness={0.6} /></mesh>
        <mesh position={[0, 0.07, 0.009]}><planeGeometry args={[0.1, 0.12]} /><meshStandardMaterial color="#8fa6c8" roughness={0.9} /></mesh>
        <mesh position={[0, 0.045, 0.011]}><planeGeometry args={[0.1, 0.05]} /><meshStandardMaterial color="#5c7a4a" roughness={0.9} /></mesh>
      </group>
      {/* headphones on a stand */}
      <group position={[-1.38, 0.795, -1.72]}>
        <mesh position={[0, 0.1, 0]} castShadow><cylinderGeometry args={[0.012, 0.012, 0.2, 8]} /><meshStandardMaterial color="#2a2a2a" metalness={0.5} roughness={0.4} /></mesh>
        <mesh position={[0, 0.01, 0]}><cylinderGeometry args={[0.06, 0.06, 0.02, 16]} /><meshStandardMaterial color="#2a2a2a" metalness={0.5} roughness={0.4} /></mesh>
        <mesh position={[0, 0.22, 0]} rotation={[0, 0, 0]} castShadow><torusGeometry args={[0.075, 0.012, 8, 20, Math.PI]} /><meshStandardMaterial color="#2c2c34" roughness={0.5} /></mesh>
        {[-0.075, 0.075].map((x) => <mesh key={x} position={[x, 0.2, 0]} castShadow><cylinderGeometry args={[0.032, 0.032, 0.03, 14]} /><meshStandardMaterial color="#c06c46" roughness={0.5} /></mesh>)}
      </group>
      {/* sticky notes on the monitor bezel */}
      <mesh position={[0.1, 1.5, -2.255]} rotation={[0, 0, 0.1]}><planeGeometry args={[0.07, 0.07]} /><meshStandardMaterial color="#f7e08a" roughness={1} /></mesh>
      <mesh position={[-0.93, 1.34, -2.255]} rotation={[0, 0, -0.08]}><planeGeometry args={[0.07, 0.07]} /><meshStandardMaterial color="#f4a3b5" roughness={1} /></mesh>
    </group>
  );
}

/* ───────── Wall: clock, polaroid garland, hanging plant, globe ───────── */
function WallExtras({ reduceMotion }: { reduceMotion: boolean }) {
  const hour = useRef<THREE.Group>(null);
  const minute = useRef<THREE.Group>(null);
  const vines = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const d = new Date();
    if (minute.current) minute.current.rotation.z = -((d.getMinutes() + d.getSeconds() / 60) / 60) * Math.PI * 2;
    if (hour.current) hour.current.rotation.z = -(((d.getHours() % 12) + d.getMinutes() / 60) / 12) * Math.PI * 2;
    if (vines.current && !reduceMotion) vines.current.rotation.z = Math.sin(clock.elapsedTime * 0.7) * 0.03;
  });
  const polaroids = useMemo(() => [
    { x: -1.55, c: '#7d94b8' }, { x: -1.2, c: '#c58a6a' }, { x: -0.85, c: '#6f9a78' }, { x: -0.5, c: '#b58bb0' }, { x: -0.15, c: '#d9b45a' },
  ], []);
  return (
    <group raycast={noRay}>
      {/* analog clock — shows the real time */}
      <group position={[0.95, 2.62, -3.46]}>
        <mesh castShadow><cylinderGeometry args={[0.18, 0.18, 0.04, 28]} /><meshStandardMaterial color="#2a2520" roughness={0.5} /></mesh>
        <mesh position={[0, 0, 0.022]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.155, 0.155, 0.004, 28]} /><meshStandardMaterial color="#e9dfc8" roughness={0.9} /></mesh>
        <group ref={hour} position={[0, 0, 0.03]}><mesh position={[0, 0.045, 0]}><boxGeometry args={[0.014, 0.09, 0.004]} /><meshStandardMaterial color="#2a2520" /></mesh></group>
        <group ref={minute} position={[0, 0, 0.034]}><mesh position={[0, 0.065, 0]}><boxGeometry args={[0.009, 0.13, 0.004]} /><meshStandardMaterial color="#2a2520" /></mesh></group>
      </group>
      {/* polaroid garland */}
      <mesh position={[-0.85, 3.02, -3.455]} rotation={[0, 0, 0]}><boxGeometry args={[1.6, 0.006, 0.006]} /><meshStandardMaterial color="#c9b48a" /></mesh>
      {polaroids.map((p, i) => (
        <group key={i} position={[p.x, 2.9, -3.45]} rotation={[0, 0, (i % 2 ? 1 : -1) * 0.06]}>
          <mesh castShadow><boxGeometry args={[0.15, 0.18, 0.006]} /><meshStandardMaterial color="#f4efe5" roughness={0.9} /></mesh>
          <mesh position={[0, 0.02, 0.005]}><planeGeometry args={[0.12, 0.11]} /><meshStandardMaterial color={p.c} roughness={0.9} /></mesh>
        </group>
      ))}
      {/* hanging plant on the left wall */}
      <group position={[-3.93, 2.95, -2.7]}>
        <mesh castShadow><cylinderGeometry args={[0.1, 0.07, 0.12, 16]} /><meshStandardMaterial color="#b9a27e" roughness={0.8} /></mesh>
        <group ref={vines} position={[0, -0.04, 0]}>
          {Array.from({ length: 9 }, (_, i) => (
            <mesh key={i} position={[0.03 + Math.sin(i * 2) * 0.05, -0.1 - i * 0.07, Math.cos(i * 1.7) * 0.06]} scale={[0.05, 0.03, 0.04]} castShadow><sphereGeometry args={[1, 8, 6]} /><meshStandardMaterial color={i % 2 ? '#4f8a4c' : '#6a9a58'} roughness={0.7} /></mesh>
          ))}
        </group>
      </group>
      {/* globe on the top shelf */}
      <group position={[-3.45, 2.64, -3.2]}>
        <mesh position={[0, 0.015, 0]}><cylinderGeometry args={[0.06, 0.07, 0.03, 16]} /><meshStandardMaterial color="#6e4b30" roughness={0.6} /></mesh>
        <mesh position={[0, 0.16, 0]} castShadow><sphereGeometry args={[0.1, 20, 16]} /><meshStandardMaterial color="#4f7f9c" roughness={0.45} /></mesh>
        <mesh position={[0.03, 0.17, 0.07]} scale={[1, 0.7, 0.6]}><sphereGeometry args={[0.04, 10, 8]} /><meshStandardMaterial color="#6f9a58" roughness={0.6} /></mesh>
        <mesh position={[0, 0.16, 0]} rotation={[0.4, 0, 0.35]}><torusGeometry args={[0.118, 0.006, 8, 28]} /><meshStandardMaterial color="#d4a84b" metalness={0.6} roughness={0.35} /></mesh>
      </group>
    </group>
  );
}

/* ───────── Candle on the plant bench ───────── */
function Candle({ reduceMotion }: { reduceMotion: boolean }) {
  const flame = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (flame.current && !reduceMotion) {
      const t = clock.elapsedTime;
      flame.current.scale.set(1 + Math.sin(t * 9) * 0.08, 1 + Math.sin(t * 7 + 1) * 0.12, 1);
    }
  });
  return (
    <group position={[3.62, 0.455, -3.05]} raycast={noRay}>
      <mesh position={[0, 0.05, 0]} castShadow><cylinderGeometry args={[0.04, 0.04, 0.1, 14]} /><meshStandardMaterial color="#efe3c8" roughness={0.6} /></mesh>
      <mesh ref={flame} position={[0, 0.13, 0]} scale={[1, 1.4, 1]}><sphereGeometry args={[0.014, 10, 8]} /><meshStandardMaterial color="#ffdf9a" emissive="#ff9d3c" emissiveIntensity={4} toneMapped={false} /></mesh>
    </group>
  );
}

/* ───────── Rain on the window ───────── */
function Rain({ reduceMotion }: { reduceMotion: boolean }) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 256;
    const g = c.getContext('2d')!;
    g.strokeStyle = 'rgba(190,215,255,.75)'; g.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * 128, y = Math.random() * 256, l = 14 + Math.random() * 30;
      g.lineWidth = 1 + Math.random() * 1.2;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x - 2, y + l); g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 1.4);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  useEffect(() => () => tex.dispose(), [tex]);
  useFrame((_, dt) => { if (!reduceMotion) tex.offset.y -= dt * 0.9; });
  return (
    <mesh position={[-4.02, 1.75, -0.4]} rotation={[0, Math.PI / 2, 0]} raycast={noRay}>
      <planeGeometry args={[1.8, 1.5]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

