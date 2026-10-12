import type { Quality } from '../domain/types';

export type ResolvedQuality = Exclude<Quality, 'auto'>;

/** What Auto looks at. Every field is optional because browsers hide or lack some of them. */
export interface QualitySignals {
  width: number;
  cores?: number;
  /** navigator.deviceMemory in GB (Chromium only, capped at 8). */
  memoryGB?: number;
  /** Unmasked WebGL renderer string, when the browser exposes it. */
  gpu?: string;
}

const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;
const WEAK_GPU = /intel.*\b(hd|uhd|gma)\b|mali-?[gt]?\d|adreno.*\b[1-5]\d\d\b|powervr|videocore|vivante/i;

/**
 * Auto quality. `high` is kept for capable machines, so their look does not change; anything that
 * looks weak steps down one tier (software rendering, small screens or ≤2 cores step down to `low`).
 */
export function pickAutoQuality({ width, cores = 4, memoryGB, gpu = '' }: QualitySignals): ResolvedQuality {
  if (width < 800 || cores <= 2 || SOFTWARE_GPU.test(gpu) || (memoryGB !== undefined && memoryGB <= 2)) return 'low';
  if (WEAK_GPU.test(gpu) || cores <= 4 || (memoryGB !== undefined && memoryGB <= 4)) return 'balanced';
  return 'high';
}

let gpuName: string | undefined;
/** Reads the WebGL renderer name once, on a throw-away context that is released straight away. */
function readGpu(): string {
  if (gpuName !== undefined) return gpuName;
  gpuName = '';
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && ext) gpuName = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { /* unknown GPU: judged on the other signals */ }
  return gpuName;
}

export function resolveQuality(q: Quality): ResolvedQuality {
  if (q !== 'auto') return q;
  const nav = navigator as Navigator & { deviceMemory?: number };
  return pickAutoQuality({ width: window.innerWidth, cores: navigator.hardwareConcurrency, memoryGB: nav.deviceMemory, gpu: readGpu() });
}
