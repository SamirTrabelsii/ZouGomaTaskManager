import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Sparkles } from '@react-three/drei';
import { useStore } from '../state/store';
import { useToday } from '../state/hooks';
import { balance, chestCoins, economyStart, pendingBounties, posterBounty } from '../domain/economy';
import { Interactive } from './Interactive';

/**
 * Pirate-adventure "goodies": original low-poly homages (straw hat, ship model, wanted posters, flag, log-pose-style
 * compass, treasure chest…). Drawn from simple shapes, not official art. Two are live: the wanted poster's bounty is
 * your lifetime Berries, and the treasure chest is the Treasury's hotspot.
 */

/** Edit this to change the name on the wanted poster on the left wall. The bounty is your lifetime Berries earned. */
export const POSTER = { name: 'SAMIR' };

const WOOD = '#a97b4f';
const WOOD_DARK = '#6e4b30';
const GOLD = '#d4a84b';

export function PirateGoodies({ evening, reduceMotion }: { evening: boolean; reduceMotion: boolean }) {
  return (
    <group>
      <LiveWantedPoster reduceMotion={reduceMotion} />
      <PirateFlag />
      <ShipsWheel />
      <StrawHat />
      <ShipModel />
      <LogPose reduceMotion={reduceMotion} />
      <TreasureMap />
      <FruitBowl />
      <SnailPhone reduceMotion={reduceMotion} />
      <MeatOnBone />
      <AnchorAndRope />
    </group>
  );
}

/* ───────── canvas helpers ───────── */
function useCanvasTexture(draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number, deps: unknown[]) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d')!, w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

export function drawPoster(g: CanvasRenderingContext2D, w: number, h: number, name: string, bounty: string, subtitle: string) {
  // parchment with torn-looking edge
  g.fillStyle = '#e6d3a3';
  g.beginPath();
  g.moveTo(8, 12);
  for (let x = 8; x <= w - 8; x += 18) g.lineTo(x, 6 + ((x * 7) % 9));
  for (let y = 12; y <= h - 12; y += 18) g.lineTo(w - 6 - ((y * 5) % 8), y);
  for (let x = w - 8; x >= 8; x -= 18) g.lineTo(x, h - 6 - ((x * 3) % 9));
  for (let y = h - 12; y >= 12; y -= 18) g.lineTo(6 + ((y * 11) % 8), y);
  g.closePath(); g.fill();
  const grad = g.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w * 0.8);
  grad.addColorStop(0, 'rgba(255,240,200,0)'); grad.addColorStop(1, 'rgba(120,80,30,.35)');
  g.fillStyle = grad; g.fill();
  g.strokeStyle = '#4a3320'; g.lineWidth = 6; g.strokeRect(26, 26, w - 52, h - 52);

  g.fillStyle = '#3a2615'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.font = `900 ${w * 0.19}px Georgia, serif`; g.fillText('WANTED', w / 2, h * 0.17);
  // portrait: generic silhouette wearing a straw-style hat
  const px = w * 0.12, py = h * 0.21, pw = w * 0.76, ph = h * 0.46;
  g.fillStyle = '#c9b178'; g.fillRect(px, py, pw, ph);
  g.strokeStyle = '#4a3320'; g.lineWidth = 5; g.strokeRect(px, py, pw, ph);
  const cx = w / 2, cy = py + ph * 0.58;
  g.fillStyle = '#5a4630'; g.beginPath(); g.ellipse(cx, py + ph + 6, pw * 0.38, ph * 0.3, 0, Math.PI, 0); g.fill(); // shoulders
  g.fillStyle = '#f0cfa0'; g.beginPath(); g.arc(cx, cy, pw * 0.2, 0, Math.PI * 2); g.fill(); // head
  g.fillStyle = '#2a1a10';
  g.beginPath(); g.arc(cx - pw * 0.07, cy - 6, 6, 0, 7); g.arc(cx + pw * 0.07, cy - 6, 6, 0, 7); g.fill(); // eyes
  g.strokeStyle = '#2a1a10'; g.lineWidth = 5; g.beginPath(); g.arc(cx, cy + 8, pw * 0.1, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke(); // grin
  g.fillStyle = '#e5c46a'; g.beginPath(); g.ellipse(cx, cy - pw * 0.15, pw * 0.4, pw * 0.07, 0, 0, 7); g.fill(); // hat brim
  g.beginPath(); g.arc(cx, cy - pw * 0.17, pw * 0.19, Math.PI, 0); g.fill(); // hat dome
  g.fillStyle = '#c0392b'; g.fillRect(cx - pw * 0.19, cy - pw * 0.2, pw * 0.38, pw * 0.045); // band

  g.fillStyle = '#3a2615';
  g.font = `700 ${w * 0.075}px Georgia, serif`; g.fillText('DEAD OR ALIVE', w / 2, h * 0.73);
  let size = w * 0.15; g.font = `900 ${size}px Georgia, serif`;
  while (g.measureText(name).width > w * 0.78 && size > 20) { size -= 2; g.font = `900 ${size}px Georgia, serif`; }
  g.fillText(name, w / 2, h * 0.84);
  g.font = `800 ${w * 0.085}px Georgia, serif`;
  g.fillText(`฿ ${bounty}-`, w / 2, h * 0.93);
  if (subtitle) { g.font = `600 ${w * 0.05}px Georgia, serif`; g.fillText(subtitle, w / 2, h * 0.975); }
}

/* ───────── Wanted posters (left wall) ───────── */
export function WantedPoster({ name, bounty, position, size, subtitle = '', zoomable = false }: {
  name: string; bounty: string; position: [number, number, number]; size: [number, number]; subtitle?: string; zoomable?: boolean;
}) {
  const tex = useCanvasTexture((g, w, h) => drawPoster(g, w, h, name, bounty, subtitle), 512, 720, [name, bounty, subtitle]);
  return (
    <group position={position} rotation={[0, Math.PI / 2, 0.02]}>
      <mesh
        {...(zoomable ? {
          onClick: (e: { stopPropagation(): void }) => { e.stopPropagation(); const st = useStore.getState(); st.setLookAt(st.lookAt ? null : 'poster'); },
          onPointerOver: (e: { stopPropagation(): void }) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; },
          onPointerOut: () => { document.body.style.cursor = ''; },
        } : {})}
      ><planeGeometry args={size} /><meshStandardMaterial map={tex} transparent alphaTest={0.2} roughness={0.95} /></mesh>
      {[[-1, 1], [1, 1]].map(([sx, sy]) => (
        <mesh key={sx} position={[sx * size[0] * 0.44, sy * size[1] * 0.46, 0.008]}><sphereGeometry args={[0.012, 8, 6]} /><meshStandardMaterial color="#c0392b" roughness={0.4} /></mesh>
      ))}
    </group>
  );
}

/* ───────── Pirate flag above the window ───────── */
function PirateFlag() {
  const tex = useCanvasTexture((g, w, h) => {
    g.fillStyle = '#15151c'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#f4efe5'; g.lineWidth = 16; g.lineCap = 'round';
    g.beginPath(); g.moveTo(w * 0.3, h * 0.62); g.lineTo(w * 0.7, h * 0.9); g.moveTo(w * 0.7, h * 0.62); g.lineTo(w * 0.3, h * 0.9); g.stroke(); // bones
    g.fillStyle = '#f4efe5'; g.beginPath(); g.arc(w / 2, h * 0.5, w * 0.17, 0, 7); g.fill(); // skull
    g.fillRect(w / 2 - w * 0.09, h * 0.56, w * 0.18, h * 0.12);
    g.fillStyle = '#15151c';
    g.beginPath(); g.arc(w / 2 - w * 0.07, h * 0.5, w * 0.045, 0, 7); g.arc(w / 2 + w * 0.07, h * 0.5, w * 0.045, 0, 7); g.fill();
    g.fillRect(w / 2 - 6, h * 0.58, 12, h * 0.07);
    g.fillStyle = '#e5c46a'; g.beginPath(); g.ellipse(w / 2, h * 0.33, w * 0.27, h * 0.045, 0, 0, 7); g.fill(); // straw-style hat
    g.beginPath(); g.arc(w / 2, h * 0.32, w * 0.16, Math.PI, 0); g.fill();
    g.fillStyle = '#c0392b'; g.fillRect(w / 2 - w * 0.16, h * 0.285, w * 0.32, h * 0.035);
  }, 512, 340, []);
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(1.1, 0.72, 16, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 6) * 0.025);
    g.computeVertexNormals();
    return g;
  }, []);
  return (
    <group position={[-3.96, 3.12, -0.4]} rotation={[0, Math.PI / 2, 0]}>
      <mesh geometry={geo} castShadow><meshStandardMaterial map={tex} roughness={0.9} side={THREE.DoubleSide} /></mesh>
      <mesh position={[0, 0.37, 0.02]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.012, 0.012, 1.2, 8]} /><meshStandardMaterial color={WOOD_DARK} roughness={0.6} /></mesh>
    </group>
  );
}

/* ───────── Ship's wheel on the left wall ───────── */
function ShipsWheel() {
  return (
    <group position={[-3.93, 2.22, -2.1]} rotation={[0, Math.PI / 2, 0]}>
      <mesh castShadow><torusGeometry args={[0.24, 0.022, 10, 32]} /><meshStandardMaterial color={WOOD} roughness={0.6} /></mesh>
      <mesh castShadow><cylinderGeometry args={[0.05, 0.05, 0.06, 16]} /><meshStandardMaterial color={GOLD} metalness={0.5} roughness={0.4} />
      </mesh>
      {Array.from({ length: 8 }, (_, i) => (
        <group key={i} rotation={[0, 0, (i / 8) * Math.PI * 2]}>
          <mesh position={[0, 0.17, 0]} castShadow><boxGeometry args={[0.025, 0.34, 0.025]} /><meshStandardMaterial color={WOOD_DARK} roughness={0.6} /></mesh>
          <mesh position={[0, 0.31, 0]} castShadow><sphereGeometry args={[0.028, 10, 8]} /><meshStandardMaterial color={WOOD_DARK} roughness={0.6} /></mesh>
        </group>
      ))}
    </group>
  );
}

/* ───────── Straw hat on a peg (back wall, beside the bookshelf) ───────── */
function StrawHat() {
  return (
    <group position={[-1.6, 1.8, -3.44]}>
      <mesh position={[0, 0.2, 0.01]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.012, 0.012, 0.05, 8]} /><meshStandardMaterial color={WOOD_DARK} roughness={0.6} /></mesh>
      <group position={[0, 0, 0.03]} rotation={[Math.PI / 2 - 0.15, 0, 0]}>
        <mesh castShadow><cylinderGeometry args={[0.24, 0.24, 0.012, 32]} /><meshStandardMaterial color="#e5c46a" roughness={0.9} /></mesh>
        <mesh position={[0, 0.06, 0]} castShadow><sphereGeometry args={[0.13, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#ecd27e" roughness={0.9} /></mesh>
        <mesh position={[0, 0.02, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.131, 0.018, 8, 28]} /><meshStandardMaterial color="#c0392b" roughness={0.7} /></mesh>
        {/* woven rings on the brim */}
        {[0.17, 0.2, 0.225].map((r) => <mesh key={r} position={[0, 0.0075, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[r, 0.0025, 6, 40]} /><meshStandardMaterial color="#b89a52" roughness={1} /></mesh>)}
      </group>
    </group>
  );
}

/* ───────── Ship model on top of the bookshelf ───────── */
function ShipModel() {
  const sails = useRef<THREE.Group>(null);
  return (
    <group position={[-2.85, 2.6, -3.2]} scale={0.9}>
      {/* stand */}
      <mesh position={[0, 0.02, 0]} castShadow><boxGeometry args={[0.7, 0.03, 0.22]} /><meshStandardMaterial color={WOOD_DARK} roughness={0.6} /></mesh>
      {/* hull */}
      <mesh position={[0, 0.1, 0]} castShadow><boxGeometry args={[0.52, 0.12, 0.2]} /><meshStandardMaterial color="#b0452f" roughness={0.7} /></mesh>
      <mesh position={[0.28, 0.13, 0]} rotation={[0, 0, -0.35]} castShadow><boxGeometry args={[0.12, 0.1, 0.17]} /><meshStandardMaterial color="#b0452f" roughness={0.7} /></mesh>
      <mesh position={[-0.28, 0.17, 0]} castShadow><boxGeometry args={[0.1, 0.1, 0.19]} /><meshStandardMaterial color="#8a3524" roughness={0.7} /></mesh>
      <mesh position={[0, 0.165, 0]}><boxGeometry args={[0.52, 0.012, 0.21]} /><meshStandardMaterial color={WOOD} roughness={0.6} /></mesh>
      {/* figurehead: a fluffy white head with little horns */}
      <group position={[0.38, 0.16, 0]}>
        <mesh castShadow><sphereGeometry args={[0.045, 12, 10]} /><meshStandardMaterial color="#f4efe5" roughness={0.95} /></mesh>
        <mesh position={[0.03, -0.005, 0]} scale={[0.6, 0.7, 0.7]}><sphereGeometry args={[0.03, 10, 8]} /><meshStandardMaterial color="#e6c9a0" roughness={0.9} /></mesh>
        {[-0.03, 0.03].map((z) => <mesh key={z} position={[0, 0.045, z]} rotation={[0, 0, 0.5]}><coneGeometry args={[0.012, 0.04, 6]} /><meshStandardMaterial color="#d9c9a8" /></mesh>)}
      </group>
      {/* masts + sails */}
      <group ref={sails}>
        {[[-0.02, 0.5], [0.16, 0.38]].map(([x, h], i) => (
          <group key={i} position={[x, 0.17, 0]}>
            <mesh position={[0, h / 2, 0]} castShadow><cylinderGeometry args={[0.008, 0.01, h, 8]} /><meshStandardMaterial color={WOOD_DARK} roughness={0.6} /></mesh>
            <mesh position={[0.012, h * 0.62, 0]} castShadow rotation={[0, 0, 0]}><boxGeometry args={[0.02, h * 0.55, 0.26 - i * 0.05]} /><meshStandardMaterial color="#f4efe5" roughness={0.95} /></mesh>
            <mesh position={[0, h - 0.01, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.006, 0.006, 0.28 - i * 0.06, 6]} /><meshStandardMaterial color={WOOD_DARK} /></mesh>
          </group>
        ))}
        {/* tiny flag */}
        <mesh position={[-0.02, 0.69, 0.04]}><boxGeometry args={[0.006, 0.05, 0.08]} /><meshStandardMaterial color="#15151c" /></mesh>
      </group>
    </group>
  );
}

/* ───────── Compass orb on the book stack ───────── */
function LogPose({ reduceMotion }: { reduceMotion: boolean }) {
  const needle = useRef<THREE.Group>(null);
  useFrame(({ clock }) => { if (needle.current && !reduceMotion) needle.current.rotation.y = 1 + Math.sin(clock.elapsedTime * 0.5) * 0.5; });
  return (
    <group position={[1.15, 0.2, 0.45]}>
      <mesh position={[0, 0.02, 0]} castShadow><cylinderGeometry args={[0.055, 0.065, 0.04, 16]} /><meshStandardMaterial color={GOLD} metalness={0.6} roughness={0.35} /></mesh>
      <mesh position={[0, 0.095, 0]}><sphereGeometry args={[0.06, 20, 16]} /><meshPhysicalMaterial color="#cfe8ff" transparent opacity={0.35} roughness={0.05} /></mesh>
      <group ref={needle} position={[0, 0.095, 0]}>
        <mesh rotation={[0, 0, Math.PI / 2]}><coneGeometry args={[0.008, 0.07, 6]} /><meshStandardMaterial color="#c0392b" emissive="#c0392b" emissiveIntensity={0.4} /></mesh>
        <mesh rotation={[0, 0, -Math.PI / 2]}><coneGeometry args={[0.008, 0.05, 6]} /><meshStandardMaterial color="#f4efe5" /></mesh>
      </group>
      <mesh position={[0, 0.095, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.062, 0.004, 6, 24]} /><meshStandardMaterial color={GOLD} metalness={0.6} roughness={0.35} /></mesh>
    </group>
  );
}

/* ───────── Treasure map on the rug ───────── */
function TreasureMap() {
  const tex = useCanvasTexture((g, w, h) => {
    g.fillStyle = '#d9c28d'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(90,60,30,.5)'; g.lineWidth = 5; g.strokeRect(10, 10, w - 20, h - 20);
    g.fillStyle = '#a9b48a';
    g.beginPath(); g.moveTo(60, 200); g.bezierCurveTo(90, 120, 170, 130, 190, 190); g.bezierCurveTo(200, 250, 90, 260, 60, 200); g.fill();
    g.beginPath(); g.moveTo(300, 80); g.bezierCurveTo(350, 40, 440, 70, 430, 130); g.bezierCurveTo(400, 170, 320, 140, 300, 80); g.fill();
    g.strokeStyle = '#7a3a2a'; g.lineWidth = 5; g.setLineDash([12, 10]);
    g.beginPath(); g.moveTo(120, 190); g.bezierCurveTo(200, 230, 280, 160, 370, 110); g.stroke(); g.setLineDash([]);
    g.strokeStyle = '#b0302a'; g.lineWidth = 9; g.beginPath(); g.moveTo(350, 90); g.lineTo(390, 130); g.moveTo(390, 90); g.lineTo(350, 130); g.stroke();
    g.strokeStyle = '#3a2615'; g.lineWidth = 3; g.beginPath(); g.arc(440, 240, 26, 0, 7); g.moveTo(440, 205); g.lineTo(440, 275); g.moveTo(405, 240); g.lineTo(475, 240); g.stroke();
  }, 512, 340, []);
  return (
    <mesh position={[-1.15, 0.013, -0.25]} rotation={[-Math.PI / 2, 0, 0.35]} receiveShadow>
      <planeGeometry args={[0.55, 0.37]} /><meshStandardMaterial map={tex} roughness={0.95} />
    </mesh>
  );
}

/* ───────── Live wanted poster ───────── */
/** Your poster: the bounty is every Berry you've earned from work. It sparkles when it goes up. */
function LiveWantedPoster({ reduceMotion }: { reduceMotion: boolean }) {
  const bounty = useStore((s) => posterBounty(s.data.ledger));
  const [sparkle, setSparkle] = useState(0);
  const last = useRef(bounty);
  useEffect(() => {
    const up = Number(bounty.replace(/,/g, '')) > Number(last.current.replace(/,/g, ''));
    last.current = bounty;
    if (!up || reduceMotion) return;
    setSparkle((n) => n + 1);
    const t = setTimeout(() => setSparkle(0), 3000);
    return () => clearTimeout(t);
  }, [bounty, reduceMotion]);
  return (
    <>
      <WantedPoster name={POSTER.name} bounty={bounty} position={[-3.97, 2.3, 1.35]} size={[0.75, 1.05]} zoomable />
      {sparkle > 0 && <Sparkles key={sparkle} count={30} scale={[0.2, 1.2, 0.9]} position={[-3.9, 2.3, 1.35]} size={4} speed={0.6} color="#f7e2a8" />}
    </>
  );
}

/* ───────── Treasure chest: the Treasury's hotspot ───────── */
/**
 * Closed until the treasury is opened; then the lid stands open over a pile of gold that grows with your balance.
 * It glows while a finished week's bounty or sealed packs are waiting. Clicking it opens the Treasury.
 */
export function TreasureChestSpot({ evening, reduceMotion }: { evening: boolean; reduceMotion: boolean }) {
  const data = useStore((s) => s.data);
  const today = useToday();
  const started = !!economyStart(data.ledger);
  const coinCount = chestCoins(balance(data.ledger));
  const waiting = started && (data.cards.sealed.length > 0 || pendingBounties(data, today).length > 0);
  const coins = useMemo(() => Array.from({ length: coinCount }, (_, i) => ({
    x: ((i * 37) % 17) / 17 * 0.36 - 0.18,
    z: ((i * 53) % 13) / 13 * 0.2 - 0.1,
    y: 0.27 + Math.floor(i / 8) * 0.012 + (i % 3) * 0.004, // later coins pile higher
    tilt: [((i * 7) % 5) * 0.3, ((i * 3) % 5) * 0.3] as const,
  })), [coinCount]);
  const lid = useRef<THREE.Group>(null);
  const light = useRef<THREE.PointLight>(null);
  useFrame(({ clock, invalidate }, dt) => {
    const target = started ? -1.85 : 0;
    if (lid.current) {
      const r = lid.current.rotation;
      r.x = reduceMotion ? target : r.x + (target - r.x) * Math.min(1, dt * 3);
      if (Math.abs(target - r.x) > 0.001) invalidate();
    }
    if (light.current) light.current.intensity = waiting ? (reduceMotion ? 2 : 1.5 + Math.sin(clock.elapsedTime * 3) * 1.2) : 0;
  });
  return (
    <Interactive
      id="chest" label="Treasure chest" hint="Berries, card shop & binder" reduceMotion={reduceMotion}
      box={{ size: [0.6, 0.5, 0.45], center: [0.95, 0.25, 2.35] }} pin={[0.95, 0.75, 2.35]}
      hit={{ size: [0.7, 0.6, 0.55], center: [0.95, 0.25, 2.35] }}
    >
      <group position={[0.95, 0, 2.35]} rotation={[0, -0.9, 0]}>
        <mesh position={[0, 0.14, 0]} castShadow receiveShadow><boxGeometry args={[0.5, 0.28, 0.32]} /><meshStandardMaterial color={WOOD} roughness={0.75} /></mesh>
        {[-0.17, 0.17].map((x) => <mesh key={x} position={[x, 0.14, 0]}><boxGeometry args={[0.04, 0.29, 0.33]} /><meshStandardMaterial color="#4a4a52" metalness={0.6} roughness={0.4} /></mesh>)}
        <mesh position={[0, 0.27, 0]}><boxGeometry args={[0.46, 0.02, 0.28]} /><meshStandardMaterial color="#3a2615" roughness={1} /></mesh>
        {coins.map((c, i) => (
          <mesh key={i} position={[c.x, c.y, c.z]} rotation={[c.tilt[0], 0, c.tilt[1]]}>
            <cylinderGeometry args={[0.03, 0.03, 0.006, 10]} /><meshStandardMaterial color="#ffd36a" emissive="#ffb340" emissiveIntensity={evening ? 1.6 : 0.5} metalness={0.7} roughness={0.3} toneMapped={false} />
          </mesh>
        ))}
        {/* lid, hinged at the back: closed until the treasury opens */}
        <group ref={lid} position={[0, 0.28, -0.16]} rotation={[started ? -1.85 : 0, 0, 0]}>
          <mesh position={[0, 0, 0.16]} castShadow><boxGeometry args={[0.5, 0.04, 0.32]} /><meshStandardMaterial color={WOOD} roughness={0.75} /></mesh>
          {[-0.17, 0.17].map((x) => <mesh key={x} position={[x, 0.005, 0.16]}><boxGeometry args={[0.04, 0.05, 0.33]} /><meshStandardMaterial color="#4a4a52" metalness={0.6} roughness={0.4} /></mesh>)}
        </group>
        <mesh position={[0, 0.2, 0.165]}><boxGeometry args={[0.07, 0.07, 0.01]} /><meshStandardMaterial color={GOLD} metalness={0.7} roughness={0.3} /></mesh>
        <pointLight ref={light} position={[0, 0.45, 0]} color="#ffc35a" intensity={0} distance={1.6} decay={2} />
        {waiting && !reduceMotion && <Sparkles count={14} scale={[0.5, 0.4, 0.4]} position={[0, 0.42, 0]} size={3} speed={0.4} color="#ffe39a" />}
      </group>
    </Interactive>
  );
}

/* ───────── Swirly fruit bowl on the record cabinet ───────── */
function FruitBowl() {
  const fruit = [{ c: '#b36bd1', x: -0.03, z: 0 }, { c: '#e8a23a', x: 0.04, z: 0.03 }, { c: '#6fbf6a', x: 0.01, z: -0.04 }];
  return (
    <group position={[3.62, 0.44, 0.02]}>
      <mesh position={[0, 0.03, 0]} castShadow><sphereGeometry args={[0.1, 20, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} /><meshStandardMaterial color="#8a5a3a" roughness={0.6} side={THREE.DoubleSide} /></mesh>
      {fruit.map((f, i) => (
        <group key={i} position={[f.x, 0.07 + (i === 2 ? 0.03 : 0), f.z]}>
          <mesh castShadow><sphereGeometry args={[0.048, 14, 12]} /><meshStandardMaterial color={f.c} roughness={0.55} /></mesh>
          {[0.02, -0.01].map((y) => <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2 + i * 0.3, 0, 0]}><torusGeometry args={[0.044 - Math.abs(y), 0.004, 6, 20]} /><meshStandardMaterial color="#f4efe5" roughness={0.5} /></mesh>)}
          <mesh position={[0, 0.05, 0]}><cylinderGeometry args={[0.004, 0.004, 0.02, 6]} /><meshStandardMaterial color="#4a6a3a" /></mesh>
        </group>
      ))}
    </group>
  );
}

/* ───────── Snail phone on the side table ───────── */
function SnailPhone({ reduceMotion }: { reduceMotion: boolean }) {
  const eyes = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!eyes.current || reduceMotion) return;
    const blink = Math.sin(clock.elapsedTime * 0.9) > 0.97 ? 0.1 : 1;
    eyes.current.scale.y = blink;
  });
  return (
    <group position={[3.47, 0.46, 1.5]} rotation={[0, -2.2, 0]}>
      <mesh position={[0, 0.025, 0]} scale={[1.4, 0.7, 1]} castShadow><sphereGeometry args={[0.04, 14, 10]} /><meshStandardMaterial color="#e8c07a" roughness={0.7} /></mesh>
      <group position={[-0.01, 0.075, 0]}>
        <mesh castShadow><sphereGeometry args={[0.042, 14, 12]} /><meshStandardMaterial color="#c58f4a" roughness={0.6} /></mesh>
        <mesh rotation={[0, Math.PI / 2, 0]}><torusGeometry args={[0.03, 0.006, 6, 20]} /><meshStandardMaterial color="#8a5a2a" roughness={0.6} /></mesh>
        <mesh rotation={[0, Math.PI / 2, 0]} scale={0.55}><torusGeometry args={[0.03, 0.006, 6, 20]} /><meshStandardMaterial color="#8a5a2a" roughness={0.6} /></mesh>
      </group>
      <group ref={eyes} position={[0.06, 0.05, 0]}>
        {[-0.014, 0.014].map((z) => (
          <group key={z} position={[0, 0.01, z]}>
            <mesh><sphereGeometry args={[0.012, 10, 8]} /><meshStandardMaterial color="#fff" roughness={0.4} /></mesh>
            <mesh position={[0.009, 0, 0]}><sphereGeometry args={[0.005, 8, 6]} /><meshStandardMaterial color="#111" /></mesh>
          </group>
        ))}
      </group>
      <mesh position={[0.07, 0.02, 0]}><sphereGeometry args={[0.01, 8, 6]} /><meshStandardMaterial color="#c06c46" /></mesh>
    </group>
  );
}

/* ───────── Meat on the bone (desk ornament) ───────── */
function MeatOnBone() {
  return (
    <group position={[-1.22, 0.805, -1.42]} rotation={[0, 0.5, 0]}>
      <mesh position={[0, 0.005, 0]}><cylinderGeometry args={[0.07, 0.07, 0.012, 20]} /><meshStandardMaterial color="#e8dcc4" roughness={0.4} /></mesh>
      <mesh position={[0, 0.045, 0]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.009, 0.009, 0.17, 8]} /><meshStandardMaterial color="#f1e6cd" roughness={0.6} /></mesh>
      {[-0.085, 0.085].map((x) => [-0.01, 0.01].map((z) => <mesh key={`${x}${z}`} position={[x, 0.045, z]}><sphereGeometry args={[0.014, 8, 6]} /><meshStandardMaterial color="#f1e6cd" roughness={0.6} /></mesh>))}
      <mesh position={[0.0, 0.045, 0]} scale={[1.05, 0.8, 0.8]} castShadow><sphereGeometry args={[0.052, 16, 12]} /><meshStandardMaterial color="#a2502e" roughness={0.55} /></mesh>
      <mesh position={[0.015, 0.075, 0.01]} scale={[1, 0.5, 0.8]}><sphereGeometry args={[0.03, 10, 8]} /><meshStandardMaterial color="#c4693c" roughness={0.5} /></mesh>
    </group>
  );
}

/* ───────── Anchor leaning with a coil of rope ───────── */
function AnchorAndRope() {
  return (
    <group position={[1.75, 0, 3.0]} rotation={[0, -0.6, 0]}>
      <group position={[0, 0.34, 0]} rotation={[0, 0, 0.12]}>
        <mesh castShadow><cylinderGeometry args={[0.022, 0.022, 0.6, 10]} /><meshStandardMaterial color="#3b3f4a" metalness={0.7} roughness={0.45} /></mesh>
        <mesh position={[0, 0.34, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.04, 0.01, 8, 16]} /><meshStandardMaterial color="#3b3f4a" metalness={0.7} roughness={0.45} /></mesh>
        <mesh position={[0, 0.22, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.014, 0.014, 0.26, 8]} /><meshStandardMaterial color="#3b3f4a" metalness={0.7} roughness={0.45} /></mesh>
        <mesh position={[0, -0.26, 0]} rotation={[0, 0, Math.PI]} castShadow><torusGeometry args={[0.14, 0.02, 8, 24, Math.PI]} /><meshStandardMaterial color="#3b3f4a" metalness={0.7} roughness={0.45} /></mesh>
        {[-0.14, 0.14].map((x) => <mesh key={x} position={[x, -0.19, 0]} rotation={[0, 0, x > 0 ? -0.9 : 0.9]}><coneGeometry args={[0.03, 0.07, 6]} /><meshStandardMaterial color="#3b3f4a" metalness={0.7} roughness={0.45} /></mesh>)}
      </group>
      <group position={[0.35, 0, 0.15]}>
        {[0.03, 0.065, 0.1].map((y, i) => (
          <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, i]} castShadow><torusGeometry args={[0.13 - i * 0.012, 0.018, 8, 28]} /><meshStandardMaterial color="#c9ad78" roughness={1} /></mesh>
        ))}
      </group>
    </group>
  );
}
