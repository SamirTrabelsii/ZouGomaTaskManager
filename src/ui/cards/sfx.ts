import { useCallback } from 'react';
import { useStore } from '../../state/store';

/*
 * Pack-opening sound effects, synthesized with the Web Audio API: no audio files to download or license.
 * The audio context starts on the first sound, which always follows a tap or a key press, so browsers allow it.
 */

export type Sfx = 'tear' | 'slide' | 'flip' | 'deal' | 'charge' | 'super' | 'secret' | 'chase' | 'new' | 'fly' | 'fill';

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    try { ctx = new Ctor(); } catch { return null; }
    out = ctx.createGain();
    out.gain.value = 0.32;
    out.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function noise(a: AudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === a.sampleRate) return noiseBuf;
  noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

/** A burst of filtered noise: paper, swishes, clicks. `sweep` moves the filter's frequency over the sound. */
function hiss(a: AudioContext, at: number, dur: number, { type = 'bandpass', freq = 1500, sweep, q = 1, gain = 0.6 }:
  { type?: BiquadFilterType; freq?: number; sweep?: number; q?: number; gain?: number }) {
  const src = a.createBufferSource();
  src.buffer = noise(a);
  const f = a.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, at);
  if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, at + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + Math.min(0.02, dur / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(g).connect(out!);
  src.start(at, Math.random() * 0.5, dur + 0.05);
}

/** One note with a quick attack and a soft tail; `glide` bends it to another pitch. */
function note(a: AudioContext, at: number, freq: number, dur: number, { type = 'triangle', gain = 0.35, glide }:
  { type?: OscillatorType; gain?: number; glide?: number } = {}) {
  const o = a.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (glide) o.frequency.exponentialRampToValueAtTime(glide, at + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(out!);
  o.start(at);
  o.stop(at + dur + 0.05);
}

const N = { C5: 523.25, E5: 659.25, G5: 783.99, B5: 987.77, C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98 };

export function playSfx(s: Sfx) {
  const a = audio();
  if (!a || !out) return;
  const t = a.currentTime + 0.01;
  switch (s) {
    case 'tear':
      // a few ragged rips, then the strip coming free
      for (let i = 0; i < 5; i++) hiss(a, t + i * 0.06, 0.09, { freq: 2600 - i * 300, q: 0.8, gain: 0.5 });
      hiss(a, t + 0.3, 0.35, { freq: 1800, sweep: 500, q: 0.7, gain: 0.45 });
      break;
    case 'slide': hiss(a, t, 0.2, { type: 'highpass', freq: 2200, sweep: 5000, gain: 0.35 }); break;
    case 'flip': hiss(a, t, 0.05, { freq: 3000, q: 2, gain: 0.4 }); note(a, t, 150, 0.09, { type: 'sine', gain: 0.4, glide: 90 }); break;
    case 'deal': hiss(a, t, 0.035, { freq: 3500, q: 3, gain: 0.18 }); break;
    case 'charge': note(a, t, 110, 1.0, { type: 'sawtooth', gain: 0.06, glide: 440 }); hiss(a, t, 1.0, { freq: 300, sweep: 2400, q: 4, gain: 0.12 }); break;
    case 'super': note(a, t, N.E5, 0.35); note(a, t + 0.09, N.B5, 0.5); break;
    case 'secret': [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => note(a, t + i * 0.08, f, 0.6, { gain: 0.3 })); note(a, t + 0.32, N.G6, 0.9, { type: 'sine', gain: 0.12 }); break;
    case 'chase':
      [N.C5, N.E5, N.G5, N.C6, N.E6].forEach((f, i) => note(a, t + i * 0.07, f, 0.7, { gain: 0.28 }));
      // a shower of high sparkles
      for (let i = 0; i < 10; i++) note(a, t + 0.35 + i * 0.05, 2000 + Math.random() * 2500, 0.18, { type: 'sine', gain: 0.07 });
      note(a, t, 65, 1.2, { type: 'sine', gain: 0.3, glide: 55 });
      break;
    case 'new': note(a, t, N.C6, 0.12, { type: 'square', gain: 0.07 }); note(a, t + 0.07, N.G6, 0.18, { type: 'square', gain: 0.07 }); break;
    case 'fly': hiss(a, t, 0.3, { freq: 600, sweep: 4000, q: 1.5, gain: 0.2 }); break;
    case 'fill': note(a, t, N.G5, 0.3, { gain: 0.2 }); note(a, t + 0.1, N.D6, 0.45, { gain: 0.2 }); break;
  }
}

/** Plays a sound unless sounds are off or reduce motion is on (Settings). */
export function useSfx() {
  const on = useStore((s) => s.data.prefs.scene.sound && !s.data.prefs.scene.reduceMotion);
  return useCallback((s: Sfx) => { if (on) playSfx(s); }, [on]);
}
