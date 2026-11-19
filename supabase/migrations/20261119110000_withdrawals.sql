-- Timber Online 2.0 · online herroepingsfunctie ("herroepingsknop")
--
-- Art. 11a Richtlijn 2011/83/EU (ingevoegd door Richtlijn (EU) 2023/2673, van toepassing vanaf 19-06-2026): bij een
-- overeenkomst via een online interface kan de consument via een doorlopend beschikbare functie herroepen en krijgt hij
-- onverwijld een ontvangstbevestiging op een duurzame gegevensdrager met de inhoud en datum en tijd van indiening.
--
-- Een herroepingsverklaring wordt altijd vastgelegd, ook als ordernummer en e-mailadres niet bij een order passen
-- (dan handmatig beoordelen). De order zelf wordt niet vergrendeld of gewijzigd: afhandeling (retour, refund) loopt via
-- de bestaande functies in beheer.

create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  order_id uuid references public.orders (id),
  order_number text not null,
  name text not null,
  email text not null,
  scope text not null check (scope in ('all', 'partial')),
  items text,
  note text,
  submitted_at timestamptz not null default now(),
  ack_status text not null default 'pending' check (ack_status in ('pending', 'sending', 'sent', 'simulated', 'failed')),
  ack_provider_id text,
  ack_error text,
  ack_sent_at timestamptz,
  status text not null default 'received' check (status in ('received', 'handled', 'rejected')),
  handled_at timestamptz,
  handled_by text,
  handled_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists withdrawals_order_idx on public.withdrawals (order_id);
create index if not exists withdrawals_open_idx on public.withdrawals (submitted_at) where status = 'received';
alter table public.withdrawals enable row level security;

drop trigger if exists withdrawals_touch on public.withdrawals;
create trigger withdrawals_touch before update on public.withdrawals
  for each row execute function public.touch_updated_at();

-- Vastleggen. Geeft geen informatie terug over het al dan niet bestaan van de order (geen opsomming van ordernummers).
create or replace function public.api_withdrawal_submit(p jsonb) returns jsonb
language plpgsql as $$
declare
  v_number text := upper(regexp_replace(coalesce(p->>'order_number', ''), '\s', '', 'g'));
  v_email text := lower(trim(coalesce(p->>'email', '')));
  v_name text := trim(coalesce(p->>'name', ''));
  v_scope text := coalesce(nullif(p->>'scope', ''), 'all');
  v_order uuid;
  w public.withdrawals%rowtype;
begin
  if v_number = '' or v_email = '' or v_name = '' or v_scope not in ('all', 'partial')
     or length(v_name) > 120 or length(v_email) > 160 or length(v_number) > 40
     or length(coalesce(p->>'items', '')) > 1000 or length(coalesce(p->>'note', '')) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  select id into v_order from public.orders
   where number = v_number and channel = 'web' and lower(email) = v_email;
  insert into public.withdrawals (reference, order_id, order_number, name, email, scope, items, note)
  values ('HR-' || to_char(now() at time zone 'Europe/Amsterdam', 'YYYYMMDD') || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 6)),
          v_order, v_number, v_name, v_email, v_scope, nullif(trim(coalesce(p->>'items', '')), ''), nullif(trim(coalesce(p->>'note', '')), ''))
  returning * into w;
  perform public.audit('klant:herroepingsformulier', 'withdrawal_received', 'withdrawal', w.id::text, null,
                       jsonb_build_object('reference', w.reference, 'order_number', w.order_number, 'matched', v_order is not null,
                                          'scope', w.scope));
  return jsonb_build_object('ok', true, 'id', w.id, 'reference', w.reference, 'submitted_at', w.submitted_at);
end $$;

-- Ontvangstbevestiging: claim (één keer versturen) en afronden.
create or replace function public.api_withdrawal_ack_claim(p jsonb) returns jsonb
language plpgsql as $$
declare w public.withdrawals%rowtype;
begin
  update public.withdrawals set ack_status = 'sending'
   where id = (p->>'id')::uuid
     and (ack_status in ('pending', 'failed') or (ack_status = 'sending' and updated_at < now() - interval '5 minutes'))
  returning * into w;
  if not found then return jsonb_build_object('claimed', false); end if;
  return jsonb_build_object('claimed', true, 'withdrawal', to_jsonb(w),
                            'seller', coalesce((select o.seller from public.orders o where o.id = w.order_id), public.seller_snapshot()));
end $$;

create or replace function public.api_withdrawal_ack_complete(p jsonb) returns jsonb
language plpgsql as $$
begin
  update public.withdrawals set
    ack_status = p->>'status',
    ack_provider_id = p->>'provider_id',
    ack_error = left(p->>'error', 500),
    ack_sent_at = case when p->>'status' in ('sent', 'simulated') then now() else ack_sent_at end
  where id = (p->>'id')::uuid and ack_status = 'sending';
  return jsonb_build_object('ok', found);
end $$;

-- Beheer
create or replace function public.api_admin_withdrawals(p jsonb) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(to_jsonb(w) || jsonb_build_object('order_ref', o.number, 'order_paid_at', o.paid_at)
                            order by w.submitted_at desc), '[]')
  from public.withdrawals w
  left join public.orders o on o.id = w.order_id
  where (p->>'order_id' is null or w.order_id = (p->>'order_id')::uuid)
    and (p->>'status' is null or w.status = p->>'status')
$$;

create or replace function public.api_withdrawal_handle(p jsonb) returns jsonb
language plpgsql as $$
declare v_actor text := public.require_actor(p); w public.withdrawals%rowtype; v_before jsonb;
begin
  if p->>'status' not in ('handled', 'rejected', 'received') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;
  select * into w from public.withdrawals where id = (p->>'id')::uuid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  v_before := jsonb_build_object('status', w.status, 'handled_note', w.handled_note);
  update public.withdrawals set
    status = p->>'status',
    handled_at = case when p->>'status' = 'received' then null else now() end,
    handled_by = case when p->>'status' = 'received' then null else v_actor end,
    handled_note = nullif(trim(coalesce(p->>'note', '')), '')
  where id = w.id;
  perform public.audit(v_actor, 'withdrawal_' || (p->>'status'), 'withdrawal', w.id::text, v_before,
                       jsonb_build_object('status', p->>'status', 'handled_note', nullif(trim(coalesce(p->>'note', '')), '')));
  return jsonb_build_object('ok', true);
end $$;

select public.lockdown_privileges();
notify pgrst, 'reload schema';
