// Local storage (settings, user songs, best scores) and share-link encoding.
// Everything stays in the browser. Nothing is uploaded.

import { noteToMidi, midiToName } from './theory.js';

const KEY = 'notefall.v1';

const DEFAULT_SETTINGS = {
  profile: 'pad5',
  anyOctave: true,
  lenientRepeats: false,
  latencyMs: 120,
  tuningCents: 0,
  sensitivity: 1,
  noteSpeed: 260, // pixels per second
  speed: 1,
  waitMode: false,
};

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}
function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage full or blocked: ignore */
  }
}

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...(load().settings || {}) };
}
export function setSettings(patch) {
  const d = load();
  d.settings = { ...getSettings(), ...patch };
  save(d);
  return d.settings;
}

export function getMySongs() {
  return load().songs || [];
}
export function saveMySong(song) {
  const d = load();
  d.songs = d.songs || [];
  const i = d.songs.findIndex((s) => s.id === song.id);
  if (i >= 0) d.songs[i] = song;
  else d.songs.unshift(song);
  save(d);
}
export function deleteMySong(id) {
  const d = load();
  d.songs = (d.songs || []).filter((s) => s.id !== id);
  save(d);
}

export function getBest(id) {
  return (load().best || {})[id] || null;
}
export function setBest(id, result) {
  const d = load();
  d.best = d.best || {};
  const prev = d.best[id];
  if (!prev || result.score > prev.score) {
    d.best[id] = { score: result.score, accuracy: result.accuracy, grade: result.grade };
    save(d);
    return true;
  }
  return false;
}

export function newId() {
  return 'u-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ---------------------------------------------------------------------------
// Song format conversion.
// File format:  notes: [[beat, lengthInBeats, "F#5"], ...]
// In memory:    notes: [{ t, d, midi }, ...]
// ---------------------------------------------------------------------------
export function fromFile(json) {
  const s = typeof json === 'string' ? JSON.parse(json) : json;
  if (!s || !Array.isArray(s.notes)) throw new Error('Not a song file');
  const notes = s.notes.map((n) => Array.isArray(n)
    ? { t: +n[0], d: +n[1], midi: typeof n[2] === 'number' ? n[2] : noteToMidi(n[2]) }
    : { t: +n.t, d: +n.d, midi: typeof n.midi === 'number' ? n.midi : noteToMidi(n.n) });
  if (notes.some((n) => !isFinite(n.t) || !isFinite(n.d) || !isFinite(n.midi) || n.d <= 0)) throw new Error('Bad note data');
  if (notes.length > 5000) throw new Error('Song too long');
  notes.sort((a, b) => a.t - b.t || a.midi - b.midi);
  return {
    id: String(s.id || newId()).slice(0, 64),
    title: String(s.title || 'Untitled').slice(0, 80),
    composer: String(s.composer || '').slice(0, 80),
    license: String(s.license || '').slice(0, 40),
    source: String(s.source || '').slice(0, 120),
    year: String(s.year || '').slice(0, 20),
    provenance: String(s.provenance || '').slice(0, 200),
    bpm: Math.min(300, Math.max(30, +s.bpm || 100)),
    beatsPerBar: Math.min(12, Math.max(2, +s.beatsPerBar || 4)),
    difficulty: +s.difficulty || estimateDifficulty(notes, +s.bpm || 100),
    notes,
  };
}

export function toFile(song) {
  return {
    format: 'notefall-song-1',
    id: song.id,
    title: song.title,
    composer: song.composer,
    license: song.license,
    source: song.source || '',
    bpm: song.bpm,
    beatsPerBar: song.beatsPerBar,
    notes: song.notes.map((n) => [round(n.t), round(n.d), midiToName(n.midi, true)]),
  };
}

const round = (x) => Math.round(x * 1000) / 1000;

export function estimateDifficulty(notes, bpm) {
  if (!notes.length) return 1;
  const beats = notes[notes.length - 1].t + notes[notes.length - 1].d;
  const nps = notes.length / ((beats * 60) / bpm);
  const accidentals = notes.filter((n) => [1, 3, 6, 8, 10].includes(((n.midi % 12) + 12) % 12)).length / notes.length;
  return Math.max(1, Math.min(5, Math.round(nps * 1.2 + accidentals * 3)));
}

// ---------------------------------------------------------------------------
// Share links: the song travels inside the URL (#s=...). No server involved.
// ---------------------------------------------------------------------------
function b64urlEncode(bytes) {
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function pipe(bytes, Stream) {
  const cs = new Stream('deflate-raw');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(cs));
  return new Uint8Array(await out.arrayBuffer());
}

export async function encodeShare(song) {
  const f = toFile(song);
  // Compact form: [title, composer, bpm, beatsPerBar, license, [t,d,midi]...]
  const compact = [f.title, f.composer, f.bpm, f.beatsPerBar, f.license, song.notes.map((n) => [round(n.t), round(n.d), n.midi])];
  const bytes = new TextEncoder().encode(JSON.stringify(compact));
  if (typeof CompressionStream !== 'undefined') {
    return 'z' + b64urlEncode(await pipe(bytes, CompressionStream));
  }
  return 'j' + b64urlEncode(bytes);
}

export async function decodeShare(code) {
  let bytes = b64urlDecode(code.slice(1));
  if (code[0] === 'z') bytes = await pipe(bytes, DecompressionStream);
  const c = JSON.parse(new TextDecoder().decode(bytes));
  return fromFile({ id: newId(), title: c[0], composer: c[1], bpm: c[2], beatsPerBar: c[3], license: c[4], notes: c[5] });
}
