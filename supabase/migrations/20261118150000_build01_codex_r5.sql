-- Timber Online 2.0 · TO-BUILD-01 · verwerking Codex-herreview ronde 5 (commit 9b3e091)
-- Niet-destructief: functies en één trigger vervangen.
--
--  H  Deadlock: refund-functies vergrendelen voortaan altijd eerst de order en pas daarna refundrijen.
--  M  Trigger op product_components plant het betrokken artikel zelf opnieuw in (ook bij verwijderen/vervangen).
--  L  Een '·' in een fouttekst kan de aandachtsmelding niet meer in losse delen splitsen.
--  L  Een teruggevonden bol-aanbod met de juiste stand gaat terug naar 'synced'.

create or replace function public.set_refund_attention(p_order uuid, p_reason text) returns void
language plpgsql as $$
declare v_base text; v_reason text := nullif(replace(p_reason, '·', '-'), '');
begin
  select public.strip_refund_attention(case when needs_attention then attention_reason end) into v_base
  from public.orders where id = p_order for update;
  update public.orders set
    attention_reason = case when v_reason is null then v_base
                            when v_base is null then v_reason
                            else v_base || ' · ' || v_reason end,
    needs_attention = (v_reason is not null or v_base is not null)
  where id = p_order;
end $$;

create or replace function public.api_refund_finish(p jsonb) returns jsonb
language plpgsql as $$
declare
  rf public.refunds%rowtype;
  v_order uuid;
  v_status text := coalesce(p->>'status', case when coalesce((p->>'ok')::boolean, false) then 'succeeded' else 'failed' end);
begin
  -- vaste lockvolgorde: eerst de order, dan refunds (voorkomt deadlocks met gelijktijdige webhooks)
  select order_id into v_order from public.refunds where id = (p->>'refund_id')::uuid;
  if v_order is null then return jsonb_build_object('ok', false, 'error', 'refund_not_found'); end if;
  perform 1 from public.orders where id = v_order for update;
  select * into rf from public.refunds where id = (p->>'refund_id')::uuid for update;
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
  v_order uuid;
begin
  -- vaste lockvolgorde: eerst de order bepalen en vergrendelen, daarna pas refundrijen
  select order_id into v_order from public.refunds where provider_refund_id = p->>'provider_refund_id';
  if v_order is null and v_meta is not null then
    select order_id into v_order from public.refunds where id = v_meta;
  end if;
  if v_order is null then
    select id into v_order from public.orders where stripe_payment_intent_id = p->>'payment_intent_id';
  end if;
  if v_order is null then
    if v_status <> 'succeeded' then return jsonb_build_object('ok', true, 'ignored', true); end if;
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;
  perform 1 from public.orders where id = v_order for update;

  select * into rf from public.refunds where provider_refund_id = p->>'provider_refund_id' for update;
  if not found and v_meta is not null then
    -- webhook vóór het Stripe-antwoord: koppel aan de eigen refund via metadata
    select * into rf from public.refunds where id = v_meta and order_id = v_order and provider_refund_id is null for update;
    if found then
      perform public.refund_claim_provider_id(rf.id, p->>'provider_refund_id');
      rf.provider_refund_id := p->>'provider_refund_id';
    end if;
  end if;
  if rf.id is not null then
    if rf.status = v_status or (rf.status in ('succeeded', 'failed') and v_status <> 'failed') then
      return jsonb_build_object('ok', true, 'already', true);
    end if;
    if rf.status = 'succeeded' and v_status = 'failed' then
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
  select * into o from public.orders where id = v_order;
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

create or replace function public.api_bol_record_remote(p jsonb) returns jsonb
language plpgsql as $$
declare it jsonb; v_diff int := 0; v_missing int := 0; v_target int; v_kind text; v_was_missing boolean;
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
    select coalesce(last_error, '') like 'Aanbod niet gevonden%' into v_was_missing
    from public.bol_sync where product_id = (it->>'product_id')::uuid and kind = v_kind;
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
    elsif coalesce(v_was_missing, false) then
      update public.bol_sync set status = 'synced', attempts = 0
       where product_id = (it->>'product_id')::uuid and kind = v_kind and status = 'failed';
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'differences', v_diff, 'missing', v_missing);
end $$;

-- Plant bol-voorraad in voor bepaalde artikelen (los van hun huidige samenstelling)
create or replace function public.mark_bol_product_dirty(p_products uuid[]) returns void
language plpgsql as $$
begin
  insert into public.bol_sync as s (product_id, kind, desired_value, desired_version, status, next_attempt_at, attempts, last_error)
  select p.id, 'stock', public.bol_target_stock(p.id), nextval('public.bol_sync_version_seq'), 'pending', now(), 0, null
  from public.products p
  where p.id = any (p_products) and p.bol_enabled
  order by p.id
  on conflict (product_id, kind) do update
    set desired_value = excluded.desired_value,
        desired_version = excluded.desired_version,
        status = case when s.status in ('in_flight', 'submitted') then s.status else 'pending' end,
        next_attempt_at = case when s.status in ('in_flight', 'submitted') then s.next_attempt_at else now() end,
        attempts = case when s.status in ('in_flight', 'submitted') then s.attempts else 0 end,
        last_error = case when s.status in ('in_flight', 'submitted') then s.last_error else null end;
end $$;

create or replace function public.product_components_bol_dirty() returns trigger
language plpgsql as $$
begin
  -- het gewijzigde artikel zelf (oud en nieuw) plus alle artikelen die de oude/nieuwe onderdelen delen
  perform public.mark_bol_product_dirty(array_remove(array[
    case when tg_op <> 'INSERT' then old.product_id end,
    case when tg_op <> 'DELETE' then new.product_id end], null));
  perform public.mark_bol_stock_dirty(array_remove(array[
    case when tg_op <> 'INSERT' then old.component_id end,
    case when tg_op <> 'DELETE' then new.component_id end], null));
  return null;
end $$;

select public.lockdown_privileges();
notify pgrst, 'reload schema';
