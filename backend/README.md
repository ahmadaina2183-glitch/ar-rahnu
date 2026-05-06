# Ar-Rahnu Fresh Backend

Backend MVP: Node.js + Express + SQLite + image upload + OpenAI Vision OCR endpoint.

## Setup

```bash
cd /root/.openclaw/workspace/ar-rahnu-fresh/backend
cp .env.example .env
npm install
```

Edit `.env`:

```env
PORT=8788
DATABASE_PATH=./arrahnu.sqlite
UPLOAD_DIR=./uploads
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.5
```

> API key simpan backend sahaja. Jangan letak dalam frontend.

## Run

```bash
npm run dev
# buka http://127.0.0.1:8788
```

Backend serve PWA frontend dari parent folder, jadi `/api/...` dan app berada pada host sama.

## Endpoints

- `GET /api/health`
- `GET /api/tickets`
- `GET /api/tickets/:id`
- `POST /api/tickets`
- `POST /api/upload` — multipart `image`
- `POST /api/ocr/pawn-ticket` — multipart `image`, panggil OpenAI Vision kalau `OPENAI_API_KEY` ada

Kalau `OPENAI_API_KEY` belum diset, OCR endpoint return fallback kosong supaya flow app masih boleh test.

## Database

SQLite file default: `backend/arrahnu.sqlite`.
Schema: `backend/schema.sql`.
