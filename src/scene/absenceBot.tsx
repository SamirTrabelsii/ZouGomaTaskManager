import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import { useAbsences } from '../state/absences';
import { useToday } from '../state/hooks';
import { absenceBotMood, upcomingDays, type AbsenceBotMood } from '../domain/absence';
import { Interactive } from './Interactive';

/** Where the absence robot stands: on the floor between the agent's crate and the record cabinet, clear of the armchair. */
export const ABSENCE_SPOT: [number, number, number] = [2.85, 0.45, 0.95];
const [X, , Z] = ABSENCE_SPOT;

const SHELL = '#a8dccb';
const TRIM = '#3f6f66';
const ANTENNA: Record<AbsenceBotMood, string> = { idle: '#7fe0b5', busy: '#5cb8ff', waiting: '#ffb347', worried: '#ff4a3c', away: '#ffd36b' };

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** The clipboard page: the next day off in big letters, or what the robot is busy with. */
function drawBoard(tex: THREE.CanvasTexture | null, mood: AbsenceBotMood, next: string | null): THREE.CanvasTexture {
  const W = 256, H = 320;
  const c = (tex?.image as HTMLCanvasElement | undefined) ?? Object.assign(document.createElement('canvas'), { width: W, height: H });
  const g = c.getContext('2d')!;
  g.fillStyle = '#fbf7ec'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#e3dccb'; g.lineWidth = 2;
  for (let y = 70; y < H; y += 34) { g.beginPath(); g.moveTo(16, y); g.lineTo(W - 16, y); g.stroke(); }
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  const title = (t: string, color = '#3f6f66') => { g.fillStyle = color; g.font = '700 30px sans-serif'; g.fillText(t, W / 2, 48); };
  if (mood === 'worried') {
    title('PROBLEM', '#c8372d');
    g.fillStyle = '#c8372d'; g.font = '700 150px sans-serif'; g.fillText('!', W / 2, 230);
    g.font = '600 30px sans-serif'; g.fillText('open me', W / 2, 290);
  } else if (mood === 'waiting' || mood === 'busy') {
    title(mood === 'busy' ? 'SENDING' : 'WAITING', mood === 'busy' ? '#2f7fc4' : '#c98112');
    g.fillStyle = '#5b5b5b'; g.font = '600 26px sans-serif';
    g.fillText(mood === 'busy' ? 'mails & statuses' : 'for n8n…', W / 2, 150);
    // an envelope
    g.strokeStyle = mood === 'busy' ? '#2f7fc4' : '#c98112'; g.lineWidth = 6;
    g.strokeRect(68, 190, 120, 80); g.beginPath(); g.moveTo(68, 190); g.lineTo(128, 238); g.lineTo(188, 190); g.stroke();
  } else if (mood === 'away') {
    title('OFF TODAY', '#c98112');
    g.font = '120px sans-serif'; g.fillText('🌴', W / 2, 240);
  } else if (next) {
    const d = new Date(`${next}T00:00:00Z`);
    title('NEXT DAY OFF');
    g.fillStyle = '#7a756a'; g.font = '600 32px sans-serif'; g.fillText(DAYS[d.getUTCDay()], W / 2, 108);
    g.fillStyle = '#2b2a27'; g.font = '800 120px sans-serif'; g.fillText(String(d.getUTCDate()), W / 2, 225);
    g.fillStyle = '#3f6f66'; g.font = '700 40px sans-serif'; g.fillText(MONTHS[d.getUTCMonth()], W / 2, 282);
  } else {
    title('ABSENCES');
    g.fillStyle = '#7a756a'; g.font = '600 28px sans-serif';
    g.fillText('nothing', W / 2, 160); g.fillText('planned', W / 2, 196);
    g.fillStyle = '#3f6f66'; g.font = '700 26px sans-serif'; g.fillText('+ book a day', W / 2, 270);
  }
  if (tex) { tex.needsUpdate = true; return tex; }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const damp = THREE.MathUtils.damp;

function Bot({ mood, next, reduceMotion }: { mood: AbsenceBotMood; next: string | null; reduceMotion: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  const root = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const bulb = useRef<THREE.MeshStandardMaterial>(null);
  const glasses = useRef<THREE.Group>(null);
  const board = useRef<THREE.MeshBasicMaterial>(null);
  const texRef = useRef<THREE.CanvasTexture | null>(null);
  const visor = useMemo(() => new THREE.MeshStandardMaterial({ color: '#16242a', emissive: new THREE.Color('#7fe0b5'), emissiveIntensity: 0.9, roughness: 0.25, toneMapped: false }), []);

  useEffect(() => {
    texRef.current = drawBoard(texRef.current, mood, next);
    if (board.current) { board.current.map = texRef.current; board.current.needsUpdate = true; }
    visor.emissive.set(mood === 'worried' ? '#ff7a6b' : mood === 'away' ? '#3a3a3a' : '#7fe0b5');
    invalidate();
  }, [mood, next, visor, invalidate]);

  const lively = mood === 'busy' || mood === 'worried';
  useEffect(() => {
    if (reduceMotion) return;
    const id = setInterval(invalidate, lively ? 33 : 100);
    return () => clearInterval(id);
  }, [reduceMotion, lively, invalidate]);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const m = reduceMotion ? 0 : 1;
    const k = reduceMotion ? 1000 : 6;
    const step = Math.min(dt, 0.1);
    let headY = 0, headX = 0, armX = -0.5, sway = 0, blink = 1;
    switch (mood) {
      case 'busy':
        headX = 0.35; armX = -0.95 + Math.sin(t * 11) * 0.18 * m; blink = Math.sin(t * 10) > 0 ? 1 : 0.2; break;
      case 'worried':
        headY = Math.sin(t * 16) * 0.3 * m; blink = Math.sin(t * 7) > -0.2 ? 1 : 0.15; sway = Math.sin(t * 24) * 0.02 * m; break;
      case 'waiting':
        headY = Math.sin(t * 0.9) * 0.6 * m; blink = 0.55 + 0.45 * Math.sin(t * 2.2); break;
      case 'away':
        headX = -0.18; sway = Math.sin(t * 1.2) * 0.05 * m; blink = 0.8; break;
      default:
        headY = Math.sin(t * 0.5) * 0.15 * m; sway = Math.sin(t * 1.4) * 0.025 * m; blink = 0.9;
    }
    if (head.current) { head.current.rotation.y = damp(head.current.rotation.y, headY, mood === 'worried' ? 30 : k, step); head.current.rotation.x = damp(head.current.rotation.x, headX, k, step); }
    if (armR.current) armR.current.rotation.x = damp(armR.current.rotation.x, armX, mood === 'busy' ? 30 : k, step);
    if (root.current) root.current.rotation.z = sway;
    if (bulb.current) bulb.current.emissiveIntensity = 0.4 + 2.6 * (reduceMotion ? 1 : blink);
    if (glasses.current) glasses.current.visible = mood === 'away';
  });

  const color = ANTENNA[mood];
  return (
    <group ref={root}>
      {/* base on wheels */}
      <mesh position={[0, 0.06, 0]} castShadow receiveShadow><cylinderGeometry args={[0.2, 0.23, 0.12, 24]} /><meshStandardMaterial color={TRIM} roughness={0.55} /></mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[Math.sin((i * Math.PI * 2) / 3) * 0.16, 0.025, Math.cos((i * Math.PI * 2) / 3) * 0.16]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.03, 0.03, 0.03, 12]} /><meshStandardMaterial color="#2c3338" roughness={0.6} />
        </mesh>
      ))}
      {/* body */}
      <mesh position={[0, 0.36, 0]} castShadow><capsuleGeometry args={[0.17, 0.28, 8, 20]} /><meshStandardMaterial color={SHELL} roughness={0.45} /></mesh>
      <mesh position={[0, 0.2, 0]}><torusGeometry args={[0.172, 0.014, 8, 32]} /><meshStandardMaterial color={TRIM} roughness={0.5} /></mesh>
      {/* left arm holds the clipboard in front */}
      <group position={[0.17, 0.46, 0.02]} rotation={[-1.05, 0, -0.35]}>
        <mesh position={[0, -0.1, 0]} castShadow><cylinderGeometry args={[0.024, 0.024, 0.2, 10]} /><meshStandardMaterial color={TRIM} roughness={0.5} /></mesh>
      </group>
      <group position={[0.02, 0.4, 0.2]} rotation={[-0.35, 0, 0]}>
        <RoundedBox args={[0.22, 0.28, 0.015]} radius={0.01} smoothness={2} castShadow><meshStandardMaterial color="#8a6a45" roughness={0.6} /></RoundedBox>
        <mesh position={[0, -0.006, 0.009]}><planeGeometry args={[0.19, 0.24]} /><meshBasicMaterial ref={board} color="#ffffff" toneMapped={false} /></mesh>
        <mesh position={[0, 0.135, 0.012]}><boxGeometry args={[0.07, 0.025, 0.012]} /><meshStandardMaterial color="#b8bcc0" metalness={0.7} roughness={0.3} /></mesh>
      </group>
      {/* right arm with a pen, writes when busy */}
      <group ref={armR} position={[-0.18, 0.47, 0.02]}>
        <mesh position={[0, -0.1, 0]} castShadow><cylinderGeometry args={[0.024, 0.024, 0.2, 10]} /><meshStandardMaterial color={TRIM} roughness={0.5} /></mesh>
        <mesh position={[0, -0.22, 0.02]} rotation={[0.6, 0, 0]}><cylinderGeometry args={[0.008, 0.004, 0.1, 8]} /><meshStandardMaterial color="#2a4a8a" roughness={0.4} /></mesh>
      </group>
      {/* dome head with a visor */}
      <group ref={head} position={[0, 0.66, 0]}>
        <mesh castShadow><sphereGeometry args={[0.15, 24, 18]} /><meshStandardMaterial color={SHELL} roughness={0.4} /></mesh>
        <mesh position={[0, 0.01, 0.105]} scale={[1, 0.45, 0.6]} material={visor}><sphereGeometry args={[0.12, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
        <group ref={glasses} visible={false} position={[0, 0.03, 0.15]}>
          {[-0.045, 0.045].map((x) => <mesh key={x} position={[x, 0, 0]}><boxGeometry args={[0.07, 0.04, 0.01]} /><meshStandardMaterial color="#111" roughness={0.2} metalness={0.4} /></mesh>)}
          <mesh><boxGeometry args={[0.03, 0.008, 0.01]} /><meshStandardMaterial color="#111" /></mesh>
        </group>
        <mesh position={[0, 0.19, 0]}><cylinderGeometry args={[0.008, 0.008, 0.09, 8]} /><meshStandardMaterial color="#8d949c" metalness={0.6} roughness={0.4} /></mesh>
        <mesh position={[0, 0.245, 0]}>
          <sphereGeometry args={[0.028, 14, 10]} />
          <meshStandardMaterial ref={bulb} color={color} emissive={color} emissiveIntensity={1} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

/** The absence assistant: click it to book a day off and follow each step (mails, planning, statuses, Boond). */
export function AbsenceBot({ reduceMotion }: { reduceMotion: boolean }) {
  const list = useAbsences((s) => s.list);
  const today = useToday();
  const mood = absenceBotMood(list, today);
  const next = useMemo(() => (list ? upcomingDays(list.absences, today)[0]?.date ?? null : null), [list, today]);
  return (
    <Interactive
      id="absence" label="Absences" hint="Book a day off" reduceMotion={reduceMotion}
      box={{ size: [0.55, 0.95, 0.55], center: [X, 0.47, Z] }} pin={[X, 1.25, Z]}
      hit={{ size: [0.6, 1.0, 0.6], center: [X, 0.5, Z] }}
    >
      <group position={[X, 0, Z]} rotation={[0, 0.78, 0]}>
        <Bot mood={mood} next={next} reduceMotion={reduceMotion} />
      </group>
    </Interactive>
  );
}
