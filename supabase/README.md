# Supabase Migration Plan — Ar-Rahnu Pro

## Status

Migration scaffold siap. App akan support **Supabase bila credentials ada**, tapi fallback ke `localStorage` kalau belum configure.

## Setup Supabase

1. Create project di Supabase.
2. Buka SQL Editor.
3. Run `supabase/schema.sql`.
4. Create Storage bucket:
   - Name: `pawn-ticket-images`
   - Public: false
5. Ambil:
   - Project URL
   - anon public key

## Frontend config

Dalam `index.html`, sebelum `app.js`, set:

```html
<script>
  window.AR_RAHNU_SUPABASE = {
    url: 'https://xxxx.supabase.co',
    anonKey: 'ey...',
    enabled: true
  };
</script>
```

Kalau config tiada / `enabled:false`, app kekal guna localStorage.

## Tables

- `profiles` — user/staff/admin metadata
- `customers` — pelanggan
- `pawn_tickets` — surat gadaian
- `ticket_items` — item emas
- `transactions` — history tebus/overlap/full
- `gold_prices` — harga gadaian rujukan

## Storage

- Bucket: `pawn-ticket-images`
- Store gambar surat gadaian.
- DB field: `pawn_tickets.image_path`.

## Next implementation step

1. Add login screen using Supabase Auth.
2. Save new tickets to Supabase.
3. Load ticket list from Supabase after login.
4. Apply Tebus Keluar transaction to Supabase.
5. Upload image to Supabase Storage.

## Migration from localStorage

After login, app can offer:

```txt
Import local data → Supabase
```

Flow:
1. Read `localStorage` tickets.
2. Upsert customer.
3. Insert pawn ticket.
4. Insert items.
5. Insert transactions.
6. Mark local data as migrated after success.
