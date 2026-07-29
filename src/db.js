const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'kuis.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT
  );

  CREATE TABLE IF NOT EXISTS scores (
    user_id INTEGER PRIMARY KEY,
    total_correct INTEGER DEFAULT 0,
    total_wrong INTEGER DEFAULT 0,
    total_points INTEGER DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES users(user_id)
  );

  CREATE TABLE IF NOT EXISTS quiz_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    chat_id INTEGER,
    question TEXT,
    correct INTEGER,
    points INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS word_weakness (
    user_id INTEGER,
    question_id INTEGER,
    level TEXT,
    wrong_count INTEGER DEFAULT 0,
    last_wrong_at DATETIME,
    PRIMARY KEY (user_id, question_id)
  );

  CREATE TABLE IF NOT EXISTS daily_scores (
    date TEXT,
    user_id INTEGER,
    points INTEGER DEFAULT 0,
    correct_count INTEGER DEFAULT 0,
    PRIMARY KEY (date, user_id)
  );

  CREATE TABLE IF NOT EXISTS user_streak (
    user_id INTEGER PRIMARY KEY,
    current_streak INTEGER DEFAULT 0,
    best_streak INTEGER DEFAULT 0,
    last_active_date TEXT
  );
`);

function upsertUser(user) {
  db.prepare(`
    INSERT INTO users (user_id, username, first_name)
    VALUES (@id, @username, @first_name)
    ON CONFLICT(user_id) DO UPDATE SET username = @username, first_name = @first_name
  `).run({ id: user.id, username: user.username || null, first_name: user.first_name || '' });

  db.prepare(`
    INSERT INTO scores (user_id) VALUES (?)
    ON CONFLICT(user_id) DO NOTHING
  `).run(user.id);
}

function addResult({ userId, chatId, question, correct, points }) {
  db.prepare(`
    INSERT INTO quiz_log (user_id, chat_id, question, correct, points)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, chatId, question, correct ? 1 : 0, points);

  if (correct) {
    db.prepare(`
      UPDATE scores SET total_correct = total_correct + 1, total_points = total_points + ?
      WHERE user_id = ?
    `).run(points, userId);
  } else {
    db.prepare(`
      UPDATE scores SET total_wrong = total_wrong + 1
      WHERE user_id = ?
    `).run(userId);
  }
}

function getLeaderboard(limit = 10) {
  return db.prepare(`
    SELECT u.first_name, u.username, s.total_points, s.total_correct, s.total_wrong
    FROM scores s
    JOIN users u ON u.user_id = s.user_id
    ORDER BY s.total_points DESC
    LIMIT ?
  `).all(limit);
}

function getUserScore(userId) {
  return db.prepare(`
    SELECT s.total_points, s.total_correct, s.total_wrong
    FROM scores s WHERE s.user_id = ?
  `).get(userId);
}

// --- Sistem kelemahan otomatis ---

function recordWrongAnswer(userId, questionId, level) {
  db.prepare(`
    INSERT INTO word_weakness (user_id, question_id, level, wrong_count, last_wrong_at)
    VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, question_id) DO UPDATE SET
      wrong_count = wrong_count + 1,
      last_wrong_at = CURRENT_TIMESTAMP
  `).run(userId, questionId, level);
}

function reduceWeakness(userId, questionId) {
  db.prepare(`
    UPDATE word_weakness SET wrong_count = MAX(wrong_count - 1, 0)
    WHERE user_id = ? AND question_id = ?
  `).run(userId, questionId);
}

function getWeakQuestionIds(userId, limit = 10) {
  return db.prepare(`
    SELECT question_id, level, wrong_count FROM word_weakness
    WHERE user_id = ? AND wrong_count > 0
    ORDER BY wrong_count DESC, last_wrong_at DESC
    LIMIT ?
  `).all(userId, limit);
}

// --- Kuis harian ---

function hasPlayedDaily(userId, date) {
  const row = db.prepare('SELECT 1 FROM daily_scores WHERE user_id = ? AND date = ?').get(userId, date);
  return Boolean(row);
}

function addDailyResult({ userId, date, points, correct }) {
  db.prepare(`
    INSERT INTO daily_scores (date, user_id, points, correct_count)
    VALUES (@date, @userId, @points, @correct)
    ON CONFLICT(date, user_id) DO UPDATE SET
      points = points + @points,
      correct_count = correct_count + @correct
  `).run({ date, userId, points, correct: correct ? 1 : 0 });
}

function getDailyLeaderboard(date, limit = 10) {
  return db.prepare(`
    SELECT u.first_name, u.username, d.points, d.correct_count
    FROM daily_scores d
    JOIN users u ON u.user_id = d.user_id
    WHERE d.date = ?
    ORDER BY d.points DESC
    LIMIT ?
  `).all(date, limit);
}

// --- Streak harian ---

function updateStreak(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const row = db.prepare('SELECT * FROM user_streak WHERE user_id = ?').get(userId);

  if (!row) {
    db.prepare(`
      INSERT INTO user_streak (user_id, current_streak, best_streak, last_active_date)
      VALUES (?, 1, 1, ?)
    `).run(userId, today);
    return { current_streak: 1, best_streak: 1 };
  }

  if (row.last_active_date === today) {
    return { current_streak: row.current_streak, best_streak: row.best_streak };
  }

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const newStreak = row.last_active_date === yesterday ? row.current_streak + 1 : 1;
  const bestStreak = Math.max(newStreak, row.best_streak);

  db.prepare(`
    UPDATE user_streak SET current_streak = ?, best_streak = ?, last_active_date = ?
    WHERE user_id = ?
  `).run(newStreak, bestStreak, today, userId);

  return { current_streak: newStreak, best_streak: bestStreak };
}

function getStreak(userId) {
  const row = db.prepare('SELECT current_streak, best_streak FROM user_streak WHERE user_id = ?').get(userId);
  return row || { current_streak: 0, best_streak: 0 };
}

module.exports = {
  upsertUser,
  addResult,
  getLeaderboard,
  getUserScore,
  recordWrongAnswer,
  reduceWeakness,
  getWeakQuestionIds,
  hasPlayedDaily,
  addDailyResult,
  getDailyLeaderboard,
  updateStreak,
  getStreak,
};
