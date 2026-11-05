import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import { useAgent } from '../state/agent';
import { alertCounts, robotMode, unseenAlerts, type RobotMode } from '../domain/agent';
import { drawAgentTexture } from './textures';
import { Interactive } from './Interactive';

/** Where the robot stands: the open floor to the right of the desk, on a crate. */
export const AGENT_SPOT: [number, number, number] = [2.45, 0.5, -0.05];
const [X, , Z] = AGENT_SPOT;
const WOOD = '#a97b4f';
const CRATE_TOP = 0.4;

/** The colour of the robot's eyes: what the alerts say (red when one is critical, amber for some, green for none, grey when it is not watching). */
const EYES = { critical: '#ff4a3c', open: '#ffb347', quiet: '#6fd27a', idle: '#6b7570' } as const;
/** How bright the eyes are in each mood. */
const EYE_LIGHT: Record<RobotMode, number> = { asleep: 0.15, resting: 0.6, calm: 1.8, active: 2.2, agitated: 3 };

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
  useFrame(({ clock }) => { // the Robot around it asks for the next frame while this is lit
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

/** A small "z" for the sleeping robot to breathe out. */
function makeZTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#cfe2ff'; g.font = '700 54px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('z', 32, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const damp = THREE.MathUtils.damp;

/**
 * The agent as a small robot with a rotating light on its head. How it behaves says what the agent is doing:
 *  - asleep: the agent is offline (head down, eyes shut, little z's);
 *  - resting: it is paused (eyes half shut, still);
 *  - agitated: new alerts you have not seen (arms waving, shaking, wide eyes, and the light flashes);
 *  - active: it is working on something right now (arms typing, eyes scanning);
 *  - calm: nothing to report (breathing, blinking now and then; its eyes show the state of the alerts).
 * Reduced motion keeps each pose but nothing moves.
 */
function Robot({ mode, tone, flash, open, critical, state, reduceMotion }: {
  mode: RobotMode; tone: keyof typeof EYES; flash: 'critical' | 'open' | null; open: number; critical: number; state: 'online' | 'paused' | 'offline'; reduceMotion: boolean;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const eyes = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const zs = useRef<THREE.Group>(null);
  const texRef = useRef<THREE.CanvasTexture | null>(null);
  const screen = useRef<THREE.MeshBasicMaterial>(null);
  const eyeMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: '#111', emissive: new THREE.Color(EYES.idle), emissiveIntensity: 0, toneMapped: false }), []);
  const zTexture = useMemo(makeZTexture, []);
  const zMaterials = useRef<(THREE.SpriteMaterial | null)[]>([]);

  useEffect(() => { eyeMaterial.emissive.set(EYES[tone]); invalidate(); }, [eyeMaterial, tone, invalidate]);
  useEffect(() => {
    texRef.current = drawAgentTexture(texRef.current, open, critical, state);
    if (screen.current) { screen.current.map = texRef.current; screen.current.needsUpdate = true; }
    invalidate();
  }, [open, critical, state, invalidate]);

  // The scene draws every frame unless reduced motion is on; then it only draws on demand. In that case the pose is set once
  // (no wobble), and a frame is asked for whenever the mood changes.
  useEffect(() => { invalidate(); }, [mode, flash, invalidate]);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const m = reduceMotion ? 0 : 1; // multiplies every wobble
    const k = reduceMotion ? 1000 : 7; // how fast a pose is reached
    const step = Math.min(dt, 0.1);
    const to = (o: THREE.Object3D | null, axis: 'x' | 'y' | 'z', v: number, lambda = k) => { if (o) o.rotation[axis] = damp(o.rotation[axis], v, lambda, step); };

    let headX = 0, headY = 0, armLx = 0, armLz = 0.12, armRx = 0, armRz = -0.12, eyeY = 1, eyeX = 0, bob = 0, shake = 0, breathe = 1;
    switch (mode) {
      case 'asleep':
        headX = 0.5; armLz = 0.05; armRz = -0.05; eyeY = 0.1; breathe = 1 + Math.sin(t * 1.1) * 0.012 * m; break;
      case 'resting':
        headX = 0.12; armLz = 0.08; armRz = -0.08; eyeY = 0.45; breathe = 1 + Math.sin(t * 1.4) * 0.008 * m; break;
      case 'agitated':
        headY = Math.sin(t * 22) * 0.28 * m;
        armLz = 2.35 + Math.sin(t * 15) * 0.35 * m; armRz = -2.35 + Math.sin(t * 15 + Math.PI) * 0.35 * m;
        eyeY = 1.35; bob = Math.abs(Math.sin(t * 13)) * 0.025 * m; shake = Math.sin(t * 31) * 0.045 * m; break;
      case 'active':
        headX = 0.18; headY = Math.sin(t * 1.3) * 0.12 * m;
        armLx = -0.95 + Math.sin(t * 9) * 0.28 * m; armRx = -0.95 + Math.sin(t * 9 + Math.PI) * 0.28 * m; armLz = 0.18; armRz = -0.18;
        eyeX = Math.sin(t * 2.4) * 0.03 * m; break;
      default: { // calm
        headY = Math.sin(t * 0.6) * 0.16 * m; bob = Math.sin(t * 1.5) * 0.004 * m;
        const blinking = (t % 3.4) > 3.28; // a blink every few seconds
        eyeY = blinking && !reduceMotion ? 0.1 : 1; breathe = 1 + Math.sin(t * 1.6) * 0.01 * m;
      }
    }
    to(head.current, 'x', headX); to(head.current, 'y', headY, mode === 'agitated' ? 40 : k);
    to(armL.current, 'x', armLx); to(armL.current, 'z', armLz);
    to(armR.current, 'x', armRx); to(armR.current, 'z', armRz);
    if (eyes.current) {
      eyes.current.scale.y = damp(eyes.current.scale.y, eyeY, mode === 'calm' ? 40 : k, step);
      const wide = mode === 'agitated' ? 1.3 : 1;
      eyes.current.scale.x = damp(eyes.current.scale.x, wide, k, step);
      eyes.current.position.x = damp(eyes.current.position.x, eyeX, k, step);
    }
    if (root.current) { root.current.position.y = CRATE_TOP + bob; root.current.rotation.z = shake; }
    if (body.current) body.current.scale.y = breathe;
    eyeMaterial.emissiveIntensity = EYE_LIGHT[mode] * (mode === 'agitated' ? 0.75 + 0.25 * Math.sin(t * 18) * m : 1);

    if (zs.current) {
      zs.current.visible = mode === 'asleep';
      zs.current.children.forEach((child, i) => {
        const phase = reduceMotion ? 0.4 + i * 0.25 : (t * 0.45 + i / 3) % 1;
        child.position.set(0.18 + phase * 0.1, 0.62 + phase * 0.3, 0.05);
        child.scale.setScalar(0.07 + phase * 0.07);
        const mat = zMaterials.current[i];
        if (mat) mat.opacity = Math.sin(Math.PI * phase) * 0.9;
      });
    }
  });

  return (
    <group ref={root} position={[0, CRATE_TOP, 0]}>
      {/* feet and legs */}
      {[-0.07, 0.07].map((x) => (
        <group key={x}>
          <mesh position={[x, 0.025, 0.01]} castShadow><boxGeometry args={[0.1, 0.05, 0.15]} /><meshStandardMaterial color="#3a3f46" roughness={0.5} /></mesh>
          <mesh position={[x, 0.08, 0]}><cylinderGeometry args={[0.02, 0.02, 0.06, 8]} /><meshStandardMaterial color="#8d949c" metalness={0.6} roughness={0.4} /></mesh>
        </group>
      ))}
      {/* body */}
      <group ref={body} position={[0, 0.12, 0]}>
        <RoundedBox args={[0.3, 0.28, 0.2]} radius={0.04} smoothness={3} position={[0, 0.14, 0]} castShadow>
          <meshStandardMaterial color="#d8d2c2" roughness={0.5} />
        </RoundedBox>
        <mesh position={[0, 0.15, 0.102]}>
          <planeGeometry args={[0.18, 0.112]} />
          <meshBasicMaterial ref={screen} color="#ffffff" toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.04, 0.101]}><boxGeometry args={[0.14, 0.012, 0.004]} /><meshStandardMaterial color="#8a8678" roughness={0.6} /></mesh>
        {/* arms: pivot at the shoulder */}
        {([['L', 0.19, armL], ['R', -0.19, armR]] as const).map(([key, x, ref]) => (
          <group key={key} ref={ref} position={[x, 0.23, 0]}>
            <mesh position={[0, -0.09, 0]} castShadow><cylinderGeometry args={[0.026, 0.026, 0.18, 10]} /><meshStandardMaterial color="#8d949c" metalness={0.5} roughness={0.45} /></mesh>
            <mesh position={[0, -0.19, 0]} castShadow><sphereGeometry args={[0.04, 12, 10]} /><meshStandardMaterial color="#d8d2c2" roughness={0.5} /></mesh>
          </group>
        ))}
      </group>
      {/* neck and head */}
      <mesh position={[0, 0.43, 0]}><cylinderGeometry args={[0.03, 0.03, 0.06, 10]} /><meshStandardMaterial color="#8d949c" metalness={0.6} roughness={0.4} /></mesh>
      <group ref={head} position={[0, 0.46, 0]}>
        <RoundedBox args={[0.28, 0.2, 0.2]} radius={0.04} smoothness={3} position={[0, 0.1, 0]} castShadow>
          <meshStandardMaterial color="#d8d2c2" roughness={0.5} />
        </RoundedBox>
        <mesh position={[0, 0.1, 0.101]}><boxGeometry args={[0.22, 0.12, 0.006]} /><meshStandardMaterial color="#1b2430" roughness={0.3} /></mesh>
        <group ref={eyes} position={[0, 0.105, 0.108]}>
          {[-0.05, 0.05].map((x) => <mesh key={x} position={[x, 0, 0]} material={eyeMaterial}><boxGeometry args={[0.045, 0.045, 0.01]} /></mesh>)}
        </group>
        {[-0.15, 0.15].map((x) => <mesh key={x} position={[x, 0.1, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.035, 0.035, 0.03, 12]} /><meshStandardMaterial color="#8d949c" metalness={0.5} roughness={0.45} /></mesh>)}
        <Gyrophare tone={flash} reduceMotion={reduceMotion} position={[0, 0.2, 0]} />
      </group>
      {/* z z z */}
      <group ref={zs} visible={false}>
        {[0, 1, 2].map((i) => (
          <sprite key={i}>
            <spriteMaterial ref={(m) => { zMaterials.current[i] = m; }} map={zTexture} transparent depthWrite={false} toneMapped={false} opacity={0} />
          </sprite>
        ))}
      </group>
    </group>
  );
}

/**
 * The agent's spot in the room: the robot on a crate. It only reads the agent's summary; nothing from work is drawn here
 * except the number of open alerts on its chest.
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

  return (
    <Interactive
      id="agent" label="Agent console" hint="Alerts & proposed fixes" reduceMotion={reduceMotion}
      box={{ size: [0.75, 1.3, 0.65], center: [X, 0.65, Z] }} pin={[X, 1.7, Z]}
      hit={{ size: [0.8, 1.35, 0.7], center: [X, 0.67, Z] }}
    >
      <group position={[X, 0, Z]} rotation={[0, 0.78, 0]}>
        {/* crate */}
        <mesh position={[0, 0.2, 0]} castShadow receiveShadow><boxGeometry args={[0.62, 0.4, 0.46]} /><meshStandardMaterial color={WOOD} roughness={0.7} /></mesh>
        {[-0.2, 0.2].map((x) => <mesh key={x} position={[x, 0.2, 0.235]}><boxGeometry args={[0.04, 0.34, 0.01]} /><meshStandardMaterial color="#6e4b30" roughness={0.7} /></mesh>)}
        <Robot mode={mode} tone={tone} flash={flash} open={open} critical={critical} state={state} reduceMotion={reduceMotion} />
      </group>
    </Interactive>
  );
}
