const { Telegraf } = require('telegraf');
const db = require('./db');
const quiz = require('./quizManager');
const { generateAchievementCard } = require('./imageGen');

const RANK_TIERS = [
  { min: 500, name: 'Emas' },
  { min: 200, name: 'Perak' },
  { min: 50, name: 'Perunggu' },
  { min: 0, name: 'Pemula' },
];

function getRankName(points) {
  const tier = RANK_TIERS.find((t) => points >= t.min);
  return tier ? tier.name : 'Pemula';
}

function createBot(token) {
  const bot = new Telegraf(token);

  bot.start((ctx) => {
    db.upsertUser(ctx.from);
    ctx.reply(
      'Halo! Saya bot kuis bahasa Jepang (kanji & kosakata).\n\n'
      + 'Perintah utama:\n'
      + '/kuis - mulai kuis (default: 10 soal, level N5)\n'
      + '/kuis <level> <jumlah> - contoh: /kuis n4 15\n'
      + `Level tersedia: ${quiz.availableLevels().join(', ').toUpperCase()}\n\n`
      + 'Fitur spesial:\n'
      + '/harian - Kuis Harian, soal sama untuk semua orang hari ini\n'
      + '/papanharian - peringkat Kuis Harian hari ini\n'
      + '/ulang - latihan soal yang sering kamu salah jawab\n'
      + '/pencapaian - lihat kartu pencapaian & streak kamu\n\n'
      + 'Lainnya:\n'
      + '/stop - hentikan kuis yang sedang berjalan\n'
      + '/skor - lihat skor kamu\n'
      + '/leaderboard - peringkat keseluruhan',
    );
  });

  bot.command('kuis', (ctx) => {
    const args = ctx.message.text.trim().split(/\s+/).slice(1);
    const level = args[0];
    const count = args[1];

    const result = quiz.startSession(bot, ctx.chat.id, { level, count });

    if (!result.started) {
      if (result.reason === 'active') {
        ctx.reply('Masih ada kuis yang berjalan di chat ini. Ketik /stop untuk menghentikannya dulu.');
      } else if (result.reason === 'invalid_level') {
        ctx.reply(`Level tidak dikenal. Level tersedia: ${quiz.availableLevels().join(', ').toUpperCase()}`);
      }
    }
  });

  bot.command('harian', (ctx) => {
    const today = quiz.todayStr();
    if (db.hasPlayedDaily(ctx.from.id, today)) {
      ctx.reply('Kamu sudah main Kuis Harian hari ini! Ketik /papanharian untuk lihat peringkat, atau balik lagi besok.');
      return;
    }

    const result = quiz.startDailyChallenge(bot, ctx.chat.id);
    if (!result.started && result.reason === 'active') {
      ctx.reply('Masih ada kuis yang berjalan di chat ini. Ketik /stop untuk menghentikannya dulu.');
    }
  });

  bot.command('papanharian', (ctx) => {
    const today = quiz.todayStr();
    const top = db.getDailyLeaderboard(today, 10);
    if (top.length === 0) {
      ctx.reply('Belum ada yang main Kuis Harian hari ini. Ketik /harian untuk jadi yang pertama!');
      return;
    }
    const lines = top.map((row, i) => {
      const name = row.username ? `@${row.username}` : row.first_name;
      return `${i + 1}. ${name} - ${row.points} poin (${row.correct_count} benar)`;
    });
    ctx.reply(`Leaderboard Harian (${today}):\n\n${lines.join('\n')}`);
  });

  bot.command('ulang', (ctx) => {
    const result = quiz.startWeakReview(bot, ctx.chat.id, ctx.from.id);
    if (!result.started) {
      if (result.reason === 'active') {
        ctx.reply('Masih ada kuis yang berjalan di chat ini. Ketik /stop untuk menghentikannya dulu.');
      } else if (result.reason === 'no_weak') {
        ctx.reply('Belum ada data kelemahan kamu. Main /kuis dulu ya — kata yang sering salah otomatis akan masuk ke sini untuk dilatih lagi.');
      }
    }
  });

  bot.command('stop', (ctx) => {
    const stopped = quiz.stopSession(ctx.chat.id);
    ctx.reply(stopped ? 'Kuis dihentikan.' : 'Tidak ada kuis yang sedang berjalan.');
  });

  bot.command('skor', (ctx) => {
    const score = db.getUserScore(ctx.from.id);
    if (!score) {
      ctx.reply('Kamu belum pernah main kuis. Ketik /kuis untuk mulai!');
      return;
    }
    ctx.reply(
      `Skor kamu:\nPoin: ${score.total_points}\nBenar: ${score.total_correct}\nSalah: ${score.total_wrong}`,
    );
  });

  bot.command('leaderboard', (ctx) => {
    const top = db.getLeaderboard(10);
    if (top.length === 0) {
      ctx.reply('Belum ada data leaderboard. Yuk mulai kuis dengan /kuis!');
      return;
    }
    const lines = top.map((row, i) => {
      const name = row.username ? `@${row.username}` : row.first_name;
      return `${i + 1}. ${name} - ${row.total_points} poin (${row.total_correct} benar)`;
    });
    ctx.reply(`Leaderboard:\n\n${lines.join('\n')}`);
  });

  bot.command('pencapaian', async (ctx) => {
    const score = db.getUserScore(ctx.from.id) || { total_points: 0, total_correct: 0, total_wrong: 0 };
    const streak = db.getStreak(ctx.from.id);
    const rank = getRankName(score.total_points);

    try {
      const buffer = generateAchievementCard({
        name: ctx.from.first_name || 'Pemain',
        rank,
        points: score.total_points,
        correct: score.total_correct,
        streak: streak.current_streak,
      });
      if (!buffer) throw new Error('Canvas tidak tersedia');
      await ctx.replyWithPhoto({ source: buffer });
    } catch (err) {
      console.error('Gagal membuat kartu pencapaian, fallback ke teks:', err);
      ctx.reply(
        `Pencapaian ${ctx.from.first_name}:\n`
        + `Rank: ${rank}\n`
        + `Poin: ${score.total_points}\n`
        + `Benar: ${score.total_correct}\n`
        + `Streak sekarang: ${streak.current_streak} hari (terbaik: ${streak.best_streak})`,
      );
    }
  });

  // Setiap pesan teks biasa dicek apakah itu jawaban kuis yang sedang berjalan
  bot.on('text', (ctx, next) => {
    if (quiz.isSessionActive(ctx.chat.id)) {
      const handled = quiz.handleAnswer(bot, ctx);
      if (handled) return;
    }
    return next();
  });

  return bot;
}

module.exports = { createBot };
