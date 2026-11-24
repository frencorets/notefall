// Monochrome drawings: ivory note blocks with black labels, and simple input icons.
//   D-pad bend  = a plus sign with an arrow      (+↑  / +↓)
//   Stick bend  = a ring with an arrow           (O↑  / O↓)
//   Both        = plus, ring and arrow together  (+O↑ / +O↓)

export const IVORY = '#efeadb';
export const INK = '#151515';

export function roundRect(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, h / 2, w / 2));
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function plus(c, cx, cy, s, col) {
  const t = s * 0.34;
  c.fillStyle = col;
  c.fillRect(cx - t / 2, cy - s / 2, t, s);
  c.fillRect(cx - s / 2, cy - t / 2, s, t);
}

function ring(c, cx, cy, s, col) {
  c.strokeStyle = col;
  c.lineWidth = Math.max(1.5, s * 0.17);
  c.beginPath();
  c.arc(cx, cy, s / 2 - c.lineWidth / 2, 0, Math.PI * 2);
  c.stroke();
}

function arrow(c, cx, cy, s, dir, col) {
  // Vertical arrow, tip up (dir > 0) or down (dir < 0).
  const up = dir > 0;
  const head = s * 0.5;
  const tipY = up ? cy - s / 2 : cy + s / 2;
  const baseY = up ? tipY + head : tipY - head;
  c.fillStyle = col;
  c.beginPath();
  c.moveTo(cx, tipY);
  c.lineTo(cx - s * 0.36, baseY);
  c.lineTo(cx + s * 0.36, baseY);
  c.closePath();
  c.fill();
  const stemW = s * 0.2;
  const stemTop = up ? baseY - 1 : cy - s / 2;
  const stemBot = up ? cy + s / 2 : baseY + 1;
  c.fillRect(cx - stemW / 2, stemTop, stemW, stemBot - stemTop);
}

// Width the icon will take for a given size s (height).
export function modWidth(mod, s) {
  if (!mod || (!mod.pad && !mod.stick)) return 0;
  const parts = (mod.pad ? 1 : 0) + (mod.stick ? 1 : 0);
  return parts * s * 0.95 + s * 0.6;
}

// Draw the bend icon left-aligned at (x, cy) with height s.
export function drawMod(c, x, cy, s, mod, col = INK) {
  if (!mod || (!mod.pad && !mod.stick)) return;
  let cx = x + s / 2;
  const dir = mod.pad || mod.stick;
  if (mod.pad) {
    plus(c, cx, cy, s * 0.82, col);
    cx += s * 0.95;
  }
  if (mod.stick) {
    ring(c, cx, cy, s * 0.82, col);
    cx += s * 0.62;
  } else {
    cx -= s * 0.28;
  }
  arrow(c, cx + s * 0.05, cy, s * 0.82, dir, col);
}

// A note block: ivory card, letter bottom-right, bend icon bottom-left.
// The bottom of the block is the moment to play.
export function drawNoteBlock(c, x, y, w, h, { letter, mod, sub, dim, glow }) {
  c.fillStyle = dim ? 'rgba(239,234,219,0.28)' : IVORY;
  roundRect(c, x, y, w, h, Math.min(10, h / 3));
  c.fill();
  if (glow) {
    c.strokeStyle = '#ffffff';
    c.lineWidth = 3;
    roundRect(c, x, y, w, h, Math.min(10, h / 3));
    c.stroke();
  }
  const ink = dim ? 'rgba(20,20,20,0.55)' : INK;
  const fs = Math.round(Math.min(26, w * 0.3, h * 0.6));
  const base = y + h - Math.max(8, fs * 0.35);
  c.fillStyle = ink;
  c.font = `900 ${fs}px "Arial Black", "Helvetica Neue", Arial, system-ui, sans-serif`;
  c.textAlign = 'right';
  c.textBaseline = 'alphabetic';
  c.fillText(letter, x + w - Math.max(7, w * 0.08), base);
  if (mod && (mod.pad || mod.stick)) {
    const s = Math.round(fs * 0.78);
    drawMod(c, x + Math.max(6, w * 0.07), base - fs * 0.36, s, mod, ink);
  }
  if (sub && h >= 44) {
    c.font = `700 ${Math.max(10, Math.round(fs * 0.45))}px system-ui, -apple-system, sans-serif`;
    c.textAlign = 'right';
    c.fillStyle = dim ? 'rgba(20,20,20,0.45)' : 'rgba(20,20,20,0.6)';
    c.fillText(sub, x + w - Math.max(7, w * 0.08), base - fs - 2);
  }
}

// Kept for older callers: a short block of fixed height.
export function drawNoteHead(c, x, y, w, h, opts) {
  drawNoteBlock(c, x, y, w, h, opts);
}

// Render a standalone example note to a small <canvas> (lesson cards, legend, editor).
export function noteCanvas(cv, { letter, mod, sub }) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.width, h = cv.height;
  cv.style.width = w + 'px';
  cv.style.height = h + 'px';
  cv.width = w * dpr;
  cv.height = h * dpr;
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawNoteBlock(c, 1, 1, w - 2, h - 2, { letter, mod, sub });
}

// The five targets: L and R are rounded bars (shoulder buttons), A Y X are ringed circles.
export function drawTarget(c, cx, cy, size, label, shape, active) {
  if (shape === 'bar') {
    const w = size * 1.75, h = size * 1.15;
    // Outer light frame.
    c.fillStyle = active ? IVORY : 'rgba(239,234,219,0.9)';
    roundRect(c, cx - w / 2 - 3, cy - h / 2 - 3, w + 6, h + 6, 14);
    c.fill();
    c.fillStyle = active ? IVORY : INK;
    roundRect(c, cx - w / 2 + 2, cy - h / 2 + 2, w - 4, h - 4, 10);
    c.fill();
  } else {
    const r = size * 0.78;
    c.beginPath();
    c.arc(cx, cy, r + 3, 0, Math.PI * 2);
    c.fillStyle = 'rgba(239,234,219,0.9)';
    c.fill();
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fillStyle = active ? IVORY : INK;
    c.fill();
    c.beginPath();
    c.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
    c.lineWidth = Math.max(2, r * 0.09);
    c.strokeStyle = active ? INK : IVORY;
    c.stroke();
  }
  c.fillStyle = active ? INK : IVORY;
  c.font = `900 ${Math.round(size * 0.78)}px "Arial Black", "Helvetica Neue", Arial, system-ui, sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(label, cx, cy + 1);
}
