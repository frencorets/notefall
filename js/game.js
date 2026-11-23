// Gameplay: scrolling note highway, judging and scoring.

import * as audio from './audio.js';
import { labelFor, hintFor, pitchMatches, midiToName, PROFILES } from './theory.js';
import { t, instruction, localNoteName } from './i18n.js';
import { drawNoteHead, drawMod, roundRect } from './icons.js';

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
    this.hwW = Math.min(this.W - 16, 520);
    this.hwX = (this.W - this.hwW) / 2;
    this.laneW = this.hwW / 5;
    this.r = Math.min(this.laneW * 0.38, 30);
    this.hitY = this.H - Math.max(150, this.H * 0.2);
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
      this.popups.push({ text: t('popMiss'), lane, t: performance.now(), color: '#ff9b9b' });
      return;
    }
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const mult = 1 + Math.min(3, Math.floor(this.combo / 8));
    this.score += POINTS[rating] * mult;
    const label = t(rating === 'perfect' ? 'popPerfect' : rating === 'great' ? 'popGreat' : 'popGood');
    const timing = rating === 'perfect' || this.s.waitMode ? '' : ' · ' + t(dt < 0 ? 'early' : 'late');
    this.popups.push({ text: label + timing, lane, t: performance.now(), color: rating === 'perfect' ? '#fff3b0' : rating === 'great' ? '#9cf0ff' : '#c8c8ff' });
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
    const { W, H, hwX, hwW, laneW, hitY, r } = this;
    const pps = this.s.noteSpeed || 260;
    const st = this.songNow ?? 0;
    c.clearRect(0, 0, W, H);

    // Lanes.
    for (let i = 0; i < 5; i++) {
      const x = hwX + i * laneW;
      const g = c.createLinearGradient(0, 0, 0, hitY);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(1, hexA(this.profile.lanes[i].color, 0.12));
      c.fillStyle = g;
      c.fillRect(x + 1, 0, laneW - 2, hitY);
      if (this.flash[i] !== 0) {
        c.fillStyle = this.flash[i] > 0 ? hexA(this.profile.lanes[i].color, 0.28 * this.flash[i]) : `rgba(255,80,80,${0.14 * -this.flash[i]})`;
        c.fillRect(x + 1, 0, laneW - 2, hitY);
        this.flash[i] *= 0.88;
        if (Math.abs(this.flash[i]) < 0.02) this.flash[i] = 0;
      }
    }
    c.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i <= 5; i++) c.fillRect(hwX + i * laneW, 0, 1, hitY);

    // Beat lines.
    const beatsVisible = hitY / pps / this.spb + 2;
    const curBeat = (st - this.leadIn) / this.spb;
    for (let b = Math.floor(curBeat) - 1; b < curBeat + beatsVisible; b++) {
      const y = hitY - (this.leadIn + b * this.spb - st) * pps;
      if (y < 0 || y > hitY) continue;
      const bar = ((b % this.song.beatsPerBar) + this.song.beatsPerBar) % this.song.beatsPerBar === 0;
      c.fillStyle = bar ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.045)';
      c.fillRect(hwX, y, hwW, bar ? 2 : 1);
    }

    // Hit line and target circles.
    c.fillStyle = 'rgba(255,255,255,0.22)';
    c.fillRect(hwX, hitY - 1, hwW, 2);
    const cur = this.current;
    const curHint = cur ? hintFor(cur.midi, this.profile) : null;
    for (let i = 0; i < 5; i++) {
      const x = this.laneX(i);
      const lane = this.profile.lanes[i];
      const active = curHint && curHint.lane === i;
      c.beginPath();
      c.arc(x, hitY, r, 0, Math.PI * 2);
      c.fillStyle = active ? lane.color : 'rgba(10,12,30,0.9)';
      c.fill();
      c.lineWidth = 3;
      c.strokeStyle = lane.color;
      c.stroke();
      c.fillStyle = active ? '#17132f' : lane.color;
      c.font = `800 ${Math.round(r * 0.85)}px system-ui, -apple-system, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const name = this.profile.showButtons ? lane.label : localNoteName(midiToName(lane.midi).replace(/\d/, ''));
      c.fillText(name, x, hitY + 1);
      if (active && this.profile.showButtons) drawMod(c, x - r * 0.85, hitY - r * 0.85, r * 0.42, curHint.mod);
    }

    // Notes (far ones first). Clip to the highway so nothing covers the bottom panel.
    c.save();
    c.beginPath();
    c.rect(0, 0, W, hitY + this.headH() / 2 + 2);
    c.clip();
    const visibleUntil = st + hitY / pps + 0.5;
    for (let k = this.notes.length - 1; k >= 0; k--) {
      const n = this.notes[k];
      if (n.time > visibleUntil) continue;
      if (n.time + n.dur < st - 1) continue;
      this.drawNote(n, st, pps);
    }
    c.restore();

    // Popups (friendly feedback above the targets).
    const nowMs = performance.now();
    this.popups = this.popups.filter((p) => nowMs - p.t < 750);
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    for (const p of this.popups) {
      const age = (nowMs - p.t) / 750;
      c.globalAlpha = 1 - age;
      c.fillStyle = p.color;
      c.font = '800 16px system-ui, -apple-system, sans-serif';
      c.fillText(p.text, this.laneX(p.lane), hitY - r - 26 - age * 30);
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
      c.fillStyle = p.color;
      c.fillRect(p.x - 2.5, p.y - 2.5, 5, 5);
    }
    c.globalAlpha = 1;

    this.drawNextPanel(st);

    // HUD.
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    c.fillStyle = '#fff';
    c.font = '800 24px system-ui, -apple-system, sans-serif';
    c.fillText(this.score.toLocaleString(), 14, 36);
    c.font = '13px system-ui, -apple-system, sans-serif';
    c.fillStyle = 'rgba(255,255,255,0.6)';
    c.fillText(this.song.title, 14, 56);
    // Mic status dot.
    c.beginPath();
    c.arc(18, 72, 5, 0, Math.PI * 2);
    c.fillStyle = cur ? '#7dffb0' : 'rgba(255,255,255,0.25)';
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.font = '12px system-ui, -apple-system, sans-serif';
    c.fillText(cur ? `${t('heard')}: ${localNoteName(midiToName(cur.midi).replace(/-?\d+$/, ''))}` : t('listening'), 30, 76);

    if (this.combo >= 4) {
      c.textAlign = 'center';
      c.font = '800 30px system-ui, -apple-system, sans-serif';
      c.fillStyle = 'rgba(255,255,255,0.85)';
      c.fillText(`${this.combo}`, W / 2, hitY * 0.3);
      c.font = '700 12px system-ui, -apple-system, sans-serif';
      c.fillStyle = 'rgba(255,255,255,0.55)';
      c.fillText(`${t('combo')} ×${1 + Math.min(3, Math.floor(this.combo / 8))}`, W / 2, hitY * 0.3 + 18);
    }

    // Count-in.
    const first = this.notes[0];
    if (first && this.blockedSince == null && st < first.time - 0.05 && first.time - st < 4 * this.spb + 0.3) {
      const beatsLeft = Math.ceil((first.time - st) / this.spb);
      if (beatsLeft <= this.song.beatsPerBar) {
        c.textAlign = 'center';
        c.fillStyle = 'rgba(255,255,255,0.92)';
        c.font = '800 64px system-ui, -apple-system, sans-serif';
        c.fillText(String(beatsLeft), W / 2, hitY * 0.5);
      }
    }
  }

  headH() {
    return this.s.showNoteNames ? 54 : 46;
  }

  // Bottom panel: the next input in pictures and plain words.
  drawNextPanel(st) {
    const c = this.ctx;
    const lat = (this.s.latencyMs || 0) / 1000;
    const upcoming = this.notes.filter((n) => !n.state && n.time >= st - lat - 0.25).slice(0, 2);
    // If a held note is being sustained, say so.
    const holding = this.notes.find((n) => n.sustaining);
    const x = this.hwX;
    const w = this.hwW;
    const y = this.hitY + this.r + 14;
    const h = Math.min(64, this.H - y - 12);
    if (h < 40) return;
    c.fillStyle = 'rgba(36,29,85,0.92)';
    roundRect(c, x, y, w, h, 14);
    c.fill();
    if (!upcoming.length && !holding) return;
    const main = holding && (!upcoming.length || upcoming[0].time - st > 0.4) ? holding : upcoming[0];
    const L = main.label;
    const laneCol = this.profile.lanes[L.h.lane].color;
    const bw = Math.min(64, w * 0.2);
    const bh = h - 16;
    const letter = this.profile.showButtons ? L.main : localNoteName(L.main);
    drawNoteHead(c, x + 8, y + 8, bw, bh, { color: laneCol, letter, mod: this.profile.showButtons ? L.h.mod : null });
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    const tx = x + 8 + bw + 12;
    const waiting = this.blockedSince != null;
    c.fillStyle = waiting ? '#ffd36b' : 'rgba(255,255,255,0.55)';
    c.font = '800 11px system-ui, -apple-system, sans-serif';
    c.fillText(waiting ? t('waiting') : t('nextLabel'), tx, y + 20);
    c.fillStyle = '#fff';
    const words = main === holding ? t('holdLong') : this.profile.showButtons
      ? instruction(L.h, this.profile.lanes[L.h.lane].label)
      : localNoteName(midiToName(L.h.midi));
    let fs = 17;
    c.font = `700 ${fs}px system-ui, -apple-system, sans-serif`;
    const nextW = upcoming[1] && main !== holding ? 70 : 0;
    const maxW = w - (tx - x) - 10 - nextW;
    while (c.measureText(words).width > maxW && fs > 11) c.font = `700 ${--fs}px system-ui, -apple-system, sans-serif`;
    c.fillText(words, tx, y + 20 + fs + 6);
    // The one after, small.
    if (nextW) {
      const n2 = upcoming[1].label;
      const sx = x + w - 62;
      c.fillStyle = 'rgba(255,255,255,0.45)';
      c.font = '700 10px system-ui, -apple-system, sans-serif';
      c.textAlign = 'center';
      c.fillText(t('then'), sx + 26, y + 15);
      drawNoteHead(c, sx, y + 20, 52, h - 28, {
        color: this.profile.lanes[n2.h.lane].color,
        letter: this.profile.showButtons ? n2.main : localNoteName(n2.main),
        mod: this.profile.showButtons ? n2.h.mod : null,
      });
    }
  }

  drawNote(n, st, pps) {
    const c = this.ctx;
    const lane = n.label.h.lane;
    const color = this.profile.lanes[lane].color;
    const x = this.hwX + lane * this.laneW + this.laneW * 0.07;
    const w = this.laneW * 0.86;
    const headH = this.headH();
    const yHead = this.hitY - (n.time - st) * pps;
    const yTail = this.hitY - (n.time + n.dur - st) * pps;
    const missed = n.state === 'miss';
    const hit = n.state && !missed;
    const L = n.label;
    const showButtons = this.profile.showButtons;
    const letter = showButtons ? L.main : localNoteName(L.main);
    const sub = this.s.showNoteNames && showButtons ? localNoteName(L.sub) : '';

    // Held notes: one tall solid block, label at the bottom where you play it.
    if (n.beats >= 2) {
      const top = yTail;
      const bottom = hit ? Math.min(yHead + headH / 2, this.hitY) : yHead + headH / 2;
      if (bottom > top) {
        c.fillStyle = missed ? 'rgba(110,110,130,0.35)' : hexA(color, hit ? (n.sustaining ? 0.95 : 0.55) : 0.8);
        roundRect(c, x, top, w, bottom - top, 12);
        c.fill();
        if (n.sustaining) {
          c.strokeStyle = '#fff';
          c.lineWidth = 2;
          roundRect(c, x, top, w, bottom - top, 12);
          c.stroke();
        }
      }
      if (hit) return;
      drawNoteHead(c, x, yHead - headH / 2, w, headH, { color, letter, mod: showButtons ? L.h.mod : null, sub, dim: missed });
      return;
    }
    if (hit) return;
    drawNoteHead(c, x, yHead - headH / 2, w, headH, { color, letter, mod: showButtons ? L.h.mod : null, sub, dim: missed });
  }
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
