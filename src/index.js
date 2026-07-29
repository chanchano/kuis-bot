require('dotenv').config();
const express = require('express');
const { createBot } = require('./bot');

const TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL; // contoh: https://nama-app.up.railway.app
const USE_WEBHOOK = Boolean(WEBHOOK_URL);

if (!TOKEN) {
  console.error('BOT_TOKEN belum diset di environment variable / file .env');
  process.exit(1);
}

const bot = createBot(TOKEN);
const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Bot kuis Telegram aktif.');
});

async function main() {
  if (USE_WEBHOOK) {
    const secretPath = `/telegraf/${bot.secretPathComponent()}`;
    app.use(bot.webhookCallback(secretPath));
    await bot.telegram.setWebhook(`${WEBHOOK_URL}${secretPath}`);
    app.listen(PORT, () => {
      console.log(`Server berjalan di port ${PORT} (mode webhook)`);
      console.log(`Webhook diset ke: ${WEBHOOK_URL}${secretPath}`);
    });
  } else {
    // Mode polling: cocok untuk development lokal.
    // Tetap buka port kosong agar platform seperti Render (yang butuh port terbuka) tidak mematikan service.
    app.listen(PORT, () => {
      console.log(`Server placeholder berjalan di port ${PORT} (mode polling)`);
    });
    await bot.launch();
    console.log('Bot berjalan dalam mode polling (long polling).');
  }
}

main().catch((err) => {
  console.error('Gagal menjalankan bot:', err);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
