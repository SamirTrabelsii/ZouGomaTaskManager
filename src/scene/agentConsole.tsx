import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import { useAgent } from '../state/agent';
import { alertCounts, unseenAlerts } from '../domain/agent';
import { drawAgentTexture } from './textures';
import { Interactive } from './Interactive';

/** Where the console stands: the open floor to the right of the desk. */
export const AGENT_SPOT: [number, number, number] = [2.45, 0.5, -0.05];
const [X, , Z] = AGENT_SPOT;
const WOOD = '#a97b4f';

const BEACON = { critical: '#ff4a3c', open: '#ffb347', quiet: '#6fd27a', idle: '#6b7570' } as const;

/** How much bigger than its drawn size the beacon is built, so it can be seen from across the room. */
const GYROPHARE_SCALE = 1.6;

const FLASH = { critical: '#ff3b30', open: '#ffa11f' } as const;

/**
 * A rotating warning light on top of the terminal. It stays dark and does nothing until alerts arrive that you have not
 * looked at yet; then its blade spins, it flashes and lights up the corner (red when one of them is critical, amber otherwise).
 * Opening the agent panel counts as looking, and it goes dark again. With reduced motion it simply stays lit, without spinning or flashing.
 */
function Gyrophare({ tone, reduceMotion }: { tone: 'critical' | 'open' | null; reduceMotion: boolean }) {
  const glass = useRef<THREE.MeshStandardMaterial>(null);
  const blade = useRef<THREE.Group>(null);
  const light = useRef<THREE.PointLight>(null);
  useFrame(({ clock, invalidate }) => {
    const lit = tone !== null;
    const t = clock.elapsedTime;
    const flash = !lit ? 0 : reduceMotion ? 1 : Math.sin(t * 9) > -0.3 ? 1 : 0.1; // about one and a half flashes a second
    if (blade.current) { blade.current.visible = lit; if (lit && !reduceMotion) blade.current.rotation.y = t * 7; }
    if (glass.current) glass.current.emissiveIntensity = lit ? 0.4 + flash * 2.4 : 0;
    if (light.current) light.current.intensity = lit ? flash * 2.5 : 0;
    if (lit && !reduceMotion) invalidate(); // keeps drawing while it flashes; nothing is drawn when it is dark
  });
  const color = tone ? FLASH[tone] : '#6a4b47';
  return (
    <group position={[-0.01, 0.8, 0.02]} scale={GYROPHARE_SCALE}>
      <mesh position={[0, 0.015, 0]} castShadow><cylinderGeometry args={[0.062, 0.07, 0.03, 16]} /><meshStandardMaterial color="#33302d" roughness={0.5} /></mesh>
      <group ref={blade} position={[0, 0.05, 0]} visible={false}>
        <mesh position={[0.026, 0, 0]}><boxGeometry args={[0.052, 0.034, 0.006]} /><meshBasicMaterial color="#fff3cf" toneMapped={false} /></mesh>
      </group>
      <mesh position={[0, 0.03, 0]}>
        <sphereGeometry args={[0.056, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial ref={glass} color={color} emissive={color} emissiveIntensity={0} transparent opacity={0.82} roughness={0.2} toneMapped={false} />
      </mesh>
      <pointLight ref={light} color={color} intensity={0} distance={3.2} decay={2} position={[0, 0.09, 0]} />
    </group>
  );
}

/**
 * The agent's console: a small retro terminal on a crate. Its screen shows the number of open alerts, a small status light
 * on the side goes red and blinks for a critical one, and the rotating light on top flashes for alerts you have not seen yet.
 * It only reads the agent's summary; nothing from work is drawn here.
 */
export function AgentConsole({ evening, reduceMotion }: { evening: boolean; reduceMotion: boolean }) {
  const overview = useAgent((s) => s.overview);
  const alerts = useAgent((s) => s.alerts);
  const seen = useAgent((s) => s.seen);
  const { open, critical } = useMemo(() => alertCounts(alerts), [alerts]);
  const fresh = useMemo(() => unseenAlerts(seen, alerts), [seen, alerts]);
  const flash = fresh.length === 0 ? null : fresh.some((a) => a.severity === 'critical') ? 'critical' : 'open';
  const state = !overview?.online ? 'offline' : overview.state === 'paused' ? 'paused' : 'online';
  const tone = state !== 'online' ? 'idle' : critical ? 'critical' : open ? 'open' : 'quiet';

  const texRef = useRef<THREE.CanvasTexture | null>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  useEffect(() => {
    texRef.current = drawAgentTexture(texRef.current, open, critical, state);
    if (matRef.current) { matRef.current.map = texRef.current; matRef.current.needsUpdate = true; }
  }, [open, critical, state]);

  const beacon = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock, invalidate }) => {
    const m = beacon.current;
    if (!m) return;
    const blink = tone === 'critical' && !reduceMotion;
    const target = tone === 'idle' ? 0.4 : blink ? 1.5 + Math.sin(clock.elapsedTime * 5) * 1.3 : evening ? 2.2 : 0.8;
    if (Math.abs(m.emissiveIntensity - target) > 0.01) { m.emissiveIntensity = target; invalidate(); }
  });

  return (
    <Interactive
      id="agent" label="Agent console" hint="Alerts & proposed fixes" reduceMotion={reduceMotion}
      box={{ size: [0.75, 1.0, 0.65], center: [X, 0.5, Z] }} pin={[X, 1.35, Z]}
      hit={{ size: [0.8, 1.05, 0.7], center: [X, 0.52, Z] }}
    >
      <group position={[X, 0, Z]} rotation={[0, 0.78, 0]}>
        {/* crate */}
        <mesh position={[0, 0.2, 0]} castShadow receiveShadow><boxGeometry args={[0.62, 0.4, 0.46]} /><meshStandardMaterial color={WOOD} roughness={0.7} /></mesh>
        {[-0.2, 0.2].map((x) => <mesh key={x} position={[x, 0.2, 0.235]}><boxGeometry args={[0.04, 0.34, 0.01]} /><meshStandardMaterial color="#6e4b30" roughness={0.7} /></mesh>)}
        {/* terminal */}
        <RoundedBox args={[0.5, 0.4, 0.36]} radius={0.03} smoothness={3} position={[0, 0.6, 0]} castShadow>
          <meshStandardMaterial color="#d8d2c2" roughness={0.55} />
        </RoundedBox>
        <mesh position={[0, 0.62, 0.182]}>
          <planeGeometry args={[0.4, 0.25]} />
          <meshBasicMaterial ref={matRef} color="#ffffff" toneMapped={false} />
        </mesh>
        <mesh position={[0.17, 0.46, 0.182]}><boxGeometry args={[0.06, 0.015, 0.004]} /><meshStandardMaterial color="#8a8678" roughness={0.6} /></mesh>
        <Gyrophare tone={flash} reduceMotion={reduceMotion} />
        {/* antenna and status light */}
        <mesh position={[-0.12, 0.88, -0.05]} rotation={[0, 0, 0.18]} castShadow><cylinderGeometry args={[0.006, 0.006, 0.3, 6]} /><meshStandardMaterial color="#2a2a2a" metalness={0.6} roughness={0.4} /></mesh>
        <mesh position={[0.15, 0.82, 0.02]} castShadow><cylinderGeometry args={[0.035, 0.04, 0.05, 14]} /><meshStandardMaterial color="#3a3a3a" roughness={0.5} /></mesh>
        <mesh position={[0.15, 0.87, 0.02]}>
          <sphereGeometry args={[0.032, 14, 10]} />
          <meshStandardMaterial ref={beacon} color={BEACON[tone]} emissive={BEACON[tone]} emissiveIntensity={0.8} toneMapped={false} />
        </mesh>
      </group>
    </Interactive>
  );
}
