import { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import { useAgent } from '../state/agent';
import { alertCounts, robotMode, unseenAlerts, type RobotMode } from '../domain/agent';
import { drawAgentTexture } from './textures';
import { Interactive } from './Interactive';
import { CREW_BLUE, CrewFigure, crewEyes, crewModel, useBotFrames, type CrewMotion } from './crewBot';

/** Where Chopper Bot stands: on his medical crate by the right wall, between the desk and the big plant. */
export const AGENT_SPOT: [number, number, number] = [2.6, 0.45, -1.0];
const [X, , Z] = AGENT_SPOT;
const WOOD = '#a97b4f';
const CRATE_TOP = 0.4;

/** How Chopper moves in each mood of the agent (see {@link CrewFigure}). */
const MOTION: Record<RobotMode, CrewMotion> = { asleep: 'slump', resting: 'rest', calm: 'breathe', active: 'busy', agitated: 'shake' };
/** His height on the crate, in metres. */
const HEIGHT = 0.68;
/** The colour of his glowing eyes: what the alerts say (red when one is critical, amber for some, his own blue for none, grey when not watching). */
const EYES = { critical: '#ff4a3c', open: '#ffb347', quiet: CREW_BLUE, idle: '#6b7570' } as const;
/** How bright his eyes are in each mood. */
const EYE_LIGHT: Record<RobotMode, number> = { asleep: 0.25, resting: 0.9, calm: 2, active: 2.4, agitated: 2.8 };

/** How much bigger than its drawn size the beacon is built, so it can be seen from across the room. */
const GYROPHARE_SCALE = 1.6;
const FLASH = { critical: '#ff3b30', open: '#ffa11f' } as const;

/**
 * A rotating warning light. It stays dark and does nothing until alerts arrive that you have not looked at yet; then its blade
 * spins, it flashes and lights up the corner (red when one of them is critical, amber otherwise). Opening the agent panel counts
 * as looking, and it goes dark again. With reduced motion it simply stays lit, without spinning or flashing.
 */
function Gyrophare({ tone, reduceMotion, position }: { tone: 'critical' | 'open' | null; reduceMotion: boolean; position: [number, number, number] }) {
  const glass = useRef<THREE.MeshStandardMaterial>(null);
  const blade = useRef<THREE.Group>(null);
  const light = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => { // the console asks for the next frame while this is lit
    const lit = tone !== null;
    const t = clock.elapsedTime;
    const flash = !lit ? 0 : reduceMotion ? 1 : Math.sin(t * 9) > -0.3 ? 1 : 0.1; // about one and a half flashes a second
    if (blade.current) { blade.current.visible = lit; if (lit && !reduceMotion) blade.current.rotation.y = t * 7; }
    if (glass.current) glass.current.emissiveIntensity = lit ? 0.4 + flash * 2.4 : 0;
    if (light.current) light.current.intensity = lit ? flash * 2.5 : 0;
  });
  const color = tone ? FLASH[tone] : '#6a4b47';
  return (
    <group position={position} scale={GYROPHARE_SCALE}>
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
 * Chopper Bot, the crew's doctor: the 3D model made from his character sheet. How he moves says what the agent is doing:
 *  - asleep: the agent is offline (slumped forward, breathing out little z's);
 *  - resting: it is paused (leaning a little, still);
 *  - agitated: new alerts you have not seen (shaking and hopping, and the beacon on his crate flashes);
 *  - active: it is working on something right now (busy little bounces, turning from side to side);
 *  - calm: nothing new (breathing, glancing around).
 * His eyes glow with the state of the alerts.
 * Reduced motion keeps each pose but nothing moves.
 */
function Chopper({ mode, tone, reduceMotion }: { mode: RobotMode; tone: keyof typeof EYES; reduceMotion: boolean }) {
  return (
    <group position={[0.02, CRATE_TOP, 0.03]}>
      <Suspense fallback={null}>
        <CrewFigure url={crewModel('chopper-bot')} eyesUrl={crewEyes('chopper-bot')} eyes={{ color: EYES[tone], intensity: EYE_LIGHT[mode], pulse: mode === 'agitated' }} height={HEIGHT} motion={MOTION[mode]} reduceMotion={reduceMotion} zs={mode === 'asleep'} />
      </Suspense>
    </group>
  );
}

/** The crate turned into Chopper's medical station: the alert monitor on its front, the warning beacon on a post at the back. */
function MedicalCrate({ open, critical, state, flash, reduceMotion }: {
  open: number; critical: number; state: 'online' | 'paused' | 'offline'; flash: 'critical' | 'open' | null; reduceMotion: boolean;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const texRef = useRef<THREE.CanvasTexture | null>(null);
  const screen = useRef<THREE.MeshBasicMaterial>(null);
  useEffect(() => {
    texRef.current = drawAgentTexture(texRef.current, open, critical, state);
    if (screen.current) { screen.current.map = texRef.current; screen.current.needsUpdate = true; }
    invalidate();
  }, [open, critical, state, invalidate]);
  useEffect(() => () => texRef.current?.dispose(), []);
  return (
    <group>
      <mesh position={[0, 0.2, 0]} castShadow receiveShadow><boxGeometry args={[0.62, 0.4, 0.46]} /><meshStandardMaterial color={WOOD} roughness={0.7} /></mesh>
      {[-0.27, 0.27].map((x) => <mesh key={x} position={[x, 0.2, 0.235]}><boxGeometry args={[0.04, 0.34, 0.01]} /><meshStandardMaterial color="#6e4b30" roughness={0.7} /></mesh>)}
      {/* the alert monitor (how many are open, how many critical) */}
      <RoundedBox args={[0.42, 0.28, 0.025]} radius={0.015} smoothness={2} position={[0, 0.2, 0.236]}><meshStandardMaterial color="#1c2a3d" roughness={0.4} /></RoundedBox>
      <mesh position={[0, 0.2, 0.2495]}><planeGeometry args={[0.37, 0.23]} /><meshBasicMaterial ref={screen} color="#ffffff" toneMapped={false} /></mesh>
      {/* the beacon on its post, clamped to the back corner */}
      <group position={[-0.24, 0.4, -0.17]}>
        <mesh position={[0, 0.16, 0]} castShadow><cylinderGeometry args={[0.014, 0.014, 0.32, 10]} /><meshStandardMaterial color="#8d949c" metalness={0.6} roughness={0.4} /></mesh>
        <mesh position={[0, 0.01, 0]}><boxGeometry args={[0.07, 0.02, 0.07]} /><meshStandardMaterial color="#5b6168" metalness={0.5} roughness={0.45} /></mesh>
        <Gyrophare tone={flash} reduceMotion={reduceMotion} position={[0, 0.32, 0]} />
      </group>
    </group>
  );
}

/**
 * Chopper Bot's spot in the room: Chopper on his medical crate. It only reads the agent's summary; nothing from work is drawn
 * here except the number of open alerts on the crate's monitor.
 */
export function AgentConsole({ reduceMotion }: { evening?: boolean; reduceMotion: boolean }) {
  const overview = useAgent((s) => s.overview);
  const alerts = useAgent((s) => s.alerts);
  const seen = useAgent((s) => s.seen);
  const { open, critical } = useMemo(() => alertCounts(alerts), [alerts]);
  const fresh = useMemo(() => unseenAlerts(seen, alerts), [seen, alerts]);
  const flash = fresh.length === 0 ? null : fresh.some((a) => a.severity === 'critical') ? 'critical' : 'open';
  const state = !overview?.online ? 'offline' : overview.state === 'paused' ? 'paused' : 'online';
  const tone = state !== 'online' ? 'idle' : critical ? 'critical' : open ? 'open' : 'quiet';
  const mode = robotMode(overview, fresh.length);
  // about 30 frames a second while he is lively or the beacon flashes, 8 for the calm moods
  useBotFrames(reduceMotion, mode === 'agitated' || mode === 'active' || flash !== null, 125);

  return (
    <Interactive
      id="agent" label="Chopper Bot" hint="Rollbar alerts & proposed fixes" reduceMotion={reduceMotion}
      box={{ size: [0.75, 1.35, 0.65], center: [X, 0.68, Z] }} pin={[X, 1.6, Z]}
      hit={{ size: [0.8, 1.4, 0.7], center: [X, 0.7, Z] }}
    >
      <group position={[X, 0, Z]} rotation={[0, 0.78, 0]}>
        <MedicalCrate open={open} critical={critical} state={state} flash={flash} reduceMotion={reduceMotion} />
        <Chopper mode={mode} tone={tone} reduceMotion={reduceMotion} />
      </group>
    </Interactive>
  );
}
