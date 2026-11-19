-- Timber Online 2.0 · TO-BUILD-01 · verwerking Codex-herreview ronde 6 (commit 3dd962d)
--
--  H  refund_claim_provider_id voegt alleen een "externe" rij van dezelfde order samen; een botsende provider-ID
--     bij een andere order wordt geweigerd (nooit een rij van een andere order vergrendelen of verwijderen).
--  M  Catalogusmutaties (api_product_save en directe samenstellingswijzigingen) lopen na elkaar via een
--     transactie-advisory-lock, zodat bol_sync-rijen niet in wisselende volgorde worden vergrendeld.

create or replace function public.refund_claim_provider_id(p_refund uuid, p_provider text) returns void
language plpgsql as $$
declare dup record; v_order uuid;
begin
  if p_provider is null then return; end if;
  select order_id into v_order from public.refunds where id = p_refund;
  -- eerst zonder lock kijken; alleen een rij van dezelfde (al vergrendelde) order mag worden vergrendeld
  select id, order_id, idempotency_key into dup from public.refunds where provider_refund_id = p_provider and id <> p_refund;
  if found then
    if dup.order_id <> v_order then
      raise exception 'provider_refund_id % hoort bij een andere order', p_provider;
    end if;
    perform 1 from public.refunds where id = dup.id for update;
    if dup.idempotency_key like 'ext:%' then
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
  -- catalogusmutaties na elkaar: voorkomt deadlocks op bol_sync-rijen bij gelijktijdig opslaan van artikelen
  -- met gedeelde onderdelen (alleen beheer; klantorders worden hier niet door vertraagd)
  perform pg_advisory_xact_lock(hashtext('timberonline:catalog'));
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

create or replace function public.product_components_bol_dirty() returns trigger
language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtext('timberonline:catalog'));
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
