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
//   tracker.push(timeSec, buffer, sampleRate) -> array of events
// Events: { type: 'on', time, midi, cents } and { type: 'off', time }
// tracker.current -> { midi, cents, level } of what is sounding right now (or null)
export class NoteTracker {
  constructor(opts = {}) {
    this.tuningCents = opts.tuningCents || 0;
    this.sensitivity = opts.sensitivity ?? 1; // higher = picks up quieter sounds
    this.minClarity = opts.minClarity ?? 0.8;
    this.minStable = opts.minStable ?? 0.03; // seconds a new pitch must hold before it counts
    this.noiseFloor = 0.002;
    this.levels = []; // recent rms values for re-attack detection
    this.candidate = null; // { midi, count, time }
    this.active = null; // { midi, onTime }
    this.silentFrames = 0;
    this.current = null;
    this.lastRaw = null;
  }

  gate() {
    return Math.max(0.006 / this.sensitivity, this.noiseFloor * 2.5);
  }

  push(time, buf, sampleRate) {
    const events = [];
    const level = rms(buf);
    // Slowly track the background noise floor (only when quiet).
    if (level < this.noiseFloor * 3 || this.noiseFloor === 0.002) {
      this.noiseFloor = this.noiseFloor * 0.97 + Math.min(level, 0.05) * 0.03;
    }
    const prevLevels = this.levels.slice(-6);
    this.levels.push(level);
    if (this.levels.length > 12) this.levels.shift();

    let detected = null;
    if (level >= this.gate()) {
      const r = yin(buf, sampleRate);
      if (r && r.clarity >= this.minClarity) {
        const midiF = freqToMidi(r.freq) - this.tuningCents / 100;
        detected = { midiF, midi: Math.round(midiF), cents: Math.round((midiF - Math.round(midiF)) * 100), level };
      }
    }
    this.lastRaw = detected;

    if (!detected) {
      this.silentFrames++;
      this.candidate = null;
      if (this.active && this.silentFrames >= 3) {
        events.push({ type: 'off', time });
        this.active = null;
      }
      if (this.silentFrames >= 2) this.current = null;
      return events;
    }
    this.silentFrames = 0;

    // Re-attack: same pitch but the level jumps after a dip (e.g. repeated button press).
    const minPrev = prevLevels.length ? Math.min(...prevLevels) : level;
    const reattack = this.active && detected.midi === this.active.midi &&
      minPrev < level * 0.55 && time - this.active.onTime > 0.09;

    if (this.active && detected.midi === this.active.midi && !reattack) {
      this.candidate = null;
      this.current = { midi: detected.midiF, cents: detected.cents, level };
      return events;
    }

    // New pitch (or re-attack): require a few consistent frames before firing.
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
