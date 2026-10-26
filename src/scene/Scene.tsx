import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Bloom, BrightnessContrast, EffectComposer, HueSaturation, Vignette } from '@react-three/postprocessing';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useStore } from '../state/store';
import { useNight } from '../state/hooks';
import type { SceneObjectId } from '../domain/types';
import { resolveQuality } from './quality';
import { Lighting, RoomShell } from './Room';
import { Bookshelf, Desk, Notebook, Plants, WallCalendar } from './objects';
import { Decor } from './decor';
import { TreasureChestSpot } from './onepiece';
import { CardShowcase, SHOWCASE_SPOT } from './showcase';

const DEFAULT_POS: [number, number, number] = [11.8, 10.8, 11.9]; // isometric-style diagonal view
const DEFAULT_TARGET: [number, number, number] = [0.2, 0.8, 0.3];
const ISO_DIR = new THREE.Vector3(0.6, 0.52, 0.6).normalize();

/** Close-up framing per object (same isometric direction, nearer and re-centred). */
const FOCUS: Record<SceneObjectId, { target: [number, number, number]; dist: number }> = {
  desk: { target: [-0.3, 1.0, -2.0], dist: 11.5 },
  bookshelf: { target: [-2.9, 1.4, -3.2], dist: 11.5 },
  plants: { target: [2.4, 1.0, -3.0], dist: 11 },
  calendar: { target: [2.4, 2.1, -3.4], dist: 11.5 },
  notebook: { target: [0.55, 0.9, -1.8], dist: 8.5 },
  // never focused: the chest opens the Treasury dialog instead of a panel
  chest: { target: [0.95, 0.3, 2.35], dist: 8.5 },
};

/** Reading view for the wall poster: as close and as square-on as the orbit limits allow. */
const POSTER_VIEW = { target: [-3.97, 2.2, 1.35] as [number, number, number], offset: [5.0, 1.0, 1.1] as [number, number, number] };
/** The framed card on the back wall, nearly face-on and close enough to read (the orbit limits allow 2 m in close-ups). */
const SHOWCASE_VIEW = { target: SHOWCASE_SPOT, offset: [0.5, 0.57, 2.49] as [number, number, number] };
const LOOK_VIEWS = { poster: POSTER_VIEW, showcase: SHOWCASE_VIEW };

interface Goal { pos: THREE.Vector3; target: THREE.Vector3 }

function CameraRig({ selected, lookAt, reduceMotion }: { selected: SceneObjectId | null; lookAt: 'poster' | 'showcase' | null; reduceMotion: boolean }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, size, invalidate } = useThree();
  const resetKey = useStore((s) => s.cameraResetKey);
  const offset = useRef(0);
  const offsetY = useRef(0);
  const goal = useRef<Goal | null>(null);
  const home = useRef<Goal | null>(null); // where to return after a close-up
  const first = useRef(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  const baseView = (): Goal => {
    const saved = useStore.getState().data.prefs.scene.camera;
    return {
      pos: new THREE.Vector3(...(saved?.position ?? DEFAULT_POS)),
      target: new THREE.Vector3(...(saved?.target ?? DEFAULT_TARGET)),
    };
  };

  // Mount / "Reset view": glide to the composed view. First visit gets a gentle intro sweep.
  useEffect(() => {
    const base = baseView();
    const hasSaved = !!useStore.getState().data.prefs.scene.camera;
    if (first.current) {
      first.current = false;
      if (!hasSaved && !reduceMotion) {
        camera.position.copy(base.target).add(base.pos.clone().sub(base.target).multiplyScalar(1.4)).add(new THREE.Vector3(0, 3, 0));
        controls.current?.target.copy(base.target);
      } else {
        camera.position.copy(base.pos);
        controls.current?.target.copy(base.target);
        controls.current?.update();
        invalidate();
        return;
      }
    }
    home.current = null;
    goal.current = base;
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // Select an object → frame it; deselect → return to where the user was.
  useEffect(() => {
    if (first.current) return;
    const c = controls.current;
    if (!c) return;
    if (selected || lookAt) {
      if (!home.current) home.current = { pos: camera.position.clone(), target: c.target.clone() };
      const view = lookAt ? LOOK_VIEWS[lookAt] : POSTER_VIEW;
      const target = new THREE.Vector3(...(selected ? FOCUS[selected].target : view.target));
      goal.current = { target, pos: selected ? target.clone().addScaledVector(ISO_DIR, FOCUS[selected].dist) : target.clone().add(new THREE.Vector3(...view.offset)) };
    } else if (home.current) {
      goal.current = home.current;
      home.current = null;
    }
    invalidate();
  }, [selected, lookAt, camera, invalidate]);

  // Keep the whole room in frame on narrow screens.
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const aspect = size.width / size.height;
    cam.fov = Math.min(64, 25 * Math.max(1, 1.45 / aspect));
    cam.updateProjectionMatrix();
    invalidate();
  }, [size, camera, invalidate]);

  useFrame((_, dt) => {
    const cam = camera as THREE.PerspectiveCamera;
    // smooth glide toward the current goal
    const g = goal.current;
    const c = controls.current;
    if (g && c) {
      const k = reduceMotion ? 1 : 1 - Math.exp(-dt * 3.2);
      camera.position.lerp(g.pos, k);
      c.target.lerp(g.target, k);
      c.update();
      if (camera.position.distanceTo(g.pos) < 0.02 && c.target.distanceTo(g.target) < 0.02) goal.current = null;
      invalidate();
    }
    // make room for the open panel: slide the room aside on desktop, lift it above the bottom sheet on phones
    const wide = size.width >= 900;
    const want = selected && wide ? 250 : 0;
    const wantY = selected && !wide ? size.height * 0.19 : 0;
    const diff = want - offset.current;
    const diffY = wantY - offsetY.current;
    if (Math.abs(diff) > 0.3) {
      offset.current += diff * Math.min(1, dt * 6);
      invalidate();
    } else offset.current = want;
    if (Math.abs(diffY) > 0.3) {
      offsetY.current += diffY * Math.min(1, dt * 6);
      invalidate();
    } else offsetY.current = wantY;
    if (offset.current === 0 && offsetY.current === 0) { if (cam.view) cam.clearViewOffset(); return; }
    cam.setViewOffset(size.width, size.height, offset.current, offsetY.current, size.width, size.height);
  });

  return (
    <OrbitControls
      ref={controls as never}
      enablePan={false} enableDamping dampingFactor={0.08} rotateSpeed={0.45} zoomSpeed={0.6}
      minDistance={lookAt ? 2 : 5} maxDistance={26}
      minPolarAngle={0.75} maxPolarAngle={1.5}
      minAzimuthAngle={0.2} maxAzimuthAngle={1.35}
      onStart={() => { goal.current = null; useStore.getState().hover(null); }}
      onEnd={() => {
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          const c = controls.current;
          // only remember free-roaming views, never a close-up on an object
          if (!c || useStore.getState().selected || useStore.getState().lookAt) return;
          // a view that is (nearly) the composed default is not a user preference — keep it unsaved so
          // future changes to the default framing still apply
          const nearDefault = camera.position.distanceTo(new THREE.Vector3(...DEFAULT_POS)) < 0.6 && c.target.distanceTo(new THREE.Vector3(...DEFAULT_TARGET)) < 0.4;
          useStore.getState().updatePrefs((p) => ({
            ...p,
            scene: { ...p.scene, camera: nearDefault ? null : { position: camera.position.toArray() as [number, number, number], target: c.target.toArray() as [number, number, number] } },
          }));
        }, 600);
      }}
    />
  );
}

export default function Scene({ onContextLost }: { onContextLost?: () => void }) {
  const scene = useStore((s) => s.data.prefs.scene);
  const selected = useStore((s) => s.selected);
  const select = useStore((s) => s.select);
  const lookAt = useStore((s) => s.lookAt);
  const q = resolveQuality(scene.quality);
  const evening = useNight();

  return (
    <Canvas
      shadows={q !== 'low'}
      dpr={q === 'high' ? [1, 2] : 1}
      frameloop={scene.reduceMotion ? 'demand' : 'always'}
      camera={{ position: DEFAULT_POS, fov: 25, near: 2, far: 50 }}
      gl={{ antialias: q !== 'low', alpha: true, powerPreference: 'high-performance' }}
      onPointerMissed={() => { select(null); useStore.getState().setLookAt(null); }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener('pointerleave', () => useStore.getState().hover(null));
        gl.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); onContextLost?.(); });
      }}
    >
      <Lighting evening={evening} shadows={q !== 'low'} shadowSize={q === 'high' ? 2048 : 1024} />
      <CameraRig selected={selected} lookAt={lookAt} reduceMotion={scene.reduceMotion} />
      <RoomShell evening={evening} />
      <Decor evening={evening} reduceMotion={scene.reduceMotion} rain={scene.weather === 'rain'} />
      <Desk reduceMotion={scene.reduceMotion} evening={evening} />
      <Notebook reduceMotion={scene.reduceMotion} />
      <Bookshelf reduceMotion={scene.reduceMotion} />
      <Plants reduceMotion={scene.reduceMotion} />
      <WallCalendar reduceMotion={scene.reduceMotion} />
      <TreasureChestSpot evening={evening} reduceMotion={scene.reduceMotion} />
      <CardShowcase reduceMotion={scene.reduceMotion} />
      {q !== 'low' && (
        <EffectComposer multisampling={0}>
          <Bloom intensity={evening ? 0.8 : 0.25} luminanceThreshold={0.92} luminanceSmoothing={0.25} mipmapBlur />
          <HueSaturation saturation={evening ? 0.08 : 0} />
          <BrightnessContrast contrast={evening ? 0.08 : 0.02} />
          <Vignette eskil={false} offset={0.25} darkness={evening ? 0.7 : 0.35} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
