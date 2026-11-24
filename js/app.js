// App shell: screens, setup wizard, lessons, library, song sheet, settings, calibration.

import * as audio from './audio.js';
import * as store from './storage.js';
import { Game } from './game.js';
import { Editor } from './editor.js';
import { PROFILES, midiToName, labelFor, hintFor, pitchMatches } from './theory.js';
import { t, setLang, applyI18n, instruction, localNoteName } from './i18n.js';
import { noteCanvas } from './icons.js';
import { CONFIG } from './config.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

let settings = store.getSettings();
let builtinIndex = null;
let currentSong = null; // in-memory song object
let currentSource = null; // 'builtin' | 'mine' | 'shared' | 'editor' | 'lesson'
let currentLesson = null; // lesson number when playing a lesson
let game = null;
let editor = null;
let listenHandle = null;
let tab = 'builtin';
let wizardUnsub = null;

const PAD = PROFILES.pad5;
const modById = (id) => PAD.mods.find((m) => m.id === id);

// ------------------------------------------------------------------ helpers
function show(id) {
  if (listenHandle) stopListen();
  if (wizardUnsub && id !== 'setup') { wizardUnsub(); wizardUnsub = null; }
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  if (id === 'home') renderHome();
  if (id === 'library') renderList();
  if (id === 'lessons') renderLessons();
  if (id === 'settings') renderSettings();
  if (id === 'setup') wizardStep(1);
  window.scrollTo(0, 0);
}

let toastTimer;
function toast(msg, ms = 2800) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const LICENSE_KEY = { 'public-domain': 'rPd', original: 'rOriginal', permission: 'rPerm' };

async function ensureMic() {
  try {
    await audio.startMic(settings);
    return true;
  } catch (e) {
    console.error(e);
    toast(location.protocol === 'file:' ? t('micFile') : t('micBlocked'), 5000);
    return false;
  }
}

function updateSettings(patch) {
  settings = store.setSettings(patch);
  audio.applySettings(settings);
}

// A small example note drawn on a canvas.
function exampleNote(letter, modId, w = 64, h = 46) {
  const lane = PAD.lanes.find((l) => l.label === letter) || PAD.lanes[2];
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  noteCanvas(cv, { color: lane.color, letter: lane.label, mod: modById(modId || '') });
  return cv;
}

// ------------------------------------------------------------------ home
function renderHome() {
  $('#startHereBtn').hidden = !!settings.setupDone;
  $('#learnBtn').classList.toggle('primary', !!settings.setupDone && !lessonsAllDone());
}

function lessonsAllDone() {
  return [1, 2, 3, 4].every((n) => store.getBest(`lesson-${n}`));
}

// ------------------------------------------------------------------ setup wizard
function wizardStep(n) {
  $$('.wstep').forEach((s) => s.classList.toggle('on', +s.dataset.step === n));
  $('#stepCount').textContent = n <= 3 ? t('step', { n }) : '';
  if (n === 2) startButtonCheck();
}

function startButtonCheck() {
  const row = $('#checkRow');
  row.innerHTML = PAD.lanes.map((l, i) => `<span data-i="${i}" style="--c:${l.color}">${l.label}</span>`).join('');
  const heard = new Set();
  if (wizardUnsub) wizardUnsub();
  wizardUnsub = audio.onNotes((events, cur) => {
    const midis = events.filter((e) => e.type === 'on').map((e) => e.midi);
    if (cur) midis.push(cur.midi);
    for (const m of midis) {
      PAD.lanes.forEach((l, i) => {
        if (pitchMatches(m, l.midi, true, 40) && !heard.has(i)) {
          heard.add(i);
          row.children[i].classList.add('ok');
          if (heard.size === 5) setTimeout(() => { if ($('#setup').classList.contains('active')) wizardStep(3); }, 900);
        }
      });
    }
  });
}

function finishSetup() {
  updateSettings({ setupDone: true });
  if (wizardUnsub) { wizardUnsub(); wizardUnsub = null; }
}

// ------------------------------------------------------------------ data
async function loadIndex() {
  if (builtinIndex) return builtinIndex;
  const r = await fetch('songs/index.json');
  builtinIndex = await r.json();
  return builtinIndex;
}

// ------------------------------------------------------------------ lessons
async function renderLessons() {
  const list = $('#lessonList');
  let idx;
  try {
    idx = await loadIndex();
  } catch {
    list.innerHTML = `<p class="muted">${esc(t('loadFail'))}</p>`;
    return;
  }
  list.innerHTML = '';
  for (const e of idx.filter((x) => x.lesson).sort((a, b) => a.lesson - b.lesson)) {
    const done = !!store.getBest(e.id);
    const b = document.createElement('button');
    b.className = 'lesson' + (done ? ' done' : '');
    b.innerHTML = `<span class="num">${done ? '✓' : e.lesson}</span>
      <span><b>${esc(t(`l${e.lesson}t`))}</b><small>${esc(t('lessonN', { n: e.lesson }))}${done ? ' · ' + esc(t('lessonDone')) : ''}</small></span>
      <span class="pic"></span>`;
    const ex = { 1: ['A', ''], 2: ['A', 'padUp'], 3: ['R', 'stickUp'], 4: ['X', 'bothUp'] }[e.lesson];
    b.querySelector('.pic').appendChild(exampleNote(ex[0], ex[1], 58, 40));
    b.onclick = () => openSheet({ ...e, source: 'builtin' }, null, e.lesson);
    list.appendChild(b);
  }
}

// ------------------------------------------------------------------ library
async function renderList() {
  const list = $('#songList');
  $$('.tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === tab));
  list.innerHTML = '';
  let items;
  if (tab === 'builtin') {
    try {
      items = (await loadIndex()).filter((s) => !s.lesson).map((s) => ({ ...s, source: 'builtin' }));
    } catch {
      list.innerHTML = `<p class="muted">${esc(t('loadFail'))}</p>`;
      return;
    }
    items.sort((a, b) => a.difficulty - b.difficulty || a.title.localeCompare(b.title));
    $('#listFoot').textContent = t('libraryFoot');
  } else {
    items = store.getMySongs().map((s) => ({ ...s, source: 'mine', noteCount: s.notes.length }));
    $('#listFoot').innerHTML = items.length ? '' : `${esc(t('noSongs'))} <a href="#" id="mkSong">${esc(t('createOne'))}</a>`;
    const mk = $('#mkSong');
    if (mk) mk.onclick = (e) => { e.preventDefault(); openEditor(null); };
  }
  for (const s of items) {
    const best = store.getBest(s.id);
    const b = document.createElement('button');
    b.className = 'song';
    const d = Math.max(1, Math.min(5, s.difficulty || 1));
    const stars = best ? starsFor(best.accuracy, false) : 0;
    b.innerHTML = `<b>${esc(s.title)}</b>
      <span class="right"><span class="dots">${'●'.repeat(d)}${'○'.repeat(5 - d)}</span><br>${best ? `<span class="badge">${stars ? '★'.repeat(stars) : '✓'}</span>` : ''}</span>
      <span class="sub">${esc(s.composer || '')}${s.year ? ' · ' + esc(s.year) : ''}</span>`;
    b.onclick = () => openSheet(s);
    list.appendChild(b);
  }
}

// ------------------------------------------------------------------ song sheet
async function openSheet(entry, sharedSong = null, lessonNo = null) {
  currentLesson = lessonNo;
  if (sharedSong) {
    currentSong = sharedSong;
    currentSource = 'shared';
  } else if (entry.source === 'builtin') {
    const r = await fetch('songs/' + entry.file);
    currentSong = store.fromFile(await r.json());
    currentSource = lessonNo ? 'lesson' : 'builtin';
  } else {
    currentSong = store.fromFile(entry);
    currentSource = 'mine';
  }
  const s = currentSong;
  const isLesson = !!lessonNo;
  $('#sheetTitle').textContent = isLesson ? `${t('lessonN', { n: lessonNo })}: ${t(`l${lessonNo}t`)}` : s.title;
  const beats = s.notes.length ? s.notes[s.notes.length - 1].t + s.notes[s.notes.length - 1].d : 0;
  const secs = Math.round((beats * 60) / s.bpm);
  $('#sheetMeta').textContent = isLesson ? '' : `${s.composer || ''}${s.year ? ' · ' + s.year : ''} — ${s.notes.length} ${t('notes')} · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const best = store.getBest(s.id);
  $('#sheetBest').textContent = isLesson
    ? (best ? t('lessonDone') : '')
    : best ? `${t('best')}: ${best.score.toLocaleString()} ${'★'.repeat(starsFor(best.accuracy, false))}` : t('notPlayed');
  $('#sheetLicense').textContent = isLesson ? '' : [LICENSE_KEY[s.license] ? t(LICENSE_KEY[s.license]) : '', s.source, s.provenance].filter(Boolean).join(' · ');

  // Lesson card: explanation plus pictures of the new kind of note.
  const pic = $('#sheetPic');
  pic.innerHTML = '';
  pic.hidden = !isLesson;
  $('#sheetLessonText').hidden = !isLesson;
  if (isLesson) {
    $('#sheetLessonText').textContent = t(`l${lessonNo}d`);
    const ex = {
      1: [['L', ''], ['R', ''], ['A', ''], ['Y', ''], ['X', '']],
      2: [['L', 'padUp'], ['A', 'padDown']],
      3: [['R', 'stickUp'], ['L', 'stickDown']],
      4: [['X', 'bothUp'], ['L', 'bothDown']],
    }[lessonNo];
    for (const [letter, mod] of ex) {
      const wrap = document.createElement('div');
      wrap.style.textAlign = 'center';
      wrap.appendChild(exampleNote(letter, mod, lessonNo === 1 ? 54 : 76, 50));
      if (mod) {
        const cap = document.createElement('p');
        cap.className = 'small muted';
        cap.style.margin = '4px 0 0';
        cap.style.maxWidth = '150px';
        cap.textContent = instruction({ mod: modById(mod) }, letter);
        wrap.appendChild(cap);
      }
      pic.appendChild(wrap);
    }
  }
  $('#sheetOptions').hidden = isLesson;
  $('#sheetMore').hidden = isLesson;
  $('#playBtn').textContent = isLesson ? t('startLesson') : t('play');
  renderSpeedSeg();
  $('#waitIn').checked = settings.waitMode;
  $('#editBtn').textContent = currentSource === 'mine' ? t('edit') : t('editCopy');
  $('#deleteBtn').hidden = currentSource !== 'mine';
  $('#saveSharedBtn').hidden = currentSource !== 'shared';
  $('#sheet .back').dataset.go = isLesson ? 'lessons' : currentSource === 'shared' ? 'home' : 'library';
  show('sheet');
}

function renderSpeedSeg() {
  $$('#speedSeg button').forEach((b) => b.classList.toggle('on', Math.abs(+b.dataset.speed - settings.speed) < 0.01));
}

function stopListen() {
  if (listenHandle) listenHandle.stop();
  listenHandle = null;
  $('#listenBtn').textContent = t('listen');
}

// ------------------------------------------------------------------ game
async function startGame() {
  if (!(await ensureMic())) return;
  show('game');
  $('#pauseMenu').hidden = true;
  if (game) game.stop();
  const s = currentLesson ? { ...settings, waitMode: true, speed: 1 } : settings;
  const song = currentLesson ? { ...currentSong, title: t(`l${currentLesson}t`), composer: t('lessonN', { n: currentLesson }) } : currentSong;
  game = new Game($('#gameCanvas'), song, s, { onEnd: showResults });
  game.start();
}

function starsFor(accuracy, practice) {
  if (practice) return 3;
  return accuracy >= 90 ? 3 : accuracy >= 70 ? 2 : accuracy >= 40 ? 1 : 0;
}

function showResults(r) {
  const practice = !currentLesson && (settings.waitMode || settings.speed < 1);
  const stars = starsFor(r.accuracy, practice || !!currentLesson);
  const isNew = currentSource !== 'shared' && (currentLesson || !practice) && store.setBest(currentSong.id, r);
  $('#resStars').innerHTML = [0, 1, 2].map((i) => `<span class="${i < stars ? '' : 'off'}">★</span>`).join('');
  $('#resCheer').textContent = t('cheer' + stars);
  $('#resTitle').textContent = (currentLesson ? t(`l${currentLesson}t`) : currentSong.title) + (practice ? ` · ${t('practiceRun')}` : '');
  $('#resScore').textContent = r.score.toLocaleString();
  $('#resNew').hidden = !isNew || !!currentLesson;
  $('#resStats').innerHTML = `
    <dt>${t('accuracy')}</dt><dd>${r.accuracy}%</dd>
    <dt>${t('perfect')}</dt><dd>${r.counts.perfect}</dd>
    <dt>${t('great')}</dt><dd>${r.counts.great}</dd>
    <dt>${t('good')}</dt><dd>${r.counts.good}</dd>
    <dt>${t('miss')}</dt><dd>${r.counts.miss}</dd>
    <dt>${t('maxCombo')}</dt><dd>${r.maxCombo}</dd>`;
  $('#resStats').hidden = !!currentLesson;
  // Auto-adjust the delay from how early/late the notes were heard.
  let adj = '';
  if (settings.autoDelay !== false && r.timing != null && Math.abs(r.timing) >= 0.02) {
    const next = Math.max(0, Math.min(500, Math.round((settings.latencyMs + r.timing * 1000 * 0.8) / 5) * 5));
    if (next !== settings.latencyMs) {
      updateSettings({ latencyMs: next });
      adj = t('delayAdjusted', { n: next });
    }
  }
  $('#resAdjust').textContent = adj;
  $('#resAdjust').hidden = !adj;
  $('#resNextBtn').textContent = currentLesson
    ? (currentLesson < 4 ? `${t('next')}: ${t(`l${currentLesson + 1}t`)}` : t('playSongs'))
    : currentSource === 'editor' ? t('editorTitle') : t('songs');
  show('results');
}

async function resultsNext() {
  if (currentLesson && currentLesson < 4) {
    const idx = await loadIndex();
    const e = idx.find((x) => x.lesson === currentLesson + 1);
    return openSheet({ ...e, source: 'builtin' }, null, e.lesson);
  }
  if (currentSource === 'editor') return show('editor');
  show(currentSource === 'shared' ? 'home' : 'library');
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
  if (!d.notes.length) return toast(t('addNotes'));
  store.saveMySong(JSON.parse(JSON.stringify(d)));
  editor.dirty = false;
  toast(t('saved'));
}

function stopEditorAudio() {
  if (!editor) return;
  editor.stopPreview(() => ($('#previewBtn').textContent = t('preview')));
  if (editor.recording) editor.stopRecording(recState);
}

function recState(on, added) {
  const b = $('#recordBtn');
  b.classList.toggle('on', on);
  b.textContent = on ? t('stopRec') : t('record');
  if (!on && added != null) toast(added ? t('addedN', { n: added }) : t('noneHeard'));
}

// ------------------------------------------------------------------ settings
function renderSettings() {
  $$('#langSeg button').forEach((b) => b.classList.toggle('on', b.dataset.lang === (settings.lang || 'auto')));
  $$('#profileSeg button').forEach((b) => b.classList.toggle('on', b.dataset.profile === settings.profile));
  $$('#nsSeg button').forEach((b) => b.classList.toggle('on', Math.abs(+b.dataset.ns - settings.noteSpeed) < 30));
  $('#namesIn').checked = !!settings.showNoteNames;
  $('#latIn').value = settings.latencyMs;
  $('#latOut').textContent = `${settings.latencyMs} ms`;
  $('#tuneIn').value = settings.tuningCents;
  $('#tuneOut').textContent = `${settings.tuningCents > 0 ? '+' : ''}${settings.tuningCents}¢`;
  $('#sensIn').value = settings.sensitivity;
  $('#sensOut').textContent = `×${(+settings.sensitivity).toFixed(1)}`;
  $('#octIn').checked = settings.anyOctave;
  $('#lenIn').checked = settings.lenientRepeats;
  $('#autoDelayIn').checked = settings.autoDelay !== false;
  $('#micBtn').hidden = audio.micActive();
  // Legend: every kind of note with its meaning.
  const legend = $('#legend');
  legend.innerHTML = '';
  for (const id of ['', 'padUp', 'padDown', 'stickUp', 'stickDown', 'bothUp', 'bothDown']) {
    const div = document.createElement('div');
    div.appendChild(exampleNote('A', id, 62, 42));
    const span = document.createElement('span');
    span.textContent = instruction({ mod: modById(id) }, 'A');
    div.appendChild(span);
    legend.appendChild(div);
  }
}

// Live tuner (advanced settings).
audio.onNotes((events, cur) => {
  if (!$('#settings').classList.contains('active')) return;
  const raw = audio.tracker.lastRaw;
  const level = raw ? raw.level : audio.tracker.levels[audio.tracker.levels.length - 1] || 0;
  $('#levelBar').style.width = Math.min(100, level * 600) + '%';
  if (cur) {
    $('#tunerNote').textContent = localNoteName(midiToName(cur.midi));
    $('#tunerNeedle').style.left = 50 + cur.cents + '%';
    const h = hintFor(cur.midi, PAD);
    $('#tunerHint').textContent = instruction(h, PAD.lanes[h.lane].label);
  } else {
    $('#tunerNote').textContent = '—';
    $('#tunerHint').textContent = '';
  }
});

// Delay calibration: play a note on each of 8 clicks. Resolves when finished.
async function calibrateLatency() {
  if (!(await ensureMic())) return false;
  return new Promise((resolve) => {
    const bpm = 90, spb = 60 / bpm, countIn = 4, n = 8;
    const t0 = audio.now() + 0.8;
    const clicks = [];
    for (let i = 0; i < countIn + n; i++) {
      const tt = t0 + i * spb;
      audio.click(tt, i < countIn);
      if (i >= countIn) clicks.push(tt);
    }
    const dots = $('#calDots');
    dots.innerHTML = '<i></i>'.repeat(n);
    $('#calTitle').textContent = t('calTitle');
    $('#calText').textContent = t('calText');
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
    const finish = (cancel) => {
      if (done) return;
      done = true;
      unsub();
      $('#calOverlay').hidden = true;
      if (cancel) return resolve(false);
      if (offsets.length < 4) { toast(t('calNotEnough')); return resolve(false); }
      offsets.sort((a, b) => a - b);
      const med = offsets[Math.floor(offsets.length / 2)];
      updateSettings({ latencyMs: Math.max(0, Math.min(500, Math.round((med * 1000) / 5) * 5)) });
      toast(t('calDone', { n: settings.latencyMs }));
      if ($('#settings').classList.contains('active')) renderSettings();
      resolve(true);
    };
    const tick = () => {
      if (done) return;
      const now = audio.now();
      clicks.forEach((c, i) => { if (now >= c && dots.children[i].className !== 'hit') dots.children[i].className = 'on'; });
      if (now > clicks[clicks.length - 1] + 0.8) return finish(false);
      requestAnimationFrame(tick);
    };
    $('#calCancel').onclick = () => finish(true);
    tick();
  });
}

// Tuning calibration: hold one steady note for ~2 seconds.
async function calibrateTuning() {
  if (!(await ensureMic())) return;
  $('#calTitle').textContent = t('tuneTitle');
  $('#calText').textContent = t('tuneText');
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
    if (samples.length < 40) return toast(t('tuneFail'));
    samples.sort((a, b) => a - b);
    const dev = Math.round(samples[Math.floor(samples.length / 2)] * 100);
    updateSettings({ tuningCents: Math.max(-50, Math.min(50, settings.tuningCents + dev)) });
    renderSettings();
    toast(t('tuneDone', { n: `${settings.tuningCents > 0 ? '+' : ''}${settings.tuningCents}` }));
  };
  $('#calCancel').onclick = () => finish(true);
  setTimeout(() => finish(false), 3000);
}

// ------------------------------------------------------------------ wiring
function wire() {
  $$('.donate').forEach((a) => (a.href = CONFIG.donateUrl));
  $('#repoLink').href = CONFIG.repoUrl;

  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (!go) return;
    if (go.hasAttribute('data-new-song')) return openEditor(null);
    show(go.dataset.go);
  });
  $('#startHereBtn').onclick = () => show('setup');
  $$('.tab').forEach((x) => (x.onclick = () => { tab = x.dataset.tab; renderList(); }));

  // Setup wizard.
  $('#wMicBtn').onclick = async () => { if (await ensureMic()) wizardStep(2); };
  $('#w2Next').onclick = () => wizardStep(3);
  $('#w2Skip').onclick = () => wizardStep(3);
  $('#w3Skip').onclick = () => wizardStep(4);
  $('#w3Cal').onclick = async () => { await calibrateLatency(); wizardStep(4); };
  $('#wDone').onclick = () => { finishSetup(); show('lessons'); };

  // Sheet.
  $$('#speedSeg button').forEach((b) => (b.onclick = () => { updateSettings({ speed: +b.dataset.speed }); renderSpeedSeg(); }));
  $('#waitIn').onchange = (e) => updateSettings({ waitMode: e.target.checked });
  $('#playBtn').onclick = startGame;
  $('#listenBtn').onclick = () => {
    if (listenHandle) return stopListen();
    listenHandle = audio.playMelody(currentSong.notes, currentSong.bpm, { speed: currentLesson ? 1 : settings.speed, onEnd: stopListen });
    $('#listenBtn').textContent = t('stop');
  };
  $('#editBtn').onclick = () => {
    const copy = JSON.parse(JSON.stringify(currentSong));
    if (currentSource !== 'mine') {
      copy.id = store.newId();
      if (currentSource === 'builtin') copy.title += ' (2)';
    }
    openEditor(copy);
  };
  $('#deleteBtn').onclick = () => {
    if (!confirmInline($('#deleteBtn'))) return;
    store.deleteMySong(currentSong.id);
    tab = 'mine';
    show('library');
  };
  $('#saveSharedBtn').onclick = () => { store.saveMySong(currentSong); currentSource = 'mine'; toast(t('saved')); $('#saveSharedBtn').hidden = true; $('#deleteBtn').hidden = false; };
  $('#shareBtn').onclick = () => shareSong(currentSong);
  $('#exportBtn').onclick = () => exportSong(currentSong);

  // Game.
  $('#pauseBtn').onclick = () => { if (!game) return; game.pause(); $('#pauseMenu').hidden = false; };
  $('#resumeBtn').onclick = () => { $('#pauseMenu').hidden = true; game.resume(); };
  $('#restartBtn').onclick = () => startGame();
  $('#quitBtn').onclick = () => {
    game.stop();
    game = null;
    show(currentLesson ? 'lessons' : currentSource === 'shared' ? 'sheet' : currentSource === 'editor' ? 'editor' : 'library');
  };
  $('#retryBtn').onclick = () => startGame();
  $('#resNextBtn').onclick = resultsNext;
  document.addEventListener('visibilitychange', () => { if (document.hidden && game && game.running) { game.pause(); $('#pauseMenu').hidden = false; } });

  // Editor.
  $('#editorBack').onclick = () => {
    stopEditorAudio();
    if (editor && editor.dirty && editor.doc.notes.length && !confirmInline($('#editorBack'), '!')) return toast(t('unsaved'));
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
  $('#previewBtn').onclick = () => { readEditorMeta(); editor.togglePreview((on) => ($('#previewBtn').textContent = on ? t('stop') : t('preview'))); };
  $('#recordBtn').onclick = async () => {
    if (editor.recording) return editor.stopRecording(recState);
    if (!(await ensureMic())) return;
    readEditorMeta();
    editor.stopPreview(() => ($('#previewBtn').textContent = t('preview')));
    editor.startRecording({ metronome: $('#edMetro').checked, onState: recState });
    toast(t('countIn'));
  };
  $('#edPlayBtn').onclick = () => {
    const d = readEditorMeta();
    if (!d.notes.length) return toast(t('addNotes'));
    stopEditorAudio();
    currentSong = store.fromFile(store.toFile(d));
    currentSource = 'editor';
    currentLesson = null;
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
      toast(t('imported'));
    } catch {
      toast(t('notSong'));
    }
  };

  // Settings.
  $$('#langSeg button').forEach((b) => (b.onclick = () => {
    updateSettings({ lang: b.dataset.lang });
    setLang(settings.lang);
    applyI18n();
    renderSettings();
  }));
  $$('#profileSeg button').forEach((b) => (b.onclick = () => { updateSettings({ profile: b.dataset.profile }); renderSettings(); }));
  $$('#nsSeg button').forEach((b) => (b.onclick = () => { updateSettings({ noteSpeed: +b.dataset.ns }); renderSettings(); }));
  $('#namesIn').onchange = (e) => updateSettings({ showNoteNames: e.target.checked });
  $('#setupAgainBtn').onclick = () => show('setup');
  $('#micBtn').onclick = async () => { if (await ensureMic()) renderSettings(); };
  $('#latIn').oninput = (e) => { updateSettings({ latencyMs: +e.target.value }); $('#latOut').textContent = `${settings.latencyMs} ms`; };
  $('#tuneIn').oninput = (e) => { updateSettings({ tuningCents: +e.target.value }); $('#tuneOut').textContent = `${settings.tuningCents > 0 ? '+' : ''}${settings.tuningCents}¢`; };
  $('#sensIn').oninput = (e) => { updateSettings({ sensitivity: +e.target.value }); $('#sensOut').textContent = `×${(+settings.sensitivity).toFixed(1)}`; };
  $('#octIn').onchange = (e) => updateSettings({ anyOctave: e.target.checked });
  $('#lenIn').onchange = (e) => updateSettings({ lenientRepeats: e.target.checked });
  $('#autoDelayIn').onchange = (e) => updateSettings({ autoDelay: e.target.checked });
  $('#calLatBtn').onclick = () => calibrateLatency();
  $('#calTuneBtn').onclick = calibrateTuning;
}

// Two-tap confirmation without browser dialogs.
function confirmInline(btn, mark) {
  if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; return true; }
  btn.dataset.armed = '1';
  btn.dataset.label = btn.textContent;
  if (mark !== '!') btn.textContent = t('tapAgain');
  setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; } }, 3000);
  return false;
}

async function shareSong(song) {
  const code = await store.encodeShare(song);
  const url = `${location.origin}${location.pathname}#s=${code}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: `Notefall: ${song.title}`, text: song.title, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    toast(t('linkCopied'), 4500);
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    prompt('Link:', url);
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
    toast(t('brokenLink'));
  }
}

setLang(settings.lang);
applyI18n();
wire();
renderHome();
handleShareLink();

// Expose for debugging/tests.
window.__notefall = { audio, store, get game() { return game; }, get editor() { return editor; }, show, hintFor, labelFor };
