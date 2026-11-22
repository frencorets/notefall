// App shell: screens, library, song sheet, settings, calibration.

import * as audio from './audio.js';
import * as store from './storage.js';
import { Game } from './game.js';
import { Editor } from './editor.js';
import { PROFILES, midiToName, labelFor, hintFor } from './theory.js';
import { CONFIG } from './config.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

let settings = store.getSettings();
let builtinIndex = null;
let currentSong = null; // in-memory song object
let currentSource = null; // 'builtin' | 'mine' | 'shared'
let game = null;
let editor = null;
let listenHandle = null;
let tab = 'builtin';

// ------------------------------------------------------------------ helpers
function show(id) {
  if (listenHandle) stopListen();
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  if (id === 'library') renderList();
  if (id === 'settings') renderSettings();
  window.scrollTo(0, 0);
}

let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const LICENSE_TEXT = {
  'public-domain': 'Public domain melody',
  original: 'Original melody',
  permission: 'Shared with permission',
};

async function ensureMic() {
  try {
    await audio.startMic(settings);
    return true;
  } catch (e) {
    console.error(e);
    toast(location.protocol === 'file:'
      ? 'The microphone needs the page to be served over http(s). See the README.'
      : 'Microphone blocked. Allow mic access for this site in your browser settings.', 5000);
    return false;
  }
}

// ------------------------------------------------------------------ library
async function loadIndex() {
  if (builtinIndex) return builtinIndex;
  const r = await fetch('songs/index.json');
  builtinIndex = await r.json();
  return builtinIndex;
}

async function renderList() {
  const list = $('#songList');
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  list.innerHTML = '';
  let items;
  if (tab === 'builtin') {
    try {
      items = (await loadIndex()).map((s) => ({ ...s, source: 'builtin' }));
    } catch {
      list.innerHTML = '<p class="muted">Could not load the song library. If you opened the file directly, run a local web server (see README).</p>';
      return;
    }
    items.sort((a, b) => a.difficulty - b.difficulty || a.title.localeCompare(b.title));
    $('#listFoot').textContent = 'Public-domain melodies and originals written for Notefall.';
  } else {
    items = store.getMySongs().map((s) => ({ ...s, source: 'mine', noteCount: s.notes.length }));
    $('#listFoot').innerHTML = items.length ? '' : 'No songs yet. <a href="#" id="mkSong">Create one</a> or import a file in the editor.';
    const mk = $('#mkSong');
    if (mk) mk.onclick = (e) => { e.preventDefault(); openEditor(null); };
  }
  for (const s of items) {
    const best = store.getBest(s.id);
    const b = document.createElement('button');
    b.className = 'song';
    b.innerHTML = `<b>${esc(s.title)}</b>
      <span class="right"><span class="dots">${'●'.repeat(s.difficulty || 1)}${'○'.repeat(5 - (s.difficulty || 1))}</span><br>${best ? `<span class="badge">${best.grade}</span>` : ''}</span>
      <span class="sub">${esc(s.composer || '')}${s.year ? ' · ' + esc(s.year) : ''} · ${s.bpm} bpm</span>`;
    b.onclick = () => openSheet(s);
    list.appendChild(b);
  }
}

async function openSheet(entry, sharedSong = null) {
  if (sharedSong) {
    currentSong = sharedSong;
    currentSource = 'shared';
  } else if (entry.source === 'builtin') {
    const r = await fetch('songs/' + entry.file);
    currentSong = store.fromFile(await r.json());
    currentSource = 'builtin';
  } else {
    currentSong = store.fromFile(entry);
    currentSource = 'mine';
  }
  const s = currentSong;
  $('#sheetTitle').textContent = s.title;
  const beats = s.notes.length ? s.notes[s.notes.length - 1].t + s.notes[s.notes.length - 1].d : 0;
  const secs = Math.round((beats * 60) / s.bpm);
  $('#sheetMeta').textContent = `${s.composer || 'Unknown'}${s.year ? ' · ' + s.year : ''} — ${s.notes.length} notes · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} · ${s.bpm} bpm`;
  const best = store.getBest(s.id);
  $('#sheetBest').textContent = best ? `Best: ${best.score.toLocaleString()} (${best.accuracy}% · ${best.grade})` : 'Not played yet';
  $('#sheetLicense').textContent = [LICENSE_TEXT[s.license] || '', s.source, s.provenance].filter(Boolean).join(' · ');
  $('#speedIn').value = settings.speed;
  $('#speedOut').textContent = Math.round(settings.speed * 100) + '%';
  $('#waitIn').checked = settings.waitMode;
  $('#editBtn').textContent = currentSource === 'mine' ? '✎ Edit' : '✎ Edit a copy';
  $('#deleteBtn').hidden = currentSource !== 'mine';
  $('#saveSharedBtn').hidden = currentSource !== 'shared';
  $('#sheet .back').dataset.go = currentSource === 'shared' ? 'home' : 'library';
  show('sheet');
}

function stopListen() {
  if (listenHandle) listenHandle.stop();
  listenHandle = null;
  $('#listenBtn').textContent = '♫ Listen';
}

// ------------------------------------------------------------------ game
async function startGame() {
  if (!(await ensureMic())) return;
  show('game');
  $('#pauseMenu').hidden = true;
  if (game) game.stop();
  game = new Game($('#gameCanvas'), currentSong, settings, { onEnd: showResults });
  game.start();
}

function showResults(r) {
  const practice = settings.waitMode || settings.speed < 1;
  const isNew = !practice && currentSource !== 'shared' && store.setBest(currentSong.id, r);
  $('#resGrade').textContent = r.grade;
  $('#resTitle').textContent = currentSong.title + (practice ? ' · practice' : '');
  $('#resScore').textContent = r.score.toLocaleString();
  $('#resNew').hidden = !isNew;
  $('#resStats').innerHTML = `
    <dt>Accuracy</dt><dd>${r.accuracy}%</dd>
    <dt>Perfect</dt><dd>${r.counts.perfect}</dd>
    <dt>Great</dt><dd>${r.counts.great}</dd>
    <dt>Good</dt><dd>${r.counts.good}</dd>
    <dt>Miss</dt><dd>${r.counts.miss}</dd>
    <dt>Max combo</dt><dd>${r.maxCombo}</dd>
    <dt>Hold bonus</dt><dd>${r.sustainBonus}</dd>`;
  show('results');
}

// ------------------------------------------------------------------ editor
function openEditor(song) {
  const doc = song
    ? JSON.parse(JSON.stringify(song))
    : { id: store.newId(), title: '', composer: '', license: 'original', bpm: 100, beatsPerBar: 4, notes: [] };
  $('#edTitle').value = doc.title;
  $('#edComposer').value = doc.composer;
  $('#edBpm').value = doc.bpm;
  $('#edBeats').value = String(doc.beatsPerBar);
  $('#edLicense').value = ['original', 'public-domain', 'permission'].includes(doc.license) ? doc.license : 'original';
  show('editor');
  editor = new Editor($('#editor'), doc, settings);
  editor.grid = +$('#edGrid').value;
  editor.len = +$('#edLen').value;
  editor.layout();
  editor.dirty = false;
  editor.onChange = () => (editor.dirty = true);
}

function readEditorMeta() {
  const d = editor.doc;
  d.title = $('#edTitle').value.trim() || 'Untitled';
  d.composer = $('#edComposer').value.trim();
  d.bpm = Math.min(300, Math.max(30, +$('#edBpm').value || 100));
  d.beatsPerBar = +$('#edBeats').value;
  d.license = $('#edLicense').value;
  d.difficulty = store.estimateDifficulty(d.notes, d.bpm);
  return d;
}

function saveEditor() {
  const d = readEditorMeta();
  if (!d.notes.length) return toast('Add some notes first.');
  store.saveMySong(JSON.parse(JSON.stringify(d)));
  editor.dirty = false;
  toast('Saved to My songs.');
}

function stopEditorAudio() {
  if (!editor) return;
  editor.stopPreview(() => ($('#previewBtn').textContent = '♫ Preview'));
  if (editor.recording) editor.stopRecording(recState);
}

function recState(on, added) {
  const b = $('#recordBtn');
  b.classList.toggle('on', on);
  b.textContent = on ? '■ Stop recording' : '● Record by playing';
  if (!on && added != null) toast(added ? `Added ${added} notes.` : 'No notes heard. Check the mic in Settings.');
}

// ------------------------------------------------------------------ settings
function fmtLat(v) { return `${v} ms`; }
function renderSettings() {
  const sel = $('#profileIn');
  sel.innerHTML = Object.values(PROFILES).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  sel.value = settings.profile;
  const p = PROFILES[settings.profile];
  $('#profileDesc').textContent = p.description;
  $('#legend').innerHTML = p.showButtons
    ? p.lanes.map((l) => `<span><b style="color:${l.color}">${l.label}</b> = ${midiToName(l.midi)}</span>`).join('') +
      p.mods.filter((m) => m.glyph).map((m) => `<span><b>${m.glyph}</b> ${esc(m.hint)}</span>`).join('')
    : '';
  $('#latIn').value = settings.latencyMs; $('#latOut').textContent = fmtLat(settings.latencyMs);
  $('#tuneIn').value = settings.tuningCents; $('#tuneOut').textContent = `${settings.tuningCents > 0 ? '+' : ''}${settings.tuningCents}¢`;
  $('#sensIn').value = settings.sensitivity; $('#sensOut').textContent = `×${(+settings.sensitivity).toFixed(1)}`;
  $('#nsIn').value = settings.noteSpeed; $('#nsOut').textContent = settings.noteSpeed;
  $('#octIn').checked = settings.anyOctave;
  $('#lenIn').checked = settings.lenientRepeats;
  $('#micBtn').hidden = audio.micActive();
}

function updateSettings(patch) {
  settings = store.setSettings(patch);
  audio.applySettings(settings);
  renderSettings();
}

// Live tuner on the settings screen.
audio.onNotes((events, cur) => {
  if (!$('#settings').classList.contains('active')) return;
  const raw = audio.tracker.lastRaw;
  const level = raw ? raw.level : audio.tracker.levels[audio.tracker.levels.length - 1] || 0;
  $('#levelBar').style.width = Math.min(100, level * 600) + '%';
  if (cur) {
    $('#tunerNote').textContent = midiToName(cur.midi);
    $('#tunerNeedle').style.left = 50 + cur.cents + '%';
    const p = PROFILES[settings.profile];
    const L = labelFor(cur.midi, p);
    $('#tunerHint').textContent = p.showButtons ? `${L.h.mod.glyph ? L.h.mod.hint + ' + ' : ''}${L.main}` : '';
  } else {
    $('#tunerNote').textContent = '—';
    $('#tunerHint').textContent = '';
  }
});

// Delay calibration: play a note on each of 8 clicks.
async function calibrateLatency() {
  if (!(await ensureMic())) return;
  const bpm = 90, spb = 60 / bpm, countIn = 4, n = 8;
  const t0 = audio.now() + 0.8;
  const clicks = [];
  for (let i = 0; i < countIn + n; i++) {
    const t = t0 + i * spb;
    audio.click(t, i < countIn);
    if (i >= countIn) clicks.push(t);
  }
  const dots = $('#calDots');
  dots.innerHTML = '<i></i>'.repeat(n);
  $('#calTitle').textContent = 'Delay calibration';
  $('#calText').textContent = 'After 4 high clicks, play a short note exactly on each of the next 8 clicks.';
  $('#calOverlay').hidden = false;
  const offsets = [];
  let done = false;
  const unsub = audio.onNotes((events) => {
    for (const e of events) {
      if (e.type !== 'on') continue;
      let best = null;
      clicks.forEach((c, i) => { const d = e.time - c; if (d > -0.15 && d < 0.6 && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, i }; });
      if (best) { offsets.push(best.d); dots.children[best.i].className = 'hit'; }
    }
  });
  const tick = () => {
    if (done) return;
    const now = audio.now();
    clicks.forEach((c, i) => { if (now >= c && dots.children[i].className !== 'hit') dots.children[i].className = 'on'; });
    if (now > clicks[clicks.length - 1] + 0.8) return finish();
    requestAnimationFrame(tick);
  };
  const finish = (cancel) => {
    done = true;
    unsub();
    $('#calOverlay').hidden = true;
    if (cancel) return;
    if (offsets.length < 4) return toast('Not enough notes heard — try again, closer to the speaker.');
    offsets.sort((a, b) => a - b);
    const med = offsets[Math.floor(offsets.length / 2)];
    updateSettings({ latencyMs: Math.max(0, Math.min(500, Math.round(med * 1000 / 5) * 5)) });
    toast(`Delay set to ${settings.latencyMs} ms.`);
  };
  $('#calCancel').onclick = () => finish(true);
  tick();
}

// Tuning calibration: hold one steady note for ~2 seconds.
async function calibrateTuning() {
  if (!(await ensureMic())) return;
  $('#calTitle').textContent = 'Auto-tune';
  $('#calText').textContent = 'Play and hold one steady note…';
  $('#calDots').innerHTML = '';
  $('#calOverlay').hidden = false;
  const samples = [];
  let done = false;
  const unsub = audio.onNotes((ev, cur) => { if (cur) samples.push(cur.midi - Math.round(cur.midi)); });
  const finish = (cancel) => {
    if (done) return;
    done = true;
    unsub();
    $('#calOverlay').hidden = true;
    if (cancel) return;
    if (samples.length < 40) return toast('No steady note heard. Try again.');
    samples.sort((a, b) => a - b);
    const dev = Math.round(samples[Math.floor(samples.length / 2)] * 100);
    updateSettings({ tuningCents: Math.max(-50, Math.min(50, settings.tuningCents + dev)) });
    toast(`Tuning offset ${settings.tuningCents > 0 ? '+' : ''}${settings.tuningCents}¢.`);
  };
  $('#calCancel').onclick = () => finish(true);
  setTimeout(() => finish(false), 3000);
}

// ------------------------------------------------------------------ wiring
function wire() {
  $('#donateLink').href = $('#donateLink2').href = CONFIG.donateUrl;
  $('#repoLink').href = CONFIG.repoUrl;
  if (localStorage.getItem('notefall.v1')) $('#firstTime').hidden = true;

  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (!go) return;
    if (go.hasAttribute('data-new-song')) return openEditor(null);
    show(go.dataset.go);
  });
  $$('.tab').forEach((t) => (t.onclick = () => { tab = t.dataset.tab; renderList(); }));

  // Sheet.
  $('#speedIn').oninput = (e) => { settings = store.setSettings({ speed: +e.target.value }); $('#speedOut').textContent = Math.round(settings.speed * 100) + '%'; };
  $('#waitIn').onchange = (e) => (settings = store.setSettings({ waitMode: e.target.checked }));
  $('#playBtn').onclick = startGame;
  $('#listenBtn').onclick = () => {
    if (listenHandle) return stopListen();
    listenHandle = audio.playMelody(currentSong.notes, currentSong.bpm, { speed: settings.speed, onEnd: stopListen });
    $('#listenBtn').textContent = '■ Stop';
  };
  $('#editBtn').onclick = () => {
    const copy = JSON.parse(JSON.stringify(currentSong));
    if (currentSource !== 'mine') {
      copy.id = store.newId();
      copy.title = currentSource === 'builtin' ? copy.title + ' (my version)' : copy.title;
    }
    openEditor(copy);
  };
  $('#deleteBtn').onclick = () => {
    if (!confirmInline($('#deleteBtn'))) return;
    store.deleteMySong(currentSong.id);
    tab = 'mine';
    show('library');
  };
  $('#saveSharedBtn').onclick = () => { store.saveMySong(currentSong); currentSource = 'mine'; toast('Saved to My songs.'); $('#saveSharedBtn').hidden = true; $('#deleteBtn').hidden = false; };
  $('#shareBtn').onclick = () => shareSong(currentSong);
  $('#exportBtn').onclick = () => exportSong(currentSong);

  // Game.
  $('#pauseBtn').onclick = () => { if (!game) return; game.pause(); $('#pauseMenu').hidden = false; };
  $('#resumeBtn').onclick = () => { $('#pauseMenu').hidden = true; game.resume(); };
  $('#restartBtn').onclick = () => startGame();
  $('#quitBtn').onclick = () => { game.stop(); game = null; show(currentSource === 'shared' ? 'sheet' : currentSource === 'editor' ? 'editor' : 'library'); };
  $('#retryBtn').onclick = () => startGame();
  document.addEventListener('visibilitychange', () => { if (document.hidden && game && game.running) { game.pause(); $('#pauseMenu').hidden = false; } });

  // Editor.
  $('#editorBack').onclick = () => {
    stopEditorAudio();
    if (editor && editor.dirty && editor.doc.notes.length && !confirmInline($('#editorBack'), '!')) return toast('Unsaved changes — tap ‹ again to discard.');
    show('library');
  };
  $('#saveSongBtn').onclick = saveEditor;
  $('#edLen').onchange = (e) => (editor.len = +e.target.value);
  $('#edGrid').onchange = (e) => { editor.grid = +e.target.value; editor.layout(); };
  $('#edBeats').onchange = () => { readEditorMeta(); editor.layout(); };
  $$('#editor [data-act]').forEach((b) => (b.onclick = () => {
    if (b.dataset.act === 'clear' && !confirmInline(b)) return;
    editor.act(b.dataset.act);
  }));
  $('#previewBtn').onclick = () => { readEditorMeta(); editor.togglePreview((on) => ($('#previewBtn').textContent = on ? '■ Stop' : '♫ Preview')); };
  $('#recordBtn').onclick = async () => {
    if (editor.recording) return editor.stopRecording(recState);
    if (!(await ensureMic())) return;
    readEditorMeta();
    editor.stopPreview(() => ($('#previewBtn').textContent = '♫ Preview'));
    editor.startRecording({ metronome: $('#edMetro').checked, onState: recState });
    toast('One bar of count-in, then play!');
  };
  $('#edPlayBtn').onclick = () => {
    const d = readEditorMeta();
    if (!d.notes.length) return toast('Add some notes first.');
    stopEditorAudio();
    currentSong = store.fromFile(store.toFile(d));
    currentSource = 'editor';
    startGame();
  };
  $('#importBtn').onclick = () => $('#importFile').click();
  $('#importFile').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const song = store.fromFile(await f.text());
      song.id = store.newId();
      openEditor(song);
      toast('Imported. Remember to Save.');
    } catch (err) {
      toast('That file is not a Notefall song.');
    }
  };

  // Settings.
  $('#micBtn').onclick = async () => { if (await ensureMic()) renderSettings(); };
  $('#profileIn').onchange = (e) => updateSettings({ profile: e.target.value });
  $('#latIn').oninput = (e) => updateSettings({ latencyMs: +e.target.value });
  $('#tuneIn').oninput = (e) => updateSettings({ tuningCents: +e.target.value });
  $('#sensIn').oninput = (e) => updateSettings({ sensitivity: +e.target.value });
  $('#nsIn').oninput = (e) => updateSettings({ noteSpeed: +e.target.value });
  $('#octIn').onchange = (e) => updateSettings({ anyOctave: e.target.checked });
  $('#lenIn').onchange = (e) => updateSettings({ lenientRepeats: e.target.checked });
  $('#calLatBtn').onclick = calibrateLatency;
  $('#calTuneBtn').onclick = calibrateTuning;
}

// Two-tap confirmation without browser dialogs.
function confirmInline(btn, mark = 'Tap again to confirm') {
  if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; return true; }
  btn.dataset.armed = '1';
  btn.dataset.label = btn.textContent;
  if (mark !== '!') btn.textContent = mark;
  setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; } }, 3000);
  return false;
}

async function shareSong(song) {
  const code = await store.encodeShare(song);
  const url = `${location.origin}${location.pathname}#s=${code}`;
  const note = 'Only share melodies you wrote, that are public domain, or that you have permission to share.';
  try {
    if (navigator.share) {
      await navigator.share({ title: `Notefall: ${song.title}`, text: `Play "${song.title}" on Notefall`, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    toast('Link copied. ' + note, 4500);
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    prompt('Copy this link:', url);
  }
}

function exportSong(song) {
  const blob = new Blob([JSON.stringify(store.toFile(song), null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (song.title || 'song').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function handleShareLink() {
  const m = /^#s=([\w-]+)$/.exec(location.hash);
  if (!m) return;
  history.replaceState(null, '', location.pathname);
  try {
    const song = await store.decodeShare(m[1]);
    openSheet(null, song);
  } catch (e) {
    console.error(e);
    toast('That share link looks broken.');
  }
}

wire();
handleShareLink();

// Expose for debugging/tests.
window.__notefall = { audio, store, get game() { return game; }, get editor() { return editor; }, show, hintFor };
