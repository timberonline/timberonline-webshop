-- Timber Online 2.0 · TO-BUILD-01 · aanvullingen na de eisencontrole van 18-11-2026
-- Niet-destructief: functies vervangen, één check-constraint verruimen, nieuwe instelling, twee gerichte datacorrecties.
--
--  1. Conceptregels afdwingen: een artikel kan alleen actief worden met onderdelen, prijs(zen) en een bevestigd toestel.
--     Nieuwe sets en hoesjes (met nieuw of bestaand onderdeel) en nieuwe toestellen kunnen in beheer worden aangemaakt.
--  2. Terugbetalingen: Stripe-status "pending" wordt 'processing' (niet 'succeeded'); latere provider-updates
--     (refund.updated / refund.failed) ronden af; een geannuleerde, nog niet terugbetaalde order blijft "aandacht nodig".
--  3. bol: definitieve fouten niet blind herhalen; een aanbod dat bij bol ontbreekt niet eindeloos opnieuw inplannen.
--  4. Verzendvoorstel houdt rekening met gewicht en formaat (briefpost-grens) en met kanaalregels (bol + tracking).
--  5. Audit: voorraadherpoging en externe terugbetalingen worden gelogd; het logboek is alleen-toevoegen.

-- ---------------------------------------------------------------------------
-- Instellingen en constraints
-- ---------------------------------------------------------------------------
insert into public.settings (key, value, updated_by) values ('letter_max_weight_g', '250', 'migration')
on conflict (key) do nothing;

alter table public.refunds drop constraint if exists refunds_status_check;
alter table public.refunds add constraint refunds_status_check
  check (status in ('pending', 'processing', 'succeeded', 'failed'));

-- ---------------------------------------------------------------------------
-- Audit-logboek: alleen toevoegen
-- ---------------------------------------------------------------------------
create or replace function public.audit_log_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is alleen-toevoegen';
end $$;

drop trigger if exists audit_log_no_change on public.audit_log;
create trigger audit_log_no_change before update or delete on public.audit_log
  for each row execute function public.audit_log_append_only();

-- ---------------------------------------------------------------------------
-- 1. Conceptregels en aanmaken van artikelen/toestellen
-- ---------------------------------------------------------------------------
create or replace function public.product_activation_problems(p_id uuid) returns text[]
language sql stable as $$
  select array_remove(array[
    case when coalesce(trim(pr.title), '') = '' then 'titel ontbreekt' end,
    case when not exists (select 1 from public.product_components pc where pc.product_id = pr.id)
         then 'geen onderdelen gekoppeld' end,
    case when pr.web_enabled and pr.web_price_cents <= 0 then 'webshopprijs ontbreekt' end,
    case when pr.bol_enabled and coalesce(pr.bol_price_cents, 0) <= 0 then 'bol-prijs ontbreekt' end,
    case when not exists (select 1 from public.product_devices pd where pd.product_id = pr.id and pd.confirmed)
         then 'geen bevestigd compatibel toestel' end
  ], null)
  from public.products pr where pr.id = p_id
$$;

create or replace function public.api_product_save(p jsonb) returns jsonb
language plpgsql as $$
declare
  v_actor text := public.require_actor(p);
  v_before jsonb;
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_kind text := p->>'kind';
  pr public.products%rowtype;
  v_comps jsonb := p->'components';
  v_bol_before boolean;
  v_comp uuid;
  v_problems text[];
begin
  if v_id is not null then
    select to_jsonb(x), x.bol_enabled into v_before, v_bol_before from public.products x where id = v_id for update;
    if v_before is null then return jsonb_build_object('ok', false, 'error', 'product_not_found'); end if;
    v_kind := v_before->>'kind';
    update public.products set
      title = coalesce(p->>'title', title),
      subtitle = case when p ? 'subtitle' then nullif(p->>'subtitle', '') else subtitle end,
      description = case when p ? 'description' then nullif(p->>'description', '') else description end,
      status = coalesce(p->>'status', status),
      ean = case when p ? 'ean' then nullif(trim(p->>'ean'), '') else ean end,
      bol_reference = case when p ? 'bol_reference' then nullif(trim(p->>'bol_reference'), '') else bol_reference end,
      bol_offer_id = case when p ? 'bol_offer_id' then nullif(trim(p->>'bol_offer_id'), '') else bol_offer_id end,
      bol_title = case when p ? 'bol_title' then nullif(p->>'bol_title', '') else bol_title end,
      bol_title_fix_required = coalesce((p->>'bol_title_fix_required')::boolean, bol_title_fix_required),
      web_enabled = coalesce((p->>'web_enabled')::boolean, web_enabled),
      bol_enabled = coalesce((p->>'bol_enabled')::boolean, bol_enabled),
      bol_buffer_units = case when p ? 'bol_buffer_units' then nullif(p->>'bol_buffer_units', '')::int else bol_buffer_units end,
      allow_tier_discount = coalesce((p->>'allow_tier_discount')::boolean, allow_tier_discount),
      allowed_carriers = case when jsonb_typeof(p->'allowed_carriers') = 'array'
                              then array(select jsonb_array_elements_text(p->'allowed_carriers')) else allowed_carriers end,
      preferred_carrier = coalesce(p->>'preferred_carrier', preferred_carrier),
      packed_weight_g = coalesce((p->>'packed_weight_g')::int, packed_weight_g),
      package_format = coalesce(p->>'package_format', package_format),
      image_path = case when p ? 'image_path' then nullif(p->>'image_path', '') else image_path end,
      review_note = case when p ? 'review_note' then nullif(p->>'review_note', '') else review_note end
    where id = v_id
    returning * into pr;
    if p ? 'allowed_carriers' and jsonb_array_length(p->'allowed_carriers') = 0 then
      raise exception 'carriers_required';
    end if;
  elsif v_kind = 'bundle' then
    insert into public.products (sku, slug, kind, product_type, title, subtitle, description, status, web_price_cents,
                                 web_enabled, bol_enabled, allow_tier_discount, allowed_carriers, preferred_carrier,
                                 packed_weight_g, package_format, review_note)
    values (upper(trim(p->>'sku')), lower(trim(p->>'slug')), 'bundle', 'bundel', p->>'title', nullif(p->>'subtitle', ''),
            nullif(p->>'description', ''), coalesce(p->>'status', 'concept'), (p->>'web_price_cents')::int, true, false,
            coalesce((p->>'allow_tier_discount')::boolean, false),
            case when jsonb_typeof(p->'allowed_carriers') = 'array'
                 then array(select jsonb_array_elements_text(p->'allowed_carriers')) else array['dhl', 'postnl'] end,
            coalesce(p->>'preferred_carrier', 'dhl'), coalesce((p->>'packed_weight_g')::int, 150),
            coalesce(p->>'package_format', 'letterbox'), nullif(p->>'review_note', ''))
    returning * into pr;
  elsif v_kind in ('set', 'case') then
    -- nieuw verkoopartikel; fysieke voorraad zit in een (nieuw of bestaand) onderdeel en start op 0
    if v_kind = 'set' and coalesce(p->>'product_type', '') not in ('screenprotector', 'privacy') then
      raise exception 'Kies producttype screenprotector of privacy voor een set';
    end if;
    v_comp := nullif(p->>'component_id', '')::uuid;
    if v_comp is null then
      if coalesce(trim(p->'new_component'->>'code'), '') = '' or coalesce(trim(p->'new_component'->>'name'), '') = '' then
        raise exception 'Kies een bestaand onderdeel of geef code en naam voor een nieuw onderdeel';
      end if;
      insert into public.components (code, name, kind, on_hand)
      values (upper(trim(p->'new_component'->>'code')), trim(p->'new_component'->>'name'),
              case when v_kind = 'case' then 'case' else 'protector' end, 0)
      returning id into v_comp;
      perform public.audit(v_actor, 'component_created', 'component', v_comp::text, null,
                           jsonb_build_object('code', upper(trim(p->'new_component'->>'code'))));
    elsif not exists (select 1 from public.components where id = v_comp
                      and kind = case when v_kind = 'case' then 'case' else 'protector' end) then
      raise exception 'Onderdeel past niet bij dit soort artikel';
    end if;
    insert into public.products (sku, slug, kind, product_type, title, subtitle, description, status, ean, bol_reference,
                                 bol_offer_id, bol_title, bol_title_fix_required, web_enabled, bol_enabled,
                                 web_price_cents, bol_price_cents, allow_tier_discount, allowed_carriers, preferred_carrier,
                                 packed_weight_g, package_format, review_note, sort)
    values (upper(trim(p->>'sku')), lower(trim(p->>'slug')), v_kind,
            case when v_kind = 'case' then 'hoesje' else p->>'product_type' end,
            p->>'title', nullif(p->>'subtitle', ''), nullif(p->>'description', ''), coalesce(p->>'status', 'concept'),
            nullif(trim(p->>'ean'), ''), nullif(trim(p->>'bol_reference'), ''), nullif(trim(p->>'bol_offer_id'), ''),
            nullif(p->>'bol_title', ''), coalesce((p->>'bol_title_fix_required')::boolean, false),
            coalesce((p->>'web_enabled')::boolean, true), false,
            coalesce((p->>'web_price_cents')::int, 0), nullif(p->>'bol_price_cents', '')::int,
            coalesce((p->>'allow_tier_discount')::boolean, true),
            case when jsonb_typeof(p->'allowed_carriers') = 'array'
                 then array(select jsonb_array_elements_text(p->'allowed_carriers')) else array['dhl', 'postnl', 'letter'] end,
            coalesce(p->>'preferred_carrier', 'dhl'),
            coalesce((p->>'packed_weight_g')::int, case when v_kind = 'case' then 90 else 60 end),
            coalesce(p->>'package_format', 'letterbox'), nullif(p->>'review_note', ''), coalesce((p->>'sort')::int, 100))
    returning * into pr;
    insert into public.product_components (product_id, component_id, qty)
    values (pr.id, v_comp, case when v_kind = 'case' then 1 else greatest(1, coalesce((p->>'pack_qty')::int, 2)) end);
  else
    raise exception 'Onbekend soort artikel';
  end if;

  -- samenstelling alleen aanpasbaar voor bundels (sets/hoesjes volgen de fysieke telling)
  if v_comps is not null and pr.kind = 'bundle' then
    if jsonb_array_length(v_comps) = 0 then raise exception 'bundle_needs_components'; end if;
    perform public.mark_bol_stock_dirty(public.product_components_of(array[pr.id])
              || array(select (c->>'component_id')::uuid from jsonb_array_elements(v_comps) c));
    delete from public.product_components where product_id = pr.id;
    insert into public.product_components (product_id, component_id, qty)
    select pr.id, (c->>'component_id')::uuid, sum((c->>'qty')::int) from jsonb_array_elements(v_comps) c group by 2;
  end if;

  if p->'devices' is not null then
    delete from public.product_devices where product_id = pr.id;
    insert into public.product_devices (product_id, device_slug, confirmed)
    select pr.id, d->>'slug', coalesce((d->>'confirmed')::boolean, true) from jsonb_array_elements(p->'devices') d;
  end if;

  if pr.kind = 'bundle' and pr.status = 'active' and not exists (select 1 from public.product_components where product_id = pr.id) then
    raise exception 'bundle_needs_components';
  end if;
  if pr.status = 'active' then
    v_problems := public.product_activation_problems(pr.id);
    if cardinality(v_problems) > 0 then
      raise exception 'Artikel kan niet actief worden: %', array_to_string(v_problems, ', ');
    end if;
  end if;
  if pr.bol_enabled and pr.bol_title_fix_required then
    raise exception 'bol_title_fix_required';
  end if;

  perform public.audit(v_actor, case when v_id is null then 'product_created' else 'product_updated' end,
                       'product', pr.id::text, v_before, to_jsonb(pr));

  if pr.bol_enabled and (v_bol_before is distinct from true or v_before->>'status' is distinct from pr.status
                         or (v_before->>'bol_buffer_units') is distinct from pr.bol_buffer_units::text) then
    perform public.mark_bol_stock_dirty(public.product_components_of(array[pr.id]));
    perform public.mark_bol_price_dirty(pr.id);
  elsif v_bol_before and not pr.bol_enabled then
    delete from public.bol_sync where product_id = pr.id and status <> 'in_flight';
  end if;
  return jsonb_build_object('ok', true, 'id', pr.id);
end $$;

create or replace function public.api_device_save(p jsonb) returns jsonb
language plpgsql as $$
declare v_actor text := public.require_actor(p); v_before jsonb; v_slug text := lower(trim(p->>'slug'));
begin
  if coalesce(v_slug, '') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'Ongeldige toestel-slug (alleen a-z, 0-9 en -)'; end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Naam van het toestel ontbreekt'; end if;
  select to_jsonb(d) into v_before from public.devices d where slug = v_slug;
  insert into public.devices (slug, name, family, sort)
  values (v_slug, trim(p->>'name'), coalesce(nullif(trim(p->>'family'), ''), 'iPhone'), coalesce((p->>'sort')::int, 100))
  on conflict (slug) do update set name = excluded.name, family = excluded.family, sort = excluded.sort;
  perform public.audit(v_actor, case when v_before is null then 'device_created' else 'device_updated' end,
                       'device', v_slug, v_before, (select to_jsonb(d) from public.devices d where slug = v_slug));
  return jsonb_build_object('ok', true, 'slug', v_slug);
end $$;

-- Datacorrecties (alleen als de rij nog in de seed-toestand staat)
do $fix$
declare r record;
begin
  -- Bundels met een voorgestelde (niet door de eigenaar ingestelde) prijs blijven concept
  for r in select id, to_jsonb(p) as before from public.products p
           where kind = 'bundle' and status = 'active' and review_note like 'Bundelprijs is een voorstel%'
  loop
    update public.products set status = 'concept' where id = r.id;
    insert into public.audit_log (actor, action, entity, entity_id, before, after)
    values ('migration:build01', 'product_updated', 'product', r.id::text, r.before, jsonb_build_object('status', 'concept'));
  end loop;
  -- bol-titel "iPhone 14 (Pro)" suggereert onbevestigde Pro-compatibiliteit: eerst corrigeren vóór activering op bol
  for r in select id, to_jsonb(p) as before from public.products p
           where sku = 'TO-SP2-IP14-STD' and bol_title like '%(Pro)%' and not bol_title_fix_required and not bol_enabled
  loop
    update public.products set bol_title_fix_required = true where id = r.id;
    insert into public.audit_log (actor, action, entity, entity_id, before, after)
    values ('migration:build01', 'product_updated', 'product', r.id::text, r.before, jsonb_build_object('bol_title_fix_required', true));
  end loop;
end $fix$;

-- ---------------------------------------------------------------------------
-- 2. Terugbetalingen
-- ---------------------------------------------------------------------------

-- Zet of wist een terugbetaling-gerelateerde aandachtsmelding zonder andere meldingen (bv. voorraadtekort) te wissen.
create or replace function public.set_refund_attention(p_order uuid, p_reason text) returns void
language plpgsql as $$
begin
  if p_reason is null then
    update public.orders set needs_attention = false, attention_reason = null
     where id = p_order and needs_attention
       and (attention_reason like 'Terugbetaling%' or attention_reason like 'Betaling ontvangen voor een geannuleerde order%');
  else
    update public.orders set needs_attention = true,
           attention_reason = case
             when not needs_attention or attention_reason is null
                  or attention_reason like 'Terugbetaling%'
                  or attention_reason like 'Betaling ontvangen voor een geannuleerde order%' then p_reason
             else attention_reason || ' · ' || p_reason end
     where id = p_order;
  end if;
end $$;

-- Herberekent terugbetaald bedrag en betaalstatus en past de aandachtsmelding aan.
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
         payment_status = case when v_done >= total_cents then 'refunded'
                               when v_done > 0 then 'partially_refunded' else payment_status end
   where id = p_order;
  if v_open > 0 then
    perform public.set_refund_attention(p_order, 'Terugbetaling in behandeling bij Stripe');
  elsif o.fulfillment_status = 'cancelled' and o.channel = 'web' and o.paid_at is not null and o.total_cents - v_done > 0 then
    perform public.set_refund_attention(p_order, 'Terugbetaling openstaand: geannuleerde order is nog niet volledig terugbetaald');
  else
    perform public.set_refund_attention(p_order, null);
  end if;
end $$;

create or replace function public.api_refund_begin(p jsonb) returns jsonb
language plpgsql as $$
declare
  v_actor text := public.require_actor(p);
  o public.orders%rowtype;
  v_amount int := (p->>'amount_cents')::int;
  v_open int;
  v_id uuid;
  v_existing public.refunds%rowtype;
begin
  select * into o from public.orders where id = (p->>'order_id')::uuid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'order_not_found'); end if;
  if o.channel <> 'web' or o.stripe_payment_intent_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_refundable', 'message', 'Alleen betaalde webshoporders');
  end if;
  select * into v_existing from public.refunds where idempotency_key = p->>'idempotency_key';
  if found then
    return jsonb_build_object('ok', v_existing.status <> 'failed', 'duplicate', true, 'refund_id', v_existing.id,
                              'status', v_existing.status, 'error', case when v_existing.status = 'failed' then 'refund_failed' end,
                              'message', case when v_existing.status = 'failed'
                                              then 'Eerdere terugbetaling mislukt: ' || coalesce(v_existing.error, 'onbekend') end);
  end if;
  select coalesce(sum(amount_cents), 0) into v_open from public.refunds
   where order_id = o.id and status in ('pending', 'processing', 'succeeded');
  if v_amount is null or v_amount <= 0 or v_amount > o.total_cents - v_open then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount', 'max_cents', o.total_cents - v_open);
  end if;
  insert into public.refunds (order_id, amount_cents, idempotency_key, reason, created_by)
  values (o.id, v_amount, p->>'idempotency_key', nullif(p->>'reason', ''), v_actor)
  returning id into v_id;
  perform public.audit(v_actor, 'refund_requested', 'order', o.id::text, null, jsonb_build_object('amount_cents', v_amount));
  return jsonb_build_object('ok', true, 'refund_id', v_id, 'payment_intent_id', o.stripe_payment_intent_id,
                            'amount_cents', v_amount, 'idempotency_key', p->>'idempotency_key');
end $$;

-- Verwerkt de uitkomst van de Stripe-aanroep. status: succeeded | processing | failed (of legacy ok=true/false).
create or replace function public.api_refund_finish(p jsonb) returns jsonb
language plpgsql as $$
declare
  rf public.refunds%rowtype;
  v_status text := coalesce(p->>'status', case when coalesce((p->>'ok')::boolean, false) then 'succeeded' else 'failed' end);
begin
  select * into rf from public.refunds where id = (p->>'refund_id')::uuid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'refund_not_found'); end if;
  if rf.status not in ('pending', 'processing') then return jsonb_build_object('ok', true, 'already', true); end if;
  perform 1 from public.orders where id = rf.order_id for update;
  if v_status = 'succeeded' then
    update public.refunds set status = 'succeeded', provider_refund_id = coalesce(p->>'provider_refund_id', provider_refund_id),
                              error = null, updated_at = now() where id = rf.id;
    perform public.audit(rf.created_by, 'refund_succeeded', 'order', rf.order_id::text, null,
                         jsonb_build_object('amount_cents', rf.amount_cents, 'provider_refund_id', p->>'provider_refund_id'));
    perform public.refund_settle_order(rf.order_id);
  elsif v_status = 'processing' then
    update public.refunds set status = 'processing', provider_refund_id = coalesce(p->>'provider_refund_id', provider_refund_id),
                              updated_at = now() where id = rf.id;
    perform public.audit(rf.created_by, 'refund_processing', 'order', rf.order_id::text, null,
                         jsonb_build_object('amount_cents', rf.amount_cents, 'provider_refund_id', p->>'provider_refund_id'));
    perform public.refund_settle_order(rf.order_id);
  else
    update public.refunds set status = 'failed', error = left(coalesce(p->>'error', 'onbekende fout'), 500),
                              provider_refund_id = coalesce(p->>'provider_refund_id', provider_refund_id), updated_at = now()
     where id = rf.id;
    perform public.audit(rf.created_by, 'refund_failed', 'order', rf.order_id::text, null,
                         jsonb_build_object('amount_cents', rf.amount_cents, 'error', left(p->>'error', 200)));
    perform public.refund_settle_order(rf.order_id);
    perform public.set_refund_attention(rf.order_id, 'Terugbetaling mislukt: ' || left(coalesce(p->>'error', 'onbekende fout'), 120));
  end if;
  return jsonb_build_object('ok', true, 'status', v_status);
end $$;

-- Latere statuswijziging vanuit Stripe (refund.updated, refund.failed, charge.refund.updated, charge.refunded).
-- Onbekende refunds die geslaagd zijn (bv. in het Stripe-dashboard gestart) worden als externe terugbetaling vastgelegd.
create or replace function public.api_refund_provider_update(p jsonb) returns jsonb
language plpgsql as $$
declare
  rf public.refunds%rowtype;
  o public.orders%rowtype;
  v_status text := case p->>'status' when 'succeeded' then 'succeeded'
                                     when 'failed' then 'failed' when 'canceled' then 'failed'
                                     else 'processing' end;
begin
  select * into rf from public.refunds where provider_refund_id = p->>'provider_refund_id' for update;
  if found then
    if rf.status = v_status or rf.status in ('succeeded', 'failed') and v_status <> 'failed' then
      return jsonb_build_object('ok', true, 'already', true);
    end if;
    if rf.status = 'succeeded' and v_status = 'failed' then
      -- uitzonderlijk: Stripe meldt een eerder geslaagde terugbetaling alsnog als mislukt
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

-- Bestaande naam blijft werken (charge.refunded-pad); nu met audit en dezelfde afronding.
create or replace function public.api_refund_external(p jsonb) returns jsonb
language plpgsql as $$
begin
  return public.api_refund_provider_update(p || jsonb_build_object('status', 'succeeded'));
end $$;

create or replace function public.api_order_cancel(p jsonb) returns jsonb
language plpgsql as $$
declare
  v_actor text := public.require_actor(p);
  o public.orders%rowtype;
  v_after int;
  r record;
  v_comps uuid[];
begin
  select * into o from public.orders where id = (p->>'order_id')::uuid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'order_not_found'); end if;

  if o.payment_status = 'pending' then
    perform public.expire_order_internal(o.id, 'cancelled', v_actor);
    update public.orders set fulfillment_status = 'cancelled' where id = o.id;
    return jsonb_build_object('ok', true, 'restocked', false, 'refund_needed', false);
  end if;

  if exists (select 1 from public.shipments where order_id = o.id
             and status in ('handed_over', 'in_transit', 'ready_for_pickup', 'delivered')) then
    return jsonb_build_object('ok', false, 'error', 'already_shipped', 'message', 'Order is al verzonden; gebruik een retour');
  end if;
  if o.fulfillment_status = 'cancelled' then
    return jsonb_build_object('ok', true, 'already', true,
                              'refund_needed', o.channel = 'web' and o.paid_at is not null and o.total_cents - o.refunded_cents > 0);
  end if;

  -- afgeboekte voorraad terugzetten (artikelen hebben het magazijn niet verlaten)
  select array_agg(distinct (c->>'component_id')::uuid order by (c->>'component_id')::uuid) into v_comps
  from public.order_lines ol cross join lateral jsonb_array_elements(ol.components) c
  where ol.order_id = o.id and ol.stock_committed;
  if v_comps is not null then
    perform 1 from public.components where id = any (v_comps) order by id for update;
    for r in
      select (c->>'component_id')::uuid as component_id, sum((c->>'qty')::int * ol.qty)::int as qty
      from public.order_lines ol cross join lateral jsonb_array_elements(ol.components) c
      where ol.order_id = o.id and ol.stock_committed group by 1
    loop
      update public.components set on_hand = on_hand + r.qty where id = r.component_id returning on_hand into v_after;
      insert into public.stock_movements (component_id, delta, on_hand_after, reason, order_id, actor)
      values (r.component_id, r.qty, v_after, 'cancel_restock', o.id, v_actor);
    end loop;
    update public.order_lines set stock_committed = false where order_id = o.id;
    perform public.mark_bol_stock_dirty(v_comps);
  end if;
  update public.reservations set status = 'released' where order_id = o.id;
  update public.shipments set status = 'cancelled' where order_id = o.id and status in ('draft', 'label_ready', 'exception');
  -- voorraadmeldingen vervallen met de annulering; een openstaande terugbetaling blijft zichtbaar
  update public.orders set fulfillment_status = 'cancelled', stock_status = 'released', cancelled_at = now(),
         needs_attention = false, attention_reason = null
   where id = o.id;
  perform public.refund_settle_order(o.id);
  perform public.audit(v_actor, 'order_cancelled', 'order', o.id::text,
                       jsonb_build_object('payment_status', o.payment_status, 'stock_status', o.stock_status), null);
  return jsonb_build_object('ok', true, 'restocked', v_comps is not null,
                            'refund_needed', o.channel = 'web' and o.total_cents - o.refunded_cents > 0);
end $$;

create or replace function public.api_order_retry_stock(p jsonb) returns jsonb
language plpgsql as $$
declare v_actor text := public.require_actor(p); o public.orders%rowtype; v_stock text;
begin
  select * into o from public.orders where id = (p->>'order_id')::uuid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'order_not_found'); end if;
  if o.stock_status <> 'shortage' or o.payment_status not in ('paid', 'partially_refunded') then
    return jsonb_build_object('ok', false, 'error', 'not_in_shortage');
  end if;
  v_stock := public.commit_order_stock(o.id, case when o.channel = 'bol' then 'sale_bol' else 'sale_web' end, v_actor);
  perform public.audit(v_actor, 'order_stock_retry', 'order', o.id::text,
                       jsonb_build_object('stock_status', o.stock_status), jsonb_build_object('stock_status', v_stock));
  return jsonb_build_object('ok', true, 'stock_status', v_stock);
end $$;

-- ---------------------------------------------------------------------------
-- 3. bol: definitieve fouten en ontbrekende aanbiedingen
-- ---------------------------------------------------------------------------
create or replace function public.api_bol_sync_complete(p jsonb) returns jsonb
language plpgsql as $$
declare
  s public.bol_sync%rowtype;
  v_result text := p->>'result'; -- 'done' | 'submitted' | 'check_error' | 'error'
  v_permanent boolean := coalesce((p->>'permanent')::boolean, false);
  v_attempts int;
begin
  select * into s from public.bol_sync
   where product_id = (p->>'product_id')::uuid and kind = p->>'kind' for update;
  if not found or s.claim_token is distinct from (p->>'token')::uuid then
    return jsonb_build_object('ok', false, 'stale', true);
  end if;

  if v_result = 'done' then
    update public.bol_sync set
      pushed_version = greatest(pushed_version, claimed_version),
      pushed_value = case when claimed_version >= pushed_version then claimed_value else pushed_value end,
      status = case when desired_version > claimed_version then 'pending' else 'synced' end,
      attempts = 0, last_error = null, process_id = null, claim_token = null, next_attempt_at = now(), updated_at = now()
    where product_id = s.product_id and kind = s.kind;
  elsif v_result = 'submitted' then
    update public.bol_sync set status = 'submitted', process_id = coalesce(p->>'process_id', process_id), claim_token = null,
                               next_attempt_at = now() + interval '15 seconds', updated_at = now()
    where product_id = s.product_id and kind = s.kind;
  elsif v_result = 'check_error' then
    v_attempts := s.attempts + 1;
    update public.bol_sync set status = case when v_attempts >= 8 then 'failed' else 'submitted' end,
           attempts = v_attempts, last_error = left(coalesce(p->>'error', 'processtatus onbekend'), 500), claim_token = null,
           next_attempt_at = now() + make_interval(secs => least(3600, 30 * power(2, v_attempts - 1)::int)), updated_at = now()
    where product_id = s.product_id and kind = s.kind;
  else
    v_attempts := s.attempts + 1;
    update public.bol_sync set
      attempts = v_attempts,
      last_error = left(case when v_permanent then 'Definitieve fout (niet herhaald): ' else '' end
                        || coalesce(p->>'error', 'onbekende fout'), 500),
      status = case when v_permanent or v_attempts >= 5 then 'failed' else 'pending' end,
      process_id = null, claim_token = null,
      next_attempt_at = now() + make_interval(secs => least(3600, 30 * power(2, v_attempts - 1)::int)), updated_at = now()
    where product_id = s.product_id and kind = s.kind;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- items: [{product_id, kind, remote_value}] of [{product_id, kind, missing: true}]
create or replace function public.api_bol_record_remote(p jsonb) returns jsonb
language plpgsql as $$
declare it jsonb; v_diff int := 0; v_missing int := 0; v_target int; v_kind text;
begin
  for it in select * from jsonb_array_elements(coalesce(p->'items', '[]')) loop
    v_kind := coalesce(it->>'kind', 'stock');
    if coalesce((it->>'missing')::boolean, false) then
      -- aanbod bestaat niet (meer) bij bol: niet opnieuw inplannen, wel zichtbaar maken
      v_missing := v_missing + 1;
      update public.bol_sync set remote_value = null, remote_checked_at = now(), updated_at = now(),
             last_error = 'Aanbod niet gevonden bij bol: controleer offerId of maak het aanbod aan',
             status = case when status = 'in_flight' then status else 'failed' end
       where product_id = (it->>'product_id')::uuid and kind = v_kind;
      continue;
    end if;
    update public.bol_sync set remote_value = (it->>'remote_value')::int, remote_checked_at = now()
     where product_id = (it->>'product_id')::uuid and kind = v_kind;
    v_target := case when v_kind = 'stock' then public.bol_target_stock((it->>'product_id')::uuid)
                     else (select bol_price_cents from public.products where id = (it->>'product_id')::uuid) end;
    if (it->>'remote_value')::int is distinct from v_target then
      v_diff := v_diff + 1;
      update public.bol_sync set status = 'pending', next_attempt_at = now(), attempts = 0,
                                 desired_version = nextval('public.bol_sync_version_seq')
       where product_id = (it->>'product_id')::uuid and kind = v_kind and status in ('synced', 'failed')
         and coalesce(last_error, '') not like 'Definitieve fout%'
         and coalesce(last_error, '') not like 'Aanbod niet gevonden%';
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'differences', v_diff, 'missing', v_missing);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Verzendvoorstel: gewicht, formaat en kanaalregels
-- ---------------------------------------------------------------------------
create or replace function public.api_setting_save(p jsonb) returns jsonb
language plpgsql as $$
declare v_actor text := public.require_actor(p); v_before jsonb;
begin
  if p->>'key' not in ('bol_buffer_units', 'reservation_minutes', 'shipping_options', 'delivery_promise',
                       'sender_address', 'bol_requires_tracking', 'tracking_info', 'letter_max_weight_g') then
    raise exception 'unknown_setting';
  end if;
  select value into v_before from public.settings where key = p->>'key';
  insert into public.settings (key, value, updated_by) values (p->>'key', p->'value', v_actor)
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = v_actor;
  perform public.audit(v_actor, 'setting_changed', 'setting', p->>'key', v_before, p->'value');
  if p->>'key' = 'bol_buffer_units' then
    perform public.mark_bol_stock_dirty((select coalesce(array_agg(id), '{}') from public.components));
  end if;
  return jsonb_build_object('ok', true);
end $$;

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
  if o.channel = 'bol' and coalesce((public.setting('bol_requires_tracking') #>> '{}')::boolean, true) then
    v_override := false;
  end if;

  v_allowed := public.order_allowed_carriers(o.id);
  if o.tracking_promised and not v_override then
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
