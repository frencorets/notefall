// Gameplay: scrolling note highway, judging and scoring.

import * as audio from './audio.js';
import { labelFor, hintFor, pitchMatches, midiToName, PROFILES } from './theory.js';
import { t, instruction, localNoteName } from './i18n.js';
import { drawNoteBlock, drawMod, modWidth, drawTarget, roundRect } from './icons.js';

const WINDOWS = { perfect: 0.075, great: 0.135, good: 0.2 };
const POINTS = { perfect: 100, great: 70, good: 40 };
const ACC = { perfect: 1, great: 0.8, good: 0.5, miss: 0 };

export class Game {
  constructor(canvas, song, settings, { onEnd } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.song = song;
    this.s = settings;
    this.profile = PROFILES[settings.profile] || PROFILES.pad5;
    this.onEnd = onEnd;
    this.spb = 60 / song.bpm / (settings.speed || 1);
    this.leadIn = Math.max(2.5, song.beatsPerBar * this.spb + 0.8);
    this.notes = song.notes.map((n, i) => ({
      i,
      midi: n.midi,
      time: this.leadIn + n.t * this.spb,
      dur: n.d * this.spb,
      beats: n.d,
      label: labelFor(n.midi, this.profile),
      state: null, // 'perfect' | 'great' | 'good' | 'miss'
      held: 0,
    }));
    this.lastEnd = this.notes.reduce((m, n) => Math.max(m, n.time + n.dur), 0);
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    this.sustainBonus = 0;
    this.popups = [];
    this.particles = [];
    this.flash = new Array(5).fill(0);
    this.running = false;
    this.paused = false;
    this.pausedAccum = 0;
    this.blockedSince = null;
    this.resize();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    this.W = r.width;
    this.H = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.hwW = Math.min(this.W - 6, 560);
    this.hwX = (this.W - this.hwW) / 2;
    this.laneW = this.hwW / 5;
    this.tsize = Math.min(this.laneW * 0.46, 38); // target size
    this.targetGap = this.tsize * 0.95; // hit line to target centre
    this.hitY = this.H - Math.max(190, this.H * 0.25);
  }

  start() {
    this.startAudio = audio.now();
    this.running = true;
    // Count-in clicks on the bar before the first note.
    const firstNote = this.notes.length ? this.notes[0].time : this.leadIn;
    const bar = this.song.beatsPerBar;
    for (let b = bar; b >= 1; b--) {
      const t = firstNote - b * this.spb;
      if (t > 0.1) audio.click(this.startAudio + t, b === bar);
    }
    this.unsub = audio.onNotes((events, current) => this.onAudio(events, current));
    this.frame = this.frame.bind(this);
    this.raf = requestAnimationFrame(this.frame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    if (this.unsub) this.unsub();
    window.removeEventListener('resize', this._onResize);
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.pauseAt = audio.now();
  }
  resume() {
    if (!this.paused) return;
    this.pausedAccum += audio.now() - this.pauseAt;
    this.paused = false;
  }

  // Song time (seconds) for a given audio-clock time.
  songTimeAt(audioTime) {
    let blocked = this.blockedSince != null ? audioTime - this.blockedSince : 0;
    if (this.paused) blocked += audioTime - this.pauseAt;
    return audioTime - this.startAudio - this.pausedAccum - Math.max(0, blocked);
  }

  nextOpenNote() {
    return this.notes.find((n) => !n.state);
  }

  onAudio(events, current) {
    if (!this.running || this.paused) return;
    this.current = current;
    const lat = (this.s.latencyMs || 0) / 1000;
    for (const e of events) {
      if (e.type !== 'on') continue;
      const t = this.songTimeAt(e.time) - lat;
      this.tryHit(e.midi, t, false);
    }
  }

  tryHit(midi, t, fromHold) {
    const anyOct = this.s.anyOctave;
    const waiting = this.s.waitMode && this.blockedSince != null;
    let best = null;
    for (const n of this.notes) {
      if (n.state) continue;
      if (n.time - t > WINDOWS.good && !(waiting && n === this.nextOpenNote())) break;
      const dt = t - n.time;
      const inWindow = Math.abs(dt) <= WINDOWS.good || (waiting && n === this.nextOpenNote());
      if (inWindow && pitchMatches(midi, n.midi, anyOct)) {
        best = { n, dt };
        break;
      }
    }
    if (best) {
      const a = Math.abs(best.dt);
      const rating = fromHold ? 'good' : a <= WINDOWS.perfect ? 'perfect' : a <= WINDOWS.great ? 'great' : 'good';
      this.judge(best.n, rating, best.dt);
      return true;
    }
    // A sounded note that matched nothing: flash the lane red if something was due.
    const due = this.notes.find((n) => !n.state && Math.abs(n.time - t) <= WINDOWS.good);
    if (due && !fromHold) {
      const lane = hintFor(midi, this.profile).lane;
      this.flash[lane] = -1;
    }
    return false;
  }

  judge(n, rating, dt = 0) {
    n.state = rating;
    this.counts[rating]++;
    const lane = n.label.h.lane;
    if (rating === 'miss') {
      this.combo = 0;
      this.popups.push({ text: t('popMiss'), lane, t: performance.now(), color: 'rgba(239,234,219,0.6)' });
      return;
    }
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const mult = 1 + Math.min(3, Math.floor(this.combo / 8));
    this.score += POINTS[rating] * mult;
    const label = t(rating === 'perfect' ? 'popPerfect' : rating === 'great' ? 'popGreat' : 'popGood');
    const timing = rating === 'perfect' || this.s.waitMode ? '' : ' · ' + t(dt < 0 ? 'early' : 'late');
    this.popups.push({ text: label + timing, lane, t: performance.now(), color: rating === 'perfect' ? '#ffffff' : '#efeadb' });
    this.flash[lane] = 1;
    const color = this.profile.lanes[lane].color;
    for (let k = 0; k < 14; k++) {
      const a = Math.random() * Math.PI * 2;
      const v = 60 + Math.random() * 160;
      this.particles.push({ x: this.laneX(lane), y: this.hitY, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, life: 1, color });
    }
    if (this.s.waitMode && this.blockedSince != null) {
      this.pausedAccum += audio.now() - this.blockedSince;
      this.blockedSince = null;
    }
  }

  laneX(i) {
    return this.hwX + this.laneW * (i + 0.5);
  }

  update() {
    const nowA = audio.now();
    const frameDt = this.lastFrameA ? Math.min(0.1, nowA - this.lastFrameA) : 0;
    this.lastFrameA = nowA;
    const lat = (this.s.latencyMs || 0) / 1000;
    let st = this.songTimeAt(nowA);

    // Wait mode: freeze the highway at the next note until it is played.
    if (this.s.waitMode && !this.paused) {
      const next = this.nextOpenNote();
      if (next && this.blockedSince == null && st >= next.time) {
        this.blockedSince = nowA - (st - next.time);
        st = next.time;
      }
    }
    this.songNow = st;
    if (this.paused) return;

    // Lenient mode / wait mode: a held matching pitch counts too.
    if (this.current && (this.s.lenientRepeats || this.blockedSince != null)) {
      this.tryHit(this.current.midi, st - lat, !this.s.waitMode);
    }

    // Sustain: reward holding long notes.
    const judgeT = st - lat;
    for (const n of this.notes) {
      if (n.time > judgeT) break;
      if (n.state && n.state !== 'miss' && n.beats >= 2 && judgeT <= n.time + n.dur) {
        if (this.current && pitchMatches(this.current.midi, n.midi, this.s.anyOctave)) {
          n.held += frameDt;
          n.sustaining = true;
        } else n.sustaining = false;
      } else n.sustaining = false;
    }

    // Misses.
    if (!this.s.waitMode) {
      for (const n of this.notes) {
        if (n.time > judgeT) break;
        if (!n.state && judgeT - n.time > WINDOWS.good) this.judge(n, 'miss');
      }
    }

    // End of song.
    if (!this.ended && this.notes.every((n) => n.state) && st > this.lastEnd + 1.2) {
      this.ended = true;
      this.finish();
    }
  }

  finish() {
    for (const n of this.notes) {
      if (n.beats >= 2 && n.state && n.state !== 'miss') this.sustainBonus += Math.round(50 * Math.min(1, n.held / n.dur));
    }
    this.score += this.sustainBonus;
    const total = this.notes.length || 1;
    const acc = this.notes.reduce((s, n) => s + ACC[n.state || 'miss'], 0) / total;
    const accuracy = Math.round(acc * 1000) / 10;
    const grade = accuracy >= 95 ? 'S' : accuracy >= 85 ? 'A' : accuracy >= 70 ? 'B' : accuracy >= 50 ? 'C' : 'D';
    this.stop();
    this.onEnd && this.onEnd({ score: this.score, accuracy, grade, counts: this.counts, maxCombo: this.maxCombo, sustainBonus: this.sustainBonus, total });
  }

  frame() {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    this.update();
    this.draw();
  }

  // ------------------------------------------------------------------ drawing
  draw() {
    const c = this.ctx;
    const { W, H, hwX, hwW, laneW, hitY } = this;
    const pps = this.s.noteSpeed || 260;
    const st = this.songNow ?? 0;
    c.clearRect(0, 0, W, H);

    // Lanes: transparent, thin light dividers.
    for (let i = 0; i < 5; i++) {
      if (this.flash[i] !== 0) {
        c.fillStyle = this.flash[i] > 0 ? `rgba(239,234,219,${0.16 * this.flash[i]})` : `rgba(255,90,90,${0.12 * -this.flash[i]})`;
        c.fillRect(hwX + i * laneW + 1, 0, laneW - 2, hitY);
        this.flash[i] *= 0.88;
        if (Math.abs(this.flash[i]) < 0.02) this.flash[i] = 0;
      }
    }
    c.fillStyle = 'rgba(239,234,219,0.28)';
    for (let i = 1; i < 5; i++) c.fillRect(Math.round(hwX + i * laneW), 0, 1, hitY);

    // Hit line.
    c.fillStyle = 'rgba(239,234,219,0.55)';
    c.fillRect(hwX, hitY, hwW, 2);

    // Song title, shown large at the start like a title card.
    const first = this.notes[0];
    if (first && st < first.time + 1.5) {
      const a = Math.max(0, Math.min(1, (first.time + 1.5 - st) / 1.5));
      c.globalAlpha = a;
      c.textAlign = 'center';
      c.textBaseline = 'alphabetic';
      c.fillStyle = '#efeadb';
      let fs = Math.min(44, W * 0.11);
      c.font = `700 ${fs}px Georgia, "Times New Roman", serif`;
      while (c.measureText(this.song.title).width > W - 32 && fs > 18) c.font = `700 ${--fs}px Georgia, "Times New Roman", serif`;
      c.fillText(this.song.title, W / 2, 110);
      if (this.song.composer) {
        c.font = `600 ${Math.round(fs * 0.42)}px Georgia, "Times New Roman", serif`;
        c.fillStyle = 'rgba(239,234,219,0.75)';
        c.fillText(this.song.composer, W / 2, 110 + fs * 0.7);
      }
      c.globalAlpha = 1;
    }

    // Notes: blocks as tall as the note lasts, clipped at the hit line.
    c.save();
    c.beginPath();
    c.rect(0, 0, W, hitY);
    c.clip();
    const visibleUntil = st + hitY / pps + 0.5;
    for (let k = this.notes.length - 1; k >= 0; k--) {
      const n = this.notes[k];
      if (n.time > visibleUntil) continue;
      if (n.time + n.dur < st - 1) continue;
      this.drawNote(n, st, pps);
    }
    c.restore();

    // Targets.
    const cur = this.current;
    const curHint = cur ? hintFor(cur.midi, this.profile) : null;
    const ty = hitY + this.targetGap;
    for (let i = 0; i < 5; i++) {
      const x = this.laneX(i);
      const lane = this.profile.lanes[i];
      const active = curHint && curHint.lane === i;
      const label = this.profile.showButtons ? lane.label : localNoteName(midiToName(lane.midi).replace(/\d/, ''));
      drawTarget(c, x, ty, this.tsize, label, this.profile.showButtons && i < 2 ? 'bar' : 'circle', active);
      // The bend being heard, shown under the target (like the controller hint).
      if (active && this.profile.showButtons && (curHint.mod.pad || curHint.mod.stick)) {
        const s = Math.round(this.tsize * 0.55);
        drawMod(c, x - modWidth(curHint.mod, s) / 2, ty + this.tsize + s * 0.2, s, curHint.mod, '#efeadb');
      }
    }

    // Popups.
    const nowMs = performance.now();
    this.popups = this.popups.filter((p) => nowMs - p.t < 750);
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    for (const p of this.popups) {
      const age = (nowMs - p.t) / 750;
      c.globalAlpha = 1 - age;
      c.fillStyle = p.color;
      c.font = '800 16px system-ui, -apple-system, sans-serif';
      c.fillText(p.text, this.laneX(p.lane), hitY - 14 - age * 30);
      c.globalAlpha = 1;
    }

    // Particles.
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const p of this.particles) {
      p.x += p.vx / 60;
      p.y += p.vy / 60;
      p.vy += 6;
      p.life -= 0.03;
      c.globalAlpha = Math.max(0, p.life);
      c.fillStyle = '#efeadb';
      c.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    c.globalAlpha = 1;

    this.drawNextPanel(st);

    // HUD.
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    c.fillStyle = '#efeadb';
    c.font = '800 22px system-ui, -apple-system, sans-serif';
    c.fillText(this.score.toLocaleString(), 14, 34);
    c.beginPath();
    c.arc(19, 50, 4.5, 0, Math.PI * 2);
    c.fillStyle = cur ? '#efeadb' : 'rgba(239,234,219,0.25)';
    c.fill();
    c.fillStyle = 'rgba(239,234,219,0.6)';
    c.font = '12px system-ui, -apple-system, sans-serif';
    c.fillText(cur ? `${t('heard')}: ${localNoteName(midiToName(cur.midi).replace(/-?\d+$/, ''))}` : t('listening'), 30, 54);

    if (this.combo >= 4) {
      c.textAlign = 'right';
      c.font = '800 20px system-ui, -apple-system, sans-serif';
      c.fillStyle = '#efeadb';
      c.fillText(`×${1 + Math.min(3, Math.floor(this.combo / 8))}  ${this.combo}`, W - 66, 34);
      c.font = '600 11px system-ui, -apple-system, sans-serif';
      c.fillStyle = 'rgba(239,234,219,0.55)';
      c.fillText(t('combo'), W - 66, 50);
    }

    // Count-in.
    if (first && this.blockedSince == null && st < first.time - 0.05 && first.time - st < 4 * this.spb + 0.3) {
      const beatsLeft = Math.ceil((first.time - st) / this.spb);
      if (beatsLeft <= this.song.beatsPerBar) {
        c.textAlign = 'center';
        c.fillStyle = '#efeadb';
        c.font = '700 64px Georgia, "Times New Roman", serif';
        c.fillText(String(beatsLeft), W / 2, hitY * 0.55);
      }
    }
  }

  // Bottom panel: the next input in pictures and plain words.
  drawNextPanel(st) {
    const c = this.ctx;
    const lat = (this.s.latencyMs || 0) / 1000;
    const upcoming = this.notes.filter((n) => !n.state && n.time >= st - lat - 0.25).slice(0, 2);
    const holding = this.notes.find((n) => n.sustaining);
    const x = this.hwX + 4;
    const w = this.hwW - 8;
    const y = this.hitY + this.targetGap + this.tsize + this.tsize * 0.9;
    const h = Math.min(60, this.H - y - 10);
    if (h < 40) return;
    c.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(c, x, y, w, h, 12);
    c.fill();
    c.strokeStyle = 'rgba(239,234,219,0.25)';
    c.lineWidth = 1;
    roundRect(c, x, y, w, h, 12);
    c.stroke();
    if (!upcoming.length && !holding) return;
    const main = holding && (!upcoming.length || upcoming[0].time - st > 0.4) ? holding : upcoming[0];
    const L = main.label;
    const bw = Math.min(70, w * 0.22);
    const bh = h - 14;
    const buttons = this.profile.showButtons;
    drawNoteBlock(c, x + 7, y + 7, bw, bh, { letter: buttons ? L.main : localNoteName(L.main.replace(/-?\d+$/, '')), mod: buttons ? L.h.mod : null });
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    const tx = x + 7 + bw + 12;
    const waiting = this.blockedSince != null;
    c.fillStyle = waiting ? '#ffffff' : 'rgba(239,234,219,0.55)';
    c.font = '800 11px system-ui, -apple-system, sans-serif';
    c.fillText(waiting ? t('waiting') : t('nextLabel'), tx, y + 19);
    c.fillStyle = '#efeadb';
    const words = main === holding ? t('holdLong') : buttons
      ? instruction(L.h, this.profile.lanes[L.h.lane].label)
      : localNoteName(midiToName(L.h.midi));
    const nextW = upcoming[1] && main !== holding ? 66 : 0;
    let fs = 17;
    c.font = `700 ${fs}px system-ui, -apple-system, sans-serif`;
    const maxW = w - (tx - x) - 10 - nextW;
    while (c.measureText(words).width > maxW && fs > 11) c.font = `700 ${--fs}px system-ui, -apple-system, sans-serif`;
    c.fillText(words, tx, y + 19 + fs + 6);
    if (nextW) {
      const n2 = upcoming[1].label;
      const sx = x + w - 60;
      c.fillStyle = 'rgba(239,234,219,0.5)';
      c.font = '700 10px system-ui, -apple-system, sans-serif';
      c.textAlign = 'center';
      c.fillText(t('then'), sx + 26, y + 14);
      drawNoteBlock(c, sx, y + 18, 52, h - 25, {
        letter: buttons ? n2.main : localNoteName(n2.main.replace(/-?\d+$/, '')),
        mod: buttons ? n2.h.mod : null,
      });
    }
  }

  drawNote(n, st, pps) {
    const c = this.ctx;
    const lane = n.label.h.lane;
    const x = this.hwX + lane * this.laneW + this.laneW * 0.06;
    const w = this.laneW * 0.88;
    const yStart = this.hitY - (n.time - st) * pps; // bottom edge: play now
    const yEnd = this.hitY - (n.time + n.dur - st) * pps;
    const minH = 46;
    const gap = 5;
    let top = Math.min(yEnd + gap, yStart - minH);
    let bottom = yStart;
    const missed = n.state === 'miss';
    const hit = n.state && !missed;
    if (hit) {
      // A played note is "eaten" by the hit line; long notes keep their remaining length.
      if (n.beats < 2) return;
      bottom = Math.min(bottom, this.hitY);
      if (bottom - top < 6) return;
    }
    const L = n.label;
    const buttons = this.profile.showButtons;
    const letter = buttons ? L.main : localNoteName(L.main.replace(/-?\d+$/, ''));
    const sub = this.s.showNoteNames && buttons ? localNoteName(L.sub) : '';
    drawNoteBlock(c, x, top, w, bottom - top, {
      letter: hit ? '' : letter,
      mod: hit || !buttons ? null : L.h.mod,
      sub: hit ? '' : sub,
      dim: missed,
      glow: n.sustaining,
    });
  }
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
