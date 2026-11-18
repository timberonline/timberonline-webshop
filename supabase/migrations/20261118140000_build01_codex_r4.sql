-- Timber Online 2.0 · TO-BUILD-01 · verwerking Codex-review ronde 4 (commit 67840cc)
-- Niet-destructief: functies vervangen, één trigger en één hulptabel toegevoegd.
--
--  H1  Refund-race: een webhook die vóór het Stripe-antwoord binnenkomt, koppelt via metadata.refund_id aan de eigen
--      refund in plaats van een "externe" dubbele rij; een eventuele dubbele externe rij wordt samengevoegd.
--  H2  Betaalstatus wordt ook teruggezet als er na een teruggedraaide refund niets (meer) terugbetaald is.
--  M   Aandachtsmeldingen: refundsegmenten worden vervangen/verwijderd, ook als ze achter een andere melding staan.
--  M   bol: "aanbod niet gevonden" verdwijnt zodra het aanbod weer gelezen wordt; definitieve procesafwijzing (TS).
--  M   Verzending: bol met trackingplicht nooit briefpost, ook zonder trackingvlag op de order.
--  M   bol-voorraad opnieuw inplannen na elke wijziging van een samenstelling (trigger).
--  M   Contactformulier: gedeelde, atomische rate limit (gehashte sleutel, geen IP-adressen opgeslagen).

-- ---------------------------------------------------------------------------
-- Aandachtsmeldingen voor terugbetalingen
-- ---------------------------------------------------------------------------
create or replace function public.strip_refund_attention(p_reason text) returns text
language sql immutable as $$
  select nullif(btrim(regexp_replace(
           regexp_replace(coalesce(p_reason, ''),
                          '(^|\s·\s)(Terugbetaling|Betaling ontvangen voor een geannuleerde order)[^·]*', '', 'g'),
           '^\s·\s', ''), ' ·'), '')
$$;

create or replace function public.set_refund_attention(p_order uuid, p_reason text) returns void
language plpgsql as $$
declare v_base text;
begin
  select public.strip_refund_attention(case when needs_attention then attention_reason end) into v_base
  from public.orders where id = p_order for update;
  update public.orders set
    attention_reason = case when p_reason is null then v_base
                            when v_base is null then p_reason
                            else v_base || ' · ' || p_reason end,
    needs_attention = (p_reason is not null or v_base is not null)
  where id = p_order;
end $$;

-- ---------------------------------------------------------------------------
-- Betaalstatus na terugbetalingen (ook terug naar 'paid' als niets meer terugbetaald is)
-- ---------------------------------------------------------------------------
create or replace function public.refund_settle_order(p_order uuid) returns void
language plpgsql as $$
declare o public.orders%rowtype; v_done int; v_open int;
begin
  select * into o from public.orders where id = p_order for update;
  select coalesce(sum(amount_cents) filter (where status = 'succeeded'), 0)::int,
         coalesce(sum(amount_cents) filter (where status in ('pending', 'processing')), 0)::int
    into v_done, v_open
  from public.refunds where order_id = p_order;
  update public.orders set refunded_cents = v_done,
         payment_status = case when v_done >= total_cents and total_cents > 0 then 'refunded'
                               when v_done > 0 then 'partially_refunded'
                               when payment_status in ('refunded', 'partially_refunded') then 'paid'
                               else payment_status end
   where id = p_order;
  if v_open > 0 then
    perform public.set_refund_attention(p_order, 'Terugbetaling in behandeling bij Stripe');
  elsif o.fulfillment_status = 'cancelled' and o.channel = 'web' and o.paid_at is not null and o.total_cents - v_done > 0 then
    perform public.set_refund_attention(p_order, 'Terugbetaling openstaand: geannuleerde order is nog niet volledig terugbetaald');
  else
    perform public.set_refund_attention(p_order, null);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Refund afronden: provider-ID koppelen zonder botsing met een (race-)externe rij
-- ---------------------------------------------------------------------------
create or replace function public.refund_claim_provider_id(p_refund uuid, p_provider text) returns void
language plpgsql as $$
declare dup public.refunds%rowtype;
begin
  if p_provider is null then return; end if;
  select * into dup from public.refunds where provider_refund_id = p_provider and id <> p_refund for update;
  if found then
    if dup.idempotency_key like 'ext:%' then
      -- dezelfde Stripe-refund was via een vroege webhook als "extern" vastgelegd: samenvoegen
      delete from public.refunds where id = dup.id;
      perform public.audit('system:stripe', 'refund_deduplicated', 'order', dup.order_id::text,
                           jsonb_build_object('external_row', dup.id, 'provider_refund_id', p_provider),
                           jsonb_build_object('kept', p_refund));
    else
      raise exception 'provider_refund_id % hoort al bij een andere terugbetaling', p_provider;
    end if;
  end if;
  update public.refunds set provider_refund_id = p_provider where id = p_refund and provider_refund_id is distinct from p_provider;
end $$;

create or replace function public.api_refund_finish(p jsonb) returns jsonb
language plpgsql as $$
declare
  rf public.refunds%rowtype;
  v_status text := coalesce(p->>'status', case when coalesce((p->>'ok')::boolean, false) then 'succeeded' else 'failed' end);
begin
  select * into rf from public.refunds where id = (p->>'refund_id')::uuid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'refund_not_found'); end if;
  perform 1 from public.orders where id = rf.order_id for update;
  perform public.refund_claim_provider_id(rf.id, nullif(p->>'provider_refund_id', ''));
  if rf.status not in ('pending', 'processing') then
    perform public.refund_settle_order(rf.order_id);
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if v_status = 'succeeded' then
    update public.refunds set status = 'succeeded', error = null, updated_at = now() where id = rf.id;
    perform public.audit(rf.created_by, 'refund_succeeded', 'order', rf.order_id::text, null,
                         jsonb_build_object('amount_cents', rf.amount_cents, 'provider_refund_id', p->>'provider_refund_id'));
    perform public.refund_settle_order(rf.order_id);
  elsif v_status = 'processing' then
    update public.refunds set status = 'processing', updated_at = now() where id = rf.id;
    perform public.audit(rf.created_by, 'refund_processing', 'order', rf.order_id::text, null,
                         jsonb_build_object('amount_cents', rf.amount_cents, 'provider_refund_id', p->>'provider_refund_id'));
    perform public.refund_settle_order(rf.order_id);
  else
    update public.refunds set status = 'failed', error = left(coalesce(p->>'error', 'onbekende fout'), 500), updated_at = now()
     where id = rf.id;
    perform public.audit(rf.created_by, 'refund_failed', 'order', rf.order_id::text, null,
                         jsonb_build_object('amount_cents', rf.amount_cents, 'error', left(p->>'error', 200)));
    perform public.refund_settle_order(rf.order_id);
    perform public.set_refund_attention(rf.order_id, 'Terugbetaling mislukt: ' || left(coalesce(p->>'error', 'onbekende fout'), 120));
  end if;
  return jsonb_build_object('ok', true, 'status', v_status);
end $$;

create or replace function public.api_refund_provider_update(p jsonb) returns jsonb
language plpgsql as $$
declare
  rf public.refunds%rowtype;
  o public.orders%rowtype;
  v_status text := case p->>'status' when 'succeeded' then 'succeeded'
                                     when 'failed' then 'failed' when 'canceled' then 'failed'
                                     else 'processing' end;
  v_meta uuid := case when coalesce(p->>'metadata_refund_id', '') ~ '^[0-9a-f-]{36}$' then (p->>'metadata_refund_id')::uuid end;
begin
  select * into rf from public.refunds where provider_refund_id = p->>'provider_refund_id' for update;
  if not found and v_meta is not null then
    -- webhook vóór het Stripe-antwoord: koppel aan de eigen refund via metadata
    select * into rf from public.refunds where id = v_meta and provider_refund_id is null for update;
    if found then
      perform 1 from public.orders where id = rf.order_id for update;
      perform public.refund_claim_provider_id(rf.id, p->>'provider_refund_id');
      rf.provider_refund_id := p->>'provider_refund_id';
    end if;
  end if;
  if rf.id is not null then
    if rf.status = v_status or (rf.status in ('succeeded', 'failed') and v_status <> 'failed') then
      return jsonb_build_object('ok', true, 'already', true);
    end if;
    if rf.status = 'succeeded' and v_status = 'failed' then
      perform 1 from public.orders where id = rf.order_id for update;
      update public.refunds set status = 'failed', error = left(coalesce(p->>'error', 'na verwerking mislukt'), 500), updated_at = now()
       where id = rf.id;
      perform public.audit('system:stripe', 'refund_failed', 'order', rf.order_id::text, null,
                           jsonb_build_object('provider_refund_id', rf.provider_refund_id, 'after_success', true));
      perform public.refund_settle_order(rf.order_id);
      perform public.set_refund_attention(rf.order_id, 'Terugbetaling mislukt na verwerking: ' || left(coalesce(p->>'error', 'controleer Stripe'), 120));
      return jsonb_build_object('ok', true, 'status', 'failed');
    end if;
    return public.api_refund_finish(jsonb_build_object('refund_id', rf.id, 'status', v_status,
                                                       'provider_refund_id', rf.provider_refund_id, 'error', p->>'error'));
  end if;
  if v_status <> 'succeeded' then
    return jsonb_build_object('ok', true, 'ignored', true);
  end if;
  select * into o from public.orders where stripe_payment_intent_id = p->>'payment_intent_id' for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'order_not_found'); end if;
  insert into public.refunds (order_id, amount_cents, status, provider_refund_id, idempotency_key, reason, created_by)
  values (o.id, (p->>'amount_cents')::int, 'succeeded', p->>'provider_refund_id', 'ext:' || (p->>'provider_refund_id'),
          'Extern (Stripe)', 'system:stripe')
  on conflict do nothing;
  if found then
    perform public.audit('system:stripe', 'refund_external', 'order', o.id::text, null,
                         jsonb_build_object('amount_cents', (p->>'amount_cents')::int, 'provider_refund_id', p->>'provider_refund_id'));
  end if;
  perform public.refund_settle_order(o.id);
  return jsonb_build_object('ok', true, 'status', 'succeeded', 'external', true);
end $$;

-- ---------------------------------------------------------------------------
-- bol
-- ---------------------------------------------------------------------------
create or replace function public.api_bol_record_remote(p jsonb) returns jsonb
language plpgsql as $$
declare it jsonb; v_diff int := 0; v_missing int := 0; v_target int; v_kind text;
begin
  for it in select * from jsonb_array_elements(coalesce(p->'items', '[]')) loop
    v_kind := coalesce(it->>'kind', 'stock');
    if coalesce((it->>'missing')::boolean, false) then
      v_missing := v_missing + 1;
      update public.bol_sync set remote_value = null, remote_checked_at = now(), updated_at = now(),
             last_error = 'Aanbod niet gevonden bij bol: controleer offerId of maak het aanbod aan',
             status = case when status = 'in_flight' then status else 'failed' end
       where product_id = (it->>'product_id')::uuid and kind = v_kind;
      continue;
    end if;
    -- aanbod is (weer) leesbaar: de melding "niet gevonden" vervalt
    update public.bol_sync set remote_value = (it->>'remote_value')::int, remote_checked_at = now(),
           last_error = case when last_error like 'Aanbod niet gevonden%' then null else last_error end
     where product_id = (it->>'product_id')::uuid and kind = v_kind;
    v_target := case when v_kind = 'stock' then public.bol_target_stock((it->>'product_id')::uuid)
                     else (select bol_price_cents from public.products where id = (it->>'product_id')::uuid) end;
    if (it->>'remote_value')::int is distinct from v_target then
      v_diff := v_diff + 1;
      update public.bol_sync set status = 'pending', next_attempt_at = now(), attempts = 0,
                                 desired_version = nextval('public.bol_sync_version_seq')
       where product_id = (it->>'product_id')::uuid and kind = v_kind and status in ('synced', 'failed')
         and coalesce(last_error, '') not like 'Definitieve fout%';
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'differences', v_diff, 'missing', v_missing);
end $$;

-- Elke wijziging van een samenstelling plant de bol-voorraad van de betrokken artikelen opnieuw in
create or replace function public.product_components_bol_dirty() returns trigger
language plpgsql as $$
begin
  perform public.mark_bol_stock_dirty(array[coalesce(new.component_id, old.component_id)]);
  return null;
end $$;

drop trigger if exists product_components_bol_dirty on public.product_components;
create trigger product_components_bol_dirty after insert or update or delete on public.product_components
  for each row execute function public.product_components_bol_dirty();

-- ---------------------------------------------------------------------------
-- Gedeelde rate limit (vast venster). Sleutel is een hash; er worden geen IP-adressen opgeslagen.
-- ---------------------------------------------------------------------------
create table if not exists public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limits enable row level security;

create or replace function public.api_rate_limit_take(p jsonb) returns jsonb
language plpgsql as $$
declare
  v_win int := greatest(1, coalesce((p->>'window_seconds')::int, 900));
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / v_win) * v_win);
  v_hits int;
begin
  if coalesce(p->>'key', '') !~ '^[a-z0-9:_-]{8,120}$' then raise exception 'invalid_rate_key'; end if;
  insert into public.rate_limits (key, window_start, hits) values (p->>'key', v_start, 1)
  on conflict (key, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into v_hits;
  if random() < 0.02 then delete from public.rate_limits where window_start < now() - interval '1 day'; end if;
  return jsonb_build_object('ok', true, 'allowed', v_hits <= coalesce((p->>'limit')::int, 5), 'hits', v_hits);
end $$;

-- ---------------------------------------------------------------------------
-- Verzending
-- ---------------------------------------------------------------------------
create or replace function public.api_shipment_prepare(p jsonb) returns jsonb
language plpgsql as $$
declare
  v_actor text := public.require_actor(p);
  o public.orders%rowtype;
  s public.shipments%rowtype;
  v_allowed text[];
  v_carrier text := nullif(p->>'carrier', '');
  v_override boolean := coalesce((p->>'override_tracking')::boolean, false);
  v_weight int;
  v_format text;
  v_pref text;
  v_candidates text[];
  v_letter_max int := coalesce((public.setting('letter_max_weight_g') #>> '{}')::int, 250);
  v_notes text[] := '{}';
  v_bol_tracking boolean;
begin
  select * into o from public.orders where id = (p->>'order_id')::uuid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'order_not_found'); end if;
  if o.payment_status not in ('paid', 'partially_refunded') or o.stock_status <> 'committed' then
    return jsonb_build_object('ok', false, 'error', 'order_not_ready',
                              'message', 'Order is niet betaald of de voorraad is niet afgeboekt');
  end if;
  if o.fulfillment_status = 'cancelled' then
    return jsonb_build_object('ok', false, 'error', 'order_cancelled');
  end if;

  -- verpakt gewicht en formaat van de hele order (alle artikelen samen)
  select coalesce(sum(pr.packed_weight_g * ol.qty), 0)::int,
         case when bool_or(pr.package_format = 'parcel') then 'parcel'
              when bool_or(pr.package_format = 'letterbox') then 'letterbox' else 'letter' end
    into v_weight, v_format
  from public.order_lines ol join public.products pr on pr.id = ol.product_id where ol.order_id = o.id;

  -- kanaalregel: bol-orders met trackingplicht nooit als briefpost, ook niet met handmatige overschrijving
  -- ook als de order zelf geen trackingvlag heeft (bv. geïmporteerd vóór de instelling werd aangezet)
  v_bol_tracking := o.channel = 'bol' and coalesce((public.setting('bol_requires_tracking') #>> '{}')::boolean, true);
  if v_bol_tracking then
    v_override := false;
  end if;

  v_allowed := public.order_allowed_carriers(o.id);
  if (o.tracking_promised or v_bol_tracking) and not v_override then
    if 'letter' = any (v_allowed) then v_notes := array_append(v_notes, 'briefpost uitgesloten: track & trace beloofd'::text); end if;
    v_allowed := array_remove(v_allowed, 'letter');
  end if;
  if 'letter' = any (v_allowed) and (v_format = 'parcel' or v_weight > v_letter_max) then
    v_notes := v_notes || format('briefpost uitgesloten: %s g / formaat %s (grens %s g, geen pakket)', v_weight, v_format, v_letter_max);
    v_allowed := array_remove(v_allowed, 'letter');
  end if;
  if cardinality(v_allowed) = 0 then
    return jsonb_build_object('ok', false, 'error', 'no_carrier_allowed',
                              'message', 'Geen vervoerder toegestaan voor alle artikelen in deze order');
  end if;

  if v_carrier is null then
    -- standaard: binnen de door de klant gekozen verzendoptie, dan voorkeur per artikel, dan DHL
    v_candidates := array(
      select c from unnest(v_allowed) with ordinality as a(c, ord)
      where c in (select jsonb_array_elements_text(o2->'carriers')
                  from jsonb_array_elements(coalesce(public.setting('shipping_options'), '[]')) o2
                  where o2->>'code' = o.shipping_option)
      order by ord);
    if cardinality(v_candidates) = 0 then
      v_candidates := v_allowed;
    end if;
    select case when count(distinct pr.preferred_carrier) = 1 then min(pr.preferred_carrier) end into v_pref
    from public.order_lines ol join public.products pr on pr.id = ol.product_id where ol.order_id = o.id;
    v_carrier := case when v_pref = any (v_candidates) then v_pref
                      when 'dhl' = any (v_candidates) then 'dhl'
                      else v_candidates[1] end;
    v_notes := v_notes || format('voorstel %s (%s g, %s)', v_carrier, v_weight, v_format);
  end if;
  if not (v_carrier = any (v_allowed)) then
    return jsonb_build_object('ok', false, 'error', 'carrier_not_allowed', 'allowed', to_jsonb(v_allowed),
                              'message', 'Vervoerder niet toegestaan voor deze order (artikelen, gewicht/formaat of trackingbelofte)');
  end if;

  select * into s from public.shipments where order_id = o.id and status <> 'cancelled' for update;
  if found then
    if s.carrier <> v_carrier then
      if s.label_status in ('ready', 'creating') then
        return jsonb_build_object('ok', false, 'error', 'label_exists',
                                  'message', 'Er bestaat al een label; annuleer de zending eerst');
      end if;
      update public.shipments set carrier = v_carrier, label_status = 'none', label_error = null,
             status = 'draft', exception_reason = null, weight_g = v_weight, package_format = v_format
       where id = s.id;
      perform public.audit(v_actor, 'shipment_carrier_changed', 'shipment', s.id::text,
                           jsonb_build_object('carrier', s.carrier), jsonb_build_object('carrier', v_carrier));
    end if;
  else
    insert into public.shipments (order_id, carrier, weight_g, package_format, created_by,
                                  ship_date)
    values (o.id, v_carrier, v_weight, v_format, v_actor,
            coalesce((p->>'ship_date')::date, (now() at time zone 'Europe/Amsterdam')::date))
    returning * into s;
    perform public.audit(v_actor, 'shipment_created', 'shipment', s.id::text, null,
                         jsonb_build_object('order_id', o.id, 'carrier', v_carrier, 'weight_g', v_weight, 'format', v_format));
  end if;

  select * into s from public.shipments where order_id = o.id and status <> 'cancelled';
  return jsonb_build_object('ok', true, 'shipment_id', s.id, 'carrier', s.carrier, 'label_status', s.label_status,
                            'allowed', to_jsonb(v_allowed), 'address_problems', public.order_address_problems(o),
                            'weight_g', v_weight, 'package_format', v_format, 'notes', to_jsonb(v_notes));
end $$;

select public.lockdown_privileges();
notify pgrst, 'reload schema';
