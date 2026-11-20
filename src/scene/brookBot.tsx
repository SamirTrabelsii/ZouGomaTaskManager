import { Suspense, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import { useDeck } from '../state/deck';
import { deckMood, type DeckButton, type DeckMood } from '../domain/deck';
import { Interactive } from './Interactive';
import { CREW_BLUE, CrewFigure, crewEyes, crewModel, useBotFrames, type CrewEyes, type CrewMotion } from './crewBot';

/** Where Brook Bot stands: the open floor at the front left, between the pouf and Nami. */
export const DECK_SPOT: [number, number, number] = [-1.75, 0.5, 2.25];
const [X, , Z] = DECK_SPOT;

/**
 * Brook Bot's real model is not made yet. Until `public/models/brook-bot.glb` (and its `brook-bot-eyes.png` mask) arrive, he is a
 * simple stand-in; set this to true once they are there and he becomes a {@link CrewFigure} like Chopper and Nami.
 */
const HAS_MODEL = false;

/** His height, in metres: the tallest of the crew. */
const HEIGHT = 0.95;
/**
 * How he moves and how his eyes shine with the deck:
 *  - unplugged: no deck has connected yet (dozing, eyes dim);
 *  - outdated: the buttons changed since the deck fetched them (looking around, amber: click ⟳ on the deck);
 *  - ready: the deck has the current buttons (swaying to his own tune, blue).
 */
const MOTION: Record<DeckMood, CrewMotion> = { unplugged: 'rest', outdated: 'look', ready: 'sway' };
const EYES: Record<DeckMood, CrewEyes> = {
  unplugged: { color: '#8a94a6', intensity: 0.8 },
  outdated: { color: '#ffb347', intensity: 2.2, pulse: true },
  ready: { color: CREW_BLUE, intensity: 2 },
};

/** The deck's buttons as a small grid of coloured keys with their icons, drawn on the hologram beside him. */
function drawKeys(tex: THREE.CanvasTexture | null, buttons: DeckButton[], columns: number, mood: DeckMood): THREE.CanvasTexture {
  const W = 320, H = 256;
  const c = (tex?.image as HTMLCanvasElement | undefined) ?? Object.assign(document.createElement('canvas'), { width: W, height: H });
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(14,16,28,.92)'; g.fillRect(0, 0, W, H);
  g.strokeStyle = mood === 'outdated' ? 'rgba(255,179,71,.9)' : 'rgba(127,216,255,.85)'; g.lineWidth = 4; g.strokeRect(4, 4, W - 8, H - 8);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (!buttons.length) {
    g.fillStyle = '#7fd8ff'; g.font = '700 30px sans-serif'; g.fillText('STREAM DECK', W / 2, 90);
    g.fillStyle = '#ffb36b'; g.font = '600 26px sans-serif'; g.fillText('+ add buttons', W / 2, 160);
  } else {
    const cols = Math.max(1, Math.min(columns, buttons.length));
    const shown = buttons.slice(0, cols * 4);
    const rows = Math.ceil(shown.length / cols);
    const pad = 18, gap = 10;
    const size = Math.min((W - pad * 2 - gap * (cols - 1)) / cols, (H - pad * 2 - gap * (rows - 1)) / rows);
    const x0 = (W - (cols * size + (cols - 1) * gap)) / 2, y0 = (H - (rows * size + (rows - 1) * gap)) / 2;
    shown.forEach((b, i) => {
      const x = x0 + (i % cols) * (size + gap), y = y0 + Math.floor(i / cols) * (size + gap);
      g.fillStyle = b.color; g.beginPath(); g.roundRect(x, y, size, size, size * 0.18); g.fill();
      g.fillStyle = '#ffffff'; g.font = `${Math.round(size * 0.5)}px sans-serif`;
      g.fillText(b.icon || b.label.slice(0, 1).toUpperCase(), x + size / 2, y + size / 2 + 2);
    });
  }
  if (mood === 'outdated') {
    g.fillStyle = 'rgba(255,179,71,.95)'; g.beginPath(); g.arc(W - 30, 30, 18, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1a1206'; g.font = '700 24px sans-serif'; g.fillText('⟳', W - 30, 31);
  }
  if (tex) { tex.needsUpdate = true; return tex; }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** The hologram of the deck, floating beside him above a small music-box projector. */
function DeckHologram({ buttons, columns, mood, reduceMotion }: { buttons: DeckButton[]; columns: number; mood: DeckMood; reduceMotion: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  const panel = useRef<THREE.Group>(null);
  const board = useRef<THREE.MeshBasicMaterial>(null);
  const texRef = useRef<THREE.CanvasTexture | null>(null);
  useEffect(() => {
    texRef.current = drawKeys(texRef.current, buttons, columns, mood);
    if (board.current) { board.current.map = texRef.current; board.current.needsUpdate = true; }
    invalidate();
  }, [buttons, columns, mood, invalidate]);
  useEffect(() => () => texRef.current?.dispose(), []);
  useFrame(({ clock }) => {
    if (panel.current) panel.current.position.y = 0.6 + Math.sin(clock.elapsedTime * 1.2) * 0.012 * (reduceMotion ? 0 : 1);
  });
  const beam = mood === 'outdated' ? '#ffb347' : mood === 'ready' ? '#7fd8ff' : '#8a94a6';
  return (
    <group>
      <RoundedBox args={[0.14, 0.06, 0.1]} radius={0.012} smoothness={2} position={[0, 0.03, 0]} castShadow>
        <meshStandardMaterial color="#3b2416" roughness={0.5} />
      </RoundedBox>
      <mesh position={[0, 0.062, 0]}><cylinderGeometry args={[0.03, 0.03, 0.006, 20]} /><meshStandardMaterial color={beam} emissive={beam} emissiveIntensity={2} toneMapped={false} /></mesh>
      <mesh position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.14, 0.03, 0.46, 24, 1, true]} />
        <meshBasicMaterial color={beam} transparent opacity={0.12} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <group ref={panel} position={[0, 0.6, 0]} rotation={[-0.12, 0, 0]}>
        <RoundedBox args={[0.3, 0.24, 0.01]} radius={0.008} smoothness={2}>
          <meshStandardMaterial color="#141a2e" emissive="#3fc4ff" emissiveIntensity={0.5} transparent opacity={0.55} roughness={0.2} toneMapped={false} />
        </RoundedBox>
        <mesh position={[0, 0, 0.007]}><planeGeometry args={[0.28, 0.224]} /><meshBasicMaterial ref={board} color="#ffffff" transparent toneMapped={false} /></mesh>
      </group>
    </group>
  );
}

const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));

/**
 * The stand-in until the real model comes: the crew bots' white shell and black visor with glowing eyes, under Brook's afro and
 * top hat, in a black suit, his violin under the arm. Only primitives, and only for now.
 */
function StandIn({ eyes, motion, reduceMotion }: { eyes: CrewEyes; motion: CrewMotion; reduceMotion: boolean }) {
  const body = useRef<THREE.Group>(null);
  const eyeMat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const m = reduceMotion ? 0 : 1;
    const step = Math.min(dt, 0.1);
    let rx = 0, ry = 0, rz = 0, sy = 1;
    if (motion === 'sway') { rz = Math.sin(t * 1.3) * 0.035 * m; sy = 1 + Math.sin(t * 1.1) * 0.01 * m; }
    else if (motion === 'look') { ry = Math.sin(t * 0.9) * 0.5 * m; }
    else { rx = 0.08; sy = 1 + Math.sin(t * 1.2) * 0.006 * m; }
    const g = body.current;
    if (g) {
      const k = reduceMotion ? 1000 : 10;
      g.rotation.x = damp(g.rotation.x, rx, k, step); g.rotation.y = damp(g.rotation.y, ry, k, step); g.rotation.z = damp(g.rotation.z, rz, k, step);
      g.scale.y = sy;
    }
    if (eyeMat.current) {
      eyeMat.current.emissive.set(eyes.color);
      eyeMat.current.emissiveIntensity = eyes.intensity * 1.6 * (eyes.pulse ? 0.75 + 0.25 * Math.sin(t * 6) * m : 1);
    }
  });
  const suit = '#1c1c24', shell = '#f4efe6', visor = '#0b0f16', afro = '#141018';
  const h = HEIGHT / 0.95;
  return (
    <group ref={body} scale={h}>
      {/* legs and shoes */}
      {[-0.06, 0.06].map((x) => (
        <group key={x}>
          <mesh position={[x, 0.2, 0]} castShadow><cylinderGeometry args={[0.035, 0.03, 0.38, 12]} /><meshStandardMaterial color={suit} roughness={0.7} /></mesh>
          <mesh position={[x, 0.02, 0.03]} castShadow><boxGeometry args={[0.07, 0.04, 0.13]} /><meshStandardMaterial color="#2a1a12" roughness={0.4} /></mesh>
        </group>
      ))}
      {/* coat, with a high collar */}
      <mesh position={[0, 0.52, 0]} castShadow><cylinderGeometry args={[0.1, 0.13, 0.32, 18]} /><meshStandardMaterial color={suit} roughness={0.7} /></mesh>
      <mesh position={[0, 0.55, 0.075]}><boxGeometry args={[0.05, 0.2, 0.06]} /><meshStandardMaterial color="#e8e1d2" roughness={0.8} /></mesh>
      <mesh position={[0, 0.63, 0.1]}><boxGeometry args={[0.07, 0.03, 0.03]} /><meshStandardMaterial color="#9b1d2a" roughness={0.6} /></mesh>
      {/* arms, the left one holding the violin */}
      <mesh position={[-0.14, 0.5, 0]} rotation={[0, 0, 0.12]} castShadow><cylinderGeometry args={[0.025, 0.022, 0.3, 10]} /><meshStandardMaterial color={suit} roughness={0.7} /></mesh>
      <mesh position={[0.14, 0.52, 0.04]} rotation={[-0.6, 0, -0.3]} castShadow><cylinderGeometry args={[0.025, 0.022, 0.28, 10]} /><meshStandardMaterial color={suit} roughness={0.7} /></mesh>
      <group position={[0.17, 0.5, 0.11]} rotation={[0.3, 0.3, -0.5]}>
        <mesh castShadow scale={[1, 1.5, 0.35]}><sphereGeometry args={[0.045, 16, 12]} /><meshStandardMaterial color="#a0522d" roughness={0.35} /></mesh>
        <mesh position={[0, 0.1, 0]}><boxGeometry args={[0.012, 0.1, 0.012]} /><meshStandardMaterial color="#2a1a12" /></mesh>
      </group>
      {/* head: the crew's white shell and black visor */}
      <mesh position={[0, 0.76, 0]} castShadow scale={[1, 0.95, 0.95]}><sphereGeometry args={[0.1, 24, 18]} /><meshStandardMaterial color={shell} roughness={0.45} /></mesh>
      <RoundedBox args={[0.15, 0.06, 0.04]} radius={0.025} smoothness={3} position={[0, 0.765, 0.08]}>
        <meshStandardMaterial color={visor} roughness={0.25} metalness={0.2} />
      </RoundedBox>
      {[-0.035, 0.035].map((x) => (
        <mesh key={x} position={[x, 0.768, 0.101]}><circleGeometry args={[0.014, 16]} /><meshStandardMaterial ref={x < 0 ? eyeMat : undefined} color="#000" emissive={eyes.color} emissiveIntensity={eyes.intensity} toneMapped={false} /></mesh>
      ))}
      {/* the afro and the top hat */}
      <mesh position={[0, 0.84, -0.02]} castShadow scale={[1.25, 0.95, 1.15]}><sphereGeometry args={[0.12, 20, 16]} /><meshStandardMaterial color={afro} roughness={0.95} /></mesh>
      <mesh position={[0, 0.93, -0.01]} castShadow><cylinderGeometry args={[0.13, 0.13, 0.012, 24]} /><meshStandardMaterial color="#111" roughness={0.5} /></mesh>
      <mesh position={[0, 1.0, -0.01]} castShadow><cylinderGeometry args={[0.075, 0.08, 0.13, 24]} /><meshStandardMaterial color="#111" roughness={0.5} /></mesh>
      <mesh position={[0, 0.95, -0.01]}><cylinderGeometry args={[0.081, 0.081, 0.025, 24]} /><meshStandardMaterial color="#6b2333" roughness={0.6} /></mesh>
    </group>
  );
}

/** Brook Bot, the crew's musician, looks after the stream deck: click him to set up the buttons on your PC. */
export function BrookBot({ reduceMotion }: { reduceMotion: boolean }) {
  const overview = useDeck((s) => s.overview);
  const mood = deckMood(overview);
  useBotFrames(reduceMotion, mood === 'outdated', 120);
  return (
    <Interactive
      id="deck" label="Brook Bot" hint="Stream deck · buttons for your PC" reduceMotion={reduceMotion}
      box={{ size: [0.8, 1.15, 0.6], center: [X, 0.57, Z] }} pin={[X, 1.3, Z]}
      hit={{ size: [0.85, 1.2, 0.65], center: [X, 0.6, Z] }}
    >
      <group position={[X, 0, Z]} rotation={[0, 0.6, 0]}>
        {HAS_MODEL ? (
          <Suspense fallback={null}>
            <CrewFigure url={crewModel('brook-bot')} eyesUrl={crewEyes('brook-bot')} eyes={EYES[mood]} height={HEIGHT} motion={MOTION[mood]} reduceMotion={reduceMotion} zs={mood === 'unplugged'} />
          </Suspense>
        ) : (
          <StandIn eyes={EYES[mood]} motion={MOTION[mood]} reduceMotion={reduceMotion} />
        )}
        <group position={[0.38, 0, -0.02]}>
          <DeckHologram buttons={overview?.buttons ?? []} columns={overview?.columns ?? 4} mood={mood} reduceMotion={reduceMotion} />
        </group>
      </group>
    </Interactive>
  );
}
