# Kuis Bot Telegram — Bahasa Jepang (Kanji & Kosakata)

Bot kuis Telegram terinspirasi dari [kotoba bot](https://github.com/mistval/kotoba), dibangun dengan Node.js + [Telegraf](https://telegraf.js.org/) + SQLite. Dibuat dari nol (bukan port langsung dari kotoba, karena kotoba adalah bot Discord dengan arsitektur besar/multi-service) agar mudah dijalankan sendiri di platform gratis seperti Railway atau Render.

## Fitur

- `/kuis` — mulai kuis (default: 10 soal, level N5), soal ditampilkan sebagai **kartu gambar** (seperti kotoba bot), dengan warna/posisi/rotasi acak tiap soal
- `/kuis <level> <jumlah>` — contoh: `/kuis n4 15` untuk 15 soal level N4
- Level tersedia: N5, N4, N3, N2, N1 (jumlah soal per level: 5–20)
- **Bonus poin kecepatan** — makin cepat jawab, makin besar poinnya (5–20 poin)

### Fitur spesial (tidak ada di kotoba bot)

- **`/harian` — Kuis Harian** gaya Wordle: 5 soal yang sama untuk semua orang di hari yang sama, sekali main per hari. `/papanharian` untuk lihat peringkat hari itu.
- **`/ulang` — Latihan Kelemahan Otomatis**: bot mencatat kata/kanji yang sering kamu jawab salah, lalu `/ulang` membuatkan sesi kuis khusus dari kata-kata itu saja (bukan acak) — belajar makin efektif dan personal.
- **`/pencapaian` — Kartu Pencapaian**: gambar kartu berisi rank (Pemula/Perunggu/Perak/Emas berdasarkan total poin), statistik, dan **streak harian** (berapa hari berturut-turut kamu main).

### Lainnya

- `/stop` — hentikan kuis yang sedang berjalan
- `/skor` — lihat skor pribadi keseluruhan
- `/leaderboard` — peringkat 10 teratas keseluruhan
- Timer 15 detik per soal, jawaban dicek otomatis dari pesan teks biasa
- Skor, kelemahan, skor harian, dan streak disimpan permanen di SQLite (`data/kuis.db`)
- Soal ada di `data/n5.json`, `data/n4.json`, dst. — tinggal tambah entri baru untuk memperbanyak soal per level

## Penting: tambahkan font Jepang untuk kartu gambar

Kartu gambar soal butuh font yang mendukung karakter Jepang, kalau tidak, kanji akan tampil sebagai kotak kosong. Font tidak disertakan di repo ini, jadi tambahkan sendiri (gratis, 2 menit):

1. Buka [Google Fonts — Noto Sans JP](https://fonts.google.com/noto/specimen/Noto+Sans+JP)
2. Klik **"Get font"** → **"Download all"**
3. Ekstrak zip-nya, cari file **`NotoSansJP-Bold.ttf`** (biasanya di folder `static/`)
4. Upload file itu (dengan nama persis `NotoSansJP-Bold.ttf`) ke folder `fonts/` di repo GitHub kamu

Kalau font ini belum ada, bot tetap jalan normal — kanji di gambar hanya tidak akan tampil (kotak kosong). Kalau proses install `canvas` gagal di Railway/Render, bot otomatis fallback ke soal berbentuk teks biasa (tidak crash).

## 1. Jalankan di lokal (development)

Butuh Node.js versi 18 ke atas.

```bash
git clone <url-repo-github-kamu>
cd kuis-bot
npm install
cp .env.example .env
```

Buat bot Telegram dan dapatkan token:
1. Buka Telegram, chat ke **@BotFather**
2. Ketik `/newbot`, ikuti instruksinya
3. Salin token yang diberikan, tempel ke file `.env` pada `BOT_TOKEN=`
4. Biarkan `WEBHOOK_URL` kosong di `.env` untuk mode lokal (bot akan pakai long polling)

Jalankan:

```bash
npm start
```

Bot akan online. Coba chat `/start` ke bot kamu di Telegram.

## 2. Simpan ke GitHub kamu sendiri

```bash
cd kuis-bot
git init
git add .
git commit -m "Initial commit: kuis bot telegram"
git branch -M main
git remote add origin https://github.com/<username-kamu>/<nama-repo>.git
git push -u origin main
```

File `.env` **tidak akan ikut ter-push** (sudah masuk `.gitignore`) — jangan pernah commit token bot ke GitHub.

## 3. Deploy gratis (Railway atau Render)

Bot ini butuh **mode webhook** saat di-deploy (bukan polling), karena hosting gratis biasanya mematikan proses yang tidak membuka port HTTP.

### Opsi A — Railway

1. Buat akun di [railway.app](https://railway.app), buat New Project → Deploy from GitHub repo
2. Pilih repo yang tadi kamu push
3. Railway otomatis mendeteksi Node.js dan menjalankan `npm install` + `npm start`
4. Di tab **Variables**, tambahkan:
   - `BOT_TOKEN` = token bot kamu
   - `WEBHOOK_URL` = URL publik yang diberikan Railway untuk project kamu (misalnya `https://nama-app.up.railway.app`), isi setelah domain muncul di tab **Settings → Networking**
5. Redeploy setelah `WEBHOOK_URL` diisi

### Opsi B — Render

1. Buat akun di [render.com](https://render.com), New → Web Service, hubungkan repo GitHub kamu
2. Render akan membaca `render.yaml` secara otomatis (Build Command: `npm install`, Start Command: `npm start`)
3. Di tab **Environment**, isi:
   - `BOT_TOKEN` = token bot kamu
   - `WEBHOOK_URL` = URL service Render kamu, contoh `https://kuis-bot-telegram.onrender.com`
4. Deploy. Catatan: plan gratis Render akan "tidur" bila tidak ada trafik selama beberapa menit, jadi respon pertama bot setelah idle lama mungkin agak lambat.

Setelah `WEBHOOK_URL` terisi dan service jalan, bot otomatis pindah ke mode webhook (lihat `src/index.js`) — tidak perlu ubah kode apa pun.

## 4. Menambah soal / level baru

Edit atau tambah entri di file JSON yang sesuai di folder `data/` (`n5.json`, `n4.json`, `n3.json`, `n2.json`, `n1.json`), format:

```json
{ "id": 31, "level": "N5", "type": "kanji", "question": "国", "reading": "くに", "meaning": "negara" }
```

Untuk menambah level yang benar-benar baru (di luar N5-N1), buat file JSON baru di `data/` lalu daftarkan di objek `DECKS` pada `src/quizManager.js`.

## Struktur proyek

```
kuis-bot/
├── data/
│   └── n5.json        # bank soal
├── src/
│   ├── bot.js          # command handler Telegram
│   ├── db.js           # SQLite: user, skor, riwayat
│   ├── quizManager.js  # logika sesi kuis & timer
│   └── index.js         # entry point (express + webhook/polling)
├── .env.example
├── render.yaml
└── package.json
```

## Catatan

- Database SQLite disimpan sebagai file lokal (`data/kuis.db`). Di Railway/Render free tier, filesystem bersifat **ephemeral** — artinya data bisa hilang saat service di-redeploy/restart. Untuk data permanen jangka panjang, pertimbangkan upgrade ke storage/volume berbayar, atau pindah ke database eksternal gratis seperti Supabase/Postgres.
- Bot ini didesain untuk grup maupun chat pribadi.
