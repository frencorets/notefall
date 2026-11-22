// Music theory helpers and "hint profiles".
// A hint profile only decides how a note is LABELLED on the highway.
// Scoring is always done on pitch, so any melodic instrument works.

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const ASCII = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function noteToMidi(name) {
  const m = /^([A-Ga-g])([#♯b♭]?)(-?\d)$/.exec(String(name).trim());
  if (!m) throw new Error('Bad note name: ' + name);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()];
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  return (parseInt(m[3], 10) + 1) * 12 + base + acc;
}

export function midiToName(midi, ascii = false) {
  const n = Math.round(midi);
  return (ascii ? ASCII : NAMES)[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
}

export function pitchClassName(midi) {
  return NAMES[((Math.round(midi) % 12) + 12) % 12];
}

export const freqToMidi = (f) => 69 + 12 * Math.log2(f / 440);
export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

// ---------------------------------------------------------------------------
// Hint profiles.
// lanes: the five base notes. mods: how to reach neighbouring notes,
// listed in order of preference (the first one that works is shown).
// ---------------------------------------------------------------------------
export const PROFILES = {
  pad5: {
    id: 'pad5',
    name: '5-button controller',
    description: 'Five base buttons plus stick and D-pad bends. Labels are hints only — edit js/theory.js to match your setup.',
    lanes: [
      { label: 'L', midi: noteToMidi('D5'), color: '#3fd0c9' },
      { label: 'R', midi: noteToMidi('F5'), color: '#ff7a8a' },
      { label: 'A', midi: noteToMidi('A5'), color: '#ffc857' },
      { label: 'Y', midi: noteToMidi('B5'), color: '#9cdb5c' },
      { label: 'X', midi: noteToMidi('D6'), color: '#a98bff' },
    ],
    // Order = preference: fewest inputs first, D-pad before stick (it lands the pitch exactly).
    // Hold the modifier first, then press the note button.
    mods: [
      { id: '', semis: 0, glyph: '', hint: '' },
      { id: 'padUp', semis: 1, glyph: '♯', hint: 'D-pad ▲ (half step up)' },
      { id: 'padDown', semis: -1, glyph: '♭', hint: 'D-pad ▼ (half step down)' },
      { id: 'stickUp', semis: 2, glyph: '↑', hint: 'Stick ▲ (whole step up)' },
      { id: 'stickDown', semis: -2, glyph: '↓', hint: 'Stick ▼ (whole step down)' },
      { id: 'bothUp', semis: 3, glyph: '♯↑', hint: 'D-pad ▲ + Stick ▲ (+3 half steps)' },
      { id: 'bothDown', semis: -3, glyph: '♭↓', hint: 'D-pad ▼ + Stick ▼ (−3 half steps)' },
    ],
    showButtons: true,
  },
  names: {
    id: 'names',
    name: 'Note names (any instrument / voice)',
    description: 'Shows plain note names. Good for real ocarinas, recorders, whistling or humming.',
    lanes: null, // copied from pad5 below
    mods: null,
    showButtons: false,
  },
};
PROFILES.names.lanes = PROFILES.pad5.lanes;
PROFILES.names.mods = PROFILES.pad5.mods;

// L−3 = B4 up to X+3 = F6: 19 chromatic pitches.
export const RANGE = { low: noteToMidi('B4'), high: noteToMidi('F6') };

// Map a MIDI note to { lane, mod } for a profile (octave-folded into range).
export function hintFor(midi, profile) {
  const m = foldIntoRange(midi);
  for (const mod of profile.mods) {
    for (let i = 0; i < profile.lanes.length; i++) {
      if (profile.lanes[i].midi + mod.semis === m) return { lane: i, mod, midi: m };
    }
  }
  // Fallback: nearest lane by pitch, no modifier.
  let best = 0;
  profile.lanes.forEach((l, i) => {
    if (Math.abs(l.midi - m) < Math.abs(profile.lanes[best].midi - m)) best = i;
  });
  return { lane: best, mod: profile.mods[0], midi: m, unreachable: true };
}

export function foldIntoRange(midi) {
  let m = Math.round(midi);
  while (m < RANGE.low) m += 12;
  while (m > RANGE.high) m -= 12;
  return m;
}

// Label text used on note blocks.
export function labelFor(midi, profile) {
  const h = hintFor(midi, profile);
  if (!profile.showButtons) return { main: midiToName(h.midi), sub: '', h };
  return { main: profile.lanes[h.lane].label, glyph: h.mod.glyph, sub: midiToName(h.midi), h };
}

// Do two pitches match? (semitone tolerance via cents window, optional octave folding)
export function pitchMatches(detectedMidi, targetMidi, anyOctave, toleranceCents = 50) {
  let diff = detectedMidi - targetMidi;
  if (anyOctave) diff = ((diff % 12) + 18) % 12 - 6; // -6..6
  return Math.abs(diff) * 100 <= toleranceCents;
}

export function beatsToSeconds(beats, bpm) {
  return (beats * 60) / bpm;
}
