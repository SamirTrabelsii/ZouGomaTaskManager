import { useMemo } from 'react';
import { Environment, Lightformer, Sparkles } from '@react-three/drei';
import { useStore } from '../state/store';
import { useToday } from '../state/hooks';
import { liveliness } from '../domain/services';
import { makeFloorTexture, makeNightSkyTexture, makeRugTexture, makeWallTexture } from './textures';

const WALL_H = 3.6;

/**
 * Fixed lighting rig — nothing here depends on user data, so the mood never drifts or flickers:
 * cool moonlight through the window, one warm key from the desk lamp, a faint blue screen glow.
 */
export function Lighting({ evening, shadowSize, shadows }: { evening: boolean; shadowSize: number; shadows: boolean }) {
  return (
    <>
      <hemisphereLight args={[evening ? '#3b55c0' : '#fff1da', evening ? '#2b1c3f' : '#b79d7a', evening ? 0.7 : 1.05]} />
      <directionalLight
        castShadow={shadows} position={evening ? [-8, 6, 1.5] : [-8, 5.2, -0.4]} target-position={[0, 0, -0.4]}
        intensity={evening ? 1.45 : 2.6} color={evening ? '#6f8fff' : '#fff0d2'}
        shadow-mapSize={[shadowSize, shadowSize]} shadow-bias={-0.002} shadow-normalBias={0.3} shadow-radius={4}
        shadow-camera-left={-7} shadow-camera-right={7} shadow-camera-top={6} shadow-camera-bottom={-4} shadow-camera-near={1} shadow-camera-far={20}
      />
      <directionalLight position={[8, 8, 9]} intensity={evening ? 0.4 : 0.55} color={evening ? '#5a6fe0' : '#fff6e8'} />
      {evening && (
        <>
          <pointLight position={[-1.3, 1.5, -1.85]} color="#ffad55" intensity={16} distance={6.5} decay={2} />
          <pointLight position={[-0.3, 0.9, -0.8]} color="#ff9a3c" intensity={4} distance={4} decay={2} />
          <pointLight position={[-0.4, 1.4, -1.6]} color="#4aa3ff" intensity={4} distance={4} decay={2} />
          <pointLight position={[-3.2, 2, -0.4]} color="#4b6bff" intensity={6} distance={7} decay={2} />
          <pointLight position={[2.6, 3.1, -3.0]} color="#ffb870" intensity={3.5} distance={5} decay={2} />
        </>
      )}
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={evening ? 1.4 : 3} position={[-6, 3, -0.5]} rotation={[0, Math.PI / 2, 0]} scale={[3, 3, 1]} color={evening ? '#5c7cff' : '#fff4e0'} />
        <Lightformer form="rect" intensity={evening ? 0.5 : 0.8} position={[0, 6, 2]} rotation={[Math.PI / 2, 0, 0]} scale={[8, 6, 1]} color={evening ? '#8aa0ff' : '#ffffff'} />
        {evening && <Lightformer form="circle" intensity={2.5} position={[-1, 1.5, 2]} scale={2} color="#ffa24a" />}
      </Environment>
      <Sparkles count={28} scale={[7, 2.8, 6]} position={[0, 1.6, 0]} size={2.4} speed={0.12} opacity={evening ? 0.45 : 0.35} color={evening ? '#ffc98a' : '#fff3d0'} />
    </>
  );
}

export function RoomShell({ evening }: { evening: boolean }) {
  const data = useStore((s) => s.data);
  const today = useToday();
  // Recent real activity lights more of the string lights (5–15). Stable otherwise.
  const lit = useMemo(() => 5 + Math.round(liveliness(data, today) * 10), [data, today]);
  const floorTex = useMemo(() => makeFloorTexture(), []);
  const wallTex = useMemo(() => makeWallTexture(evening ? '#5f7eaa' : '#efe6d6'), [evening]);
  const wallTexL = useMemo(() => makeWallTexture(evening ? '#4d6896' : '#e8ddc8'), [evening]);
  const rugTex = useMemo(() => makeRugTexture(), []);
  const skyTex = useMemo(() => makeNightSkyTexture(), []);
  const sky = '#cfe6f5';
  return (
    <group>
      {/* floating cut-away base, like a diorama */}
      <mesh position={[0.05, -0.23, 0]} receiveShadow>
        <boxGeometry args={[8.3, 0.4, 7.2]} /><meshStandardMaterial color={evening ? '#241b36' : '#8a6d4a'} roughness={0.8} />
      </mesh>
      {/* string lights along the back wall */}
      {Array.from({ length: 15 }, (_, i) => {
        const x = -3.6 + i * 0.52;
        const y = 3.28 - Math.sin((i / 14) * Math.PI) * 0.22;
        return (
          <mesh key={i} position={[x, y, -3.4]}>
            <sphereGeometry args={[0.045, 10, 8]} />
            <meshStandardMaterial color={i < lit ? "#ffd9a0" : "#6d6455"} emissive="#ffb347" emissiveIntensity={i < lit ? (evening ? 3 : 0.4) : 0} toneMapped={false} />
          </mesh>
        );
      })}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.05, 0, 0]} receiveShadow>
        <planeGeometry args={[8.1, 7]} /><meshStandardMaterial map={floorTex} color={evening ? '#8b88a8' : '#ffffff'} roughness={0.5} metalness={0.05} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-0.3, 0.014, -1.0]} receiveShadow>
        <planeGeometry args={[3.4, 2.4]} /><meshStandardMaterial map={rugTex} roughness={1} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
      </mesh>

      {/* back wall */}
      <mesh position={[0.05, WALL_H / 2, -3.575]} receiveShadow castShadow>
        <boxGeometry args={[8.3, WALL_H, 0.15]} /><meshStandardMaterial map={wallTex} roughness={0.95} />
      </mesh>
      <mesh position={[0.05, 0.07, -3.48]} receiveShadow><boxGeometry args={[8.1, 0.14, 0.04]} /><meshStandardMaterial color="#f6f1e6" roughness={0.7} /></mesh>

      {/* left wall with a window opening z∈[-1.3,0.5], y∈[1.0,2.5] */}
      {[
        { pos: [-4.075, 0.5, 0], size: [0.15, 1.0, 7.15] },
        { pos: [-4.075, 3.05, 0], size: [0.15, 1.1, 7.15] },
        { pos: [-4.075, 1.75, -2.4], size: [0.15, 1.5, 2.2] },
        { pos: [-4.075, 1.75, 2.0], size: [0.15, 1.5, 3.0] },
      ].map((w, i) => (
        <mesh key={i} position={w.pos as [number, number, number]} receiveShadow castShadow>
          <boxGeometry args={w.size as [number, number, number]} /><meshStandardMaterial map={wallTexL} roughness={0.95} />
        </mesh>
      ))}
      <mesh position={[-3.99, 0.07, 0]} receiveShadow><boxGeometry args={[0.04, 0.14, 7]} /><meshStandardMaterial color="#f6f1e6" roughness={0.7} /></mesh>

      {/* window: sky, glass, frame, sill */}
      <mesh position={[-4.2, 1.75, -0.4]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[1.8, 1.5]} />
        {evening ? <meshBasicMaterial map={skyTex} toneMapped={false} /> : <meshBasicMaterial color={sky} toneMapped={false} />}
      </mesh>
      {/* half-drawn blinds */}
      {Array.from({ length: 7 }, (_, i) => (
        <mesh key={i} position={[-3.93, 2.42 - i * 0.075, -0.4]} castShadow>
          <boxGeometry args={[0.03, 0.05, 1.8]} /><meshStandardMaterial color={evening ? '#3a3350' : '#e8dfcc'} roughness={0.7} />
        </mesh>
      ))}
      <mesh position={[-4.0, 1.75, -0.4]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[1.8, 1.5]} /><meshStandardMaterial color="#dff0f7" transparent opacity={0.12} roughness={0.05} /></mesh>
      {[
        { p: [-3.97, 1.75, -0.4], s: [0.06, 0.05, 1.86] }, { p: [-3.97, 2.5, -0.4], s: [0.06, 0.05, 1.86] },
        { p: [-3.97, 1.0, -0.4], s: [0.06, 0.05, 1.86] }, { p: [-3.97, 1.75, -1.3], s: [0.06, 1.5, 0.05] },
        { p: [-3.97, 1.75, 0.5], s: [0.06, 1.5, 0.05] }, { p: [-3.97, 1.75, -0.4], s: [0.06, 1.5, 0.04] },
      ].map((b, i) => (
        <mesh key={i} position={b.p as [number, number, number]} castShadow><boxGeometry args={b.s as [number, number, number]} /><meshStandardMaterial color="#f6f1e6" roughness={0.6} /></mesh>
      ))}
      <mesh position={[-3.88, 0.98, -0.4]} castShadow receiveShadow><boxGeometry args={[0.22, 0.05, 2.0]} /><meshStandardMaterial color="#f6f1e6" roughness={0.6} /></mesh>
      {/* curtains */}
      {[-1.45, 0.65].map((z, i) => (
        <mesh key={i} position={[-3.9, 1.8, z]} castShadow><boxGeometry args={[0.05, 1.9, 0.3]} /><meshStandardMaterial color="#dcd0b8" roughness={1} /></mesh>
      ))}

      {/* wall art above the desk */}
      <group position={[-0.7, 2.35, -3.48]}>
        <mesh castShadow><boxGeometry args={[0.8, 1.0, 0.04]} /><meshStandardMaterial color={'#6e4b30'} roughness={0.6} /></mesh>
        <mesh position={[0, 0, 0.022]}><planeGeometry args={[0.7, 0.9]} /><meshStandardMaterial color="#e6dcc6" roughness={1} /></mesh>
        <mesh position={[0, -0.12, 0.025]}><circleGeometry args={[0.2, 32]} /><meshStandardMaterial color="#c06c46" roughness={1} /></mesh>
        <mesh position={[0, 0.2, 0.025]}><circleGeometry args={[0.12, 32]} /><meshStandardMaterial color="#628a52" roughness={1} /></mesh>
      </group>
      <group position={[0.35, 2.55, -3.48]}>
        <mesh castShadow><boxGeometry args={[0.6, 0.45, 0.04]} /><meshStandardMaterial color="#2a2520" roughness={0.5} /></mesh>
        <mesh position={[0, 0, 0.022]}><planeGeometry args={[0.52, 0.37]} /><meshStandardMaterial color="#d9cfb9" roughness={1} /></mesh>
        <mesh position={[-0.05, -0.04, 0.025]} rotation={[0, 0, 0.5]}><planeGeometry args={[0.35, 0.02]} /><meshStandardMaterial color="#4f6b7d" roughness={1} /></mesh>
      </group>
    </group>
  );
}
