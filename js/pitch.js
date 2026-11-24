// Pitch detection (YIN) and note-onset tracking.
// Pure logic, no browser APIs, so it can be unit-tested in Node.

import { freqToMidi } from './theory.js';

// YIN fundamental-frequency estimator.
// Returns { freq, clarity } or null. clarity is 0..1 (1 = perfectly periodic).
export function yin(buf, sampleRate, minFreq = 140, maxFreq = 2200, threshold = 0.15) {
  const n = buf.length;
  const maxTau = Math.min(Math.floor(sampleRate / minFreq), Math.floor(n / 2));
  const minTau = Math.max(2, Math.floor(sampleRate / maxFreq));
  const half = n - maxTau;
  const d = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < half; i++) {
      const delta = buf[i] - buf[i + tau];
      sum += delta * delta;
    }
    d[tau] = sum;
  }
  // Cumulative mean normalised difference.
  const cmnd = new Float32Array(maxTau + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }
  let tauEst = -1;
  for (let tau = minTau; tau <= maxTau; tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 <= maxTau && cmnd[tau + 1] < cmnd[tau]) tau++;
      tauEst = tau;
      break;
    }
  }
  if (tauEst < 0) {
    // No dip under threshold: take the global minimum but report low clarity.
    let best = minTau;
    for (let tau = minTau; tau <= maxTau; tau++) if (cmnd[tau] < cmnd[best]) best = tau;
    tauEst = best;
    if (cmnd[best] > 0.4) return null;
  }
  // Parabolic interpolation for sub-sample accuracy.
  let better = tauEst;
  if (tauEst > 1 && tauEst < maxTau) {
    const s0 = cmnd[tauEst - 1], s1 = cmnd[tauEst], s2 = cmnd[tauEst + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (denom !== 0) better = tauEst + (s2 - s0) / denom;
  }
  return { freq: sampleRate / better, clarity: Math.max(0, 1 - cmnd[tauEst]) };
}

export function rms(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

// Turns a stream of analysis frames into note events.
//   tracker.push(timeSec, buffer, sampleRate)        -> events   (analyses the buffer itself)
//   tracker.pushFrame(timeSec, {freq, clarity}|null, level) -> events (already analysed, e.g. by the worklet)
// Events: { type: 'on', time, midi, cents } and { type: 'off', time }
// tracker.current -> { midi, cents, level } of what is sounding right now (or null)
// All windows are in seconds, so it behaves the same at 30, 60 or 100 frames per second.
export class NoteTracker {
  constructor(opts = {}) {
    this.tuningCents = opts.tuningCents || 0;
    this.sensitivity = opts.sensitivity ?? 1; // higher = picks up quieter sounds
    this.minClarity = opts.minClarity ?? 0.72;
    this.minStable = opts.minStable ?? 0.03; // seconds a new pitch must hold before it counts
    this.noiseFloor = 0.002;
    this.levels = []; // [{ t, l }] recent levels for re-attack detection
    this.candidate = null; // { midi, count, time }
    this.active = null; // { midi, onTime }
    this.lastHeard = -Infinity;
    this.current = null;
    this.lastRaw = null;
  }

  gate() {
    return Math.max(0.006 / this.sensitivity, this.noiseFloor * 2.5);
  }

  push(time, buf, sampleRate) {
    const level = rms(buf);
    const r = level >= this.gate() ? yin(buf, sampleRate) : null;
    return this.pushFrame(time, r, level);
  }

  pushFrame(time, r, level) {
    const events = [];
    // Slowly track the background noise floor (only when quiet).
    if (level < this.noiseFloor * 3 || this.noiseFloor === 0.002) {
      this.noiseFloor = this.noiseFloor * 0.97 + Math.min(level, 0.05) * 0.03;
    }
    // Quietest level in the last 80 ms (before this frame).
    let minPrev = level;
    for (const x of this.levels) if (time - x.t <= 0.08 && x.l < minPrev) minPrev = x.l;
    const prevLevel = this.levels.length ? this.levels[this.levels.length - 1].l : level;
    this.levels.push({ t: time, l: level });
    while (this.levels.length && time - this.levels[0].t > 0.2) this.levels.shift();

    let detected = null;
    if (r && level >= this.gate() && r.clarity >= this.minClarity) {
      const midiF = freqToMidi(r.freq) - this.tuningCents / 100;
      detected = { midiF, midi: Math.round(midiF), cents: Math.round((midiF - Math.round(midiF)) * 100), level };
    }
    this.lastRaw = detected;

    if (!detected) {
      this.candidate = null;
      if (this.active && time - this.lastHeard >= 0.04) {
        events.push({ type: 'off', time });
        this.active = null;
      }
      if (time - this.lastHeard >= 0.025) this.current = null;
      return events;
    }
    this.lastHeard = time;

    // Re-attack: same pitch, but the sound dipped and is rising again (a repeated button press).
    // Through a TV the gap between two presses is small, so the dip only needs to be ~35%.
    const reattack = this.active && detected.midi === this.active.midi &&
      minPrev < level * 0.65 && level > prevLevel * 1.1 && time - this.active.onTime > 0.1;

    if (this.active && detected.midi === this.active.midi && !reattack) {
      this.candidate = null;
      this.current = { midi: detected.midiF, cents: detected.cents, level };
      return events;
    }

    // New pitch (or re-attack): require it to hold briefly before firing.
    if (this.candidate && this.candidate.midi === detected.midi) {
      this.candidate.count++;
    } else {
      this.candidate = { midi: detected.midi, count: 1, time };
      if (reattack) this.candidate.reattack = true; // re-attacks are already stable in pitch
    }
    if (this.candidate.reattack || (this.candidate.count >= 2 && time - this.candidate.time >= this.minStable - 1e-6)) {
      if (this.active) events.push({ type: 'off', time: this.candidate.time });
      events.push({ type: 'on', time: this.candidate.time, midi: detected.midiF, cents: detected.cents });
      this.active = { midi: detected.midi, onTime: this.candidate.time };
      this.candidate = null;
    }
    this.current = { midi: detected.midiF, cents: detected.cents, level };
    return events;
  }
}
