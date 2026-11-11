import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF, useTexture } from '@react-three/drei';

/**
 * The Straw Hat crew bots (Chopper Bot, Nami Bot) are real 3D models generated from their character sheets (public/models).
 * They are lit by the room like everything else; what the bot is doing shows in how the whole figure moves.
 */

export const crewModel = (name: string) => `${import.meta.env.BASE_URL}models/${name}.glb`;
/** The mask of a model's eyes: white where its texture paints the glowing eyes, on the same UVs (made from the texture itself). */
export const crewEyes = (name: string) => `${import.meta.env.BASE_URL}models/${name}-eyes.png`;

/** The visor glow from the character sheets. */
export const CREW_BLUE = '#3fc4ff';

/** How the eyes shine: their colour, and how bright (1 is just lit, above about 1.5 the room's bloom makes them glow). */
export interface CrewEyes { color: THREE.ColorRepresentation; intensity: number; pulse?: boolean }

/**
 * How a bot moves:
 *  - breathe: standing at ease, breathing;
 *  - sway: rocking gently from side to side;
 *  - busy: quick little bounces, turning left and right as if working;
 *  - look: looking around, waiting for something;
 *  - shake: shaking and hopping, something needs you;
 *  - hop: happy hops;
 *  - rest: leaning a little forward, still;
 *  - slump: asleep, head down, slow breathing.
 */
export type CrewMotion = 'breathe' | 'sway' | 'busy' | 'look' | 'shake' | 'hop' | 'rest' | 'slump';

/**
 * The scene is drawn on demand, so a bot asks for its own frames: often while it is lively, a few a second otherwise, and none
 * at all with reduced motion.
 */
export function useBotFrames(reduceMotion: boolean, lively: boolean, calmMs = 110) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (reduceMotion) return;
    const id = setInterval(invalidate, lively ? 33 : calmMs);
    return () => clearInterval(id);
  }, [reduceMotion, lively, calmMs, invalidate]);
}

/** A small "z" for a sleeping bot to breathe out. */
function makeZTexture() {
  const c = Object.assign(document.createElement('canvas'), { width: 64, height: 64 });
  const g = c.getContext('2d')!;
  g.fillStyle = '#cfe2ff'; g.font = '700 54px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('z', 32, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The model, scaled to `height` metres, centred, its feet on the group's origin and facing +z. Its materials are its own
 * copies (the room's hover glow writes to them), made non-metallic: the generator leaves the metalness unset, which three.js
 * reads as fully metallic and renders far too dark.
 */
function useCrewModel(url: string, height: number) {
  const { scene } = useGLTF(url);
  const model = useMemo(() => {
    const m = scene.clone(true);
    m.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(m);
    const size = box.getSize(new THREE.Vector3());
    const s = height / size.y;
    const centre = box.getCenter(new THREE.Vector3());
    const holder = new THREE.Group();
    m.scale.setScalar(s);
    m.position.set(-centre.x * s, -box.min.y * s, -centre.z * s);
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((mat) => {
        const copy = (mat as THREE.MeshStandardMaterial).clone();
        if (copy.isMeshStandardMaterial) { copy.metalness = 0; copy.roughness = 0.62; copy.envMapIntensity = 0.6; }
        return copy;
      });
      mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
    });
    holder.add(m);
    return holder;
  }, [scene, height]);
  useEffect(() => () => model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((mat) => mat.dispose());
  }), [model]);
  return model;
}

/**
 * Makes the eyes glow: the eye mask becomes the emissive map of the model's own material, so only the eyes painted in its
 * texture give off light (and bloom), at no extra drawing cost. The figure sets their colour and brightness every frame.
 * The room's hover glow also writes the emissive colour, so these materials opt out of it (`skipGlow`); the bot's surroundings
 * (crate, projector) still warm up on hover.
 */
function useGlowingEyes(model: THREE.Object3D, maskUrl: string) {
  const mask = useTexture(maskUrl, (t) => {
    const tex = t as THREE.Texture;
    tex.flipY = false; // glTF textures are not flipped: match the model's UVs
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
  });
  return useMemo(() => {
    const materials: THREE.MeshStandardMaterial[] = [];
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => {
        const mat = m as THREE.MeshStandardMaterial;
        if (!mat.isMeshStandardMaterial) return;
        mat.emissiveMap = mask;
        mat.emissive.set(CREW_BLUE);
        mat.userData.skipGlow = true;
        mat.needsUpdate = true;
        materials.push(mat);
      });
    });
    return materials;
  }, [model, mask]);
}

const damp = THREE.MathUtils.damp;

/** One crew bot standing on the group's origin, moving the way `motion` says, its eyes glowing. Suspends while its model loads. */
export function CrewFigure({ url, eyesUrl, eyes, height, motion, reduceMotion, zs = false }: {
  url: string; eyesUrl: string; eyes: CrewEyes; height: number; motion: CrewMotion; reduceMotion: boolean; zs?: boolean;
}) {
  const model = useCrewModel(url, height);
  const eyeMaterials = useGlowingEyes(model, eyesUrl);
  const body = useRef<THREE.Group>(null);
  const zGroup = useRef<THREE.Group>(null);
  const zMaterials = useRef<(THREE.SpriteMaterial | null)[]>([]);
  const zTexture = useMemo(makeZTexture, []);
  useEffect(() => () => zTexture.dispose(), [zTexture]);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const m = reduceMotion ? 0 : 1;
    const k = reduceMotion ? 1000 : 12;
    const step = Math.min(dt, 0.1);
    let y = 0, rx = 0, ry = 0, rz = 0, sy = 1;
    switch (motion) {
      case 'breathe': sy = 1 + Math.sin(t * 1.6) * 0.012 * m; ry = Math.sin(t * 0.5) * 0.08 * m; break;
      case 'sway': rz = Math.sin(t * 1.3) * 0.035 * m; sy = 1 + Math.sin(t * 1.1) * 0.01 * m; break;
      case 'busy': y = Math.abs(Math.sin(t * 9)) * 0.012 * m; ry = Math.sin(t * 2.4) * 0.15 * m; rx = 0.05; break;
      case 'look': ry = Math.sin(t * 0.9) * 0.5 * m; sy = 1 + Math.sin(t * 1.4) * 0.008 * m; break;
      case 'shake': rz = Math.sin(t * 31) * 0.05 * m; y = Math.abs(Math.sin(t * 13)) * 0.025 * m; break;
      case 'hop': y = Math.abs(Math.sin(t * 4.2)) * 0.05 * m; ry = Math.sin(t * 2.1) * 0.12 * m; break;
      case 'rest': rx = 0.08; sy = 1 + Math.sin(t * 1.2) * 0.006 * m; break;
      case 'slump': rx = 0.22; sy = 1 + Math.sin(t * 1.1) * 0.015 * m; break;
    }
    const pulse = eyes.pulse ? 0.75 + 0.25 * Math.sin(t * 14) * m : 1;
    eyeMaterials.forEach((mat) => { mat.emissive.set(eyes.color); mat.emissiveIntensity = eyes.intensity * 1.6 * pulse; });
    const g = body.current;
    if (g) {
      g.position.y = y;
      g.rotation.x = damp(g.rotation.x, rx, k, step);
      g.rotation.y = damp(g.rotation.y, ry, k, step);
      g.rotation.z = damp(g.rotation.z, rz, motion === 'shake' ? 40 : k, step);
      g.scale.y = sy;
    }
    if (zGroup.current) {
      zGroup.current.visible = zs;
      if (zs) zGroup.current.children.forEach((child, i) => {
        const phase = reduceMotion ? 0.4 + i * 0.25 : (t * 0.45 + i / 3) % 1;
        child.position.set(0.16 + phase * 0.1, height * 0.9 + phase * 0.3, 0.05);
        child.scale.setScalar(0.07 + phase * 0.07);
        const mat = zMaterials.current[i];
        if (mat) mat.opacity = Math.sin(Math.PI * phase) * 0.9;
      });
    }
  });

  return (
    <group>
      <group ref={body}><primitive object={model} /></group>
      <group ref={zGroup} visible={false}>
        {[0, 1, 2].map((i) => (
          <sprite key={i}>
            <spriteMaterial ref={(mm) => { zMaterials.current[i] = mm; }} map={zTexture} transparent depthWrite={false} toneMapped={false} opacity={0} />
          </sprite>
        ))}
      </group>
    </group>
  );
}
