// AudioWorklet: analyses the microphone on the audio thread, 100 times per second.
// Runs separately from screen drawing, so a busy or power-saving phone does not slow listening down.
// Posts { t, f, c, l } per frame: time (s, audio clock, centre of the window), frequency (Hz or 0),
// clarity (0..1) and level (RMS).

function yin(buf, sr, minFreq, maxFreq, threshold) {
  const n = buf.length;
  const maxTau = Math.min(Math.floor(sr / minFreq), Math.floor(n / 2));
  const minTau = Math.max(2, Math.floor(sr / maxFreq));
  const half = n - maxTau;
  const cmnd = new Float32Array(maxTau + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < half; i++) {
      const d = buf[i] - buf[i + tau];
      sum += d * d;
    }
    running += sum;
    cmnd[tau] = running > 0 ? (sum * tau) / running : 1;
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
    let best = minTau;
    for (let tau = minTau; tau <= maxTau; tau++) if (cmnd[tau] < cmnd[best]) best = tau;
    if (cmnd[best] > 0.4) return null;
    tauEst = best;
  }
  let better = tauEst;
  if (tauEst > 1 && tauEst < maxTau) {
    const s0 = cmnd[tauEst - 1], s1 = cmnd[tauEst], s2 = cmnd[tauEst + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (denom !== 0) better = tauEst + (s2 - s0) / denom;
  }
  return { f: sr / better, c: Math.max(0, 1 - cmnd[tauEst]) };
}

class PitchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Halve the rate on 44.1/48 kHz devices: the instrument stays far below the new limit,
    // and it makes the analysis four times cheaper.
    this.ds = sampleRate >= 44100 ? 2 : 1;
    this.sr = sampleRate / this.ds;
    this.N = this.sr >= 22000 ? 1024 : 512;
    this.ring = new Float32Array(this.N);
    this.frame = new Float32Array(this.N);
    this.w = 0;
    this.filled = 0;
    this.hop = Math.round(this.sr / 100);
    this.since = 0;
    this.acc = 0;
    this.accN = 0;
    this.windowSec = (this.N * this.ds) / sampleRate;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i];
      if (++this.accN < this.ds) continue;
      this.ring[this.w] = this.acc / this.ds;
      this.w = (this.w + 1) % this.N;
      this.acc = 0;
      this.accN = 0;
      if (this.filled < this.N) this.filled++;
      if (++this.since >= this.hop && this.filled === this.N) {
        this.since = 0;
        this.analyse(currentTime + (i + 1) / sampleRate);
      }
    }
    return true;
  }

  analyse(endTime) {
    const N = this.N;
    let sq = 0;
    for (let k = 0; k < N; k++) {
      const v = this.ring[(this.w + k) % N];
      this.frame[k] = v;
      sq += v * v;
    }
    const l = Math.sqrt(sq / N);
    let f = 0, c = 0;
    if (l > 0.0015) {
      const r = yin(this.frame, this.sr, 140, 2200, 0.15);
      if (r) { f = r.f; c = r.c; }
    }
    this.port.postMessage({ t: endTime - this.windowSec / 2, f, c, l });
  }
}

registerProcessor('notefall-pitch', PitchProcessor);
