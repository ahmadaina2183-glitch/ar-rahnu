# Ar-Rahnu Database Plan

## Current MVP: localStorage

Untuk fasa paling cepat, app guna `localStorage` dalam browser.

**Kenapa:**
- Paling senang dan cepat test flow
- Tak perlu setup server/database dulu
- Sesuai untuk validate UI, calculator, upload gambar, dan form
- Data kekal dalam device/browser user

**Limit:**
- Data tidak sync antara device
- Storage browser terhad, especially gambar besar
- Tiada multi-user/admin
- Susah buat backup/audit production

## Next recommended: SQLite + Backend

Bila flow dah confirm, pindah ke backend ringan:

- Node.js + Express
- SQLite untuk MVP server-side
- Upload gambar simpan dalam `uploads/`
- Metadata simpan dalam SQLite
- Endpoint OCR Vision panggil OpenAI dari backend

## Production later: PostgreSQL

Kalau nak multi-user, branch, role admin/staff, audit log, reporting besar:

- PostgreSQL
- Object storage untuk gambar (S3/R2/local VPS storage)
- Auth + role permission
- Audit log setiap transaction

## Suggested tables

```sql
customers(id, name, ic, phone, address, created_at)
pawn_tickets(id, ticket_no, customer_id, principal, remaining_principal,
             gold_price, rate, rate_mode, start_date, tenure, status,
             image_path, ocr_raw_json, created_at, updated_at)
ticket_items(id, ticket_id, description, weight_gram, value, redeemed, redeemed_at)
transactions(id, ticket_id, type, amount, upah_amount, total_paid, item_ids_json, created_at)
```
