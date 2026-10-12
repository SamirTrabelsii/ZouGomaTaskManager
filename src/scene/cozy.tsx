import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import { WantedPoster } from './onepiece';

/**
 * Second decoration batch. Everything here is ornamental (no data, no click handlers) and uses emissive
 * materials instead of extra lights, so it adds almost nothing to the lighting cost.
 */
const WOOD = '#a97b4f';
const WOOD_DARK = '#6e4b30';

export function CozyExtras({ evening, reduceMotion }: { evening: boolean; reduceMotion: boolean }) {
  return (
    <group>
      <Armchair />
      <RecordCorner reduceMotion={reduceMotion} />
      <Corkboard />
      <WallShelf />
      <WantedPoster name="THE COOK" bounty="177,000,000" position={[-3.93, 2.0, 2.0]} size={[0.2, 0.28]} />
      <WantedPoster name="NAVIGATOR" bounty="366,000,000" position={[-3.93, 1.72, 2.6]} size={[0.2, 0.28]} />
      <Palm reduceMotion={reduceMotion} />
      <Pothos reduceMotion={reduceMotion} />
      <WindowSill evening={evening} reduceMotion={reduceMotion} />
      <Basket />
      <Pendant evening={evening} />
      <LeftWallLights evening={evening} />
    </group>
  );
}

/* ───────── Armchair + blanket + side table ───────── */
function Armchair() {
  const fabric = '#5b7a6c';
  return (
    <group>
      <group position={[2.45, 0, 2.1]} rotation={[0, -Math.PI * 0.72, 0]}>
        <RoundedBox args={[0.8, 0.22, 0.75]} radius={0.06} smoothness={3} position={[0, 0.3, 0]} castShadow receiveShadow><meshStandardMaterial color={fabric} roughness={0.95} /></RoundedBox>
        <RoundedBox args={[0.8, 0.62, 0.18]} radius={0.07} smoothness={3} position={[0, 0.66, -0.32]} rotation={[-0.12, 0, 0]} castShadow><meshStandardMaterial color={fabric} roughness={0.95} /></RoundedBox>
        {[-0.44, 0.44].map((x) => (
          <RoundedBox key={x} args={[0.14, 0.4, 0.75]} radius={0.06} smoothness={3} position={[x, 0.45, 0]} castShadow><meshStandardMaterial color="#4e6a5d" roughness={0.95} /></RoundedBox>
        ))}
        {[[-0.32, -0.3], [0.32, -0.3], [-0.32, 0.3], [0.32, 0.3]].map(([x, z], i) => (
          <mesh key={i} position={[x, 0.09, z]} castShadow><cylinderGeometry args={[0.025, 0.02, 0.18, 8]} /><meshStandardMaterial color={WOOD_DARK} roughness={0.6} /></mesh>
        ))}
        {/* throw blanket draped over the arm and seat */}
        <RoundedBox args={[0.34, 0.05, 0.7]} radius={0.02} smoothness={3} position={[0.2, 0.43, 0.02]} rotation={[0, 0, -0.05]} castShadow><meshStandardMaterial color="#c0704a" roughness={1} /></RoundedBox>
        <RoundedBox args={[0.06, 0.34, 0.6]} radius={0.02} smoothness={3} position={[0.45, 0.62, 0.02]} castShadow><meshStandardMaterial color="#c0704a" roughness={1} /></RoundedBox>
        <mesh position={[-0.22, 0.5, -0.1]} rotation={[0.1, 0.5, 0.3]} castShadow><boxGeometry args={[0.26, 0.26, 0.08]} /><meshStandardMaterial color="#e1b66a" roughness={1} /></mesh>
      </group>
      {/* side table with tea */}
      <group position={[3.4, 0, 1.55]}>
        <mesh position={[0, 0.42, 0]} castShadow receiveShadow><cylinderGeometry args={[0.22, 0.22, 0.03, 24]} /><meshStandardMaterial color={WOOD} roughness={0.55} /></mesh>
        <mesh position={[0, 0.21, 0]} castShadow><cylinderGeometry args={[0.025, 0.025, 0.42, 8]} /><meshStandardMaterial color={WOOD_DARK} roughness={0.6} /></mesh>
        <mesh position={[0, 0.01, 0]}><cylinderGeometry args={[0.14, 0.14, 0.02, 16]} /><meshStandardMaterial color={WOOD_DARK} roughness={0.6} /></mesh>
        <mesh position={[-0.05, 0.48, 0.03]} castShadow><cylinderGeometry args={[0.045, 0.04, 0.08, 14]} /><meshStandardMaterial color="#e8dcc4" roughness={0.35} /></mesh>
        <mesh position={[-0.05, 0.523, 0.03]}><cylinderGeometry args={[0.036, 0.036, 0.006, 14]} /><meshStandardMaterial color="#6b3d22" roughness={0.4} /></mesh>
        <mesh position={[0.08, 0.452, -0.04]} rotation={[0, 0.4, 0]} castShadow><boxGeometry args={[0.16, 0.028, 0.12]} /><meshStandardMaterial color="#3d3350" roughness={0.8} /></mesh>
      </group>
    </group>
  );
}

/* ───────── Record player + vinyl crate ───────── */
function RecordCorner({ reduceMotion }: { reduceMotion: boolean }) {
  const disc = useRef<THREE.Group>(null);
  useFrame((_, dt) => { if (disc.current && !reduceMotion) disc.current.rotation.y -= dt * 1.4; });
  const sleeves = ['#c06c46', '#4f7f9c', '#d9b45a', '#6f9a78', '#b58bb0', '#8a4a3a', '#e9dfc8', '#3d3350'];
  return (
    <group>
      <group position={[3.62, 0, -0.45]}>
        <mesh position={[0, 0.22, 0]} castShadow receiveShadow><boxGeometry args={[0.5, 0.44, 1.2]} /><meshStandardMaterial color={WOOD} roughness={0.55} /></mesh>
        <mesh position={[0, 0.2, 0.0]}><boxGeometry args={[0.46, 0.34, 1.12]} /><meshStandardMaterial color="#8a6340" roughness={0.7} /></mesh>
        <RoundedBox args={[0.42, 0.06, 0.5]} radius={0.015} smoothness={3} position={[0, 0.47, -0.1]} castShadow><meshStandardMaterial color="#2c2630" roughness={0.45} /></RoundedBox>
        <group ref={disc} position={[0, 0.51, -0.1]}>
          <mesh><cylinderGeometry args={[0.17, 0.17, 0.008, 32]} /><meshStandardMaterial color="#111" roughness={0.3} metalness={0.3} /></mesh>
          <mesh position={[0, 0.006, 0]}><cylinderGeometry args={[0.055, 0.055, 0.004, 20]} /><meshStandardMaterial color="#c06c46" roughness={0.6} /></mesh>
          <mesh position={[0.08, 0.005, 0]}><boxGeometry args={[0.07, 0.002, 0.004]} /><meshStandardMaterial color="#444" /></mesh>
        </group>
        {/* tonearm */}
        <mesh position={[0.15, 0.53, -0.2]} rotation={[0, 0.6, 0]}><boxGeometry args={[0.012, 0.012, 0.2]} /><meshStandardMaterial color="#cfcfcf" metalness={0.8} roughness={0.3} /></mesh>
        <mesh position={[0.17, 0.5, -0.32]}><cylinderGeometry args={[0.014, 0.014, 0.05, 10]} /><meshStandardMaterial color="#2a2a2a" /></mesh>
        {/* a couple of sleeves leaning on top */}
        <mesh position={[0, 0.58, 0.38]} rotation={[-0.25, 0, 0]}><boxGeometry args={[0.3, 0.3, 0.012]} /><meshStandardMaterial color="#d9b45a" roughness={0.8} /></mesh>
      </group>
      <group position={[3.62, 0, 0.6]}>
        <mesh position={[0, 0.14, 0]} castShadow receiveShadow><boxGeometry args={[0.5, 0.28, 0.62]} /><meshStandardMaterial color="#b0875a" roughness={0.8} /></mesh>
        {sleeves.map((c, i) => (
          <mesh key={i} position={[0, 0.3, -0.24 + i * 0.07]} rotation={[0, 0, (i % 3 - 1) * 0.06]} castShadow><boxGeometry args={[0.3, 0.3, 0.012]} /><meshStandardMaterial color={c} roughness={0.8} /></mesh>
        ))}
      </group>
    </group>
  );
}

/* ───────── Corkboard on the left wall ───────── */
function Corkboard() {
  const notes = useMemo(() => [
    { y: 0.12, z: -0.3, c: '#f7e08a', r: 0.1 }, { y: -0.05, z: -0.05, c: '#f4a3b5', r: -0.12 }, { y: 0.15, z: 0.22, c: '#9fd3e8', r: 0.06 },
    { y: -0.18, z: 0.28, c: '#b9e0a5', r: -0.08 }, { y: -0.17, z: -0.28, c: '#f2c28b', r: 0.14 },
  ], []);
  return (
    <group position={[-3.95, 1.85, 2.3]} rotation={[0, Math.PI / 2, 0]}>
      <mesh castShadow><boxGeometry args={[1.1, 0.75, 0.04]} /><meshStandardMaterial color={WOOD_DARK} roughness={0.6} /></mesh>
      <mesh position={[0, 0, 0.022]}><planeGeometry args={[1.0, 0.65]} /><meshStandardMaterial color="#b98a5b" roughness={1} /></mesh>
      {notes.slice(0, 3).map((n, i) => (
        <group key={i} position={[n.z * 1.6, n.y * 1.3, 0.03]} rotation={[0, 0, n.r]}>
          <mesh><planeGeometry args={[0.16, 0.16]} /><meshStandardMaterial color={n.c} roughness={1} /></mesh>
          <mesh position={[0, 0.06, 0.006]}><sphereGeometry args={[0.012, 8, 6]} /><meshStandardMaterial color="#c0392b" roughness={0.4} /></mesh>
        </group>
      ))}
      <mesh position={[0.28, 0.1, 0.03]} rotation={[0, 0, 0.1]}><planeGeometry args={[0.18, 0.22]} /><meshStandardMaterial color="#f4efe5" roughness={0.9} /></mesh>
      <mesh position={[0.28, 0.12, 0.034]} rotation={[0, 0, 0.1]}><planeGeometry args={[0.14, 0.14]} /><meshStandardMaterial color="#6f8fb8" roughness={0.9} /></mesh>
    </group>
  );
}

/* ───────── Floating shelf with mugs, kettle and jars ───────── */
function WallShelf() {
  return (
    <group position={[-3.82, 1.5, -2.2]}>
      <mesh castShadow receiveShadow><boxGeometry args={[0.3, 0.04, 1.0]} /><meshStandardMaterial color={WOOD} roughness={0.55} /></mesh>
      {[[-0.38, '#c06c46'], [-0.25, '#e8dcc4'], [-0.12, '#4f7f9c']].map(([z, c], i) => (
        <mesh key={i} position={[0, 0.07, z as number]} castShadow><cylinderGeometry args={[0.045, 0.04, 0.09, 14]} /><meshStandardMaterial color={c as string} roughness={0.4} /></mesh>
      ))}
      <group position={[0, 0.02, 0.15]}>
        <mesh position={[0, 0.09, 0]} castShadow><sphereGeometry args={[0.09, 16, 12]} /><meshStandardMaterial color="#8a8f99" metalness={0.6} roughness={0.35} /></mesh>
        <mesh position={[0, 0.2, 0]}><sphereGeometry args={[0.02, 8, 6]} /><meshStandardMaterial color="#2a2a2a" /></mesh>
        <mesh position={[0.1, 0.1, 0]} rotation={[0, 0, -0.9]}><cylinderGeometry args={[0.012, 0.012, 0.12, 8]} /><meshStandardMaterial color="#8a8f99" metalness={0.6} roughness={0.35} /></mesh>
      </group>
      {[[0.36, '#d9b45a'], [0.44, '#6f9a78']].map(([z, c], i) => (
        <group key={i} position={[0, 0.02, z as number]}>
          <mesh position={[0, 0.07, 0]}><cylinderGeometry args={[0.04, 0.04, 0.12, 14]} /><meshPhysicalMaterial color="#e6f0ee" transparent opacity={0.3} roughness={0.1} /></mesh>
          <mesh position={[0, 0.05, 0]}><cylinderGeometry args={[0.032, 0.032, 0.07, 14]} /><meshStandardMaterial color={c as string} roughness={0.8} /></mesh>
        </group>
      ))}
    </group>
  );
}

/* ───────── Floor plants ───────── */
function Palm({ reduceMotion }: { reduceMotion: boolean }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => { if (g.current && !reduceMotion) g.current.rotation.z = Math.sin(clock.elapsedTime * 0.6) * 0.012; });
  const fronds = useMemo(() => Array.from({ length: 10 }, (_, i) => ({ a: (i / 10) * Math.PI * 2, tilt: 0.7 + (i % 3) * 0.2, h: 0.95 + (i % 4) * 0.12, len: 0.6 + (i % 3) * 0.1 })), []);
  return (
    <group position={[3.75, 0, 3.0]} scale={0.72}>
      <mesh position={[0, 0.17, 0]} castShadow receiveShadow><cylinderGeometry args={[0.2, 0.15, 0.34, 20]} /><meshStandardMaterial color="#d5c8b0" roughness={0.8} /></mesh>
      <mesh position={[0, 0.34, 0]}><cylinderGeometry args={[0.185, 0.185, 0.012, 20]} /><meshStandardMaterial color="#4a3426" roughness={1} /></mesh>
      <group ref={g}>
        <mesh position={[0, 0.7, 0]} castShadow><cylinderGeometry args={[0.025, 0.04, 0.75, 8]} /><meshStandardMaterial color="#7a6a48" roughness={0.9} /></mesh>
        {fronds.map((f, i) => (
          <group key={i} position={[0, f.h, 0]} rotation={[0, f.a, 0]}>
            <mesh position={[f.len / 2, 0.02 - f.tilt * 0.12, 0]} rotation={[0, 0, -f.tilt * 0.55]} scale={[f.len, 0.02, 0.1]} castShadow>
              <sphereGeometry args={[1, 10, 6]} /><meshStandardMaterial color={i % 2 ? '#3f7d48' : '#4f8f50'} roughness={0.7} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

function Pothos({ reduceMotion }: { reduceMotion: boolean }) {
  const v = useRef<THREE.Group>(null);
  useFrame(({ clock }) => { if (v.current && !reduceMotion) v.current.rotation.z = Math.sin(clock.elapsedTime * 0.8 + 1) * 0.02; });
  return (
    <group position={[-3.55, 0, 2.75]}>
      {[[-0.1, -0.1], [0.1, -0.1], [-0.1, 0.1], [0.1, 0.1]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.3, z]} castShadow><cylinderGeometry args={[0.014, 0.014, 0.6, 6]} /><meshStandardMaterial color={WOOD_DARK} roughness={0.6} /></mesh>
      ))}
      <mesh position={[0, 0.6, 0]} castShadow><boxGeometry args={[0.3, 0.025, 0.3]} /><meshStandardMaterial color={WOOD} roughness={0.55} /></mesh>
      <mesh position={[0, 0.69, 0]} castShadow><cylinderGeometry args={[0.1, 0.075, 0.15, 16]} /><meshStandardMaterial color="#c9a07a" roughness={0.75} /></mesh>
      <group ref={v} position={[0, 0.76, 0]}>
        {Array.from({ length: 16 }, (_, i) => {
          const a = i * 2.2;
          return (
            <mesh key={i} position={[Math.cos(a) * (0.08 + (i % 3) * 0.03), 0.04 - (i / 16) * 0.5 + (i < 5 ? 0.06 : 0), Math.sin(a) * (0.08 + (i % 3) * 0.03)]} scale={[0.05, 0.02, 0.035]} rotation={[0, a, 0.6]} castShadow>
              <sphereGeometry args={[1, 8, 6]} /><meshStandardMaterial color={i % 2 ? '#4f8a4c' : '#6aa35a'} roughness={0.7} />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}

/* ───────── Window sill ───────── */
function WindowSill({ evening, reduceMotion }: { evening: boolean; reduceMotion: boolean }) {
  const flame = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => { if (flame.current && !reduceMotion) flame.current.scale.y = 1.4 + Math.sin(clock.elapsedTime * 8) * 0.18; });
  return (
    <group position={[-3.86, 1.0, -0.4]}>
      {/* cactus */}
      <group position={[0, 0, -0.75]}>
        <mesh position={[0, 0.05, 0]} castShadow><cylinderGeometry args={[0.05, 0.04, 0.1, 12]} /><meshStandardMaterial color="#c06c46" roughness={0.8} /></mesh>
        <mesh position={[0, 0.15, 0]} castShadow><capsuleGeometry args={[0.03, 0.09, 4, 8]} /><meshStandardMaterial color="#5c9a5c" roughness={0.7} /></mesh>
        <mesh position={[0.04, 0.17, 0]} rotation={[0, 0, -0.9]}><capsuleGeometry args={[0.015, 0.04, 4, 6]} /><meshStandardMaterial color="#5c9a5c" roughness={0.7} /></mesh>
      </group>
      {/* candle */}
      <group position={[0, 0, -0.1]}>
        <mesh position={[0, 0.04, 0]} castShadow><cylinderGeometry args={[0.03, 0.03, 0.08, 12]} /><meshStandardMaterial color="#efe3c8" roughness={0.6} /></mesh>
        <mesh ref={flame} position={[0, 0.1, 0]} scale={[1, 1.4, 1]}><sphereGeometry args={[0.011, 8, 6]} /><meshStandardMaterial color="#ffdf9a" emissive="#ff9d3c" emissiveIntensity={evening ? 4 : 1.5} toneMapped={false} /></mesh>
      </group>
      {/* letters */}
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[0, 0.015 + i * 0.012, 0.55]} rotation={[0, 0.2 + i * 0.25, 0]} castShadow><boxGeometry args={[0.14, 0.01, 0.1]} /><meshStandardMaterial color={['#f4efe5', '#e8dcc4', '#d9c9a8'][i]} roughness={0.9} /></mesh>
      ))}
    </group>
  );
}

/* ───────── Basket of blankets ───────── */
function Basket() {
  return (
    <group position={[-1.95, 0, 1.2]}>
      <mesh position={[0, 0.16, 0]} castShadow receiveShadow><cylinderGeometry args={[0.3, 0.24, 0.32, 24, 1, true]} /><meshStandardMaterial color="#c4a373" roughness={1} side={THREE.DoubleSide} /></mesh>
      <mesh position={[0, 0.02, 0]}><cylinderGeometry args={[0.24, 0.24, 0.02, 24]} /><meshStandardMaterial color="#a98558" roughness={1} /></mesh>
      {[0.08, 0.16, 0.24].map((y) => (
        <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.24 + y * 0.2, 0.008, 6, 28]} /><meshStandardMaterial color="#a98558" roughness={1} /></mesh>
      ))}
      <mesh position={[0, 0.34, 0]} scale={[1, 0.55, 1]} castShadow><sphereGeometry args={[0.24, 16, 12]} /><meshStandardMaterial color="#9a6b7a" roughness={1} /></mesh>
      <mesh position={[0.08, 0.42, 0.05]} rotation={[0, 0.5, 0.2]} castShadow><boxGeometry args={[0.22, 0.04, 0.3]} /><meshStandardMaterial color="#e1b66a" roughness={1} /></mesh>
    </group>
  );
}

/* ───────── Pendant lamp over the rug (hung from a wall beam) ───────── */
function Pendant({ evening }: { evening: boolean }) {
  return (
    <group>
      <mesh position={[-0.3, 3.45, -2.1]} castShadow><boxGeometry args={[0.1, 0.1, 2.8]} /><meshStandardMaterial color={WOOD_DARK} roughness={0.6} /></mesh>
      <mesh position={[-0.3, 3.1, -0.8]}><cylinderGeometry args={[0.004, 0.004, 0.7, 6]} /><meshStandardMaterial color="#222" /></mesh>
      <mesh position={[-0.3, 2.7, -0.8]} castShadow><sphereGeometry args={[0.17, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.62]} /><meshStandardMaterial color="#d9a65f" side={THREE.DoubleSide} emissive="#ffb050" emissiveIntensity={evening ? 0.9 : 0.2} roughness={0.5} metalness={0.3} toneMapped={false} /></mesh>
      <mesh position={[-0.3, 2.64, -0.8]}><sphereGeometry args={[0.05, 12, 10]} /><meshStandardMaterial color="#fff2cf" emissive="#ffc46a" emissiveIntensity={evening ? 4 : 0.3} toneMapped={false} /></mesh>
    </group>
  );
}

/* ───────── Fairy lights on the left wall (emissive only) ───────── */
function LeftWallLights({ evening }: { evening: boolean }) {
  return (
    <group>
      {Array.from({ length: 14 }, (_, i) => {
        const z = -1.6 + i * 0.36;
        const y = 2.95 - Math.sin((i / 13) * Math.PI) * 0.2;
        return (
          <mesh key={i} position={[-3.93, y, z]}>
            <sphereGeometry args={[0.04, 8, 6]} />
            <meshStandardMaterial color="#ffd9a0" emissive="#ffb347" emissiveIntensity={evening ? 3 : 0.3} toneMapped={false} />
          </mesh>
        );
      })}
      {/* wall sconce */}
      <group position={[-3.92, 2.2, 3.1]}>
        <mesh rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.015, 0.015, 0.14, 8]} /><meshStandardMaterial color="#2a2a2a" metalness={0.6} roughness={0.4} /></mesh>
        <mesh position={[0.14, 0.02, 0]}><coneGeometry args={[0.1, 0.14, 18, 1, true]} /><meshStandardMaterial color="#e7c28a" side={THREE.DoubleSide} emissive="#ffb050" emissiveIntensity={evening ? 2.4 : 0.2} toneMapped={false} /></mesh>
      </group>
    </group>
  );
}
