// Browser audio: microphone input + a tiny synth for previews and the metronome.
// All processing happens on the device. No audio is recorded or sent anywhere.

import { NoteTracker } from './pitch.js';
import { midiToFreq } from './theory.js';

let ctx = null;
let analyser = null;
let stream = null;
let buf = null;
export let tracker = new NoteTracker();
const listeners = new Set();
let rafId = null;

export function audioContext() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function micActive() {
  return !!stream;
}

export async function startMic(settings) {
  audioContext();
  if (stream) {
    applySettings(settings);
    return;
  }
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      // Voice-call processing would treat a steady tone as noise and remove it.
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  const src = ctx.createMediaStreamSource(stream);
  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0;
  src.connect(analyser);
  buf = new Float32Array(analyser.fftSize);
  applySettings(settings);
  loop();
}

export function applySettings(s) {
  if (!s) return;
  tracker.tuningCents = s.tuningCents || 0;
  tracker.sensitivity = s.sensitivity || 1;
}

export function stopMic() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  analyser = null;
}

// Game time in seconds, on the audio clock (same clock the synth uses).
export function now() {
  return ctx ? ctx.currentTime : performance.now() / 1000;
}

function loop() {
  rafId = requestAnimationFrame(loop);
  if (!analyser) return;
  analyser.getFloatTimeDomainData(buf);
  // The analysis window ends "now", so its centre is half a window ago.
  const t = now() - analyser.fftSize / ctx.sampleRate / 2;
  const events = tracker.push(t, buf, ctx.sampleRate);
  for (const fn of listeners) fn(events, tracker.current);
}

// Subscribe to note events. Returns an unsubscribe function.
export function onNotes(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------------------------------------------------------------------------
// Synth (an original soft "breathy flute" tone made from plain oscillators).
// ---------------------------------------------------------------------------
let master = null;
function out() {
  audioContext();
  if (!master) {
    master = ctx.createGain();
    master.gain.value = 0.25;
    master.connect(ctx.destination);
  }
  return master;
}

export function playTone(midi, when, dur, vol = 1) {
  const c = audioContext();
  const t0 = Math.max(when, c.currentTime);
  const f = midiToFreq(midi);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.9 * vol, t0 + 0.03);
  g.gain.setTargetAtTime(0.6 * vol, t0 + 0.05, 0.1);
  g.gain.setTargetAtTime(0, t0 + Math.max(0.05, dur - 0.04), 0.04);
  const o1 = c.createOscillator();
  o1.type = 'sine';
  o1.frequency.value = f;
  const o2 = c.createOscillator();
  o2.type = 'triangle';
  o2.frequency.value = f * 2;
  const g2 = c.createGain();
  g2.gain.value = 0.12;
  // Gentle vibrato.
  const lfo = c.createOscillator();
  lfo.frequency.value = 5.2;
  const lfoG = c.createGain();
  lfoG.gain.value = f * 0.004;
  lfo.connect(lfoG);
  lfoG.connect(o1.frequency);
  o1.connect(g);
  o2.connect(g2).connect(g);
  g.connect(out());
  const stopAt = t0 + dur + 0.3;
  [o1, o2, lfo].forEach((o) => { o.start(t0); o.stop(stopAt); });
}

export function click(when, accent = false) {
  const c = audioContext();
  const t0 = Math.max(when, c.currentTime);
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'square';
  o.frequency.value = accent ? 1800 : 1200;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.3, t0 + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
  o.connect(g).connect(out());
  o.start(t0);
  o.stop(t0 + 0.06);
}

// Schedule a whole melody. Returns a stop() function.
export function playMelody(notes, bpm, { speed = 1, startAt = null, onEnd } = {}) {
  const c = audioContext();
  const spb = 60 / bpm / speed;
  const t0 = startAt ?? c.currentTime + 0.15;
  const nodesStopped = { v: false };
  const timers = [];
  // Schedule in small batches so stop() is responsive.
  let i = 0;
  const sorted = [...notes].sort((a, b) => a.t - b.t);
  function pump() {
    if (nodesStopped.v) return;
    const horizon = c.currentTime + 0.6;
    while (i < sorted.length && t0 + sorted[i].t * spb < horizon) {
      const n = sorted[i++];
      playTone(n.midi, t0 + n.t * spb, n.d * spb * 0.95);
    }
    if (i < sorted.length) timers.push(setTimeout(pump, 200));
    else {
      const last = sorted[sorted.length - 1];
      const endIn = last ? (t0 + (last.t + last.d) * spb - c.currentTime) * 1000 : 0;
      timers.push(setTimeout(() => onEnd && onEnd(), Math.max(0, endIn) + 300));
    }
  }
  pump();
  return {
    t0,
    spb,
    stop() {
      nodesStopped.v = true;
      timers.forEach(clearTimeout);
    },
  };
}
