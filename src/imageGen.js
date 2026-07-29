const path = require('path');
const fs = require('fs');

let canvasLib = null;
try {
  // eslint-disable-next-line global-require
  canvasLib = require('canvas');
} catch (err) {
  console.warn('Modul "canvas" tidak tersedia, kartu soal bergambar dinonaktifkan (fallback ke teks).');
}

const FONT_PATH = path.join(__dirname, '..', 'fonts', 'NotoSansJP-Bold.ttf');
let fontRegistered = false;

function ensureFont() {
  if (!canvasLib || fontRegistered) return;
  if (fs.existsSync(FONT_PATH)) {
    canvasLib.registerFont(FONT_PATH, { family: 'NotoSansJP' });
    fontRegistered = true;
  } else {
    console.warn(
      'Font Jepang tidak ditemukan di fonts/NotoSansJP-Bold.ttf. '
      + 'Karakter kanji mungkin tidak tampil di gambar kartu. Lihat README untuk cara menambahkannya.',
    );
  }
}

const LEVEL_COLORS = {
  N5: '#4cc9f0',
  N4: '#4895ef',
  N3: '#4361ee',
  N2: '#7209b7',
  N1: '#f72585',
};

// Beberapa palet gradient berbeda, dipilih acak tiap soal
const BG_PALETTES = [
  ['#101828', '#1e2749'],
  ['#1a1030', '#3a1c52'],
  ['#0f2027', '#203a43'],
  ['#2c0b3f', '#5b1a52'],
  ['#0d1b2a', '#1b263b'],
  ['#1c1c1c', '#3c1053'],
];

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function generateQuestionCard(q, questionNumber, totalQuestions) {
  if (!canvasLib) return null;
  ensureFont();

  const width = 900;
  const height = 560;
  const canvas = canvasLib.createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background gradient acak per soal
  const palette = BG_PALETTES[Math.floor(Math.random() * BG_PALETTES.length)];
  const angle = randomBetween(0, Math.PI * 2);
  const x0 = width / 2 + Math.cos(angle) * width;
  const y0 = height / 2 + Math.sin(angle) * height;
  const x1 = width / 2 - Math.cos(angle) * width;
  const y1 = height / 2 - Math.sin(angle) * height;
  const bg = ctx.createLinearGradient(x0, y0, x1, y1);
  bg.addColorStop(0, palette[0]);
  bg.addColorStop(1, palette[1]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Grain/noise tipis biar tidak gampang di-reverse-image-search
  const dotCount = 250;
  for (let i = 0; i < dotCount; i += 1) {
    ctx.fillStyle = `rgba(255,255,255,${randomBetween(0.01, 0.05).toFixed(3)})`;
    const r = randomBetween(0.5, 1.8);
    ctx.beginPath();
    ctx.arc(Math.random() * width, Math.random() * height, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Card border
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 3;
  ctx.strokeRect(24, 24, width - 48, height - 48);

  // Level badge
  const levelColor = LEVEL_COLORS[q.level] || '#4cc9f0';
  ctx.fillStyle = levelColor;
  roundRect(ctx, 48, 48, 120, 44, 12);
  ctx.fill();
  ctx.fillStyle = '#0b1020';
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(q.level, 108, 72);

  // Question counter (top right)
  ctx.fillStyle = '#ffffff';
  ctx.font = '24px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`${questionNumber} / ${totalQuestions}`, width - 48, 72);

  // Main question text (kanji/vocab) — posisi & rotasi sedikit acak
  const fontFamily = fontRegistered ? 'NotoSansJP' : 'sans-serif';
  const fontSize = q.question.length > 3 ? 90 : 150;
  const jitterX = randomBetween(-15, 15);
  const jitterY = randomBetween(-15, 15);
  const rotation = randomBetween(-0.06, 0.06); // radian, sekitar -3.4° s/d 3.4°

  ctx.save();
  ctx.translate(width / 2 + jitterX, height / 2 + 10 + jitterY);
  ctx.rotate(rotation);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${fontSize}px ${fontFamily}`;
  ctx.fillText(q.question, 0, 0);
  ctx.restore();

  // Footer hint
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '22px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Ketik bacaan atau arti kata ini di chat', width / 2, height - 60);

  return canvas.toBuffer('image/png');
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const RANK_STYLES = {
  Pemula: { color: '#8d99ae', glow: 'rgba(141,153,174,0.35)' },
  Perunggu: { color: '#cd7f32', glow: 'rgba(205,127,50,0.35)' },
  Perak: { color: '#c0c0c0', glow: 'rgba(192,192,192,0.35)' },
  Emas: { color: '#ffd700', glow: 'rgba(255,215,0,0.35)' },
};

function generateAchievementCard(data) {
  if (!canvasLib) return null;
  ensureFont();

  const width = 900;
  const height = 500;
  const canvas = canvasLib.createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#0b0f1a');
  bg.addColorStop(1, '#1a1030');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const rankStyle = RANK_STYLES[data.rank] || RANK_STYLES.Pemula;

  // Glow lingkaran di belakang badge
  const glow = ctx.createRadialGradient(width / 2, 190, 20, width / 2, 190, 220);
  glow.addColorStop(0, rankStyle.glow);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  // Border kartu
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 3;
  ctx.strokeRect(24, 24, width - 48, height - 48);

  // Badge lingkaran rank
  ctx.beginPath();
  ctx.arc(width / 2, 180, 90, 0, Math.PI * 2);
  ctx.fillStyle = rankStyle.color;
  ctx.fill();

  ctx.fillStyle = '#0b0f1a';
  ctx.font = 'bold 40px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(data.rank.toUpperCase(), width / 2, 180);

  // Nama pengguna
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText(data.name, width / 2, 320);

  // Statistik
  ctx.font = '26px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  const statsLine = `${data.points} poin  •  ${data.correct} benar  •  🔥 ${data.streak} hari streak`;
  ctx.fillText(statsLine, width / 2, 380);

  // Footer
  ctx.font = '20px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText('Kartu Pencapaian Kuis Bahasa Jepang', width / 2, height - 50);

  return canvas.toBuffer('image/png');
}

module.exports = { generateQuestionCard, generateAchievementCard };
