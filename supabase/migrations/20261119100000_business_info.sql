-- Timber Online 2.0 · bedrijfsgegevens, afzender- en retouradres, verkopergegevens per order
--
-- Bronnen (gecontroleerd 19-11-2026): timberservices.nl/algemene-voorwaarden (naam, adres, KvK, btw-id) en de
-- gestructureerde gegevens (JSON-LD Organization) op timberservices.nl (adres, telefoon, btw-id). Het webshopadres
-- voor e-mail is door de eigenaar opgegeven. Alle drie de toepassingen staan op "nog te bevestigen" tot de eigenaar ze
-- in beheer bevestigt vóór de commerciële livegang.
--
-- Historie: elke order krijgt bij aanmaak een vaste kopie van de verkopergegevens (orders.seller). Latere wijzigingen
-- van de instellingen veranderen bestaande orders, e-mails en documenten dus niet.

-- ---------------------------------------------------------------------------
-- 1. Instellingen
-- ---------------------------------------------------------------------------
insert into public.settings (key, value, updated_by) values
  ('business_info', $json${
     "legal_name": "Timber Services", "shop_name": "Timber Online",
     "street": "Abel Tasmanstraat", "house_number": "22", "postal_code": "6413 SX", "city": "Heerlen", "country": "NL",
     "kvk": "88562700", "vat_id": "NL004626847B65", "phone": "+31 6 17028248", "email": "timberonline@timberservices.nl",
     "confirmed_at": null, "confirmed_by": null,
     "source": "timberservices.nl/algemene-voorwaarden en JSON-LD op timberservices.nl (19-11-2026); e-mail door eigenaar"
   }$json$::jsonb, 'migration'),
  ('return_address', $json${
     "name": "Timber Online", "street": "Abel Tasmanstraat", "house_number": "22", "postal_code": "6413 SX", "city": "Heerlen",
     "country": "NL", "confirmed_at": null, "confirmed_by": null
   }$json$::jsonb, 'migration')
on conflict (key) do nothing;

-- Afzenderadres: alleen invullen zolang het nog de lege seedwaarde is (een ingesteld adres blijft staan).
do $$
declare v_before jsonb := public.setting('sender_address');
        v_after jsonb := $json${
          "name": "Timber Online", "street": "Abel Tasmanstraat", "house_number": "22", "postal_code": "6413 SX",
          "city": "Heerlen", "country": "NL", "confirmed_at": null, "confirmed_by": null
        }$json$::jsonb;
begin
  if v_before is null or coalesce(v_before->>'street', '') = '' then
    insert into public.settings (key, value, updated_by) values ('sender_address', v_after, 'migration')
    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = 'migration';
    perform public.audit('migration', 'setting_changed', 'setting', 'sender_address', v_before, v_after);
  end if;
end $$;

do $$
begin
  if not exists (select 1 from public.audit_log where action = 'setting_changed' and entity_id = 'business_info') then
    perform public.audit('migration', 'setting_changed', 'setting', 'business_info', null, public.setting('business_info'));
    perform public.audit('migration', 'setting_changed', 'setting', 'return_address', null, public.setting('return_address'));
  end if;
end $$;

create or replace function public.api_setting_save(p jsonb) returns jsonb
language plpgsql as $$
declare v_actor text := public.require_actor(p); v_before jsonb;
begin
  if p->>'key' not in ('bol_buffer_units', 'reservation_minutes', 'shipping_options', 'delivery_promise',
                       'sender_address', 'return_address', 'business_info',
                       'bol_requires_tracking', 'tracking_info', 'letter_max_weight_g') then
    raise exception 'unknown_setting';
  end if;
  if p->>'key' in ('sender_address', 'return_address', 'business_info') and jsonb_typeof(p->'value') <> 'object' then
    raise exception 'invalid_setting';
  end if;
  select value into v_before from public.settings where key = p->>'key';
  -- Ongewijzigd opslaan (hele formulier) levert geen ruis in het logboek op.
  if v_before is not distinct from p->'value' then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;
  insert into public.settings (key, value, updated_by) values (p->>'key', p->'value', v_actor)
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = v_actor;
  perform public.audit(v_actor, 'setting_changed', 'setting', p->>'key', v_before, p->'value');
  if p->>'key' = 'bol_buffer_units' then
    perform public.mark_bol_stock_dirty((select coalesce(array_agg(id), '{}') from public.components));
  end if;
  return jsonb_build_object('ok', true, 'changed', true);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Verkopergegevens per order (vaste kopie)
-- ---------------------------------------------------------------------------
create or replace function public.seller_snapshot() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'business', coalesce(public.setting('business_info'), '{}'::jsonb) - 'confirmed_at' - 'confirmed_by' - 'source',
    'return_address', coalesce(public.setting('return_address'), '{}'::jsonb) - 'confirmed_at' - 'confirmed_by',
    'captured_at', now())
$$;

alter table public.orders add column if not exists seller jsonb;

create or replace function public.orders_seller_snapshot() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.seller := coalesce(new.seller, public.seller_snapshot());
  elsif old.seller is not null and new.seller is distinct from old.seller then
    raise exception 'seller_snapshot_immutable' using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists orders_seller_snapshot on public.orders;
create trigger orders_seller_snapshot before insert or update of seller on public.orders
  for each row execute function public.orders_seller_snapshot();

-- Bestaande orders (alleen testorders van TO-BUILD-01) krijgen eenmalig de huidige gegevens, gemarkeerd als achteraf
-- toegevoegd; updated_at blijft ongewijzigd.
alter table public.orders disable trigger orders_touch;
update public.orders set seller = public.seller_snapshot() || '{"backfilled": true}'::jsonb where seller is null;
alter table public.orders enable trigger orders_touch;

-- ---------------------------------------------------------------------------
-- 3. Lees-API's
-- ---------------------------------------------------------------------------
-- Publieke bedrijfsgegevens voor storefront (footer, contact, voorwaarden). Geen bevestigingsmetadata.
create or replace function public.api_public_business(p jsonb) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'business', coalesce(public.setting('business_info'), '{}'::jsonb) - 'confirmed_at' - 'confirmed_by' - 'source',
    'return_address', coalesce(public.setting('return_address'), '{}'::jsonb) - 'confirmed_at' - 'confirmed_by')
$$;

create or replace function public.api_order_for_email(p jsonb) returns jsonb
language sql stable as $$
  select coalesce((
    select jsonb_build_object(
      'id', o.id, 'number', o.number, 'channel', o.channel, 'email', o.email, 'customer_name', o.customer_name,
      'subtotal_cents', o.subtotal_cents, 'discount_cents', o.discount_cents, 'shipping_cents', o.shipping_cents,
      'total_cents', o.total_cents, 'delivery_promise', o.delivery_promise, 'shipping_option', o.shipping_option,
      'tracking_promised', o.tracking_promised, 'stock_status', o.stock_status, 'paid_at', o.paid_at,
      'payment_method', o.payment_method,
      'seller', coalesce(o.seller, public.seller_snapshot()),
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

select public.lockdown_privileges();
notify pgrst, 'reload schema';
