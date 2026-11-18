-- Timber Online 2.0 · TO-BUILD-01 · leesfuncties voor storefront en beheer

create or replace function public.active_discounts_json(p_product uuid) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', dr.id, 'name', dr.name, 'min_qty', dr.min_qty,
                                               'discount_type', dr.discount_type, 'value', dr.value) order by dr.min_qty), '[]')
  from public.discount_rule_products drp
  join public.discount_rules dr on dr.id = drp.rule_id
  join public.products pr on pr.id = drp.product_id
  where drp.product_id = p_product and pr.allow_tier_discount and dr.active
    and (dr.starts_at is null or dr.starts_at <= now()) and (dr.ends_at is null or dr.ends_at > now())
$$;

create or replace function public.api_catalog(p jsonb) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pr.id, 'sku', pr.sku, 'slug', pr.slug, 'kind', pr.kind, 'product_type', pr.product_type,
        'title', pr.title, 'subtitle', pr.subtitle, 'description', pr.description, 'ean', pr.ean,
        'price_cents', pr.web_price_cents, 'image_path', pr.image_path,
        'available_units', coalesce(pa.available_units, 0),
        'devices', coalesce((select jsonb_agg(jsonb_build_object('slug', d.slug, 'name', d.name) order by d.sort)
                             from public.product_devices pd join public.devices d on d.slug = pd.device_slug
                             where pd.product_id = pr.id and pd.confirmed), '[]'),
        'components', coalesce((select jsonb_agg(jsonb_build_object('name', c.name, 'kind', c.kind, 'qty', pc.qty) order by c.kind desc)
                                from public.product_components pc join public.components c on c.id = pc.component_id
                                where pc.product_id = pr.id), '[]'),
        'tier_discounts', public.active_discounts_json(pr.id)
      ) order by pr.sort, pr.title)
      from public.products pr
      left join public.product_availability pa on pa.product_id = pr.id
      where pr.status = 'active' and pr.web_enabled
    ), '[]'),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object('slug', d.slug, 'name', d.name, 'family', d.family) order by d.sort)
      from public.devices d
      where exists (select 1 from public.product_devices pd join public.products pr on pr.id = pd.product_id
                    where pd.device_slug = d.slug and pd.confirmed and pr.status = 'active' and pr.web_enabled)
    ), '[]'),
    'settings', jsonb_build_object(
      'delivery_promise', public.setting('delivery_promise') #>> '{}',
      'tracking_info', public.setting('tracking_info') #>> '{}',
      'shipping_options', (select coalesce(jsonb_agg(o), '[]') from jsonb_array_elements(coalesce(public.setting('shipping_options'), '[]')) o
                           where coalesce((o->>'enabled')::boolean, true))
    )
  )
$$;

-- Bedankpagina: alleen met overeenkomende Stripe-sessie
create or replace function public.api_order_public(p jsonb) returns jsonb
language sql stable as $$
  select coalesce((
    select jsonb_build_object(
      'number', o.number, 'payment_status', o.payment_status, 'stock_status', o.stock_status,
      'fulfillment_status', o.fulfillment_status, 'subtotal_cents', o.subtotal_cents, 'discount_cents', o.discount_cents,
      'shipping_cents', o.shipping_cents, 'total_cents', o.total_cents, 'delivery_promise', o.delivery_promise,
      'lines', (select coalesce(jsonb_agg(jsonb_build_object('title', ol.title, 'qty', ol.qty, 'line_total_cents', ol.line_total_cents)
                                          order by ol.created_at), '[]') from public.order_lines ol where ol.order_id = o.id))
    from public.orders o
    where o.id = (p->>'order_id')::uuid and o.stripe_session_id is not null and o.stripe_session_id = p->>'session_id'
  ), 'null'::jsonb)
$$;

create or replace function public.api_order_for_email(p jsonb) returns jsonb
language sql stable as $$
  select coalesce((
    select jsonb_build_object(
      'id', o.id, 'number', o.number, 'channel', o.channel, 'email', o.email, 'customer_name', o.customer_name,
      'subtotal_cents', o.subtotal_cents, 'discount_cents', o.discount_cents, 'shipping_cents', o.shipping_cents,
      'total_cents', o.total_cents, 'delivery_promise', o.delivery_promise, 'shipping_option', o.shipping_option,
      'tracking_promised', o.tracking_promised, 'stock_status', o.stock_status,
      'address', jsonb_build_object('street', o.ship_street, 'house_number', o.ship_house_number, 'extra', o.ship_address_extra,
                                    'postal_code', o.ship_postal_code, 'city', o.ship_city, 'country', o.ship_country),
      'lines', (select coalesce(jsonb_agg(jsonb_build_object('title', ol.title, 'sku', ol.sku, 'qty', ol.qty,
                                                             'unit_price_cents', ol.unit_price_cents, 'discount_cents', ol.discount_cents,
                                                             'line_total_cents', ol.line_total_cents) order by ol.created_at), '[]')
                from public.order_lines ol where ol.order_id = o.id),
      'shipment', (select jsonb_build_object('carrier', s.carrier, 'tracking_code', s.tracking_code, 'tracking_url', s.tracking_url,
                                             'status', s.status)
                   from public.shipments s where s.order_id = o.id and s.status <> 'cancelled' limit 1))
    from public.orders o where o.id = (p->>'order_id')::uuid
  ), 'null'::jsonb)
$$;

-- ---------------------------------------------------------------------------
-- Beheer
-- ---------------------------------------------------------------------------
create or replace function public.api_admin_overview(p jsonb) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'orders_pending', (select count(*) from public.orders where payment_status = 'pending'),
    'orders_to_ship', (select count(*) from public.orders o where o.payment_status in ('paid', 'partially_refunded')
                         and o.stock_status = 'committed' and o.fulfillment_status in ('unfulfilled', 'label_ready')),
    'attention', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'number', number, 'channel', channel,
                                                              'reason', attention_reason, 'created_at', created_at) order by created_at desc)
                           from public.orders where needs_attention), '[]'),
    'low_stock', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', name, 'free', free, 'on_hand', on_hand) order by free)
                           from public.component_stock where free <= low_stock_threshold), '[]'),
    'bol_failed', (select count(*) from public.bol_sync where status = 'failed'),
    'bol_pending', (select count(*) from public.bol_sync where status in ('pending', 'in_flight', 'submitted')),
    'shipment_exceptions', (select count(*) from public.shipments where status = 'exception'),
    'email_failed', (select count(*) from public.email_log where status = 'failed'),
    'outbox_failed', (select count(*) from public.outbox where status = 'failed'),
    'stock_totals', (select jsonb_build_object('protectors', coalesce(sum(on_hand) filter (where kind = 'protector'), 0),
                                               'cases', coalesce(sum(on_hand) filter (where kind = 'case'), 0),
                                               'reserved', coalesce(sum(reserved), 0))
                     from public.component_stock)
  )
$$;

create or replace function public.admin_product_json(pr public.products) returns jsonb
language sql stable as $$
  select to_jsonb(pr) || jsonb_build_object(
    'available_units', (select available_units from public.product_availability where product_id = pr.id),
    'bol_target_stock', public.bol_target_stock(pr.id),
    'components', coalesce((select jsonb_agg(jsonb_build_object('component_id', c.id, 'code', c.code, 'name', c.name, 'qty', pc.qty,
                                                               'free', cs.free, 'on_hand', cs.on_hand) order by c.code)
                            from public.product_components pc join public.components c on c.id = pc.component_id
                            join public.component_stock cs on cs.id = c.id where pc.product_id = pr.id), '[]'),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('slug', d.slug, 'name', d.name, 'confirmed', pd.confirmed) order by d.sort)
                         from public.product_devices pd join public.devices d on d.slug = pd.device_slug where pd.product_id = pr.id), '[]'),
    'bol_sync', coalesce((select jsonb_object_agg(s.kind, jsonb_build_object('status', s.status, 'desired_value', s.desired_value,
                                                                             'pushed_value', s.pushed_value, 'last_error', s.last_error,
                                                                             'remote_value', s.remote_value, 'updated_at', s.updated_at))
                          from public.bol_sync s where s.product_id = pr.id), '{}'),
    'discount_rule_ids', coalesce((select jsonb_agg(rule_id) from public.discount_rule_products where product_id = pr.id), '[]')
  )
$$;

create or replace function public.api_admin_products(p jsonb) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(public.admin_product_json(pr) order by pr.sort, pr.sku), '[]')
  from public.products pr
  where (p->>'id' is null or pr.id = (p->>'id')::uuid)
$$;

create or replace function public.api_admin_components(p jsonb) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'components', coalesce((select jsonb_agg(to_jsonb(cs) || jsonb_build_object(
                     'products', (select coalesce(jsonb_agg(jsonb_build_object('sku', pr.sku, 'qty', pc.qty, 'status', pr.status)), '[]')
                                  from public.product_components pc join public.products pr on pr.id = pc.product_id
                                  where pc.component_id = cs.id)) order by cs.kind desc, cs.code)
                   from public.component_stock cs), '[]'),
    'movements', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'code', c.code, 'delta', m.delta,
                                                              'on_hand_after', m.on_hand_after, 'reason', m.reason, 'actor', m.actor,
                                                              'note', m.note, 'order_number', o.number, 'created_at', m.created_at)
                                           order by m.id desc)
                           from (select * from public.stock_movements
                                 where p->>'component_id' is null or component_id = (p->>'component_id')::uuid
                                 order by id desc limit coalesce((p->>'limit')::int, 100)) m
                           join public.components c on c.id = m.component_id
                           left join public.orders o on o.id = m.order_id), '[]')
  )
$$;

create or replace function public.api_admin_orders(p jsonb) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id, 'number', o.number, 'channel', o.channel, 'payment_status', o.payment_status,
    'stock_status', o.stock_status, 'fulfillment_status', o.fulfillment_status, 'customer_name', o.customer_name,
    'email', o.email, 'total_cents', o.total_cents, 'created_at', o.created_at, 'needs_attention', o.needs_attention,
    'attention_reason', o.attention_reason,
    'items', (select coalesce(sum(qty), 0) from public.order_lines where order_id = o.id)
  ) order by o.created_at desc), '[]')
  from (
    select * from public.orders o
    where (p->>'channel' is null or o.channel = p->>'channel')
      and (p->>'payment_status' is null or o.payment_status = p->>'payment_status')
      and (coalesce((p->>'attention')::boolean, false) = false or o.needs_attention)
      and (p->>'q' is null or o.number ilike '%' || (p->>'q') || '%' or o.email ilike '%' || (p->>'q') || '%'
           or o.customer_name ilike '%' || (p->>'q') || '%' or o.bol_order_id ilike '%' || (p->>'q') || '%')
    order by o.created_at desc
    limit coalesce((p->>'limit')::int, 100)
  ) o
$$;

create or replace function public.api_admin_order(p jsonb) returns jsonb
language sql stable as $$
  select coalesce((
    select to_jsonb(o) || jsonb_build_object(
      'address_problems', public.order_address_problems(o),
      'allowed_carriers', to_jsonb(public.order_allowed_carriers(o.id)),
      'lines', (select coalesce(jsonb_agg(to_jsonb(ol) || jsonb_build_object(
                  'returned_qty', (select coalesce(sum(qty), 0) from public.return_lines rl where rl.order_line_id = ol.id))
                  order by ol.created_at), '[]') from public.order_lines ol where ol.order_id = o.id),
      'reservations', (select coalesce(jsonb_agg(jsonb_build_object('code', c.code, 'qty', r.qty, 'status', r.status,
                                                                    'expires_at', r.expires_at)), '[]')
                       from public.reservations r join public.components c on c.id = r.component_id where r.order_id = o.id),
      'shipments', (select coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object(
                      'events', (select coalesce(jsonb_agg(to_jsonb(e) order by e.occurred_at), '[]') from public.shipment_events e
                                 where e.shipment_id = s.id)) order by s.created_at), '[]')
                    from public.shipments s where s.order_id = o.id),
      'emails', (select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at), '[]') from public.email_log e where e.order_id = o.id),
      'refunds', (select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at), '[]') from public.refunds r where r.order_id = o.id),
      'returns', (select coalesce(jsonb_agg(to_jsonb(rt) || jsonb_build_object(
                    'lines', (select coalesce(jsonb_agg(to_jsonb(rl) || jsonb_build_object('sku', ol.sku, 'title', ol.title)), '[]')
                              from public.return_lines rl join public.order_lines ol on ol.id = rl.order_line_id
                              where rl.return_id = rt.id)) order by rt.created_at), '[]')
                  from public.returns rt where rt.order_id = o.id),
      'outbox', (select coalesce(jsonb_agg(to_jsonb(ob) - 'claim_token'), '[]') from public.outbox ob where ob.payload->>'order_id' = o.id::text),
      'audit', (select coalesce(jsonb_agg(to_jsonb(a) order by a.id desc), '[]') from public.audit_log a
                where a.entity_id = o.id::text
                   or a.entity_id in (select s.id::text from public.shipments s where s.order_id = o.id))
    )
    from public.orders o where o.id = (p->>'id')::uuid
  ), 'null'::jsonb)
$$;

-- Verzendingen: openstaande orders, zendingen per dag en uitzonderingen
create or replace function public.api_admin_shipments(p jsonb) returns jsonb
language sql stable as $$
  with base as (
    select o.*, s.id as shipment_id, s.carrier, s.status as shipment_status, s.label_status, s.label_source,
           s.tracking_code, s.tracking_url, s.ship_date, s.exception_reason, s.label_error, s.weight_g, s.package_format,
           s.handed_over_at, s.handover_manual, s.label_path is not null as has_label
    from public.orders o
    left join public.shipments s on s.order_id = o.id and s.status <> 'cancelled'
    where o.payment_status in ('paid', 'partially_refunded') and o.stock_status = 'committed'
      and o.fulfillment_status <> 'cancelled'
  )
  select jsonb_build_object(
    'date', coalesce(p->>'date', (now() at time zone 'Europe/Amsterdam')::date::text),
    'open', coalesce((select jsonb_agg(jsonb_build_object(
              'order_id', b.id, 'number', b.number, 'channel', b.channel, 'customer_name', b.customer_name,
              'city', b.ship_city, 'postal_code', b.ship_postal_code, 'created_at', b.created_at, 'ship_deadline', b.ship_deadline,
              'deadline_soon', coalesce(b.ship_deadline < now() + interval '24 hours', false),
              'tracking_promised', b.tracking_promised, 'shipping_option', b.shipping_option,
              'allowed_carriers', to_jsonb(public.order_allowed_carriers(b.id)),
              'address_problems', public.order_address_problems((select o2 from public.orders o2 where o2.id = b.id)),
              'shipment_id', b.shipment_id, 'carrier', b.carrier, 'shipment_status', b.shipment_status,
              'label_status', b.label_status, 'label_source', b.label_source, 'tracking_code', b.tracking_code,
              'tracking_url', b.tracking_url, 'ship_date', b.ship_date, 'exception_reason', b.exception_reason,
              'label_error', b.label_error, 'weight_g', b.weight_g, 'package_format', b.package_format, 'has_label', b.has_label,
              'lines', (select coalesce(jsonb_agg(jsonb_build_object('sku', ol.sku, 'title', ol.title, 'qty', ol.qty)), '[]')
                        from public.order_lines ol where ol.order_id = b.id)
            ) order by b.ship_deadline nulls last, b.created_at)
            from base b where b.fulfillment_status in ('unfulfilled', 'label_ready')
               or b.shipment_status in ('draft', 'label_ready', 'exception')), '[]'),
    'day', coalesce((select jsonb_agg(jsonb_build_object(
              'shipment_id', s.id, 'order_id', o.id, 'number', o.number, 'channel', o.channel, 'carrier', s.carrier,
              'status', s.status, 'label_status', s.label_status, 'tracking_code', s.tracking_code,
              'handed_over_at', s.handed_over_at, 'handover_manual', s.handover_manual, 'has_label', s.label_path is not null)
              order by o.number)
            from public.shipments s join public.orders o on o.id = s.order_id
            where s.status <> 'cancelled'
              and s.ship_date = coalesce((p->>'date')::date, (now() at time zone 'Europe/Amsterdam')::date)), '[]'),
    'recent', coalesce((select jsonb_agg(x order by x->>'handed_over_at' desc) from (
              select jsonb_build_object('shipment_id', s.id, 'order_id', o.id, 'number', o.number, 'carrier', s.carrier,
                     'status', s.status, 'tracking_code', s.tracking_code, 'handed_over_at', s.handed_over_at,
                     'delivered_at', s.delivered_at, 'channel', o.channel) as x
              from public.shipments s join public.orders o on o.id = s.order_id
              where s.status in ('handed_over', 'in_transit', 'ready_for_pickup', 'delivered')
              order by s.handed_over_at desc limit 30) r), '[]'),
    'sender_address', public.setting('sender_address')
  )
$$;

create or replace function public.api_shipment_get(p jsonb) returns jsonb
language sql stable as $$
  select coalesce((select to_jsonb(s) || jsonb_build_object('order_number', o.number, 'channel', o.channel)
                   from public.shipments s join public.orders o on o.id = s.order_id
                   where s.id = (p->>'id')::uuid), 'null'::jsonb)
$$;

create or replace function public.api_day_labels(p jsonb) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('shipment_id', s.id, 'number', o.number, 'label_path', s.label_path,
                                               'carrier', s.carrier) order by s.carrier, o.number), '[]')
  from public.shipments s join public.orders o on o.id = s.order_id
  where s.status <> 'cancelled' and s.label_status = 'ready' and s.label_path is not null
    and s.ship_date = (p->>'date')::date
$$;

create or replace function public.api_bol_shipment_payload(p jsonb) returns jsonb
language sql stable as $$
  select coalesce((
    select jsonb_build_object('order_id', o.id, 'bol_order_id', o.bol_order_id, 'carrier', s.carrier,
                              'tracking_code', s.tracking_code, 'shipment_id', s.id,
                              'order_item_ids', (select coalesce(jsonb_agg(ol.bol_order_item_id), '[]') from public.order_lines ol
                                                 where ol.order_id = o.id and ol.bol_order_item_id is not null))
    from public.orders o join public.shipments s on s.order_id = o.id and s.status <> 'cancelled'
    where o.id = (p->>'order_id')::uuid
  ), 'null'::jsonb)
$$;

create or replace function public.api_admin_bol(p jsonb) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'sync', coalesce((select jsonb_agg(jsonb_build_object(
              'product_id', pr.id, 'sku', pr.sku, 'title', pr.title, 'bol_offer_id', pr.bol_offer_id, 'bol_reference', pr.bol_reference,
              'ean', pr.ean, 'bol_enabled', pr.bol_enabled, 'bol_title_fix_required', pr.bol_title_fix_required,
              'status', pr.status, 'bol_price_cents', pr.bol_price_cents, 'target_stock', public.bol_target_stock(pr.id),
              'available_units', pa.available_units,
              'stock', (select to_jsonb(s) - 'claim_token' from public.bol_sync s where s.product_id = pr.id and s.kind = 'stock'),
              'price', (select to_jsonb(s) - 'claim_token' from public.bol_sync s where s.product_id = pr.id and s.kind = 'price')
            ) order by pr.sort, pr.sku)
            from public.products pr left join public.product_availability pa on pa.product_id = pr.id
            where pr.kind <> 'bundle'), '[]'),
    'outbox', coalesce((select jsonb_agg(to_jsonb(ob) - 'claim_token' order by ob.created_at desc)
                        from (select * from public.outbox where kind like 'bol%' order by created_at desc limit 50) ob), '[]'),
    'sim_offers', coalesce((select jsonb_agg(to_jsonb(s) order by s.offer_key) from public.bol_sim_offers s), '[]'),
    'buffer_units', public.setting_int('bol_buffer_units', 1)
  )
$$;

create or replace function public.api_admin_discounts(p jsonb) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(to_jsonb(dr) || jsonb_build_object(
    'product_ids', (select coalesce(jsonb_agg(product_id), '[]') from public.discount_rule_products where rule_id = dr.id))
    order by dr.created_at), '[]')
  from public.discount_rules dr
$$;

create or replace function public.api_admin_settings(p jsonb) returns jsonb
language sql stable as $$
  select coalesce(jsonb_object_agg(key, value), '{}') from public.settings
$$;

create or replace function public.api_admin_devices(p jsonb) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(to_jsonb(d) order by d.sort), '[]') from public.devices d
$$;

create or replace function public.api_admin_audit(p jsonb) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(to_jsonb(a) order by a.id desc), '[]')
  from (select * from public.audit_log
        where (p->>'entity' is null or entity = p->>'entity')
        order by id desc limit coalesce((p->>'limit')::int, 200)) a
$$;

create or replace function public.api_admin_ai_proposals(p jsonb) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(x order by (x->>'created_at') desc), '[]') from (
    select to_jsonb(ap) || jsonb_build_object(
      'bol_status', (select coalesce(jsonb_object_agg(s.product_id::text, jsonb_build_object('status', s.status,
                                       'last_error', s.last_error, 'pushed_value', s.pushed_value, 'desired_value', s.desired_value)), '{}')
                     from public.bol_sync s where s.kind = 'price'
                       and s.product_id in (select (i->>'product_id')::uuid from jsonb_array_elements(ap.items) i))) as x
    from public.ai_price_proposals ap
    where p->>'id' is null or ap.id = (p->>'id')::uuid
    order by ap.created_at desc limit 20
  ) t
$$;

create or replace function public.api_admin_users(p jsonb) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(to_jsonb(u) order by u.created_at), '[]') from public.admin_users u
$$;

create or replace function public.api_email_retry_list(p jsonb) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('order_id', order_id, 'kind', kind)), '[]')
  from (select order_id, kind from public.email_log where status = 'failed' and attempts < 5 order by updated_at limit 20) x
$$;

select public.lockdown_privileges();
