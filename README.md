# Ar-Rahnu Pro Fresh PWA

Fresh MVP PWA untuk flow Ar-Rahnu baru.

## Features siap

- Dashboard stats + quick actions
- Senarai Surat dengan search/filter
- Detail Surat dengan info, item checklist, history timeline
- Upload Surat dengan camera/gallery preview
- Placeholder OpenAI Vision OCR auto-fill
- Calculator:
  - Tebus sebahagian
  - Overlap / renew
  - Tebus penuh
- localStorage persistence untuk MVP
- PWA manifest + service worker offline cache

## Run local

```bash
cd /root/.openclaw/workspace/ar-rahnu-fresh
python3 -m http.server 18999
```

Open: http://127.0.0.1:18999

## Backend

Backend dah ditambah dalam `backend/`:

- Node.js + Express
- SQLite schema
- Image upload endpoint
- OpenAI Vision OCR endpoint
- Serve frontend + API pada host sama

```bash
cd /root/.openclaw/workspace/ar-rahnu-fresh/backend
cp .env.example .env
npm install
npm run dev
```

Open: http://127.0.0.1:8788

OCR endpoint:

```txt
POST /api/ocr/pawn-ticket
body: multipart/form-data image
returns: extracted ticket fields + item list
```

Jangan letak OpenAI API key dalam frontend. Simpan key di backend `.env`.
