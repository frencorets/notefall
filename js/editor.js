// Song editor: piano roll + record-by-playing.

import * as audio from './audio.js';
import { RANGE, midiToName, foldIntoRange, labelFor, PROFILES } from './theory.js';

const ROW_H = 26;
const COL_W = 30;

export class Editor {
  constructor(root, song, settings) {
    this.root = root;
    this.doc = song;
    this.s = settings;
    this.profile = PROFILES[settings.profile] || PROFILES.pad5;
    this.grid = 0.5; // beats per column
    this.len = 1; // new note length in beats
    this.sel = null;
    this.preview = null;
    this.recording = null;
    this.rows = [];
    for (let m = RANGE.high; m >= RANGE.low; m--) this.rows.push(m);

    this.labels = root.querySelector('.roll-labels');
    this.scroller = root.querySelector('.roll-scroll');
    this.canvas = root.querySelector('.roll-grid');
    this.ctx = this.canvas.getContext('2d');
    this.canvas.addEventListener('pointerdown', (e) => this.onPointer(e));
    this.drawLabels();
    this.layout();
  }

  get totalBeats() {
    const end = this.doc.notes.reduce((m, n) => Math.max(m, n.t + n.d), 0);
    const bar = this.doc.beatsPerBar;
    return Math.max(8 * bar, Math.ceil(end / bar) * bar + 2 * bar);
  }

  layout() {
    const cols = Math.ceil(this.totalBeats / this.grid);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cw = cols * COL_W;
    this.ch = this.rows.length * ROW_H;
    this.canvas.style.width = this.cw + 'px';
    this.canvas.style.height = this.ch + 'px';
    this.canvas.width = this.cw * dpr;
    this.canvas.height = this.ch * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  drawLabels() {
    this.labels.innerHTML = '';
    for (const m of this.rows) {
      const d = document.createElement('div');
      d.className = 'roll-label' + ([1, 3, 6, 8, 10].includes(m % 12) ? ' sharp' : '');
      d.style.height = ROW_H + 'px';
      const L = labelFor(m, PROFILES.pad5);
      const hint = this.profile.showButtons ? `<small>${L.glyph || ''}${L.main}</small>` : '';
      d.innerHTML = `<span>${midiToName(m)}</span>${hint}`;
      this.labels.appendChild(d);
    }
  }

  beatToX(b) {
    return (b / this.grid) * COL_W;
  }

  draw(playBeat = null) {
    const c = this.ctx;
    c.clearRect(0, 0, this.cw, this.ch);
    // Rows.
    this.rows.forEach((m, r) => {
      c.fillStyle = [1, 3, 6, 8, 10].includes(m % 12) ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.03)';
      c.fillRect(0, r * ROW_H, this.cw, ROW_H);
      c.fillStyle = 'rgba(255,255,255,0.05)';
      c.fillRect(0, r * ROW_H, this.cw, 1);
    });
    // Columns.
    const cols = Math.ceil(this.totalBeats / this.grid);
    for (let i = 0; i <= cols; i++) {
      const beat = i * this.grid;
      const isBar = Math.abs(beat % this.doc.beatsPerBar) < 1e-6;
      const isBeat = Math.abs(beat % 1) < 1e-6;
      c.fillStyle = isBar ? 'rgba(255,255,255,0.3)' : isBeat ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)';
      c.fillRect(i * COL_W, 0, isBar ? 2 : 1, this.ch);
      if (isBar) {
        c.fillStyle = 'rgba(255,255,255,0.45)';
        c.font = '10px system-ui, sans-serif';
        c.fillText(String(beat / this.doc.beatsPerBar + 1), i * COL_W + 4, 11);
      }
    }
    // Notes.
    for (const n of this.doc.notes) {
      const r = this.rows.indexOf(n.midi);
      if (r < 0) continue;
      const x = this.beatToX(n.t);
      const w = Math.max(6, this.beatToX(n.d) - 2);
      const lane = labelFor(n.midi, this.profile).h.lane;
      c.fillStyle = this.profile.lanes[lane].color;
      c.fillRect(x + 1, r * ROW_H + 3, w, ROW_H - 6);
      if (n === this.sel) {
        c.strokeStyle = '#fff';
        c.lineWidth = 2;
        c.strokeRect(x + 1, r * ROW_H + 3, w, ROW_H - 6);
      }
    }
    if (playBeat != null) {
      c.fillStyle = '#fff';
      c.fillRect(this.beatToX(playBeat), 0, 2, this.ch);
    }
  }

  onPointer(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const r = Math.floor(y / ROW_H);
    const midi = this.rows[r];
    if (midi == null) return;
    const beat = (x / COL_W) * this.grid;
    const hitNote = this.doc.notes.find((n) => n.midi === midi && beat >= n.t && beat < n.t + n.d);
    if (hitNote) {
      this.sel = hitNote === this.sel ? null : hitNote;
    } else {
      const t = Math.floor(beat / this.grid) * this.grid;
      const n = { t, d: this.len, midi };
      this.doc.notes.push(n);
      this.sortNotes();
      this.sel = n;
      audio.playTone(midi, audio.now(), 0.25, 0.8);
    }
    this.changed();
  }

  sortNotes() {
    this.doc.notes.sort((a, b) => a.t - b.t || a.midi - b.midi);
  }

  changed() {
    const before = this.canvas.width;
    this.layout();
    if (this.canvas.width === before) this.draw();
    this.onChange && this.onChange();
  }

  // Toolbar actions on the selected note.
  act(cmd) {
    const n = this.sel;
    if (cmd === 'clear') {
      this.doc.notes = [];
      this.sel = null;
      return this.changed();
    }
    if (!n) return;
    if (cmd === 'delete') {
      this.doc.notes = this.doc.notes.filter((x) => x !== n);
      this.sel = null;
    }
    if (cmd === 'up' && n.midi < RANGE.high) n.midi++;
    if (cmd === 'down' && n.midi > RANGE.low) n.midi--;
    if (cmd === 'left') n.t = Math.max(0, n.t - this.grid);
    if (cmd === 'right') n.t += this.grid;
    if (cmd === 'longer') n.d += this.grid;
    if (cmd === 'shorter') n.d = Math.max(this.grid, n.d - this.grid);
    if (['up', 'down'].includes(cmd)) audio.playTone(n.midi, audio.now(), 0.25, 0.8);
    this.sortNotes();
    this.changed();
  }

  togglePreview(onState) {
    if (this.preview) return this.stopPreview(onState);
    if (!this.doc.notes.length) return;
    const p = audio.playMelody(this.doc.notes, this.doc.bpm, { onEnd: () => this.stopPreview(onState) });
    this.preview = p;
    onState && onState(true);
    const tick = () => {
      if (this.preview !== p) return;
      const beat = (audio.now() - p.t0) / p.spb;
      this.draw(Math.max(0, beat));
      const x = this.beatToX(beat);
      if (x > this.scroller.scrollLeft + this.scroller.clientWidth - 40) this.scroller.scrollLeft = x - 40;
      requestAnimationFrame(tick);
    };
    tick();
  }

  stopPreview(onState) {
    if (this.preview) this.preview.stop();
    this.preview = null;
    this.draw();
    onState && onState(false);
  }

  // Record by playing: count-in bar, then capture note events until stopped.
  async startRecording({ metronome = true, onState } = {}) {
    await audio.startMic(this.s);
    const spb = 60 / this.doc.bpm;
    const bar = this.doc.beatsPerBar;
    const t0 = audio.now() + 0.2 + bar * spb; // recording starts after one bar
    for (let b = 0; b < bar; b++) audio.click(t0 - (bar - b) * spb, b === 0);
    const lastEnd = this.doc.notes.reduce((m, n) => Math.max(m, n.t + n.d), 0);
    const offsetBeats = lastEnd ? Math.ceil(lastEnd / bar) * bar : 0;
    const rec = { t0, spb, open: null, taken: [], offsetBeats, metronome, nextClick: 0 };
    this.recording = rec;
    const lat = (this.s.latencyMs || 0) / 1000;
    rec.unsub = audio.onNotes((events) => {
      for (const e of events) {
        const t = e.time - lat - t0;
        if (t < -0.15) continue;
        if (rec.open && (e.type === 'off' || e.type === 'on')) {
          rec.open.end = t;
          rec.taken.push(rec.open);
          rec.open = null;
        }
        if (e.type === 'on') rec.open = { start: Math.max(0, t), midi: Math.round(e.midi) };
      }
    });
    const tick = () => {
      if (this.recording !== rec) return;
      const now = audio.now();
      if (rec.metronome) {
        // Schedule clicks a little ahead.
        while (t0 + rec.nextClick * spb < now + 0.3) {
          if (rec.nextClick >= 0 && t0 + rec.nextClick * spb > now) audio.click(t0 + rec.nextClick * spb, rec.nextClick % bar === 0);
          rec.nextClick++;
        }
      }
      const beat = (now - t0) / spb;
      this.draw(beat >= 0 ? offsetBeats + beat : null);
      requestAnimationFrame(tick);
    };
    tick();
    onState && onState(true);
  }

  stopRecording(onState) {
    const rec = this.recording;
    if (!rec) return;
    this.recording = null;
    rec.unsub();
    if (rec.open) {
      rec.open.end = audio.now() - rec.t0;
      rec.taken.push(rec.open);
    }
    const g = this.grid;
    const q = (beats) => Math.round(beats / g) * g;
    let added = 0;
    let prevT = -Infinity;
    for (const n of rec.taken) {
      // Two quick notes can round to the same cell: push the later one along.
      const t = Math.max(q(n.start / rec.spb), prevT + g);
      prevT = t;
      const d = Math.max(g, q((n.end - n.start) / rec.spb));
      const midi = foldIntoRange(n.midi);
      const tt = rec.offsetBeats + t;
      // Skip duplicates that landed on the same grid cell.
      if (this.doc.notes.some((x) => x.t === tt && x.midi === midi)) continue;
      this.doc.notes.push({ t: tt, d, midi });
      added++;
    }
    // Trim overlaps so notes never overlap in time.
    this.sortNotes();
    for (let i = 0; i < this.doc.notes.length - 1; i++) {
      const a = this.doc.notes[i], b = this.doc.notes[i + 1];
      if (a.t + a.d > b.t && b.t > a.t) a.d = Math.max(g, b.t - a.t);
    }
    this.changed();
    onState && onState(false, added);
  }
}
