const fs = require('fs');
const path = require('path');
const db = require('./db');
const { generateQuestionCard } = require('./imageGen');

const DECKS = {
  n5: JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'n5.json'), 'utf8')),
  n4: JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'n4.json'), 'utf8')),
  n3: JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'n3.json'), 'utf8')),
  n2: JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'n2.json'), 'utf8')),
  n1: JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'n1.json'), 'utf8')),
};

// Index semua soal by id (dipakai untuk mode /ulang lintas level)
const ALL_QUESTIONS_BY_ID = {};
Object.values(DECKS).forEach((deck) => {
  deck.forEach((q) => { ALL_QUESTIONS_BY_ID[q.id] = q; });
});

// Menyimpan sesi kuis aktif per chatId
const activeSessions = new Map();

const QUESTION_TIME_MS = 15000;
const POINTS_MIN = 5;
const POINTS_MAX = 20;
const DEFAULT_QUESTIONS = 10;
const MIN_QUESTIONS = 5;
const MAX_QUESTIONS = 20;
const DAILY_QUESTION_COUNT = 5;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// PRNG seeded (mulberry32) supaya soal harian sama untuk semua orang di hari yang sama
function hashStringToInt(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (Math.imul(hash, 31) + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let a = seed;
  return function next() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(arr, seedStr) {
  const rng = mulberry32(hashStringToInt(seedStr));
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normalize(str) {
  return String(str).trim().toLowerCase();
}

function buildQuestionQueue(deckName, count) {
  const deck = DECKS[deckName] || DECKS.n5;
  return shuffle(deck).slice(0, Math.min(count, deck.length));
}

function isSessionActive(chatId) {
  return activeSessions.has(chatId);
}

function availableLevels() {
  return Object.keys(DECKS);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Menghitung poin berdasarkan sisa waktu saat menjawab (semakin cepat, semakin besar)
function calculatePoints(elapsedMs) {
  const timeLeftRatio = Math.max(0, Math.min(1, (QUESTION_TIME_MS - elapsedMs) / QUESTION_TIME_MS));
  const points = POINTS_MIN + timeLeftRatio * (POINTS_MAX - POINTS_MIN);
  return Math.round(points);
}

function startSession(bot, chatId, options = {}) {
  if (isSessionActive(chatId)) return { started: false, reason: 'active' };

  const deckName = (options.level || 'n5').toLowerCase();
  if (!DECKS[deckName]) {
    return { started: false, reason: 'invalid_level' };
  }

  let count = Number(options.count) || DEFAULT_QUESTIONS;
  count = Math.max(MIN_QUESTIONS, Math.min(MAX_QUESTIONS, count));

  const queue = buildQuestionQueue(deckName, count);
  const session = {
    queue,
    index: 0,
    timer: null,
    scoredThisQuestion: false,
    questionStartTime: null,
    level: deckName.toUpperCase(),
    mode: 'normal',
    wrongAttemptUsers: new Set(),
  };
  activeSessions.set(chatId, session);

  askNextQuestion(bot, chatId);
  return { started: true };
}

// Kuis Harian: soal sama untuk semua orang pada tanggal yang sama (gaya Wordle)
function startDailyChallenge(bot, chatId) {
  if (isSessionActive(chatId)) return { started: false, reason: 'active' };

  const date = todayStr();
  const pool = Object.values(DECKS).flat();
  const queue = seededShuffle(pool, `daily-${date}`).slice(0, DAILY_QUESTION_COUNT);

  const session = {
    queue,
    index: 0,
    timer: null,
    scoredThisQuestion: false,
    questionStartTime: null,
    level: 'HARIAN',
    mode: 'daily',
    dailyDate: date,
    wrongAttemptUsers: new Set(),
  };
  activeSessions.set(chatId, session);

  askNextQuestion(bot, chatId);
  return { started: true };
}

// Mode Ulang: soal dari kata-kata yang sering salah dijawab oleh user tertentu
function startWeakReview(bot, chatId, userId) {
  if (isSessionActive(chatId)) return { started: false, reason: 'active' };

  const weakRows = db.getWeakQuestionIds(userId, 10);
  const queue = weakRows
    .map((row) => ALL_QUESTIONS_BY_ID[row.question_id])
    .filter(Boolean);

  if (queue.length === 0) return { started: false, reason: 'no_weak' };

  const session = {
    queue,
    index: 0,
    timer: null,
    scoredThisQuestion: false,
    questionStartTime: null,
    level: 'ULANG',
    mode: 'weak',
    wrongAttemptUsers: new Set(),
  };
  activeSessions.set(chatId, session);

  askNextQuestion(bot, chatId);
  return { started: true };
}

function stopSession(chatId) {
  const session = activeSessions.get(chatId);
  if (!session) return false;
  if (session.timer) clearTimeout(session.timer);
  activeSessions.delete(chatId);
  return true;
}

async function askNextQuestion(bot, chatId) {
  const session = activeSessions.get(chatId);
  if (!session) return;

  if (session.index >= session.queue.length) {
    let doneText = 'Kuis selesai! Ketik /leaderboard untuk lihat peringkat, atau /kuis untuk main lagi.';
    if (session.mode === 'daily') {
      doneText = 'Kuis Harian selesai! Ketik /papanharian untuk lihat peringkat hari ini. Sampai jumpa besok!';
    } else if (session.mode === 'weak') {
      doneText = 'Sesi /ulang selesai! Kata yang tadi dijawab benar bebannya berkurang. Ketik /ulang lagi kapan saja.';
    }
    await bot.telegram.sendMessage(chatId, doneText);
    activeSessions.delete(chatId);
    return;
  }

  const q = session.queue[session.index];
  session.scoredThisQuestion = false;
  session.questionStartTime = Date.now();
  session.wrongAttemptUsers = new Set();

  const caption = q.type === 'kanji'
    ? 'Apa arti & bacaan dari kanji ini? Ketik jawabannya (bacaan romaji/hiragana atau arti Bahasa Indonesia). Makin cepat jawab, makin besar poinnya!'
    : 'Apa arti dari kata ini? Makin cepat jawab, makin besar poinnya!';

  try {
    const imageBuffer = generateQuestionCard(q, session.index + 1, session.queue.length);
    if (!imageBuffer) throw new Error('Canvas tidak tersedia');
    await bot.telegram.sendPhoto(
      chatId,
      { source: imageBuffer },
      { caption },
    );
  } catch (err) {
    console.error('Gagal membuat gambar kartu soal, fallback ke teks:', err);
    await bot.telegram.sendMessage(
      chatId,
      `Soal ${session.index + 1}/${session.queue.length} (${session.level})\n\n*${q.question}*\n\n${caption}`,
      { parse_mode: 'Markdown' },
    );
  }

  session.timer = setTimeout(() => {
    handleTimeout(bot, chatId);
  }, QUESTION_TIME_MS);
}

async function handleTimeout(bot, chatId) {
  const session = activeSessions.get(chatId);
  if (!session) return;
  const q = session.queue[session.index];

  if (!session.scoredThisQuestion) {
    await bot.telegram.sendMessage(
      chatId,
      `Waktu habis! Jawaban: *${q.reading}* (${q.meaning})`,
      { parse_mode: 'Markdown' },
    );
  }

  session.index += 1;
  askNextQuestion(bot, chatId);
}

// Dipanggil saat ada pesan teks masuk di chat dengan sesi aktif
function handleAnswer(bot, ctx) {
  const chatId = ctx.chat.id;
  const session = activeSessions.get(chatId);
  if (!session || session.scoredThisQuestion) return false;

  const q = session.queue[session.index];
  const userAnswer = normalize(ctx.message.text);
  const user = ctx.from;

  const validAnswers = [q.reading, q.meaning].map(normalize);
  const isCorrect = validAnswers.some((valid) => valid === userAnswer || (valid.includes(userAnswer) && userAnswer.length >= 2));

  db.upsertUser(user);

  if (!isCorrect) {
    // Catat kelemahan, maksimal 1 kali per soal per user supaya tidak spam
    if (!session.wrongAttemptUsers.has(user.id)) {
      session.wrongAttemptUsers.add(user.id);
      db.recordWrongAnswer(user.id, q.id, q.level);
    }
    return false;
  }

  session.scoredThisQuestion = true;
  if (session.timer) clearTimeout(session.timer);

  const elapsedMs = Date.now() - session.questionStartTime;
  const points = calculatePoints(elapsedMs);
  const seconds = (elapsedMs / 1000).toFixed(1);

  db.addResult({
    userId: user.id,
    chatId,
    question: q.question,
    correct: true,
    points,
  });
  db.reduceWeakness(user.id, q.id);
  const streak = db.updateStreak(user.id);

  if (session.mode === 'daily') {
    db.addDailyResult({
      userId: user.id, date: session.dailyDate, points, correct: true,
    });
  }

  let reply = `Benar, ${user.first_name}! +${points} poin (${seconds} detik). (${q.reading} - ${q.meaning})`;
  if (streak.current_streak > 1) {
    reply += `\nStreak harian: ${streak.current_streak} hari berturut-turut!`;
  }
  ctx.reply(reply);

  session.index += 1;
  askNextQuestion(bot, chatId);
  return true;
}

module.exports = {
  startSession,
  startDailyChallenge,
  startWeakReview,
  stopSession,
  isSessionActive,
  handleAnswer,
  availableLevels,
  todayStr,
  DECKS,
};
