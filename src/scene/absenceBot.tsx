import { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import { useAbsences } from '../state/absences';
import { useToday } from '../state/hooks';
import { absenceBotMood, upcomingDays, type AbsenceBotMood } from '../domain/absence';
import { Interactive } from './Interactive';
import { CREW_BLUE, CrewFigure, crewEyes, crewModel, useBotFrames, type CrewEyes, type CrewMotion } from './crewBot';

/** Where Nami Bot stands: the open floor on the left, between the pouf and the chest, well apart from Chopper. */
export const ABSENCE_SPOT: [number, number, number] = [-0.35, 0.42, 1.85];
const [X, , Z] = ABSENCE_SPOT;

/**
 * How Nami moves in each mood of the absence robot (see {@link CrewFigure}):
 *  - idle: nothing to do (rocking gently);
 *  - busy: a step is being carried out (busy little bounces);
 *  - waiting: steps wait for an executor (looking around);
 *  - worried: a step failed (shaking, open her panel);
 *  - away: you are off today (happy hops).
 */
const MOTION: Record<AbsenceBotMood, CrewMotion> = { idle: 'sway', busy: 'busy', waiting: 'look', worried: 'shake', away: 'hop' };
/** Her height, in metres. */
const HEIGHT = 0.82;
/** Her glowing eyes in each mood: blue, red when a step failed, softer on her day off. */
const EYES: Record<AbsenceBotMood, CrewEyes> = {
  idle: { color: CREW_BLUE, intensity: 2 }, busy: { color: CREW_BLUE, intensity: 2.4 }, waiting: { color: CREW_BLUE, intensity: 1.7 },
  worried: { color: '#ff4a3c', intensity: 2.6, pulse: true }, away: { color: CREW_BLUE, intensity: 1.2 },
};
/** The light of the chart's projector in each mood (the old robot's antenna colours). */
const BEAM: Record<AbsenceBotMood, string> = { idle: '#7fe0b5', busy: '#5cb8ff', waiting: '#ffb347', worried: '#ff4a3c', away: '#ffd36b' };

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** A compass rose in the current stroke and fill colours. */
function drawRose(g: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  g.save(); g.translate(cx, cy);
  g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(0, 0, r * 0.78, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < 8; i++) {
    const long = i % 2 === 0 ? r * 0.95 : r * 0.55;
    g.rotate(Math.PI / 4);
    g.beginPath(); g.moveTo(0, -long); g.lineTo(r * 0.11, 0); g.lineTo(0, r * 0.11); g.lineTo(-r * 0.11, 0); g.closePath(); g.fill();
  }
  g.restore();
}

/** The holographic sea chart she holds: the next day off in big letters, or what she is busy with. */
function drawBoard(tex: THREE.CanvasTexture | null, mood: AbsenceBotMood, next: string | null): THREE.CanvasTexture {
  const W = 256, H = 320;
  const c = (tex?.image as HTMLCanvasElement | undefined) ?? Object.assign(document.createElement('canvas'), { width: W, height: H });
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(8,30,58,.92)'; g.fillRect(0, 0, W, H);
  // the chart's grid and a faint compass rose
  g.strokeStyle = 'rgba(120,205,255,.16)'; g.lineWidth = 1.5;
  for (let x = 16; x < W; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let y = 16; y < H; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.strokeStyle = g.fillStyle = 'rgba(120,205,255,.13)'; g.lineWidth = 2;
  drawRose(g, W - 58, H - 62, 46);
  g.strokeStyle = 'rgba(127,216,255,.85)'; g.lineWidth = 4; g.strokeRect(4, 4, W - 8, H - 8);
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  const title = (t: string, color = '#7fd8ff') => { g.fillStyle = color; g.font = '700 30px sans-serif'; g.fillText(t, W / 2, 48); };
  if (mood === 'worried') {
    title('PROBLEM', '#ff7a6b');
    g.fillStyle = '#ff7a6b'; g.font = '700 150px sans-serif'; g.fillText('!', W / 2, 230);
    g.font = '600 30px sans-serif'; g.fillText('open me', W / 2, 290);
  } else if (mood === 'waiting' || mood === 'busy') {
    const tone = mood === 'busy' ? '#7fd8ff' : '#ffc35a';
    title(mood === 'busy' ? 'SENDING' : 'WAITING', tone);
    g.fillStyle = '#d7ecfb'; g.font = '600 26px sans-serif';
    g.fillText(mood === 'busy' ? 'mails & statuses' : 'for n8n…', W / 2, 150);
    // an envelope
    g.strokeStyle = tone; g.lineWidth = 6;
    g.strokeRect(68, 190, 120, 80); g.beginPath(); g.moveTo(68, 190); g.lineTo(128, 238); g.lineTo(188, 190); g.stroke();
  } else if (mood === 'away') {
    title('OFF TODAY', '#ffc35a');
    g.font = '120px sans-serif'; g.fillText('🌴', W / 2, 240);
  } else if (next) {
    const d = new Date(`${next}T00:00:00Z`);
    title('NEXT DAY OFF');
    g.fillStyle = '#a9d6f5'; g.font = '600 32px sans-serif'; g.fillText(DAYS[d.getUTCDay()], W / 2, 108);
    g.fillStyle = '#ffffff'; g.font = '800 120px sans-serif'; g.fillText(String(d.getUTCDate()), W / 2, 225);
    g.fillStyle = '#ffb36b'; g.font = '700 40px sans-serif'; g.fillText(MONTHS[d.getUTCMonth()], W / 2, 282);
  } else {
    title('ABSENCES');
    g.fillStyle = '#a9d6f5'; g.font = '600 28px sans-serif';
    g.fillText('nothing', W / 2, 160); g.fillText('planned', W / 2, 196);
    g.fillStyle = '#ffb36b'; g.font = '700 26px sans-serif'; g.fillText('+ book a day', W / 2, 270);
  }
  if (tex) { tex.needsUpdate = true; return tex; }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * The sea chart floating beside her, above a small brass projector: the next day off, or what she is busy with. Its beam takes
 * the colour of her mood and blinks while she works or when something went wrong.
 */
function HoloChart({ mood, next, reduceMotion }: { mood: AbsenceBotMood; next: string | null; reduceMotion: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  const panel = useRef<THREE.Group>(null);
  const board = useRef<THREE.MeshBasicMaterial>(null);
  const lens = useRef<THREE.MeshStandardMaterial>(null);
  const beam = useRef<THREE.MeshBasicMaterial>(null);
  const texRef = useRef<THREE.CanvasTexture | null>(null);
  useEffect(() => {
    texRef.current = drawBoard(texRef.current, mood, next);
    if (board.current) { board.current.map = texRef.current; board.current.needsUpdate = true; }
    invalidate();
  }, [mood, next, invalidate]);
  useEffect(() => () => texRef.current?.dispose(), []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const m = reduceMotion ? 0 : 1;
    if (panel.current) panel.current.position.y = 0.56 + Math.sin(t * 1.3) * 0.012 * m;
    const blink = reduceMotion ? 1
      : mood === 'busy' ? (Math.sin(t * 10) > 0 ? 1 : 0.3)
      : mood === 'worried' ? (Math.sin(t * 7) > -0.2 ? 1 : 0.2)
      : mood === 'waiting' ? 0.55 + 0.45 * Math.sin(t * 2.2) : 0.85;
    if (lens.current) lens.current.emissiveIntensity = 0.4 + 2.2 * blink;
    if (beam.current) beam.current.opacity = 0.08 + 0.12 * blink;
  });

  const color = BEAM[mood];
  return (
    <group>
      {/* the projector on the floor */}
      <mesh position={[0, 0.025, 0]} castShadow><cylinderGeometry args={[0.065, 0.08, 0.05, 24]} /><meshStandardMaterial color="#b0702e" metalness={0.6} roughness={0.35} /></mesh>
      <mesh position={[0, 0.053, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 0.008, 20]} />
        <meshStandardMaterial ref={lens} color={color} emissive={color} emissiveIntensity={1} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.25, 0]}>
        <cylinderGeometry args={[0.13, 0.035, 0.4, 24, 1, true]} />
        <meshBasicMaterial ref={beam} color={color} transparent opacity={0.15} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      {/* the chart itself */}
      <group ref={panel} position={[0, 0.56, 0]} rotation={[-0.12, 0, 0]}>
        <RoundedBox args={[0.23, 0.29, 0.01]} radius={0.008} smoothness={2}>
          <meshStandardMaterial color="#123a66" emissive="#3fc4ff" emissiveIntensity={0.7} transparent opacity={0.55} roughness={0.2} toneMapped={false} />
        </RoundedBox>
        <mesh position={[0, 0, 0.007]}><planeGeometry args={[0.21, 0.27]} /><meshBasicMaterial ref={board} color="#ffffff" transparent toneMapped={false} /></mesh>
      </group>
    </group>
  );
}

/** Nami Bot, the crew's navigator, runs the absences: click her to book a day off and follow each step (mails, planning, statuses, Boond). */
export function AbsenceBot({ reduceMotion }: { evening?: boolean; reduceMotion: boolean }) {
  const list = useAbsences((s) => s.list);
  const today = useToday();
  const mood = absenceBotMood(list, today);
  const next = useMemo(() => (list ? upcomingDays(list.absences, today)[0]?.date ?? null : null), [list, today]);
  useBotFrames(reduceMotion, mood !== 'idle', 100);
  return (
    <Interactive
      id="absence" label="Nami Bot" hint="Absences · book a day off" reduceMotion={reduceMotion}
      box={{ size: [0.8, 1.05, 0.6], center: [X, 0.52, Z] }} pin={[X, 1.2, Z]}
      hit={{ size: [0.85, 1.1, 0.65], center: [X, 0.55, Z] }}
    >
      <group position={[X, 0, Z]} rotation={[0, 0.78, 0]}>
        <Suspense fallback={null}>
          <CrewFigure url={crewModel('nami-bot')} eyesUrl={crewEyes('nami-bot')} eyes={EYES[mood]} height={HEIGHT} motion={MOTION[mood]} reduceMotion={reduceMotion} />
        </Suspense>
        <group position={[-0.36, 0, -0.04]}>
          <HoloChart mood={mood} next={next} reduceMotion={reduceMotion} />
        </group>
      </group>
    </Interactive>
  );
}
