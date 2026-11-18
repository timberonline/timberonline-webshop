-- Timber Online 2.0 · TO-BUILD-01 · kernschema
-- Niet-destructief: maakt alleen nieuwe objecten aan.
-- Toegang loopt uitsluitend via de server (service_role). anon/authenticated krijgen geen tabelrechten.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Instellingen en referenties
-- ---------------------------------------------------------------------------
create table if not exists public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.devices (
  slug text primary key,
  name text not null unique,
  family text not null,
  sort int not null default 0
);

-- Fysieke voorraad per stuk (één protector, één hoesje)
create table if not exists public.components (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  kind text not null check (kind in ('protector', 'case')),
  on_hand int not null default 0 check (on_hand >= 0),
  low_stock_threshold int not null default 4 check (low_stock_threshold >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Verkoopbare artikelen: set (tweepack), hoesje of bundel
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  slug text not null unique,
  kind text not null check (kind in ('set', 'case', 'bundle')),
  product_type text not null check (product_type in ('screenprotector', 'privacy', 'hoesje', 'bundel')),
  title text not null,
  subtitle text,
  description text,
  status text not null default 'concept' check (status in ('concept', 'active', 'archived')),
  ean text unique,
  bol_reference text unique,
  bol_offer_id text unique,
  bol_title text,
  bol_title_fix_required boolean not null default false,
  web_enabled boolean not null default true,
  bol_enabled boolean not null default false,
  web_price_cents int not null check (web_price_cents >= 0),
  bol_price_cents int check (bol_price_cents >= 0),
  bol_buffer_units int check (bol_buffer_units >= 0),
  allow_tier_discount boolean not null default true,
  allowed_carriers text[] not null default array['dhl', 'postnl', 'letter'],
  preferred_carrier text not null default 'dhl',
  packed_weight_g int not null default 50 check (packed_weight_g > 0),
  package_format text not null default 'letterbox' check (package_format in ('letter', 'letterbox', 'parcel')),
  image_path text,
  review_note text,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_carriers_valid check (allowed_carriers <@ array['dhl', 'postnl', 'letter'] and cardinality(allowed_carriers) > 0),
  constraint products_preferred_allowed check (preferred_carrier = any (allowed_carriers)),
  constraint products_bundle_web_only check (kind <> 'bundle' or bol_enabled = false)
);

create table if not exists public.product_components (
  product_id uuid not null references public.products (id) on delete cascade,
  component_id uuid not null references public.components (id),
  qty int not null check (qty > 0),
  primary key (product_id, component_id)
);

create table if not exists public.product_devices (
  product_id uuid not null references public.products (id) on delete cascade,
  device_slug text not null references public.devices (slug),
  confirmed boolean not null default true,
  primary key (product_id, device_slug)
);

-- Staffelkorting
create table if not exists public.discount_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  min_qty int not null check (min_qty >= 1),
  discount_type text not null check (discount_type in ('fixed', 'percent')),
  value int not null check (value > 0),
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discount_percent_range check (discount_type <> 'percent' or value between 1 and 90)
);

create table if not exists public.discount_rule_products (
  rule_id uuid not null references public.discount_rules (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  primary key (rule_id, product_id)
);

-- ---------------------------------------------------------------------------
-- Orders en voorraadreserveringen
-- ---------------------------------------------------------------------------
create sequence if not exists public.order_number_seq start 100001;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default ('TO' || nextval('public.order_number_seq')),
  channel text not null check (channel in ('web', 'bol')),
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'paid', 'expired', 'cancelled', 'failed', 'refunded', 'partially_refunded')),
  stock_status text not null default 'reserved'
    check (stock_status in ('reserved', 'committed', 'released', 'shortage')),
  fulfillment_status text not null default 'unfulfilled'
    check (fulfillment_status in ('unfulfilled', 'label_ready', 'shipped', 'delivered', 'ready_for_pickup', 'cancelled', 'returned')),
  email text,
  customer_name text,
  phone text,
  ship_street text,
  ship_house_number text,
  ship_address_extra text,
  ship_postal_code text,
  ship_city text,
  ship_country text,
  shipping_option text not null default 'tracked',
  tracking_promised boolean not null default true,
  subtotal_cents int not null default 0,
  discount_cents int not null default 0,
  shipping_cents int not null default 0,
  total_cents int not null default 0,
  refunded_cents int not null default 0,
  currency text not null default 'eur',
  stripe_session_id text unique,
  stripe_payment_intent_id text,
  payment_method text,
  bol_order_id text unique,
  ship_deadline timestamptz,
  delivery_promise text,
  reserved_until timestamptz,
  paid_at timestamptz,
  cancelled_at timestamptz,
  needs_attention boolean not null default false,
  attention_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_pending_idx on public.orders (reserved_until) where payment_status = 'pending';
create index if not exists orders_created_idx on public.orders (created_at desc);

create table if not exists public.order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id),
  sku text not null,
  title text not null,
  kind text not null,
  qty int not null check (qty > 0),
  unit_price_cents int not null check (unit_price_cents >= 0),
  discount_cents int not null default 0 check (discount_cents >= 0),
  line_total_cents int not null check (line_total_cents >= 0),
  discount_rule_id uuid,
  bol_order_item_id text unique,
  components jsonb not null default '[]'::jsonb,
  stock_committed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists order_lines_order_idx on public.order_lines (order_id);

create table if not exists public.reservations (
  order_id uuid not null references public.orders (id) on delete cascade,
  component_id uuid not null references public.components (id),
  qty int not null check (qty > 0),
  status text not null default 'active' check (status in ('active', 'committed', 'released')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (order_id, component_id)
);
create index if not exists reservations_active_idx on public.reservations (component_id) where status = 'active';

create table if not exists public.stock_movements (
  id bigint generated always as identity primary key,
  component_id uuid not null references public.components (id),
  delta int not null,
  on_hand_after int not null,
  reason text not null,
  order_id uuid references public.orders (id),
  actor text not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists stock_movements_component_idx on public.stock_movements (component_id, created_at desc);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);

create table if not exists public.webhook_events (
  id text primary key,
  source text not null,
  type text not null,
  status text not null default 'received' check (status in ('received', 'processed', 'failed', 'ignored')),
  attempts int not null default 1,
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Retouren en refunds
-- ---------------------------------------------------------------------------
create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  amount_cents int not null check (amount_cents > 0),
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  provider_refund_id text unique,
  idempotency_key text not null unique,
  reason text,
  error text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.returns (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  status text not null default 'open' check (status in ('open', 'closed')),
  note text,
  created_by text not null,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.return_lines (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.returns (id) on delete cascade,
  order_line_id uuid not null references public.order_lines (id),
  qty int not null check (qty > 0),
  decision text not null default 'pending' check (decision in ('pending', 'restock', 'writeoff')),
  decided_by text,
  decided_at timestamptz
);

-- ---------------------------------------------------------------------------
-- bol-synchronisatie (voorraad en prijs) en uitgaande taken
-- ---------------------------------------------------------------------------
create sequence if not exists public.bol_sync_version_seq;

create table if not exists public.bol_sync (
  product_id uuid not null references public.products (id) on delete cascade,
  kind text not null check (kind in ('stock', 'price')),
  desired_value int,
  desired_version bigint not null default 0,
  pushed_value int,
  pushed_version bigint not null default 0,
  status text not null default 'pending' check (status in ('pending', 'in_flight', 'submitted', 'synced', 'failed')),
  attempts int not null default 0,
  last_error text,
  process_id text,
  claim_token uuid,
  claimed_version bigint,
  claimed_value int,
  claimed_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  remote_value int,
  remote_checked_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (product_id, kind)
);

-- Uitgaande taken met idempotentiesleutel (bv. verzendbevestiging naar bol)
create table if not exists public.outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  dedupe_key text not null unique,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'in_flight', 'submitted', 'done', 'failed')),
  attempts int not null default 0,
  last_error text,
  process_id text,
  claim_token uuid,
  claimed_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  done_at timestamptz
);

-- Gesimuleerde bol-omgeving (testmodus); wordt niet gebruikt met een live koppeling
create table if not exists public.bol_sim_offers (
  offer_key text primary key,
  stock int,
  price_cents int,
  update_count int not null default 0,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Verzending
-- ---------------------------------------------------------------------------
create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  carrier text not null check (carrier in ('dhl', 'postnl', 'letter')),
  status text not null default 'draft'
    check (status in ('draft', 'label_ready', 'handed_over', 'in_transit', 'ready_for_pickup', 'delivered', 'exception', 'cancelled')),
  label_status text not null default 'none' check (label_status in ('none', 'creating', 'ready', 'failed')),
  label_source text check (label_source in ('carrier_api', 'simulated', 'uploaded', 'letter')),
  label_path text,
  label_claim_token uuid,
  label_claimed_at timestamptz,
  label_error text,
  carrier_reference text,
  tracking_code text,
  tracking_url text,
  weight_g int,
  package_format text,
  ship_date date not null default ((now() at time zone 'Europe/Amsterdam')::date),
  handed_over_at timestamptz,
  handover_manual boolean not null default false,
  delivered_at timestamptz,
  exception_reason text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists shipments_one_active_per_order on public.shipments (order_id) where status <> 'cancelled';
create index if not exists shipments_ship_date_idx on public.shipments (ship_date);

create table if not exists public.shipment_events (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments (id) on delete cascade,
  event_key text not null unique,
  status text not null,
  source text not null,
  detail text,
  occurred_at timestamptz not null default now()
);

create table if not exists public.email_log (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  kind text not null check (kind in ('order_confirmation', 'shipped')),
  to_email text not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'simulated', 'failed')),
  provider_id text,
  error text,
  claim_token uuid,
  attempts int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, kind)
);

-- ---------------------------------------------------------------------------
-- Beheer
-- ---------------------------------------------------------------------------
create table if not exists public.admin_users (
  user_id uuid primary key,
  email text not null unique,
  role text not null check (role in ('owner', 'admin', 'fulfilment')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_price_proposals (
  id uuid primary key default gen_random_uuid(),
  created_by text not null,
  prompt text not null,
  provider text not null,
  items jsonb not null,
  status text not null default 'proposed' check (status in ('proposed', 'applied', 'cancelled')),
  result jsonb,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text
);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['components', 'products', 'discount_rules', 'orders', 'reservations', 'refunds', 'shipments', 'email_log', 'bol_sync']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated_at()', t || '_touch', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Beveiliging: RLS aan op alle tabellen, geen policies voor anon/authenticated.
-- ---------------------------------------------------------------------------
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- Rechten dichtzetten: alleen service_role (server) mag tabellen, sequences en functies gebruiken.
-- Wordt aan het eind van elke migratie opnieuw aangeroepen.
create or replace function public.lockdown_privileges() returns void
language plpgsql as $fn$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon, authenticated', f.sig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon, authenticated';
    execute 'revoke all on all sequences in schema public from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema public to service_role';
    execute 'grant select, insert, update, delete on all tables in schema public to service_role';
    execute 'grant usage, select on all sequences in schema public to service_role';
  end if;
end $fn$;

-- Opslag (alleen aanwezig in Supabase): productfoto's publiek leesbaar, labels afgeschermd.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('product-images', 'product-images', true, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
    on conflict (id) do nothing;
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('shipping-labels', 'shipping-labels', false, 10485760, array['application/pdf'])
    on conflict (id) do nothing;
  end if;
end $$;

select public.lockdown_privileges();
