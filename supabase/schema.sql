-- Ar-Rahnu Pro Supabase schema
-- Run this in Supabase SQL Editor.

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'staff' check (role in ('admin','staff','user')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id),
  name text not null,
  ic text,
  phone text,
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pawn_tickets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id),
  customer_id uuid not null references public.customers(id) on delete cascade,
  ticket_no text not null,
  principal numeric(12,2) not null default 0,
  remaining_principal numeric(12,2) not null default 0,
  gold_price numeric(10,2) not null default 0,
  rate numeric(8,4) not null default 0.75,
  rate_mode text not null default 'month' check (rate_mode in ('month','year')),
  start_date date not null default current_date,
  tenure integer not null default 6,
  status text not null default 'active' check (status in ('active','warning','overdue','redeemed')),
  image_path text,
  ocr_raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, ticket_no)
);

create table if not exists public.ticket_items (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.pawn_tickets(id) on delete cascade,
  description text not null,
  weight_gram numeric(10,3) not null default 0,
  value numeric(12,2) not null default 0,
  redeemed boolean not null default false,
  redeemed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.pawn_tickets(id) on delete cascade,
  type text not null,
  amount numeric(12,2) not null default 0,
  upah_amount numeric(12,2) not null default 0,
  total_paid numeric(12,2) not null default 0,
  cash_out numeric(12,2) not null default 0,
  item_ids uuid[] not null default '{}',
  meta jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.gold_prices (
  id uuid primary key default gen_random_uuid(),
  bank_id text not null,
  bank_name text not null,
  purity text not null,
  price_per_gram numeric(10,2),
  source text,
  recorded_at timestamptz not null default now(),
  unique(bank_id, purity, recorded_at)
);

create index if not exists idx_customers_owner on public.customers(owner_id);
create index if not exists idx_tickets_owner on public.pawn_tickets(owner_id);
create index if not exists idx_tickets_customer on public.pawn_tickets(customer_id);
create index if not exists idx_items_ticket on public.ticket_items(ticket_id);
create index if not exists idx_transactions_ticket on public.transactions(ticket_id);

alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.pawn_tickets enable row level security;
alter table public.ticket_items enable row level security;
alter table public.transactions enable row level security;
alter table public.gold_prices enable row level security;

create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

create policy "customers_owner_all" on public.customers for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "tickets_owner_all" on public.pawn_tickets for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "items_owner_all" on public.ticket_items for all using (
  exists (select 1 from public.pawn_tickets t where t.id = ticket_items.ticket_id and t.owner_id = auth.uid())
) with check (
  exists (select 1 from public.pawn_tickets t where t.id = ticket_items.ticket_id and t.owner_id = auth.uid())
);
create policy "transactions_owner_all" on public.transactions for all using (
  exists (select 1 from public.pawn_tickets t where t.id = transactions.ticket_id and t.owner_id = auth.uid())
) with check (
  exists (select 1 from public.pawn_tickets t where t.id = transactions.ticket_id and t.owner_id = auth.uid())
);
create policy "gold_prices_read_all" on public.gold_prices for select using (true);

insert into public.gold_prices (bank_id, bank_name, purity, price_per_gram, source, recorded_at) values
('bank-rakyat', 'Bank Rakyat — Ar-Rahnu X''Change', '999', 669.50, 'hargaemas.com.my/ar-rahnu', '2026-05-07'),
('bank-rakyat', 'Bank Rakyat — Ar-Rahnu X''Change', '916', 613.71, 'hargaemas.com.my/ar-rahnu', '2026-05-07'),
('bank-rakyat', 'Bank Rakyat — Ar-Rahnu X''Change', '835', 557.92, 'hargaemas.com.my/ar-rahnu', '2026-05-07'),
('bank-rakyat', 'Bank Rakyat — Ar-Rahnu X''Change', '750', 502.13, 'hargaemas.com.my/ar-rahnu', '2026-05-07'),
('muamalat', 'Bank Muamalat', '999', 652.16, 'hargaemas.com.my/ar-rahnu', '2026-05-07'),
('muamalat', 'Bank Muamalat', '916', 597.98, 'hargaemas.com.my/ar-rahnu', '2026-05-07'),
('muamalat', 'Bank Muamalat', '835', 545.10, 'hargaemas.com.my/ar-rahnu', '2026-05-07'),
('muamalat', 'Bank Muamalat', '750', 489.61, 'hargaemas.com.my/ar-rahnu', '2026-05-07')
on conflict do nothing;

-- Storage bucket: create from Supabase Dashboard or run if storage schema available:
-- insert into storage.buckets (id, name, public) values ('pawn-ticket-images', 'pawn-ticket-images', false) on conflict do nothing;
