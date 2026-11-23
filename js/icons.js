// Canvas drawings for controller inputs: D-pad with a lit arm, stick with a ringed arrow.
// Shared by the game, lesson cards and the settings legend.

export const UP = '#ffd36b';
export const DOWN = '#6cc4ff';
const DARK = '#17132f';
const CROSS = 'rgba(255,255,255,0.42)';

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

function dpad(c, x, y, r, dir) {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fillStyle = DARK;
  c.fill();
  const arm = r * 0.36; // half-thickness
  const len = r * 0.72;
  c.fillStyle = CROSS;
  roundRect(c, x - arm, y - len, arm * 2, len * 2, arm * 0.5);
  c.fill();
  roundRect(c, x - len, y - arm, len * 2, arm * 2, arm * 0.5);
  c.fill();
  if (dir) {
    c.fillStyle = dir > 0 ? UP : DOWN;
    const top = dir > 0 ? y - len : y + arm * 0.6;
    roundRect(c, x - arm, top, arm * 2, len - arm * 0.6, arm * 0.5);
    c.fill();
  }
}

function stick(c, x, y, r, dir) {
  const col = dir > 0 ? UP : DOWN;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fillStyle = DARK;
  c.fill();
  c.lineWidth = Math.max(1.5, r * 0.16);
  c.strokeStyle = col;
  c.beginPath();
  c.arc(x, y, r * 0.86, 0, Math.PI * 2);
  c.stroke();
  // Arrow.
  const s = dir > 0 ? -1 : 1;
  c.fillStyle = col;
  c.beginPath();
  c.moveTo(x, y + s * r * 0.62);
  c.lineTo(x - r * 0.42, y + s * r * 0.05);
  c.lineTo(x + r * 0.42, y + s * r * 0.05);
  c.closePath();
  c.fill();
  // Stem on the opposite side of the arrow head.
  const stemTop = dir > 0 ? y - r * 0.1 : y - r * 0.5;
  c.fillRect(x - r * 0.14, stemTop, r * 0.28, r * 0.6);
}

// Draw the modifier for a hint. Returns nothing if no modifier.
export function drawMod(c, x, y, r, mod) {
  if (!mod || (!mod.pad && !mod.stick)) return;
  if (mod.pad && mod.stick) {
    dpad(c, x, y, r, mod.pad);
    stick(c, x + r * 0.85, y - r * 0.85, r * 0.62, mod.stick);
  } else if (mod.pad) dpad(c, x, y, r, mod.pad);
  else stick(c, x, y, r, mod.stick);
}

// A note head block: rounded block with button letter and optional modifier icon.
export function drawNoteHead(c, x, y, w, h, { color, letter, mod, sub, dim }) {
  c.fillStyle = dim ? 'rgba(110,110,130,0.55)' : color;
  roundRect(c, x, y, w, h, Math.min(12, h / 3));
  c.fill();
  c.fillStyle = 'rgba(255,255,255,0.28)';
  roundRect(c, x + 4, y + 3, w - 8, Math.min(8, h * 0.18), 4);
  c.fill();
  const hasMod = mod && (mod.pad || mod.stick);
  const r = Math.min(h * 0.36, w * 0.24);
  const letterX = hasMod ? x + w - Math.max(w * 0.26, 13) : x + w / 2;
  if (hasMod) drawMod(c, x + r + Math.max(3, w * 0.06), y + h / 2 + (sub ? -3 : 0) + (mod.pad && mod.stick ? r * 0.15 : 0), r * (mod.pad && mod.stick ? 0.85 : 1), mod);
  c.fillStyle = dim ? '#ddd' : DARK;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const fs = Math.round(Math.min(h * 0.5, w * 0.34));
  c.font = `800 ${fs}px system-ui, -apple-system, sans-serif`;
  c.fillText(letter, letterX, y + h / 2 + (sub ? -5 : 1));
  if (sub) {
    c.font = `700 ${Math.round(Math.min(11, h * 0.24))}px system-ui, -apple-system, sans-serif`;
    c.fillText(sub, hasMod ? x + w / 2 : letterX, y + h - 9);
  }
}

// Render a standalone example note to a small <canvas> (lesson cards, legend).
export function noteCanvas(cv, { color, letter, mod, sub }) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.width, h = cv.height;
  cv.style.width = w + 'px';
  cv.style.height = h + 'px';
  cv.width = w * dpr;
  cv.height = h * dpr;
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawNoteHead(c, 2, 2, w - 4, h - 4, { color, letter, mod, sub });
}
