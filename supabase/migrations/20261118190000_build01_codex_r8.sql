-- Timber Online 2.0 · TO-BUILD-01 · verwerking Codex-review ronde 8
--
--  H  api_expire_stale_orders liet per verlopen order direct bol_sync-rijen vergrendelen. Binnen één transactie met
--     meerdere orders ontstond zo een volgorde die niet gesorteerd is (order 1 → rij B, order 2 → rij A), wat met een
--     tweede sweeper of een orderpad kan deadlocken. Nu: eerst alle orders verlopen en onderdelen verzamelen, daarna
--     één gesorteerde markering van de bol-voorraad.

-- Laat één order verlopen zonder bol-markering; geeft de vrijgegeven onderdelen terug (null = niets gedaan).
create or replace function public.expire_order_collect(p_order uuid, p_status text, p_actor text) returns uuid[]
language plpgsql as $$
declare
  v_found uuid;
  v_comps uuid[];
begin
  update public.orders
     set payment_status = p_status,
         stock_status = case when stock_status = 'reserved' then 'released' else stock_status end,
         cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end
   where id = p_order and payment_status = 'pending'
  returning id into v_found;
  if v_found is null then
    return null;
  end if;
  select coalesce(array_agg(component_id), '{}') into v_comps
  from public.reservations where order_id = p_order and status = 'active';
  update public.reservations set status = 'released' where order_id = p_order and status = 'active';
  perform public.audit(p_actor, 'order_' || p_status, 'order', p_order::text, null, null);
  return v_comps;
end $$;

-- Eén order (annuleren, Stripe-melding): verlopen + direct markeren (één gesorteerde statement)
create or replace function public.expire_order_internal(p_order uuid, p_status text, p_actor text) returns boolean
language plpgsql as $$
declare v_comps uuid[];
begin
  v_comps := public.expire_order_collect(p_order, p_status, p_actor);
  if v_comps is null then
    return false;
  end if;
  if cardinality(v_comps) > 0 then
    perform public.mark_bol_stock_dirty(v_comps);
  end if;
  return true;
end $$;

-- Sweeper: alle verlopen orders eerst afhandelen, bol-voorraad daarna in één keer (gesorteerd) markeren
create or replace function public.api_expire_stale_orders(p jsonb) returns jsonb
language plpgsql as $$
declare
  r record;
  v_n int := 0;
  v_comps uuid[];
  v_all uuid[] := '{}';
begin
  for r in
    select id from public.orders
    where payment_status = 'pending' and reserved_until < now()
    order by reserved_until
    limit coalesce((p->>'limit')::int, 100)
    for update skip locked
  loop
    v_comps := public.expire_order_collect(r.id, 'expired', 'system:sweeper');
    if v_comps is not null then
      v_n := v_n + 1;
      v_all := v_all || v_comps;
    end if;
  end loop;
  if cardinality(v_all) > 0 then
    perform public.mark_bol_stock_dirty(array(select distinct unnest(v_all)));
  end if;
  return jsonb_build_object('ok', true, 'expired', v_n);
end $$;

select public.lockdown_privileges();
notify pgrst, 'reload schema';
