-- Timber Online 2.0 · TO-BUILD-01 · domeinfuncties
-- Alle kritieke mutaties lopen via deze functies, elk in één databasetransactie.
-- Publieke API-functies hebben de vorm api_*(p jsonb) returns jsonb en zijn alleen uitvoerbaar door service_role.

-- ---------------------------------------------------------------------------
-- Hulpfuncties
-- ---------------------------------------------------------------------------
create or replace function public.setting(p_key text) returns jsonb
language sql stable as $$
  select value from public.settings where key = p_key
$$;

create or replace function public.setting_int(p_key text, p_default int) returns int
language sql stable as $$
  select coalesce((select (value #>> '{}')::int from public.settings where key = p_key), p_default)
$$;

create or replace function public.audit(p_actor text, p_action text, p_entity text, p_entity_id text,
                                        p_before jsonb default null, p_after jsonb default null) returns void
language sql as $$
  insert into public.audit_log (actor, action, entity, entity_id, before, after)
  values (coalesce(nullif(p_actor, ''), 'onbekend'), p_action, p_entity, p_entity_id, p_before, p_after)
$$;

create or replace function public.require_actor(p jsonb) returns text
language plpgsql immutable as $$
begin
  if coalesce(p->>'actor', '') = '' then
    raise exception 'actor_required' using errcode = '22023';
  end if;
  return p->>'actor';
end $$;

-- Gereserveerd door andere openstaande (niet verlopen) reserveringen
create or replace function public.component_reserved(p_component uuid, p_exclude_order uuid default null) returns int
language sql stable as $$
  select coalesce(sum(qty), 0)::int
  from public.reservations
  where component_id = p_component
    and status = 'active'
    and expires_at > now()
    and (p_exclude_order is null or order_id <> p_exclude_order)
$$;

create or replace view public.component_stock with (security_invoker = true) as
select c.id, c.code, c.name, c.kind, c.on_hand, c.low_stock_threshold,
       coalesce(r.reserved, 0)::int as reserved,
       (c.on_hand - coalesce(r.reserved, 0))::int as free
from public.components c
left join (
  select component_id, sum(qty) as reserved
  from public.reservations
  where status = 'active' and expires_at > now()
  group by component_id
) r on r.component_id = c.id;

create or replace view public.product_availability with (security_invoker = true) as
select p.id as product_id,
       coalesce(min(floor(greatest(cs.free, 0)::numeric / pc.qty))::int, 0) as available_units
from public.products p
left join public.product_components pc on pc.product_id = p.id
left join public.component_stock cs on cs.id = pc.component_id
group by p.id;

-- bol-voorraad = verkoopbare eenheden min buffer (standaard 1 eenheid per SKU voor de webshop).
-- Delen meerdere bol-actieve artikelen een component, dan krijgt elk een evenredig deel van de vrije stuks,
-- zodat de gepubliceerde bol-standen samen nooit meer dan de fysieke voorraad beloven.
create or replace function public.bol_target_stock(p_product uuid) returns int
language sql stable as $$
  select case when p.status <> 'active' or not p.bol_enabled then 0
              else greatest(0,
                coalesce((
                  select min(floor(
                           (greatest(cs.free, 0) / greatest(1, (
                              select count(*) from public.product_components pc2
                              join public.products p2 on p2.id = pc2.product_id
                              where pc2.component_id = pc.component_id and p2.bol_enabled and p2.status = 'active')))::numeric
                           / pc.qty))::int
                  from public.product_components pc
                  join public.component_stock cs on cs.id = pc.component_id
                  where pc.product_id = p.id), 0)
                - coalesce(p.bol_buffer_units, public.setting_int('bol_buffer_units', 1)))
         end
  from public.products p
  where p.id = p_product
$$;

-- E-mail als onderdeel van dezelfde transactie klaarzetten; versturen gebeurt daarna (met herpogingen).
create or replace function public.enqueue_email(p_order uuid, p_kind text) returns void
language sql as $$
  insert into public.email_log (order_id, kind, to_email, status, attempts)
  select o.id, p_kind, o.email, 'pending', 0
  from public.orders o
  where o.id = p_order and o.channel = 'web' and coalesce(o.email, '') <> ''
  on conflict (order_id, kind) do nothing
$$;

create or replace function public.mark_bol_stock_dirty(p_components uuid[]) returns void
language plpgsql as $$
begin
  insert into public.bol_sync as s (product_id, kind, desired_value, desired_version, status, next_attempt_at, attempts, last_error)
  select x.id, 'stock', public.bol_target_stock(x.id), nextval('public.bol_sync_version_seq'), 'pending', now(), 0, null
  from (
    select distinct p.id
    from public.products p
    join public.product_components pc on pc.product_id = p.id
    where pc.component_id = any (p_components) and p.bol_enabled
  ) x
  order by x.id
  on conflict (product_id, kind) do update
    set desired_value = excluded.desired_value,
        desired_version = excluded.desired_version,
        status = case when s.status in ('in_flight', 'submitted') then s.status else 'pending' end,
        next_attempt_at = case when s.status in ('in_flight', 'submitted') then s.next_attempt_at else now() end,
        attempts = case when s.status in ('in_flight', 'submitted') then s.attempts else 0 end,
        last_error = case when s.status in ('in_flight', 'submitted') then s.last_error else null end;
end $$;

create or replace function public.mark_bol_price_dirty(p_product uuid) returns void
language plpgsql as $$
begin
  insert into public.bol_sync as s (product_id, kind, desired_value, desired_version, status, next_attempt_at, attempts, last_error)
  select p.id, 'price', p.bol_price_cents, nextval('public.bol_sync_version_seq'), 'pending', now(), 0, null
  from public.products p
  where p.id = p_product and p.bol_enabled and p.bol_price_cents is not null
  on conflict (product_id, kind) do update
    set desired_value = excluded.desired_value,
        desired_version = excluded.desired_version,
        status = case when s.status in ('in_flight', 'submitted') then s.status else 'pending' end,
        next_attempt_at = case when s.status in ('in_flight', 'submitted') then s.next_attempt_at else now() end,
        attempts = case when s.status in ('in_flight', 'submitted') then s.attempts else 0 end,
        last_error = case when s.status in ('in_flight', 'submitted') then s.last_error else null end;
end $$;

create or replace function public.product_components_of(p_products uuid[]) returns uuid[]
language sql stable as $$
  select coalesce(array_agg(distinct component_id), '{}') from public.product_components where product_id = any (p_products)
$$;

-- Componentbehoefte van nog niet afgeboekte orderregels
create or replace function public.order_component_needs(p_order uuid)
returns table (component_id uuid, needed int)
language sql stable as $$
  select (c->>'component_id')::uuid, sum((c->>'qty')::int * ol.qty)::int
  from public.order_lines ol
  cross join lateral jsonb_array_elements(ol.components) c
  where ol.order_id = p_order and not ol.stock_committed
  group by 1
$$;

-- ---------------------------------------------------------------------------
-- Prijsberekening (offerte) — enige bron voor prijs, korting, verzendkosten en totaal
-- ---------------------------------------------------------------------------
create or replace function public.quote_cart(p jsonb) returns jsonb
language plpgsql volatile as $$
declare
  v_errors jsonb := '[]';
  v_lines jsonb := '[]';
  v_subtotal int := 0;
  v_discount int := 0;
  v_shipping int := 0;
  v_option_code text := coalesce(nullif(p->>'shipping_option', ''), 'tracked');
  v_option jsonb;
  v_options jsonb := coalesce(public.setting('shipping_options'), '[]');
  v_free_from int;
  v_carriers text[] := array['dhl', 'postnl', 'letter'];
  v_shortages jsonb := '[]';
  v_count int;
  r record;
  rd record;
  v_best int;
  v_best_rule uuid;
  v_best_name text;
  v_per_unit int;
begin
  -- regels samenvoegen en valideren
  create temporary table if not exists _quote_lines (product_id uuid primary key, qty int) on commit drop;
  truncate _quote_lines;
  begin
    insert into _quote_lines (product_id, qty)
    select (l->>'product_id')::uuid, sum((l->>'qty')::int)
    from jsonb_array_elements(coalesce(p->'lines', '[]')) l
    group by 1;
  exception when others then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array(jsonb_build_object('code', 'invalid_lines')));
  end;

  select count(*) into v_count from _quote_lines;
  if v_count = 0 then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array(jsonb_build_object('code', 'empty_cart')));
  end if;
  if v_count > 30 then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array(jsonb_build_object('code', 'too_many_lines')));
  end if;

  for r in
    select q.product_id, q.qty, pr.id is not null as product_exists, pr.status, pr.web_enabled, pr.sku
    from _quote_lines q left join public.products pr on pr.id = q.product_id
  loop
    if not r.product_exists or r.status <> 'active' or not r.web_enabled then
      v_errors := v_errors || jsonb_build_object('code', 'product_unavailable', 'product_id', r.product_id);
    elsif r.qty < 1 or r.qty > 20 then
      v_errors := v_errors || jsonb_build_object('code', 'invalid_qty', 'product_id', r.product_id, 'sku', r.sku);
    end if;
  end loop;
  if jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object('ok', false, 'errors', v_errors);
  end if;

  -- per regel de beste staffelkorting (geen stapeling, bundels standaard uitgesloten)
  for r in
    select q.product_id, q.qty, pr.sku, pr.title, pr.kind, pr.web_price_cents, pr.allow_tier_discount,
           pr.allowed_carriers, pr.image_path, pr.slug,
           coalesce(pa.available_units, 0) as available_units,
           coalesce((select jsonb_agg(jsonb_build_object('component_id', pc.component_id, 'qty', pc.qty) order by pc.component_id)
                     from public.product_components pc where pc.product_id = pr.id), '[]') as components
    from _quote_lines q
    join public.products pr on pr.id = q.product_id
    left join public.product_availability pa on pa.product_id = pr.id
    order by pr.sort, pr.sku
  loop
    v_best := 0; v_best_rule := null; v_best_name := null;
    if r.allow_tier_discount then
      for rd in
        select dr.id, dr.name, dr.min_qty, dr.discount_type, dr.value,
               (select coalesce(sum(q2.qty), 0) from _quote_lines q2
                  join public.discount_rule_products drp2 on drp2.product_id = q2.product_id and drp2.rule_id = dr.id
                  join public.products p2 on p2.id = q2.product_id and p2.allow_tier_discount) as eligible_qty
        from public.discount_rules dr
        join public.discount_rule_products drp on drp.rule_id = dr.id and drp.product_id = r.product_id
        where dr.active and (dr.starts_at is null or dr.starts_at <= now()) and (dr.ends_at is null or dr.ends_at > now())
      loop
        if rd.eligible_qty >= rd.min_qty then
          v_per_unit := case when rd.discount_type = 'fixed' then least(rd.value, r.web_price_cents)
                             else round(r.web_price_cents * rd.value / 100.0)::int end;
          if v_per_unit > v_best then
            v_best := v_per_unit; v_best_rule := rd.id; v_best_name := rd.name;
          end if;
        end if;
      end loop;
    end if;

    v_carriers := array(select unnest(v_carriers) intersect select unnest(r.allowed_carriers));
    v_subtotal := v_subtotal + r.web_price_cents * r.qty;
    v_discount := v_discount + v_best * r.qty;
    v_lines := v_lines || jsonb_build_object(
      'product_id', r.product_id, 'sku', r.sku, 'title', r.title, 'kind', r.kind, 'slug', r.slug,
      'image_path', r.image_path, 'qty', r.qty, 'unit_price_cents', r.web_price_cents,
      'discount_per_unit_cents', v_best, 'discount_cents', v_best * r.qty,
      'line_total_cents', (r.web_price_cents - v_best) * r.qty,
      'discount_rule_id', v_best_rule, 'discount_rule_name', v_best_name,
      'available_units', r.available_units, 'components', r.components);
  end loop;

  -- verzendoptie
  select o into v_option from jsonb_array_elements(v_options) o
  where o->>'code' = v_option_code and coalesce((o->>'enabled')::boolean, true)
  limit 1;
  if v_option is null then
    v_errors := v_errors || jsonb_build_object('code', 'shipping_option_unavailable', 'shipping_option', v_option_code);
  else
    if not exists (
      select 1 from jsonb_array_elements_text(coalesce(v_option->'carriers', '[]')) c where c = any (v_carriers)
    ) then
      v_errors := v_errors || jsonb_build_object('code', 'shipping_option_not_allowed', 'shipping_option', v_option_code);
    end if;
    v_shipping := coalesce((v_option->>'cost_cents')::int, 0);
    v_free_from := (v_option->>'free_from_cents')::int;
    if v_free_from is not null and (v_subtotal - v_discount) >= v_free_from then
      v_shipping := 0;
    end if;
  end if;

  -- gezamenlijke voorraadcontrole over alle onderdelen in de winkelwagen
  select coalesce(jsonb_agg(jsonb_build_object('component_id', n.component_id, 'name', c.name, 'needed', n.needed,
                                               'available', greatest(cs.free, 0))), '[]')
  into v_shortages
  from (
    select pc.component_id, sum(pc.qty * q.qty)::int as needed
    from _quote_lines q
    join public.product_components pc on pc.product_id = q.product_id
    group by 1
  ) n
  join public.components c on c.id = n.component_id
  join public.component_stock cs on cs.id = n.component_id
  where n.needed > greatest(cs.free, 0);

  return jsonb_build_object(
    'ok', jsonb_array_length(v_errors) = 0,
    'errors', v_errors,
    'lines', v_lines,
    'subtotal_cents', v_subtotal,
    'discount_cents', v_discount,
    'shipping_cents', v_shipping,
    'total_cents', v_subtotal - v_discount + v_shipping,
    'shipping_option', v_option,
    'shipping_options', (select coalesce(jsonb_agg(o), '[]') from jsonb_array_elements(v_options) o
                         where coalesce((o->>'enabled')::boolean, true)),
    'allowed_carriers', to_jsonb(v_carriers),
    'stock_ok', jsonb_array_length(v_shortages) = 0,
    'shortages', v_shortages,
    'delivery_promise', public.setting('delivery_promise') #>> '{}'
  );
end $$;

create or replace function public.api_quote(p jsonb) returns jsonb
language sql volatile as $$
  select public.quote_cart(p)
$$;

-- ---------------------------------------------------------------------------
-- Webshoporder aanmaken met voorraadreservering (één transactie)
-- ---------------------------------------------------------------------------
create or replace function public.api_create_web_order(p jsonb) returns jsonb
language plpgsql as $$
declare
  v_quote jsonb;
  v_comps uuid[];
  v_shortages jsonb := '[]';
  v_order uuid;
  v_number text;
  v_minutes int := public.setting_int('reservation_minutes', 35);
  v_until timestamptz;
  r record;
  l jsonb;
begin
  v_quote := public.quote_cart(p);
  if not (v_quote->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'error', 'quote_invalid', 'quote', v_quote);
  end if;

  -- componentbehoefte
  create temporary table if not exists _needs (component_id uuid primary key, needed int) on commit drop;
  truncate _needs;
  insert into _needs (component_id, needed)
  select (c->>'component_id')::uuid, sum((c->>'qty')::int * (l2->>'qty')::int)
  from jsonb_array_elements(v_quote->'lines') l2
  cross join lateral jsonb_array_elements(l2->'components') c
  group by 1;

  select array_agg(component_id order by component_id) into v_comps from _needs;
  if v_comps is null then
    return jsonb_build_object('ok', false, 'error', 'no_components');
  end if;

  -- vergrendel componenten in vaste volgorde en controleer opnieuw onder slot
  perform 1 from public.components where id = any (v_comps) order by id for update;

  for r in
    select n.component_id, n.needed, c.name, c.on_hand - public.component_reserved(n.component_id) as available
    from _needs n join public.components c on c.id = n.component_id
  loop
    if r.needed > r.available then
      v_shortages := v_shortages || jsonb_build_object('component_id', r.component_id, 'name', r.name,
                                                       'needed', r.needed, 'available', greatest(r.available, 0));
    end if;
  end loop;
  if jsonb_array_length(v_shortages) > 0 then
    return jsonb_build_object('ok', false, 'error', 'insufficient_stock', 'shortages', v_shortages, 'quote', v_quote);
  end if;

  v_until := now() + make_interval(mins => v_minutes);

  insert into public.orders (channel, payment_status, stock_status, shipping_option, tracking_promised,
                             subtotal_cents, discount_cents, shipping_cents, total_cents, delivery_promise, reserved_until,
                             email)
  values ('web', 'pending', 'reserved', v_quote->'shipping_option'->>'code',
          coalesce((v_quote->'shipping_option'->>'tracking')::boolean, true),
          (v_quote->>'subtotal_cents')::int, (v_quote->>'discount_cents')::int, (v_quote->>'shipping_cents')::int,
          (v_quote->>'total_cents')::int, v_quote->>'delivery_promise', v_until,
          nullif(lower(trim(p->>'email')), ''))
  returning id, number into v_order, v_number;

  for l in select * from jsonb_array_elements(v_quote->'lines') loop
    insert into public.order_lines (order_id, product_id, sku, title, kind, qty, unit_price_cents, discount_cents,
                                    line_total_cents, discount_rule_id, components)
    values (v_order, (l->>'product_id')::uuid, l->>'sku', l->>'title', l->>'kind', (l->>'qty')::int,
            (l->>'unit_price_cents')::int, (l->>'discount_cents')::int, (l->>'line_total_cents')::int,
            nullif(l->>'discount_rule_id', '')::uuid, l->'components');
  end loop;

  insert into public.reservations (order_id, component_id, qty, status, expires_at)
  select v_order, component_id, needed, 'active', v_until from _needs;

  perform public.mark_bol_stock_dirty(v_comps);

  return jsonb_build_object('ok', true, 'order_id', v_order, 'number', v_number, 'reserved_until', v_until, 'quote', v_quote);
end $$;

create or replace function public.api_attach_checkout_session(p jsonb) returns jsonb
language plpgsql as $$
declare v_id uuid;
begin
  update public.orders
     set stripe_session_id = p->>'session_id'
   where id = (p->>'order_id')::uuid and payment_status = 'pending' and stripe_session_id is null
  returning id into v_id;
  return jsonb_build_object('ok', v_id is not null);
end $$;

-- ---------------------------------------------------------------------------
-- Voorraad afboeken (idempotent per orderregel)
-- ---------------------------------------------------------------------------
create or replace function public.commit_order_stock(p_order uuid, p_reason text, p_actor text) returns text
language plpgsql as $$
declare
  v_comps uuid[];
  v_short jsonb := '[]';
  v_after int;
  r record;
begin
  select array_agg(component_id order by component_id) into v_comps from public.order_component_needs(p_order);

  if v_comps is null then
    update public.orders set stock_status = 'committed' where id = p_order and stock_status <> 'committed';
    return 'committed';
  end if;

  perform 1 from public.components where id = any (v_comps) order by id for update;

  for r in
    select n.component_id, n.needed, c.name, c.on_hand - public.component_reserved(n.component_id, p_order) as available
    from public.order_component_needs(p_order) n
    join public.components c on c.id = n.component_id
  loop
    if r.needed > r.available then
      v_short := v_short || jsonb_build_object('component_id', r.component_id, 'name', r.name,
                                               'needed', r.needed, 'available', greatest(r.available, 0));
    end if;
  end loop;

  if jsonb_array_length(v_short) > 0 then
    update public.reservations set status = 'released' where order_id = p_order and status = 'active';
    update public.orders
       set stock_status = 'shortage', needs_attention = true,
           attention_reason = 'Voorraadtekort na betaling: ' ||
             (select string_agg((s->>'name') || ' (nodig ' || (s->>'needed') || ', vrij ' || (s->>'available') || ')', '; ')
                from jsonb_array_elements(v_short) s)
     where id = p_order;
    perform public.audit(p_actor, 'stock_shortage', 'order', p_order::text, null, jsonb_build_object('shortages', v_short));
    perform public.mark_bol_stock_dirty(v_comps);
    return 'shortage';
  end if;

  for r in select * from public.order_component_needs(p_order) loop
    update public.components set on_hand = on_hand - r.needed where id = r.component_id returning on_hand into v_after;
    insert into public.stock_movements (component_id, delta, on_hand_after, reason, order_id, actor)
    values (r.component_id, -r.needed, v_after, p_reason, p_order, p_actor);
  end loop;

  update public.order_lines set stock_committed = true where order_id = p_order and not stock_committed;
  update public.reservations set status = 'committed' where order_id = p_order and status in ('active', 'released');
  update public.orders
     set stock_status = 'committed',
         needs_attention = case when stock_status = 'shortage' then false else needs_attention end,
         attention_reason = case when stock_status = 'shortage' then null else attention_reason end
   where id = p_order;
  perform public.mark_bol_stock_dirty(v_comps);
  if exists (select 1 from public.orders where id = p_order and payment_status in ('paid', 'partially_refunded')) then
    perform public.enqueue_email(p_order, 'order_confirmation');
  end if;
  return 'committed';
end $$;

-- ---------------------------------------------------------------------------
-- Betaalmeldingen
-- ---------------------------------------------------------------------------
create or replace function public.api_mark_order_paid(p jsonb) returns jsonb
language plpgsql as $$
declare
  o public.orders%rowtype;
  v_stock text;
  v_actor text := coalesce(nullif(p->>'actor', ''), 'system:stripe');
  v_late boolean;
  c jsonb := p->'customer';
begin
  select * into o from public.orders where id = (p->>'order_id')::uuid for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;
  if o.channel <> 'web' then
    return jsonb_build_object('ok', false, 'error', 'wrong_channel');
  end if;
  if p->>'session_id' is not null and o.stripe_session_id is not null and o.stripe_session_id <> p->>'session_id' then
    return jsonb_build_object('ok', false, 'error', 'session_mismatch');
  end if;

  if c is not null then
    update public.orders set
      email = coalesce(nullif(lower(trim(c->>'email')), ''), email),
      customer_name = coalesce(nullif(c->>'name', ''), customer_name),
      phone = coalesce(nullif(c->>'phone', ''), phone),
      ship_street = coalesce(nullif(c->>'street', ''), ship_street),
      ship_house_number = coalesce(nullif(c->>'house_number', ''), ship_house_number),
      ship_address_extra = coalesce(nullif(c->>'address_extra', ''), ship_address_extra),
      ship_postal_code = coalesce(nullif(upper(trim(c->>'postal_code')), ''), ship_postal_code),
      ship_city = coalesce(nullif(c->>'city', ''), ship_city),
      ship_country = coalesce(nullif(upper(c->>'country'), ''), ship_country)
    where id = o.id;
  end if;

  if o.payment_status in ('paid', 'refunded', 'partially_refunded') then
    return jsonb_build_object('ok', true, 'already', true, 'order_id', o.id, 'number', o.number,
                              'stock_status', o.stock_status);
  end if;

  v_late := o.payment_status in ('expired', 'cancelled', 'failed') or o.stock_status = 'released';

  -- Betaling voor een order die de beheerder al had geannuleerd: niet afboeken, wel zichtbaar voor terugbetaling.
  if o.fulfillment_status = 'cancelled' then
    update public.orders set
      payment_status = 'paid', paid_at = now(),
      stripe_session_id = coalesce(stripe_session_id, p->>'session_id'),
      stripe_payment_intent_id = coalesce(p->>'payment_intent_id', stripe_payment_intent_id),
      payment_method = coalesce(p->>'payment_method', payment_method),
      needs_attention = true,
      attention_reason = 'Betaling ontvangen voor een geannuleerde order: terugbetalen'
    where id = o.id;
    perform public.audit(v_actor, 'order_paid_after_cancel', 'order', o.id::text, null, null);
    return jsonb_build_object('ok', true, 'already', false, 'order_id', o.id, 'number', o.number,
                              'stock_status', o.stock_status, 'late', true, 'refund_required', true);
  end if;

  update public.orders set
    payment_status = 'paid',
    paid_at = now(),
    stripe_session_id = coalesce(stripe_session_id, p->>'session_id'),
    stripe_payment_intent_id = coalesce(p->>'payment_intent_id', stripe_payment_intent_id),
    payment_method = coalesce(p->>'payment_method', payment_method),
    needs_attention = case when (p->>'amount_total') is not null and (p->>'amount_total')::int <> o.total_cents then true
                           when v_late then true else needs_attention end,
    attention_reason = case when (p->>'amount_total') is not null and (p->>'amount_total')::int <> o.total_cents
                              then 'Betaald bedrag wijkt af van ordertotaal'
                            when v_late then 'Late betaalbevestiging (na ' || o.payment_status || ')'
                            else attention_reason end
  where id = o.id;

  v_stock := public.commit_order_stock(o.id, 'sale_web', v_actor);

  if v_late and v_stock = 'committed' then
    update public.orders set attention_reason = 'Late betaalbevestiging verwerkt; voorraad opnieuw toegewezen' where id = o.id;
  end if;

  perform public.audit(v_actor, 'order_paid', 'order', o.id::text,
                       jsonb_build_object('payment_status', o.payment_status, 'stock_status', o.stock_status),
                       jsonb_build_object('payment_status', 'paid', 'stock_status', v_stock, 'late', v_late));

  return jsonb_build_object('ok', true, 'already', false, 'order_id', o.id, 'number', o.number,
                            'stock_status', v_stock, 'late', v_late);
end $$;

create or replace function public.expire_order_internal(p_order uuid, p_status text, p_actor text) returns boolean
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
    return false;
  end if;
  select array_agg(component_id) into v_comps from public.reservations where order_id = p_order and status = 'active';
  update public.reservations set status = 'released' where order_id = p_order and status = 'active';
  if v_comps is not null then
    perform public.mark_bol_stock_dirty(v_comps);
  end if;
  perform public.audit(p_actor, 'order_' || p_status, 'order', p_order::text, null, null);
  return true;
end $$;

-- Betaalpoging definitief verlopen / mislukt / door klant afgebroken
create or replace function public.api_release_order(p jsonb) returns jsonb
language plpgsql as $$
declare
  v_status text := coalesce(p->>'status', 'expired');
  v_order uuid;
  v_changed boolean;
begin
  if v_status not in ('expired', 'failed', 'cancelled') then
    raise exception 'invalid_status';
  end if;
  if p->>'order_id' is not null then
    v_order := (p->>'order_id')::uuid;
  else
    select id into v_order from public.orders where stripe_session_id = p->>'session_id';
  end if;
  if v_order is null then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;
  perform 1 from public.orders where id = v_order for update;
  v_changed := public.expire_order_internal(v_order, v_status, coalesce(nullif(p->>'actor', ''), 'system'));
  return jsonb_build_object('ok', true, 'changed', v_changed, 'order_id', v_order);
end $$;

create or replace function public.api_expire_stale_orders(p jsonb) returns jsonb
language plpgsql as $$
declare
  r record;
  v_n int := 0;
begin
  for r in
    select id from public.orders
    where payment_status = 'pending' and reserved_until < now()
    order by reserved_until
    limit coalesce((p->>'limit')::int, 100)
    for update skip locked
  loop
    if public.expire_order_internal(r.id, 'expired', 'system:sweeper') then
      v_n := v_n + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'expired', v_n);
end $$;

create or replace function public.api_record_webhook_event(p jsonb) returns jsonb
language plpgsql as $$
declare v_status text;
begin
  insert into public.webhook_events (id, source, type) values (p->>'id', p->>'source', p->>'type')
  on conflict (id) do update set attempts = public.webhook_events.attempts + 1
  returning status into v_status;
  return jsonb_build_object('ok', true, 'status', v_status);
end $$;

create or replace function public.api_finish_webhook_event(p jsonb) returns jsonb
language sql as $$
  update public.webhook_events
     set status = coalesce(p->>'status', 'processed'), error = p->>'error', processed_at = now()
   where id = p->>'id';
  select jsonb_build_object('ok', true);
$$;

-- ---------------------------------------------------------------------------
-- bol-orders: iedere orderregel één keer verwerken
-- ---------------------------------------------------------------------------
create or replace function public.api_bol_import_order(p jsonb) returns jsonb
language plpgsql as $$
declare
  v_order uuid;
  v_number text;
  v_actor text := coalesce(nullif(p->>'actor', ''), 'system:bol');
  it jsonb;
  pr public.products%rowtype;
  v_line uuid;
  v_new int := 0;
  v_dup int := 0;
  v_unmatched jsonb := '[]';
  v_stock text := 'committed';
  c jsonb := p->'customer';
begin
  if coalesce(p->>'bol_order_id', '') = '' then
    raise exception 'bol_order_id_required';
  end if;

  insert into public.orders (channel, bol_order_id, payment_status, stock_status, paid_at, shipping_option,
                             tracking_promised, ship_deadline, email, customer_name, ship_street, ship_house_number,
                             ship_address_extra, ship_postal_code, ship_city, ship_country)
  values ('bol', p->>'bol_order_id', 'paid', 'committed', coalesce((p->>'placed_at')::timestamptz, now()), 'tracked',
          coalesce((public.setting('bol_requires_tracking') #>> '{}')::boolean, true),
          (p->>'ship_deadline')::timestamptz, c->>'email', c->>'name', c->>'street', c->>'house_number',
          c->>'address_extra', upper(c->>'postal_code'), c->>'city', upper(coalesce(c->>'country', 'NL')))
  on conflict (bol_order_id) do nothing;

  select id, number into v_order, v_number from public.orders where bol_order_id = p->>'bol_order_id' for update;

  for it in select * from jsonb_array_elements(coalesce(p->'items', '[]')) loop
    if exists (select 1 from public.order_lines where bol_order_item_id = it->>'order_item_id') then
      v_dup := v_dup + 1;
      continue;
    end if;

    select * into pr from public.products
     where (it->>'offer_id' is not null and bol_offer_id = it->>'offer_id')
        or (it->>'ean' is not null and ean = it->>'ean')
        or (it->>'reference' is not null and bol_reference = it->>'reference')
     order by (bol_offer_id = it->>'offer_id') desc nulls last
     limit 1;
    if not found then
      v_unmatched := v_unmatched || it;
      continue;
    end if;

    insert into public.order_lines (order_id, product_id, sku, title, kind, qty, unit_price_cents, discount_cents,
                                    line_total_cents, bol_order_item_id, components)
    values (v_order, pr.id, pr.sku, coalesce(pr.bol_title, pr.title), pr.kind, (it->>'qty')::int,
            (it->>'unit_price_cents')::int, 0, (it->>'unit_price_cents')::int * (it->>'qty')::int, it->>'order_item_id',
            coalesce((select jsonb_agg(jsonb_build_object('component_id', pc.component_id, 'qty', pc.qty) order by pc.component_id)
                      from public.product_components pc where pc.product_id = pr.id), '[]'))
    on conflict (bol_order_item_id) do nothing
    returning id into v_line;

    if v_line is null then
      v_dup := v_dup + 1;
    else
      v_new := v_new + 1;
    end if;
  end loop;

  update public.orders o set
    subtotal_cents = s.total, total_cents = s.total
  from (select coalesce(sum(line_total_cents), 0)::int as total from public.order_lines where order_id = v_order) s
  where o.id = v_order;

  if v_new > 0 then
    v_stock := public.commit_order_stock(v_order, 'sale_bol', v_actor);
  end if;

  if jsonb_array_length(v_unmatched) > 0 then
    update public.orders set needs_attention = true,
           attention_reason = 'bol-orderregel zonder gekoppeld artikel: ' ||
             (select string_agg(coalesce(u->>'offer_id', u->>'ean', u->>'order_item_id'), ', ') from jsonb_array_elements(v_unmatched) u)
     where id = v_order;
  end if;

  if v_new > 0 then
    perform public.audit(v_actor, 'bol_order_imported', 'order', v_order::text, null,
                         jsonb_build_object('new_lines', v_new, 'duplicates', v_dup, 'stock_status', v_stock));
  end if;

  return jsonb_build_object('ok', true, 'order_id', v_order, 'number', v_number, 'new_lines', v_new,
                            'duplicate_lines', v_dup, 'unmatched', v_unmatched,
                            'stock_status', (select stock_status from public.orders where id = v_order));
end $$;

-- ---------------------------------------------------------------------------
-- bol-synchronisatie: claimen, afronden, reconciliatie
-- ---------------------------------------------------------------------------
create or replace function public.api_bol_sync_claim(p jsonb) returns jsonb
language plpgsql as $$
declare
  v_limit int := coalesce((p->>'limit')::int, 20);
  v_out jsonb := '[]';
  v_token uuid;
  v_value int;
  v_action text;
  r record;
begin
  for r in
    select s.product_id, s.kind, s.status, s.desired_version, s.process_id, s.claimed_value, s.claimed_version,
           pr.bol_offer_id, pr.bol_reference, pr.ean, pr.sku, pr.bol_price_cents
    from public.bol_sync s
    join public.products pr on pr.id = s.product_id
    where pr.bol_enabled
      and ((s.status in ('pending', 'submitted') and s.next_attempt_at <= now())
           or (s.status = 'in_flight' and s.claimed_at < now() - interval '2 minutes'))
    order by s.next_attempt_at
    limit v_limit
    for update of s skip locked
  loop
    v_token := gen_random_uuid();
    -- Is er al een verzoek bij bol ingediend (proces-ID bekend), dan eerst de processtatus controleren,
    -- ook als een eerdere controle werd onderbroken. Nooit blind opnieuw indienen.
    if r.process_id is not null then
      v_action := 'check';
      v_value := r.claimed_value;
      update public.bol_sync set status = 'in_flight', claim_token = v_token, claimed_at = now()
       where product_id = r.product_id and kind = r.kind;
    else
      v_action := 'push';
      v_value := case when r.kind = 'stock' then public.bol_target_stock(r.product_id) else r.bol_price_cents end;
      update public.bol_sync set status = 'in_flight', claim_token = v_token, claimed_at = now(),
                                 claimed_version = r.desired_version, claimed_value = v_value, desired_value = v_value
       where product_id = r.product_id and kind = r.kind;
    end if;
    v_out := v_out || jsonb_build_object('product_id', r.product_id, 'kind', r.kind, 'action', v_action,
                                         'token', v_token, 'value', v_value,
                                         'version', case when v_action = 'check' then r.claimed_version else r.desired_version end,
                                         'process_id', r.process_id, 'offer_id', r.bol_offer_id,
                                         'reference', r.bol_reference, 'ean', r.ean, 'sku', r.sku);
  end loop;
  return jsonb_build_object('ok', true, 'items', v_out);
end $$;

create or replace function public.api_bol_sync_complete(p jsonb) returns jsonb
language plpgsql as $$
declare
  s public.bol_sync%rowtype;
  v_result text := p->>'result'; -- 'done' | 'submitted' | 'error'
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
      attempts = 0, last_error = null, process_id = null, claim_token = null, next_attempt_at = now()
    where product_id = s.product_id and kind = s.kind;
  elsif v_result = 'submitted' then
    update public.bol_sync set status = 'submitted', process_id = coalesce(p->>'process_id', process_id), claim_token = null,
                               next_attempt_at = now() + interval '15 seconds'
    where product_id = s.product_id and kind = s.kind;
  elsif v_result = 'check_error' then
    -- tijdelijke fout bij het opvragen van de processtatus: proces-ID bewaren en later opnieuw controleren
    v_attempts := s.attempts + 1;
    update public.bol_sync set status = case when v_attempts >= 8 then 'failed' else 'submitted' end,
           attempts = v_attempts, last_error = left(coalesce(p->>'error', 'processtatus onbekend'), 500), claim_token = null,
           next_attempt_at = now() + make_interval(secs => least(3600, 30 * power(2, v_attempts - 1)::int))
    where product_id = s.product_id and kind = s.kind;
  else
    v_attempts := s.attempts + 1;
    update public.bol_sync set
      attempts = v_attempts,
      last_error = left(coalesce(p->>'error', 'onbekende fout'), 500),
      status = case when v_attempts >= 5 then 'failed' else 'pending' end,
      process_id = null, claim_token = null,
      next_attempt_at = now() + make_interval(secs => least(3600, 30 * power(2, v_attempts - 1)::int))
    where product_id = s.product_id and kind = s.kind;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Handmatige herpoging vanuit beheer
create or replace function public.api_bol_sync_retry(p jsonb) returns jsonb
language plpgsql as $$
declare v_actor text := public.require_actor(p); v_n int;
begin
  update public.bol_sync set status = 'pending', attempts = 0, next_attempt_at = now(), claim_token = null,
                             desired_version = nextval('public.bol_sync_version_seq')
   where (p->>'product_id' is null or product_id = (p->>'product_id')::uuid)
     and (p->>'kind' is null or kind = p->>'kind')
     and status in ('failed', 'pending', 'synced');
  get diagnostics v_n = row_count;
  perform public.audit(v_actor, 'bol_sync_retry', 'bol_sync', p->>'product_id', null, jsonb_build_object('rows', v_n));
  return jsonb_build_object('ok', true, 'rows', v_n);
end $$;

-- Volledige herberekening (bijv. na buffer- of kanaalwijziging)
create or replace function public.api_bol_sync_enqueue_all(p jsonb) returns jsonb
language plpgsql as $$
declare v_actor text := public.require_actor(p);
begin
  perform public.mark_bol_stock_dirty((select coalesce(array_agg(id), '{}') from public.components));
  perform public.mark_bol_price_dirty(id) from public.products where bol_enabled;
  perform public.audit(v_actor, 'bol_sync_enqueue_all', 'bol_sync', null, null, null);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.api_bol_record_remote(p jsonb) returns jsonb
language plpgsql as $$
declare it jsonb; v_diff int := 0; v_target int;
begin
  for it in select * from jsonb_array_elements(coalesce(p->'items', '[]')) loop
    update public.bol_sync set remote_value = (it->>'remote_value')::int, remote_checked_at = now()
     where product_id = (it->>'product_id')::uuid and kind = coalesce(it->>'kind', 'stock');
    v_target := case when coalesce(it->>'kind', 'stock') = 'stock' then public.bol_target_stock((it->>'product_id')::uuid)
                     else (select bol_price_cents from public.products where id = (it->>'product_id')::uuid) end;
    if (it->>'remote_value')::int is distinct from v_target then
      v_diff := v_diff + 1;
      update public.bol_sync set status = 'pending', next_attempt_at = now(),
                                 desired_version = nextval('public.bol_sync_version_seq')
       where product_id = (it->>'product_id')::uuid and kind = coalesce(it->>'kind', 'stock') and status in ('synced', 'failed');
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'differences', v_diff);
end $$;

-- Gesimuleerde bol-omgeving
create or replace function public.api_bol_sim_apply(p jsonb) returns jsonb
language plpgsql as $$
begin
  insert into public.bol_sim_offers as o (offer_key, stock, price_cents, update_count)
  values (p->>'offer_key', (p->>'stock')::int, (p->>'price_cents')::int, 1)
  on conflict (offer_key) do update set
    stock = coalesce((p->>'stock')::int, o.stock),
    price_cents = coalesce((p->>'price_cents')::int, o.price_cents),
    update_count = o.update_count + 1,
    updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.api_bol_sim_read(p jsonb) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(to_jsonb(o)), '[]') from public.bol_sim_offers o
$$;

-- ---------------------------------------------------------------------------
-- Uitgaande taken (outbox)
-- ---------------------------------------------------------------------------
create or replace function public.api_outbox_claim(p jsonb) returns jsonb
language plpgsql as $$
declare v_out jsonb := '[]'; r record; v_token uuid;
begin
  for r in
    select id, kind, payload, attempts, status, process_id from public.outbox
    where ((status in ('pending', 'submitted') and next_attempt_at <= now())
       or (status = 'in_flight' and claimed_at < now() - interval '2 minutes'))
      and (p->>'kind' is null or kind = p->>'kind')
    order by created_at
    limit coalesce((p->>'limit')::int, 20)
    for update skip locked
  loop
    v_token := gen_random_uuid();
    update public.outbox set status = 'in_flight', claim_token = v_token, claimed_at = now() where id = r.id;
    v_out := v_out || jsonb_build_object('id', r.id, 'kind', r.kind, 'payload', r.payload, 'token', v_token, 'attempts', r.attempts,
                                         'action', case when r.process_id is not null then 'check' else 'push' end,
                                         'process_id', r.process_id);
  end loop;
  return jsonb_build_object('ok', true, 'items', v_out);
end $$;

-- result: 'done' | 'submitted' (asynchroon geaccepteerd, processtatus volgt) | 'error'
create or replace function public.api_outbox_complete(p jsonb) returns jsonb
language plpgsql as $$
declare o public.outbox%rowtype; v_attempts int; v_result text := coalesce(p->>'result', case when (p->>'ok')::boolean then 'done' else 'error' end);
begin
  select * into o from public.outbox where id = (p->>'id')::uuid for update;
  if not found or o.claim_token is distinct from (p->>'token')::uuid then
    return jsonb_build_object('ok', false, 'stale', true);
  end if;
  if v_result = 'done' then
    update public.outbox set status = 'done', done_at = now(), claim_token = null, last_error = null, process_id = null where id = o.id;
  elsif v_result = 'submitted' then
    update public.outbox set status = 'submitted', claim_token = null, process_id = coalesce(p->>'process_id', process_id),
                             next_attempt_at = now() + interval '15 seconds'
     where id = o.id;
  elsif v_result = 'check_error' then
    v_attempts := o.attempts + 1;
    update public.outbox set status = case when v_attempts >= 8 then 'failed' else 'submitted' end, attempts = v_attempts,
           claim_token = null, last_error = left(coalesce(p->>'error', 'processtatus onbekend'), 500),
           next_attempt_at = now() + make_interval(secs => least(3600, 30 * power(2, v_attempts - 1)::int))
     where id = o.id;
  else
    v_attempts := o.attempts + 1;
    update public.outbox set attempts = v_attempts, claim_token = null, process_id = null,
      status = case when v_attempts >= 8 then 'failed' else 'pending' end,
      last_error = left(coalesce(p->>'error', 'onbekende fout'), 500),
      next_attempt_at = now() + make_interval(secs => least(3600, 30 * power(2, v_attempts - 1)::int))
    where id = o.id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.api_outbox_retry(p jsonb) returns jsonb
language plpgsql as $$
declare v_actor text := public.require_actor(p);
begin
  update public.outbox set status = 'pending', attempts = 0, next_attempt_at = now()
   where id = (p->>'id')::uuid and status in ('failed', 'pending');
  perform public.audit(v_actor, 'outbox_retry', 'outbox', p->>'id', null, null);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- E-mail: precies één bericht per order en soort
-- ---------------------------------------------------------------------------
create or replace function public.api_email_claim(p jsonb) returns jsonb
language plpgsql as $$
declare v_id uuid; v_token uuid := gen_random_uuid();
begin
  insert into public.email_log as e (order_id, kind, to_email, status, claim_token)
  values ((p->>'order_id')::uuid, p->>'kind', p->>'to', 'sending', v_token)
  on conflict (order_id, kind) do update
    set status = 'sending', attempts = e.attempts + 1, error = null, to_email = excluded.to_email, claim_token = v_token
    where e.status in ('pending', 'failed') or (e.status = 'sending' and e.updated_at < now() - interval '5 minutes')
  returning id into v_id;
  return jsonb_build_object('ok', true, 'claimed', v_id is not null, 'id', v_id, 'token', case when v_id is not null then v_token end);
end $$;

-- Alleen de poging met het actuele claimtoken mag de uitkomst vastleggen (een oude, vastgelopen poging niet).
create or replace function public.api_email_complete(p jsonb) returns jsonb
language plpgsql as $$
declare v_id uuid;
begin
  update public.email_log set status = p->>'status', provider_id = p->>'provider_id', error = left(p->>'error', 500), claim_token = null
   where id = (p->>'id')::uuid and claim_token = (p->>'token')::uuid and status = 'sending'
  returning id into v_id;
  return jsonb_build_object('ok', v_id is not null, 'stale', v_id is null);
end $$;

-- ---------------------------------------------------------------------------
-- Verzending
-- ---------------------------------------------------------------------------
create or replace function public.order_allowed_carriers(p_order uuid) returns text[]
language sql stable as $$
  select coalesce(array_agg(t.c order by t.ord), '{}')
  from unnest(array['dhl', 'postnl', 'letter']) with ordinality as t(c, ord)
  where not exists (
    select 1 from public.order_lines ol join public.products pr on pr.id = ol.product_id
    where ol.order_id = p_order and not (t.c = any (pr.allowed_carriers))
  )
$$;

create or replace function public.order_address_problems(o public.orders) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(x), '[]') from (
    select 'Naam ontbreekt' as x where coalesce(trim(o.customer_name), '') = ''
    union all select 'Straat ontbreekt' where coalesce(trim(o.ship_street), '') = ''
    union all select 'Huisnummer ontbreekt' where coalesce(trim(o.ship_house_number), '') = ''
    union all select 'Plaats ontbreekt' where coalesce(trim(o.ship_city), '') = ''
    union all select 'Postcode ontbreekt' where coalesce(trim(o.ship_postal_code), '') = ''
    union all select 'Postcode heeft geen geldig NL-formaat'
      where coalesce(o.ship_country, 'NL') = 'NL' and coalesce(trim(o.ship_postal_code), '') <> ''
        and o.ship_postal_code !~ '^[1-9][0-9]{3} ?[A-Z]{2}$'
    union all select 'Land ' || o.ship_country || ' wordt niet ondersteund'
      where o.ship_country is not null and o.ship_country not in ('NL', 'BE')
  ) s
$$;

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

  v_allowed := public.order_allowed_carriers(o.id);
  if o.tracking_promised and not v_override then
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
  end if;
  if not (v_carrier = any (v_allowed)) then
    return jsonb_build_object('ok', false, 'error', 'carrier_not_allowed', 'allowed', to_jsonb(v_allowed),
                              'message', 'Vervoerder niet toegestaan voor deze order (artikelen of trackingbelofte)');
  end if;

  select coalesce(sum(pr.packed_weight_g * ol.qty), 0)::int,
         case when bool_or(pr.package_format = 'parcel') then 'parcel'
              when bool_or(pr.package_format = 'letterbox') then 'letterbox' else 'letter' end
    into v_weight, v_format
  from public.order_lines ol join public.products pr on pr.id = ol.product_id where ol.order_id = o.id;

  select * into s from public.shipments where order_id = o.id and status <> 'cancelled' for update;
  if found then
    if s.carrier <> v_carrier then
      if s.label_status in ('ready', 'creating') then
        return jsonb_build_object('ok', false, 'error', 'label_exists',
                                  'message', 'Er bestaat al een label; annuleer de zending eerst');
      end if;
      update public.shipments set carrier = v_carrier, label_status = 'none', label_error = null,
             status = 'draft', exception_reason = null
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
                         jsonb_build_object('order_id', o.id, 'carrier', v_carrier));
  end if;

  select * into s from public.shipments where order_id = o.id and status <> 'cancelled';
  return jsonb_build_object('ok', true, 'shipment_id', s.id, 'carrier', s.carrier, 'label_status', s.label_status,
                            'allowed', to_jsonb(v_allowed), 'address_problems', public.order_address_problems(o));
end $$;

-- Claim voor labelaanmaak: voorkomt dubbele labels bij dubbelklik of herhaalde gebeurtenissen
create or replace function public.api_label_claim(p jsonb) returns jsonb
language plpgsql as $$
declare
  s public.shipments%rowtype;
  o public.orders%rowtype;
  v_token uuid := gen_random_uuid();
  v_lines jsonb;
begin
  select * into s from public.shipments where id = (p->>'shipment_id')::uuid for update;
  if not found or s.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'error', 'shipment_not_found');
  end if;
  if s.label_status = 'ready' then
    return jsonb_build_object('ok', true, 'reuse', true, 'label_path', s.label_path);
  end if;
  if s.label_status = 'creating' and s.label_claimed_at > now() - interval '2 minutes' then
    return jsonb_build_object('ok', false, 'error', 'busy', 'message', 'Label wordt al aangemaakt');
  end if;
  select * into o from public.orders where id = s.order_id;
  if jsonb_array_length(public.order_address_problems(o)) > 0 then
    update public.shipments set status = 'exception', label_status = 'failed',
           exception_reason = 'Adresprobleem: ' || (select string_agg(x, ', ') from jsonb_array_elements_text(public.order_address_problems(o)) x)
     where id = s.id;
    return jsonb_build_object('ok', false, 'error', 'address_problem', 'problems', public.order_address_problems(o));
  end if;
  update public.shipments set label_status = 'creating', label_claim_token = v_token, label_claimed_at = now(),
                              label_error = null
   where id = s.id;
  select coalesce(jsonb_agg(jsonb_build_object('sku', sku, 'title', title, 'qty', qty)), '[]') into v_lines
    from public.order_lines where order_id = o.id;
  return jsonb_build_object('ok', true, 'reuse', false, 'token', v_token,
    'shipment', jsonb_build_object('id', s.id, 'carrier', s.carrier, 'weight_g', s.weight_g,
                                   'package_format', s.package_format, 'ship_date', s.ship_date),
    'order', jsonb_build_object('id', o.id, 'number', o.number, 'channel', o.channel, 'name', o.customer_name,
                                'street', o.ship_street, 'house_number', o.ship_house_number,
                                'address_extra', o.ship_address_extra, 'postal_code', o.ship_postal_code,
                                'city', o.ship_city, 'country', coalesce(o.ship_country, 'NL'), 'email', o.email,
                                'phone', o.phone, 'lines', v_lines),
    'sender', public.setting('sender_address'));
end $$;

create or replace function public.api_label_complete(p jsonb) returns jsonb
language plpgsql as $$
declare s public.shipments%rowtype;
begin
  select * into s from public.shipments where id = (p->>'shipment_id')::uuid for update;
  if not found or s.label_claim_token is distinct from (p->>'token')::uuid then
    return jsonb_build_object('ok', false, 'stale', true);
  end if;
  if coalesce((p->>'ok')::boolean, false) then
    update public.shipments set
      label_status = 'ready', label_path = p->>'label_path', label_source = p->>'label_source',
      tracking_code = coalesce(p->>'tracking_code', tracking_code), tracking_url = coalesce(p->>'tracking_url', tracking_url),
      carrier_reference = coalesce(p->>'carrier_reference', carrier_reference),
      status = case when status in ('draft', 'exception') then 'label_ready' else status end,
      exception_reason = null, label_error = null, label_claim_token = null
    where id = s.id;
    update public.orders set fulfillment_status = 'label_ready'
     where id = s.order_id and fulfillment_status = 'unfulfilled';
    perform public.audit(coalesce(p->>'actor', 'system'), 'label_created', 'shipment', s.id::text, null,
                         jsonb_build_object('carrier', s.carrier, 'source', p->>'label_source'));
  else
    update public.shipments set label_status = 'failed', status = 'exception', label_claim_token = null,
           label_error = left(p->>'error', 500), exception_reason = 'Labelaanvraag mislukt: ' || left(p->>'error', 300)
     where id = s.id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.api_label_attach_upload(p jsonb) returns jsonb
language plpgsql as $$
declare v_actor text := public.require_actor(p); s public.shipments%rowtype;
begin
  select * into s from public.shipments where id = (p->>'shipment_id')::uuid for update;
  if not found or s.status = 'cancelled' then return jsonb_build_object('ok', false, 'error', 'shipment_not_found'); end if;
  if s.status in ('handed_over', 'in_transit', 'delivered', 'ready_for_pickup') then
    return jsonb_build_object('ok', false, 'error', 'already_shipped');
  end if;
  update public.shipments set label_status = 'ready', label_source = 'uploaded', label_path = p->>'label_path',
         tracking_code = coalesce(nullif(p->>'tracking_code', ''), tracking_code),
         tracking_url = coalesce(nullif(p->>'tracking_url', ''), tracking_url),
         status = case when status in ('draft', 'exception', 'label_ready') then 'label_ready' else status end,
         exception_reason = null, label_error = null, label_claim_token = null
   where id = s.id;
  update public.orders set fulfillment_status = 'label_ready' where id = s.order_id and fulfillment_status = 'unfulfilled';
  perform public.audit(v_actor, 'label_uploaded', 'shipment', s.id::text, jsonb_build_object('label_path', s.label_path),
                       jsonb_build_object('label_path', p->>'label_path'));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.api_shipment_set_tracking(p jsonb) returns jsonb
language plpgsql as $$
declare v_actor text := public.require_actor(p); s public.shipments%rowtype;
begin
  select * into s from public.shipments where id = (p->>'shipment_id')::uuid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'shipment_not_found'); end if;
  if coalesce(trim(p->>'tracking_code'), '') = '' then return jsonb_build_object('ok', false, 'error', 'tracking_required'); end if;
  update public.shipments set tracking_code = trim(p->>'tracking_code'), tracking_url = nullif(trim(p->>'tracking_url'), '')
   where id = s.id;
  perform public.audit(v_actor, 'tracking_set', 'shipment', s.id::text, jsonb_build_object('tracking_code', s.tracking_code),
                       jsonb_build_object('tracking_code', trim(p->>'tracking_code')));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.api_shipment_cancel(p jsonb) returns jsonb
language plpgsql as $$
declare v_actor text := public.require_actor(p); s public.shipments%rowtype;
begin
  select * into s from public.shipments where id = (p->>'shipment_id')::uuid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'shipment_not_found'); end if;
  if s.status in ('handed_over', 'in_transit', 'delivered', 'ready_for_pickup') then
    return jsonb_build_object('ok', false, 'error', 'already_shipped');
  end if;
  update public.shipments set status = 'cancelled' where id = s.id;
  update public.orders set fulfillment_status = 'unfulfilled' where id = s.order_id and fulfillment_status = 'label_ready';
  perform public.audit(v_actor, 'shipment_cancelled', 'shipment', s.id::text, null, null);
  return jsonb_build_object('ok', true);
end $$;

-- Statusovergangen. Rangorde voorkomt terugval (bv. bezorgd -> onderweg).
create or replace function public.shipment_rank(p_status text) returns int
language sql immutable as $$
  select case p_status when 'draft' then 0 when 'exception' then 0 when 'label_ready' then 1 when 'handed_over' then 2
                       when 'in_transit' then 3 when 'ready_for_pickup' then 4 when 'delivered' then 5 else -1 end
$$;

create or replace function public.apply_shipment_status(p_shipment uuid, p_status text, p_actor text, p_manual boolean,
                                                        p_detail text) returns jsonb
language plpgsql as $$
declare
  s public.shipments%rowtype;
  o public.orders%rowtype;
  v_first_handover boolean := false;
begin
  select * into s from public.shipments where id = p_shipment for update;
  if not found or s.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'error', 'shipment_not_found');
  end if;
  select * into o from public.orders where id = s.order_id for update;

  if p_status = 'exception' then
    update public.shipments set status = 'exception', exception_reason = coalesce(p_detail, 'Vervoerdersuitzondering')
     where id = s.id and status not in ('delivered');
    return jsonb_build_object('ok', true, 'first_handover', false);
  end if;

  if p_status in ('handed_over', 'in_transit', 'ready_for_pickup', 'delivered') then
    if s.label_status <> 'ready' then
      return jsonb_build_object('ok', false, 'error', 'label_missing', 'message', 'Geen label aanwezig');
    end if;
    if s.carrier <> 'letter' and coalesce(s.tracking_code, '') = '' then
      return jsonb_build_object('ok', false, 'error', 'tracking_missing', 'message', 'Trackingcode ontbreekt');
    end if;
  end if;

  v_first_handover := s.handed_over_at is null and p_status in ('handed_over', 'in_transit', 'ready_for_pickup', 'delivered');

  if public.shipment_rank(p_status) > public.shipment_rank(s.status) or s.status = 'exception' then
    update public.shipments set
      status = p_status,
      handed_over_at = coalesce(handed_over_at, case when v_first_handover then now() end),
      handover_manual = case when v_first_handover then p_manual else handover_manual end,
      delivered_at = case when p_status = 'delivered' then now() else delivered_at end,
      exception_reason = null
    where id = s.id;
    update public.orders set fulfillment_status = case p_status
        when 'delivered' then 'delivered' when 'ready_for_pickup' then 'ready_for_pickup' else 'shipped' end
     where id = o.id and fulfillment_status not in ('cancelled', 'returned');
  elsif v_first_handover then
    update public.shipments set handed_over_at = now(), handover_manual = p_manual where id = s.id;
  end if;

  if v_first_handover then
    perform public.enqueue_email(o.id, 'shipped');
    if o.channel = 'bol' then
      insert into public.outbox (kind, dedupe_key, payload)
      values ('bol_shipment', 'bol_shipment:' || o.id,
              jsonb_build_object('order_id', o.id, 'shipment_id', s.id))
      on conflict (dedupe_key) do nothing;
    end if;
    perform public.audit(p_actor, case when p_manual then 'handover_confirmed_manual' else 'handover_carrier_scan' end,
                         'shipment', s.id::text, null, jsonb_build_object('status', p_status));
  end if;

  return jsonb_build_object('ok', true, 'first_handover', v_first_handover, 'order_id', o.id, 'channel', o.channel,
                            'send_shipped_email', v_first_handover and o.channel = 'web');
end $$;

create or replace function public.api_shipment_handover(p jsonb) returns jsonb
language plpgsql as $$
declare v_actor text := public.require_actor(p);
begin
  return public.apply_shipment_status((p->>'shipment_id')::uuid, 'handed_over', v_actor, true, null);
end $$;

-- Vervoerdersgebeurtenis (webhook, polling of simulatie). Dubbele gebeurtenissen worden genegeerd.
create or replace function public.api_shipment_carrier_event(p jsonb) returns jsonb
language plpgsql as $$
declare
  v_shipment uuid;
  v_inserted uuid;
begin
  if p->>'shipment_id' is not null then
    v_shipment := (p->>'shipment_id')::uuid;
  else
    select id into v_shipment from public.shipments
     where tracking_code = p->>'tracking_code' and status <> 'cancelled' limit 1;
  end if;
  if v_shipment is null then
    return jsonb_build_object('ok', false, 'error', 'shipment_not_found');
  end if;
  if p->>'status' not in ('handed_over', 'in_transit', 'ready_for_pickup', 'delivered', 'exception') then
    raise exception 'invalid_status';
  end if;
  insert into public.shipment_events (shipment_id, event_key, status, source, detail)
  values (v_shipment, p->>'event_key', p->>'status', coalesce(p->>'source', 'carrier'), p->>'detail')
  on conflict (event_key) do nothing
  returning id into v_inserted;
  if v_inserted is null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'first_handover', false, 'send_shipped_email', false);
  end if;
  return public.apply_shipment_status(v_shipment, p->>'status', coalesce(p->>'actor', 'system:carrier'), false, p->>'detail');
end $$;

-- ---------------------------------------------------------------------------
-- Beheer: prijzen, voorraad, artikelen, acties, instellingen
-- ---------------------------------------------------------------------------
create or replace function public.api_set_price(p jsonb) returns jsonb
language plpgsql as $$
declare
  v_actor text := public.require_actor(p);
  pr public.products%rowtype;
  v_channel text := p->>'channel';
  v_new int := (p->>'price_cents')::int;
  v_old int;
begin
  if v_channel not in ('web', 'bol') then raise exception 'invalid_channel'; end if;
  if v_new is null or v_new < 0 or v_new > 100000 then raise exception 'invalid_price'; end if;
  select * into pr from public.products where id = (p->>'product_id')::uuid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'product_not_found'); end if;
  if v_channel = 'bol' and pr.kind = 'bundle' then
    return jsonb_build_object('ok', false, 'error', 'bundle_web_only');
  end if;
  v_old := case when v_channel = 'web' then pr.web_price_cents else pr.bol_price_cents end;
  if v_channel = 'web' then
    update public.products set web_price_cents = v_new where id = pr.id;
  else
    update public.products set bol_price_cents = v_new where id = pr.id;
    perform public.mark_bol_price_dirty(pr.id);
  end if;
  perform public.audit(v_actor, 'price_change', 'product', pr.id::text,
                       jsonb_build_object('channel', v_channel, 'price_cents', v_old, 'sku', pr.sku),
                       jsonb_build_object('channel', v_channel, 'price_cents', v_new, 'sku', pr.sku,
                                          'source', coalesce(p->>'source', 'manual')));
  return jsonb_build_object('ok', true, 'product_id', pr.id, 'sku', pr.sku, 'channel', v_channel,
                            'old_cents', v_old, 'new_cents', v_new,
                            'bol_sync', case when v_channel = 'bol' then
                              (case when pr.bol_enabled then 'pending' else 'kanaal_uit' end) end);
end $$;

create or replace function public.api_stock_correct(p jsonb) returns jsonb
language plpgsql as $$
declare
  v_actor text := public.require_actor(p);
  c public.components%rowtype;
  v_new int;
  v_reserved int;
begin
  if coalesce(trim(p->>'reason'), '') = '' then raise exception 'reason_required'; end if;
  select * into c from public.components where id = (p->>'component_id')::uuid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'component_not_found'); end if;
  v_new := case when p->>'mode' = 'set' then (p->>'value')::int else c.on_hand + (p->>'value')::int end;
  if v_new < 0 then return jsonb_build_object('ok', false, 'error', 'negative_stock'); end if;
  if v_new = c.on_hand then return jsonb_build_object('ok', true, 'unchanged', true, 'on_hand', v_new); end if;
  update public.components set on_hand = v_new where id = c.id;
  insert into public.stock_movements (component_id, delta, on_hand_after, reason, actor, note)
  values (c.id, v_new - c.on_hand, v_new, 'correction', v_actor, trim(p->>'reason'));
  perform public.audit(v_actor, 'stock_correction', 'component', c.id::text,
                       jsonb_build_object('on_hand', c.on_hand, 'code', c.code),
                       jsonb_build_object('on_hand', v_new, 'reason', trim(p->>'reason')));
  perform public.mark_bol_stock_dirty(array[c.id]);
  v_reserved := public.component_reserved(c.id);
  return jsonb_build_object('ok', true, 'on_hand', v_new, 'reserved', v_reserved,
                            'warning', case when v_new < v_reserved then 'Minder voorraad dan open reserveringen' end);
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
  else
    if v_kind <> 'bundle' then
      raise exception 'only_bundles_can_be_created';
    end if;
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
  end if;

  -- samenstelling alleen aanpasbaar voor bundels (sets/hoesjes volgen de fysieke telling)
  if v_comps is not null and pr.kind = 'bundle' then
    if jsonb_array_length(v_comps) = 0 then raise exception 'bundle_needs_components'; end if;
    -- oude én nieuwe componenten: bol-standen van artikelen die deze delen opnieuw berekenen
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

create or replace function public.api_discount_save(p jsonb) returns jsonb
language plpgsql as $$
declare
  v_actor text := public.require_actor(p);
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_before jsonb;
  r public.discount_rules%rowtype;
begin
  if v_id is null then
    insert into public.discount_rules (name, min_qty, discount_type, value, active, starts_at, ends_at)
    values (p->>'name', (p->>'min_qty')::int, p->>'discount_type', (p->>'value')::int,
            coalesce((p->>'active')::boolean, true), nullif(p->>'starts_at', '')::timestamptz, nullif(p->>'ends_at', '')::timestamptz)
    returning * into r;
  else
    select to_jsonb(x) into v_before from public.discount_rules x where id = v_id for update;
    update public.discount_rules set name = p->>'name', min_qty = (p->>'min_qty')::int, discount_type = p->>'discount_type',
           value = (p->>'value')::int, active = coalesce((p->>'active')::boolean, true),
           starts_at = nullif(p->>'starts_at', '')::timestamptz, ends_at = nullif(p->>'ends_at', '')::timestamptz
     where id = v_id returning * into r;
    if not found then return jsonb_build_object('ok', false, 'error', 'rule_not_found'); end if;
  end if;
  if p->'product_ids' is not null then
    delete from public.discount_rule_products where rule_id = r.id;
    insert into public.discount_rule_products (rule_id, product_id)
    select r.id, x::uuid from jsonb_array_elements_text(p->'product_ids') x;
  end if;
  perform public.audit(v_actor, case when v_id is null then 'discount_created' else 'discount_updated' end,
                       'discount_rule', r.id::text, v_before,
                       to_jsonb(r) || jsonb_build_object('product_ids', p->'product_ids'));
  return jsonb_build_object('ok', true, 'id', r.id);
end $$;

create or replace function public.api_discount_delete(p jsonb) returns jsonb
language plpgsql as $$
declare v_actor text := public.require_actor(p); v_before jsonb;
begin
  select to_jsonb(x) into v_before from public.discount_rules x where id = (p->>'id')::uuid;
  delete from public.discount_rules where id = (p->>'id')::uuid;
  perform public.audit(v_actor, 'discount_deleted', 'discount_rule', p->>'id', v_before, null);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.api_setting_save(p jsonb) returns jsonb
language plpgsql as $$
declare v_actor text := public.require_actor(p); v_before jsonb;
begin
  if p->>'key' not in ('bol_buffer_units', 'reservation_minutes', 'shipping_options', 'delivery_promise',
                       'sender_address', 'bol_requires_tracking', 'tracking_info') then
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

create or replace function public.api_order_update_address(p jsonb) returns jsonb
language plpgsql as $$
declare v_actor text := public.require_actor(p); o public.orders%rowtype;
begin
  select * into o from public.orders where id = (p->>'order_id')::uuid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'order_not_found'); end if;
  if exists (select 1 from public.shipments where order_id = o.id and label_status = 'ready' and status <> 'cancelled') then
    return jsonb_build_object('ok', false, 'error', 'label_exists', 'message', 'Annuleer eerst de zending met het bestaande label');
  end if;
  update public.orders set
    customer_name = nullif(trim(p->>'name'), ''),
    ship_street = nullif(trim(p->>'street'), ''),
    ship_house_number = nullif(trim(p->>'house_number'), ''),
    ship_address_extra = nullif(trim(p->>'address_extra'), ''),
    ship_postal_code = nullif(upper(trim(p->>'postal_code')), ''),
    ship_city = nullif(trim(p->>'city'), ''),
    ship_country = coalesce(nullif(upper(trim(p->>'country')), ''), 'NL')
  where id = o.id;
  update public.shipments set status = 'draft', label_status = 'none', exception_reason = null, label_error = null
   where order_id = o.id and status = 'exception' and label_status in ('failed', 'none');
  perform public.audit(v_actor, 'address_updated', 'order', o.id::text, null, null);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Annuleren, refunds en retouren
-- ---------------------------------------------------------------------------
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
    return jsonb_build_object('ok', true, 'already', true);
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
  update public.orders set fulfillment_status = 'cancelled', stock_status = 'released', cancelled_at = now(),
         needs_attention = false, attention_reason = null
   where id = o.id;
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
  return jsonb_build_object('ok', true, 'stock_status', v_stock);
end $$;

create or replace function public.api_refund_begin(p jsonb) returns jsonb
language plpgsql as $$
declare
  v_actor text := public.require_actor(p);
  o public.orders%rowtype;
  v_amount int := (p->>'amount_cents')::int;
  v_open int;
  v_id uuid;
begin
  select * into o from public.orders where id = (p->>'order_id')::uuid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'order_not_found'); end if;
  if o.channel <> 'web' or o.stripe_payment_intent_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_refundable', 'message', 'Alleen betaalde webshoporders');
  end if;
  select coalesce(sum(amount_cents), 0) into v_open from public.refunds where order_id = o.id and status in ('pending', 'succeeded');
  if v_amount is null or v_amount <= 0 or v_amount > o.total_cents - v_open then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount', 'max_cents', o.total_cents - v_open);
  end if;
  insert into public.refunds (order_id, amount_cents, idempotency_key, reason, created_by)
  values (o.id, v_amount, p->>'idempotency_key', nullif(p->>'reason', ''), v_actor)
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.refunds where idempotency_key = p->>'idempotency_key';
    return jsonb_build_object('ok', true, 'duplicate', true, 'refund_id', v_id);
  end if;
  perform public.audit(v_actor, 'refund_requested', 'order', o.id::text, null, jsonb_build_object('amount_cents', v_amount));
  return jsonb_build_object('ok', true, 'refund_id', v_id, 'payment_intent_id', o.stripe_payment_intent_id,
                            'amount_cents', v_amount, 'idempotency_key', p->>'idempotency_key');
end $$;

create or replace function public.api_refund_finish(p jsonb) returns jsonb
language plpgsql as $$
declare rf public.refunds%rowtype; v_total int;
begin
  select * into rf from public.refunds where id = (p->>'refund_id')::uuid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'refund_not_found'); end if;
  if rf.status <> 'pending' then return jsonb_build_object('ok', true, 'already', true); end if;
  if coalesce((p->>'ok')::boolean, false) then
    update public.refunds set status = 'succeeded', provider_refund_id = p->>'provider_refund_id' where id = rf.id;
    perform 1 from public.orders where id = rf.order_id for update;
    select coalesce(sum(amount_cents), 0) into v_total from public.refunds where order_id = rf.order_id and status = 'succeeded';
    update public.orders set refunded_cents = v_total,
           payment_status = case when v_total >= total_cents then 'refunded' else 'partially_refunded' end
     where id = rf.order_id;
    perform public.audit(rf.created_by, 'refund_succeeded', 'order', rf.order_id::text, null,
                         jsonb_build_object('amount_cents', rf.amount_cents, 'provider_refund_id', p->>'provider_refund_id'));
  else
    update public.refunds set status = 'failed', error = left(p->>'error', 500) where id = rf.id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Refund die buiten de app (bv. Stripe-dashboard) is gedaan
create or replace function public.api_refund_external(p jsonb) returns jsonb
language plpgsql as $$
declare o public.orders%rowtype; v_total int;
begin
  select * into o from public.orders where stripe_payment_intent_id = p->>'payment_intent_id' for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'order_not_found'); end if;
  insert into public.refunds (order_id, amount_cents, status, provider_refund_id, idempotency_key, reason, created_by)
  values (o.id, (p->>'amount_cents')::int, 'succeeded', p->>'provider_refund_id', 'ext:' || (p->>'provider_refund_id'),
          'Extern (Stripe)', 'system:stripe')
  on conflict do nothing;
  select coalesce(sum(amount_cents), 0) into v_total from public.refunds where order_id = o.id and status = 'succeeded';
  update public.orders set refunded_cents = v_total,
         payment_status = case when v_total >= total_cents then 'refunded' when v_total > 0 then 'partially_refunded' else payment_status end
   where id = o.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.api_return_create(p jsonb) returns jsonb
language plpgsql as $$
declare
  v_actor text := public.require_actor(p);
  v_ret uuid;
  it jsonb;
  ol public.order_lines%rowtype;
  v_already int;
begin
  perform 1 from public.orders where id = (p->>'order_id')::uuid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'order_not_found'); end if;
  insert into public.returns (order_id, note, created_by) values ((p->>'order_id')::uuid, nullif(p->>'note', ''), v_actor)
  returning id into v_ret;
  for it in select * from jsonb_array_elements(coalesce(p->'lines', '[]')) loop
    if coalesce((it->>'qty')::int, 0) <= 0 then continue; end if;
    select * into ol from public.order_lines where id = (it->>'order_line_id')::uuid and order_id = (p->>'order_id')::uuid;
    if not found then raise exception 'order_line_not_found'; end if;
    select coalesce(sum(rl.qty), 0) into v_already from public.return_lines rl where rl.order_line_id = ol.id;
    if v_already + (it->>'qty')::int > ol.qty then
      raise exception 'return_qty_exceeds_order';
    end if;
    insert into public.return_lines (return_id, order_line_id, qty) values (v_ret, ol.id, (it->>'qty')::int);
  end loop;
  if not exists (select 1 from public.return_lines where return_id = v_ret) then
    raise exception 'return_needs_lines';
  end if;
  perform public.audit(v_actor, 'return_created', 'order', p->>'order_id', null, p->'lines');
  return jsonb_build_object('ok', true, 'return_id', v_ret);
end $$;

-- Beheerder beslist per retourregel: weer verkoopbaar (restock) of afboeken (writeoff)
create or replace function public.api_return_decide(p jsonb) returns jsonb
language plpgsql as $$
declare
  v_actor text := public.require_actor(p);
  rl public.return_lines%rowtype;
  ol public.order_lines%rowtype;
  v_decision text := p->>'decision';
  v_after int;
  c jsonb;
  v_comps uuid[];
begin
  if v_decision not in ('restock', 'writeoff') then raise exception 'invalid_decision'; end if;
  select * into rl from public.return_lines where id = (p->>'return_line_id')::uuid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'return_line_not_found'); end if;
  if rl.decision <> 'pending' then
    return jsonb_build_object('ok', true, 'already', true, 'decision', rl.decision);
  end if;
  select * into ol from public.order_lines where id = rl.order_line_id;
  if v_decision = 'restock' then
    select array_agg((x->>'component_id')::uuid order by (x->>'component_id')::uuid) into v_comps from jsonb_array_elements(ol.components) x;
    perform 1 from public.components where id = any (v_comps) order by id for update;
    for c in select * from jsonb_array_elements(ol.components) loop
      update public.components set on_hand = on_hand + (c->>'qty')::int * rl.qty
       where id = (c->>'component_id')::uuid returning on_hand into v_after;
      insert into public.stock_movements (component_id, delta, on_hand_after, reason, order_id, actor, note)
      values ((c->>'component_id')::uuid, (c->>'qty')::int * rl.qty, v_after, 'return_restock', ol.order_id, v_actor,
              'Retour ' || rl.return_id);
    end loop;
    perform public.mark_bol_stock_dirty(v_comps);
  end if;
  update public.return_lines set decision = v_decision, decided_by = v_actor, decided_at = now() where id = rl.id;
  if not exists (select 1 from public.return_lines where return_id = rl.return_id and decision = 'pending') then
    update public.returns set status = 'closed', closed_at = now() where id = rl.return_id;
  end if;
  perform public.audit(v_actor, 'return_decision', 'return_line', rl.id::text, null,
                       jsonb_build_object('decision', v_decision, 'qty', rl.qty, 'sku', ol.sku));
  return jsonb_build_object('ok', true, 'decision', v_decision);
end $$;

-- ---------------------------------------------------------------------------
-- AI-prijsassistent: voorstel opslaan en bevestigde wijzigingen toepassen via api_set_price
-- ---------------------------------------------------------------------------
create or replace function public.api_ai_proposal_create(p jsonb) returns jsonb
language plpgsql as $$
declare v_actor text := public.require_actor(p); v_id uuid; v_items jsonb := '[]'; it jsonb; pr public.products%rowtype;
begin
  for it in select * from jsonb_array_elements(coalesce(p->'items', '[]')) loop
    select * into pr from public.products where id = (it->>'product_id')::uuid;
    if not found then continue; end if;
    if it->>'channel' not in ('web', 'bol') then continue; end if;
    if it->>'channel' = 'bol' and pr.kind = 'bundle' then continue; end if;
    v_items := v_items || jsonb_build_object(
      'product_id', pr.id, 'sku', pr.sku, 'title', pr.title, 'channel', it->>'channel',
      'old_cents', case when it->>'channel' = 'web' then pr.web_price_cents else pr.bol_price_cents end,
      'new_cents', (it->>'new_cents')::int, 'bol_enabled', pr.bol_enabled);
  end loop;
  insert into public.ai_price_proposals (created_by, prompt, provider, items)
  values (v_actor, p->>'prompt', coalesce(p->>'provider', 'rule-based-test'), v_items)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'items', v_items);
end $$;

create or replace function public.api_ai_proposal_apply(p jsonb) returns jsonb
language plpgsql as $$
declare
  v_actor text := public.require_actor(p);
  pr public.ai_price_proposals%rowtype;
  it jsonb;
  v_res jsonb := '[]';
  v_one jsonb;
  v_selected jsonb := p->'selected';
begin
  select * into pr from public.ai_price_proposals where id = (p->>'id')::uuid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'proposal_not_found'); end if;
  if pr.status <> 'proposed' then return jsonb_build_object('ok', false, 'error', 'already_decided', 'result', pr.result); end if;
  for it in select * from jsonb_array_elements(pr.items) loop
    if v_selected is not null and not (v_selected ? ((it->>'product_id') || ':' || (it->>'channel'))) then
      continue;
    end if;
    -- prijs gewijzigd sinds voorstel? dan niet blind overschrijven
    if (select case when it->>'channel' = 'web' then web_price_cents else bol_price_cents end
          from public.products where id = (it->>'product_id')::uuid) is distinct from (it->>'old_cents')::int then
      v_res := v_res || (it || jsonb_build_object('applied', false, 'error', 'Prijs is intussen gewijzigd'));
      continue;
    end if;
    v_one := public.api_set_price(jsonb_build_object('product_id', it->>'product_id', 'channel', it->>'channel',
                                                     'price_cents', (it->>'new_cents')::int, 'actor', v_actor, 'source', 'ai'));
    v_res := v_res || (it || jsonb_build_object('applied', (v_one->>'ok')::boolean, 'bol_sync', v_one->>'bol_sync'));
  end loop;
  update public.ai_price_proposals set status = 'applied', result = v_res, decided_at = now(), decided_by = v_actor
   where id = pr.id;
  return jsonb_build_object('ok', true, 'result', v_res);
end $$;

create or replace function public.api_ai_proposal_cancel(p jsonb) returns jsonb
language plpgsql as $$
declare v_actor text := public.require_actor(p);
begin
  update public.ai_price_proposals set status = 'cancelled', decided_at = now(), decided_by = v_actor
   where id = (p->>'id')::uuid and status = 'proposed';
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Beheerders
-- ---------------------------------------------------------------------------
create or replace function public.api_admin_lookup(p jsonb) returns jsonb
language sql stable as $$
  select coalesce((select jsonb_build_object('user_id', user_id, 'email', email, 'role', role)
                     from public.admin_users where user_id = (p->>'user_id')::uuid and active), 'null'::jsonb)
$$;

create or replace function public.api_admin_upsert(p jsonb) returns jsonb
language plpgsql as $$
declare v_actor text := public.require_actor(p);
begin
  if p->>'role' not in ('owner', 'admin', 'fulfilment') then raise exception 'invalid_role'; end if;
  insert into public.admin_users (user_id, email, role, active)
  values ((p->>'user_id')::uuid, lower(p->>'email'), p->>'role', coalesce((p->>'active')::boolean, true))
  on conflict (user_id) do update set email = excluded.email, role = excluded.role, active = excluded.active;
  perform public.audit(v_actor, 'admin_upsert', 'admin_user', p->>'user_id', null,
                       jsonb_build_object('email', lower(p->>'email'), 'role', p->>'role', 'active', coalesce((p->>'active')::boolean, true)));
  return jsonb_build_object('ok', true);
end $$;

select public.lockdown_privileges();
