import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { RoundedBox, Sparkles } from '@react-three/drei';
import { useStore } from '../state/store';
import { cardImageUrl, RARITY_LABEL, type Card } from '../domain/cards';
import { holoPattern, revealTier, type HoloPattern } from '../domain/reveal';
import { showcaseCard } from '../domain/shop';

/** Where the frame hangs: the back wall, above the desk, between the sheep painting and the calendar. */
export const SHOWCASE_SPOT: [number, number, number] = [0.7, 1.85, -3.47];
const CARD_W = 0.33;
const CARD_H = CARD_W * 88 / 63;

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** While the art loads, or if it can't (local-only mode cannot read optcgapi.com's images into WebGL): a framed name. */
function fallbackTexture(card: Card) {
  return canvasTexture(256, 358, (g) => {
    g.fillStyle = '#1b2350'; g.fillRect(0, 0, 256, 358);
    g.strokeStyle = '#d4a84b'; g.lineWidth = 8; g.strokeRect(10, 10, 236, 338);
    g.fillStyle = '#f6ead3'; g.textAlign = 'center';
    g.font = '600 18px Georgia, serif'; g.fillText(card.number, 128, 140);
    g.font = '700 26px Georgia, serif'; g.fillText(card.name.slice(0, 16), 128, 185);
    g.font = '16px Georgia, serif'; g.fillText(RARITY_LABEL[card.rarity], 128, 220);
  });
}

/** The holo sheen: a soft band of light (gold, rainbow or white) that slides across the card. */
function sheenTexture(pattern: HoloPattern) {
  return canvasTexture(512, 64, (g) => {
    const grad = g.createLinearGradient(0, 0, 512, 0);
    const stops: string[] = pattern === 'rainbow'
      ? ['#ff5f6d', '#ffc371', '#f9f947', '#47f99a', '#47c8f9', '#b347f9']
      : pattern === 'gold' ? ['#fff1b8', '#ffc94d', '#fff1b8'] : ['#ffffff', '#cfe3ff', '#ffffff'];
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    stops.forEach((c, i) => grad.addColorStop(0.3 + (i / Math.max(1, stops.length - 1)) * 0.4, c));
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 512, 64);
  });
}

function plaqueTexture(card: Card, rarity: string) {
  return canvasTexture(512, 96, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 96);
    grad.addColorStop(0, '#f2d48a'); grad.addColorStop(1, '#b8862f');
    g.fillStyle = grad; g.fillRect(0, 0, 512, 96);
    g.fillStyle = '#2a1a08'; g.textAlign = 'center';
    g.font = '700 38px Georgia, serif'; g.fillText(card.name.slice(0, 24), 256, 46);
    g.font = '24px Georgia, serif'; g.fillText(rarity, 256, 80);
  });
}

/**
 * Your best card (or the one you picked in the binder), framed on the back wall with a little light on it.
 * Holo prints catch a moving sheen. Clicking it zooms in; from there you can change the card.
 */
export function CardShowcase({ reduceMotion }: { reduceMotion: boolean }) {
  const card = useStore((s) => showcaseCard(s.data));
  if (!card) return null;
  return <Framed key={card.id} card={card} reduceMotion={reduceMotion} />;
}

function Framed({ card, reduceMotion }: { card: Card; reduceMotion: boolean }) {
  const viaServer = useStore((s) => s.cloud.enabled && !!s.cloud.email);
  const pattern = holoPattern(card);
  const tier = revealTier(card);
  const rarity = `${RARITY_LABEL[card.rarity]}${card.variant !== 'base' && card.variant !== 'reprint' ? ` · ${card.variant === 'superParallel' ? 'Super Parallel' : card.variant[0].toUpperCase() + card.variant.slice(1)}` : ''}`;
  const fallback = useMemo(() => fallbackTexture(card), [card]);
  const [art, setArt] = useState<THREE.Texture | null>(null);
  const sheen = useMemo(() => (pattern === 'none' ? null : sheenTexture(pattern)), [pattern]);
  const plaque = useMemo(() => plaqueTexture(card, rarity), [card, rarity]);
  const sheenMat = useRef<THREE.MeshBasicMaterial>(null);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    let alive = true;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(cardImageUrl(card.img, viaServer), (t) => {
      if (!alive) return t.dispose();
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      setArt(t);
    }, undefined, () => { /* keep the drawn fallback */ });
    return () => { alive = false; };
  }, [card.img, viaServer]);
  useEffect(() => () => { art?.dispose(); }, [art]);
  useEffect(() => () => { fallback.dispose(); sheen?.dispose(); plaque.dispose(); }, [fallback, sheen, plaque]);

  useFrame(({ clock }) => {
    if (!sheen || !sheenMat.current) return;
    // the band drifts across every few seconds, as if the light moved over the card
    const t = reduceMotion ? 0.5 : (clock.elapsedTime * 0.12) % 1;
    sheen.offset.x = 0.6 - t * 1.6;
    sheenMat.current.opacity = (tier === 'chase' ? 0.5 : 0.32) * (hover ? 1.4 : 1);
  });

  const zoom = (e: { stopPropagation(): void }) => { e.stopPropagation(); const st = useStore.getState(); st.setLookAt(st.lookAt === 'showcase' ? null : 'showcase'); };

  return (
    <group position={SHOWCASE_SPOT}>
      <group
        onClick={zoom}
        onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { setHover(false); document.body.style.cursor = ''; }}>
        {/* frame and mat */}
        <RoundedBox args={[CARD_W + 0.11, CARD_H + 0.19, 0.04]} radius={0.012} smoothness={3} position={[0, -0.03, 0]} castShadow>
          <meshStandardMaterial color="#c99a3e" metalness={0.65} roughness={0.32} />
        </RoundedBox>
        <mesh position={[0, -0.03, 0.021]}><planeGeometry args={[CARD_W + 0.07, CARD_H + 0.15]} /><meshStandardMaterial color="#141b3d" roughness={0.9} /></mesh>
        {/* the card */}
        <mesh position={[0, 0.02, 0.024]}>
          <planeGeometry args={[CARD_W, CARD_H]} />
          <meshStandardMaterial map={art ?? fallback} roughness={0.35} metalness={0.05} emissive="#ffffff" emissiveMap={art ?? fallback} emissiveIntensity={hover ? 0.14 : 0.06} />
        </mesh>
        {sheen && (
          <mesh position={[0, 0.02, 0.026]}>
            <planeGeometry args={[CARD_W, CARD_H]} />
            <meshBasicMaterial ref={sheenMat} map={sheen} transparent opacity={0.32} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
          </mesh>
        )}
        {/* glass */}
        <mesh position={[0, -0.03, 0.03]}><planeGeometry args={[CARD_W + 0.07, CARD_H + 0.15]} /><meshPhysicalMaterial transparent opacity={0.08} roughness={0.05} metalness={0} clearcoat={1} /></mesh>
        {/* name plate */}
        <mesh position={[0, -CARD_H / 2 - 0.05, 0.026]}><planeGeometry args={[CARD_W * 0.9, CARD_W * 0.9 * 96 / 512]} /><meshStandardMaterial map={plaque} metalness={0.4} roughness={0.4} /></mesh>
      </group>
      {/* a small picture light above the frame */}
      <mesh position={[0, CARD_H / 2 + 0.12, 0.06]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.015, 0.015, CARD_W * 0.8, 10]} /><meshStandardMaterial color="#c99a3e" metalness={0.7} roughness={0.3} /></mesh>
      <pointLight position={[0, CARD_H / 2 + 0.05, 0.3]} color="#ffd9a0" intensity={hover ? 0.9 : 0.55} distance={1.4} decay={2} />
      {(tier === 'chase' || tier === 'secret') && !reduceMotion && (
        <Sparkles count={10} scale={[CARD_W + 0.1, CARD_H + 0.1, 0.1]} position={[0, 0.02, 0.06]} size={2.2} speed={0.25} color="#ffe39a" />
      )}
    </group>
  );
}
