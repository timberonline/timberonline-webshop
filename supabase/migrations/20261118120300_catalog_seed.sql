-- Timber Online 2.0 · TO-BUILD-01 · openingscatalogus en -voorraad (telling 18-11-2026)
-- Idempotent en niet-destructief: bestaande rijen worden nooit overschreven.
-- 341 fysieke stuks: 315 screenprotectors (losse stuks) en 26 hoesjes.

insert into public.settings (key, value, updated_by) values
  ('bol_buffer_units', '1', 'seed'),
  ('reservation_minutes', '35', 'seed'),
  ('bol_requires_tracking', 'true', 'seed'),
  ('delivery_promise', '"Verzonden binnen 1 werkdag na betaling. Bezorging doorgaans binnen 1–3 werkdagen."', 'seed'),
  ('tracking_info', '"Je ontvangt per e-mail een track & trace-code zodra je zending aan de vervoerder is overgedragen."', 'seed'),
  ('shipping_options', $json$[
    {"code": "tracked", "label": "Brievenbuspakje met track & trace", "description": "Verzonden met DHL of PostNL",
     "cost_cents": 0, "free_from_cents": null, "carriers": ["dhl", "postnl"], "tracking": true, "enabled": true,
     "delivery": "1–3 werkdagen"},
    {"code": "letter", "label": "Briefpost zonder track & trace", "description": "Als gewone brief, handmatig gefrankeerd",
     "cost_cents": 0, "free_from_cents": null, "carriers": ["letter"], "tracking": false, "enabled": false,
     "delivery": "2–4 werkdagen"}
  ]$json$::jsonb, 'seed'),
  ('sender_address', '{"name": "Timber Online", "street": null, "house_number": null, "postal_code": null, "city": null, "country": "NL"}', 'seed')
on conflict (key) do nothing;

insert into public.devices (slug, name, family, sort) values
  ('iphone-11', 'iPhone 11', 'iPhone 11', 110),
  ('iphone-11-pro-max', 'iPhone 11 Pro Max', 'iPhone 11', 113),
  ('iphone-12', 'iPhone 12', 'iPhone 12', 120),
  ('iphone-12-pro-max', 'iPhone 12 Pro Max', 'iPhone 12', 123),
  ('iphone-13', 'iPhone 13', 'iPhone 13', 130),
  ('iphone-13-pro', 'iPhone 13 Pro', 'iPhone 13', 132),
  ('iphone-13-pro-max', 'iPhone 13 Pro Max', 'iPhone 13', 133),
  ('iphone-14', 'iPhone 14', 'iPhone 14', 140),
  ('iphone-14-pro', 'iPhone 14 Pro', 'iPhone 14', 142),
  ('iphone-14-pro-max', 'iPhone 14 Pro Max', 'iPhone 14', 143),
  ('iphone-15', 'iPhone 15', 'iPhone 15', 150),
  ('iphone-15-plus', 'iPhone 15 Plus', 'iPhone 15', 151),
  ('iphone-15-pro', 'iPhone 15 Pro', 'iPhone 15', 152),
  ('iphone-15-pro-max', 'iPhone 15 Pro Max', 'iPhone 15', 153)
on conflict (slug) do nothing;

do $seed$
declare
  r record;
  v_comp uuid;
  v_prod uuid;
  v_new boolean;
  d text;
  v_title_bol text;
begin
  -- code, naam, soort, telling, sku, slug, producttype, titel, ondertitel, ean, bol-ref, bol-titel, prijs, status,
  -- apparaten (bevestigd), apparaten (twijfel), bol-titelcorrectie, reviewnotitie, sortering
  for r in
    select * from (values
      ('C-SP-IP11PM-STD','Screenprotector iPhone 11 Pro Max','protector',9,'TO-SP2-IP11PM-STD','screenprotector-iphone-11-pro-max','screenprotector','Screenprotector iPhone 11 Pro Max','Tweepack · 9H gehard glas','9507117868291','BOLSPI11PM','Screenprotector iPhone 11 Pro Max',1995,'active',array['iphone-11-pro-max'],array[]::text[],false,null,10),
      ('C-SP-IP11PM-PRV','Privacy-screenprotector iPhone 11 Pro Max','protector',19,'TO-SP2-IP11PM-PRV','privacy-screenprotector-iphone-11-pro-max','privacy','Privacy-screenprotector iPhone 11 Pro Max','Tweepack · privacyfilter · 9H gehard glas','9501639892987','BOLSPI11PMPSP','Privacy Screenprotector iPhone 11 Pro Max',1995,'active',array['iphone-11-pro-max'],array[]::text[],false,null,11),
      ('C-SP-IP12-STD','Screenprotector iPhone 12','protector',6,'TO-SP2-IP12-STD','screenprotector-iphone-12','screenprotector','Screenprotector iPhone 12','Tweepack · 9H gehard glas','9506147994819','BOLSPI12','Screenprotector iPhone 12',1995,'active',array['iphone-12'],array[]::text[],false,null,20),
      ('C-SP-IP12-PRV','Privacy-screenprotector iPhone 12','protector',11,'TO-SP2-IP12-PRV','privacy-screenprotector-iphone-12','privacy','Privacy-screenprotector iPhone 12','Tweepack · privacyfilter · 9H gehard glas','9506386429783','BOLSPI12PSP','Privacy Screenprotector iPhone 12',1995,'active',array['iphone-12'],array[]::text[],false,null,21),
      ('C-SP-IP12PM-STD','Screenprotector iPhone 12 Pro Max','protector',9,'TO-SP2-IP12PM-STD','screenprotector-iphone-12-pro-max','screenprotector','Screenprotector iPhone 12 Pro Max','Tweepack · 9H gehard glas','9509611541281','BOLSPI12MP','Screenprotector iPhone 12 Pro Max',1995,'active',array['iphone-12-pro-max'],array[]::text[],false,null,22),
      ('C-SP-IP12PM-PRV','Privacy-screenprotector iPhone 12 Pro Max','protector',5,'TO-SP2-IP12PM-PRV','privacy-screenprotector-iphone-12-pro-max','privacy','Privacy-screenprotector iPhone 12 Pro Max','Tweepack · privacyfilter · 9H gehard glas','9509557139238','BOLSPI12PMPSP','Privacy Screenprotector iPhone 12 Pro Max',1995,'active',array['iphone-12-pro-max'],array[]::text[],false,null,23),
      ('C-SP-IP13-STD','Screenprotector iPhone 13 / 13 Pro','protector',27,'TO-SP2-IP13-STD','screenprotector-iphone-13-13-pro','screenprotector','Screenprotector iPhone 13 / 13 Pro','Tweepack · past op iPhone 13 en 13 Pro','9503454246938','BOLSPI13','Screenprotector iPhone 13 (Pro)',1995,'active',array['iphone-13','iphone-13-pro'],array[]::text[],false,'Eén SKU voor iPhone 13 en 13 Pro (telling 10 + 17 samengevoegd).',30),
      ('C-SP-IP13PM-PRV','Privacy-screenprotector iPhone 13 Pro Max','protector',27,'TO-SP2-IP13PM-PRV','privacy-screenprotector-iphone-13-pro-max','privacy','Privacy-screenprotector iPhone 13 Pro Max','Tweepack · privacyfilter · 9H gehard glas','9504983983745','BOLSPI13PMPSP','Privacy Screenprotector iPhone 13 Pro Max',1995,'active',array['iphone-13-pro-max'],array[]::text[],false,null,33),
      ('C-SP-IP14-STD','Screenprotector iPhone 14','protector',14,'TO-SP2-IP14-STD','screenprotector-iphone-14','screenprotector','Screenprotector iPhone 14','Tweepack · 9H gehard glas','9506532976277','BOLSPI14','Screenprotector iPhone 14 (Pro)',1995,'active',array['iphone-14'],array['iphone-14-pro'],false,'bol-titel noemt "iPhone 14 (Pro)"; compatibiliteit met iPhone 14 Pro is niet bevestigd en staat als concept.',40),
      ('C-SP-IP14PM-STD','Screenprotector iPhone 14 Pro Max','protector',17,'TO-SP2-IP14PM-STD','screenprotector-iphone-14-pro-max','screenprotector','Screenprotector iPhone 14 Pro Max','Tweepack · 9H gehard glas','9502494531745','BOLSPI14PM','Screenprotector iPhone 14 Pro Max',1995,'active',array['iphone-14-pro-max'],array[]::text[],false,null,43),
      ('C-SP-IP14PM-PRV','Privacy-screenprotector iPhone 14 Pro Max','protector',18,'TO-SP2-IP14PM-PRV','privacy-screenprotector-iphone-14-pro-max','privacy','Privacy-screenprotector iPhone 14 Pro Max','Tweepack · privacyfilter · 9H gehard glas','9507723652932','BOLSPI14PMPSP','Privacy Screenprotector iPhone 14 Pro Max',1995,'active',array['iphone-14-pro-max'],array[]::text[],false,null,44),
      ('C-SP-IP15-PRV','Privacy-screenprotector iPhone 15','protector',45,'TO-SP2-IP15-PRV','privacy-screenprotector-iphone-15','privacy','Privacy-screenprotector iPhone 15','Tweepack · privacyfilter · 9H gehard glas','9509834126616','BOLSPPI15','Privacy Screenprotector iPhone 15',1995,'active',array['iphone-15'],array[]::text[],false,null,50),
      ('C-SP-IP15P-PRV','Privacy-screenprotector iPhone 15 Pro','protector',46,'TO-SP2-IP15P-PRV','privacy-screenprotector-iphone-15-pro','privacy','Privacy-screenprotector iPhone 15 Pro','Tweepack · privacyfilter · 9H gehard glas','9508856998171','BOLSPPI15P','Privacy Screenprotector iPhone 15 Pro',1995,'active',array['iphone-15-pro'],array[]::text[],false,null,52),
      ('C-SP-IP15PM-PRV','Privacy-screenprotector iPhone 15 Pro Max','protector',20,'TO-SP2-IP15PM-PRV','privacy-screenprotector-iphone-15-pro-max','privacy','Privacy-screenprotector iPhone 15 Pro Max','Tweepack · privacyfilter · 9H gehard glas','9502655166892','BOLSPPI15PM','Privacy Screenprotector iPhone 15 Pro Max',1995,'active',array['iphone-15-pro-max'],array[]::text[],false,null,53),
      ('C-SP-IP15PL-PRV','Privacy-screenprotector iPhone 15 Plus','protector',42,'TO-SP2-IP15PL-PRV','privacy-screenprotector-iphone-15-plus','privacy','Privacy-screenprotector iPhone 15 Plus','Tweepack · privacyfilter · 9H gehard glas','9504675437259','BOLSPPI15Plus','Privacy Screenprotector iPhone 15 Plus',2495,'active',array['iphone-15-plus'],array[]::text[],false,null,51),
      ('C-CS-IP13P','MagSafe-hoesje iPhone 13 Pro','case',3,'TO-CS-IP13P-MS','magsafe-hoesje-iphone-13-pro','hoesje','MagSafe-hoesje iPhone 13 Pro','Hoesje · per stuk','9509916568396','BOLMC13','Magsafe Cover iPhone 13',1995,'active',array['iphone-13-pro'],array[]::text[],true,'Hoesje is voor iPhone 13 Pro (bevestigd door eigenaar). bol-titel noemt "iPhone 13" en moet vóór activering op bol worden gecorrigeerd.',35),
      ('C-CS-IP13PM','MagSafe-hoesje iPhone 13 Pro Max','case',3,'TO-CS-IP13PM-MS','magsafe-hoesje-iphone-13-pro-max','hoesje','MagSafe-hoesje iPhone 13 Pro Max','Hoesje · per stuk','9506423287611','BOLMC13PM','Magsafe Cover iPhone 13 Pro Max',1995,'active',array['iphone-13-pro-max'],array[]::text[],false,null,36),
      ('C-CS-IP14','MagSafe-hoesje iPhone 14','case',13,'TO-CS-IP14-MS','magsafe-hoesje-iphone-14','hoesje','MagSafe-hoesje iPhone 14','Hoesje · per stuk','9509824457485','BOLMC14','Magsafe Cover iPhone 14',1995,'active',array['iphone-14'],array[]::text[],false,null,45),
      ('C-CS-IP14PM','MagSafe-hoesje iPhone 14 Pro Max','case',7,'TO-CS-IP14PM-MS','magsafe-hoesje-iphone-14-pro-max','hoesje','MagSafe-hoesje iPhone 14 Pro Max','Hoesje · per stuk','9509815766374','BOLMC14PM','Magsafe Cover iPhone 14 Pro Max',1995,'active',array['iphone-14-pro-max'],array[]::text[],false,null,46),
      -- bol-referenties zonder actuele telling: concept, geen voorraad
      ('C-SP-IP11-STD','Screenprotector iPhone 11','protector',0,'TO-SP2-IP11-STD','screenprotector-iphone-11','screenprotector','Screenprotector iPhone 11','Tweepack · 9H gehard glas','9505957826723','BOLSPI11','Screenprotector iPhone 11',1995,'concept',array['iphone-11'],array[]::text[],false,'Niet in actuele telling van 18-11-2026; geen voorraad.',90),
      ('C-SP-IP11-PRV','Privacy-screenprotector iPhone 11','protector',0,'TO-SP2-IP11-PRV','privacy-screenprotector-iphone-11','privacy','Privacy-screenprotector iPhone 11','Tweepack · privacyfilter · 9H gehard glas','9501434331735','BOLSPI11PSP','Privacy Screenprotector iPhone 11',1995,'concept',array['iphone-11'],array[]::text[],false,'Niet in actuele telling van 18-11-2026; geen voorraad.',91),
      ('C-SP-IP13-PRV','Privacy-screenprotector iPhone 13','protector',0,'TO-SP2-IP13-PRV','privacy-screenprotector-iphone-13','privacy','Privacy-screenprotector iPhone 13','Tweepack · privacyfilter · 9H gehard glas','9504342449912','BOLSPI13PSP','Privacy Screenprotector iPhone 13',1995,'concept',array['iphone-13'],array[]::text[],false,'Niet in actuele telling van 18-11-2026; geen voorraad.',92),
      ('C-SP-IP13PM-STD','Screenprotector iPhone 13 Pro Max','protector',0,'TO-SP2-IP13PM-STD','screenprotector-iphone-13-pro-max','screenprotector','Screenprotector iPhone 13 Pro Max','Tweepack · 9H gehard glas','9506778237934','BOLSPI13PM','Screenprotector iPhone 13 Pro Max',1995,'concept',array['iphone-13-pro-max'],array[]::text[],false,'Niet in actuele telling van 18-11-2026 (export noemde 19); geen voorraad.',93),
      ('C-SP-IP14-PRV','Privacy-screenprotector iPhone 14','protector',0,'TO-SP2-IP14-PRV','privacy-screenprotector-iphone-14','privacy','Privacy-screenprotector iPhone 14','Tweepack · privacyfilter · 9H gehard glas','9505251581441','BOLSPI14PSP','Privacy Screenprotector iPhone 14',1995,'concept',array['iphone-14'],array[]::text[],false,'Niet in actuele telling van 18-11-2026; geen voorraad.',94)
    ) as t(code, cname, ckind, qty, sku, slug, ptype, title, subtitle, ean, bolref, boltitle, price, status, devs, doubt, titlefix, note, sort)
  loop
    insert into public.components (code, name, kind, on_hand)
    values (r.code, r.cname, r.ckind, r.qty)
    on conflict (code) do nothing
    returning id into v_comp;
    v_new := v_comp is not null;
    if v_new then
      if r.qty > 0 then
        insert into public.stock_movements (component_id, delta, on_hand_after, reason, actor, note)
        values (v_comp, r.qty, r.qty, 'opening', 'seed', 'Openingstelling 18-11-2026');
      end if;
    else
      select id into v_comp from public.components where code = r.code;
    end if;

    v_title_bol := case when r.ckind = 'case' then r.boltitle
                        else r.boltitle || ' | 2X TIMBER PREMIUM 9H Gehard Glas | Waterafstotend | Olie afstotend' end;

    insert into public.products (sku, slug, kind, product_type, title, subtitle, description, status, ean, bol_reference,
                                 bol_title, bol_title_fix_required, web_enabled, bol_enabled, web_price_cents, bol_price_cents,
                                 allow_tier_discount, allowed_carriers, preferred_carrier, packed_weight_g, package_format,
                                 review_note, sort)
    values (r.sku, r.slug, case when r.ckind = 'case' then 'case' else 'set' end, r.ptype, r.title, r.subtitle,
            case r.ptype
              when 'hoesje' then 'Beschermhoes met MagSafe-ondersteuning. Per stuk geleverd.'
              when 'privacy' then 'Twee screenprotectors van 9H gehard glas met privacyfilter: van opzij is je scherm slecht leesbaar. Water- en olieafstotend.'
              else 'Twee screenprotectors van 9H gehard glas. Water- en olieafstotend.' end,
            r.status, r.ean, r.bolref, v_title_bol, r.titlefix, true, false, r.price, r.price, true,
            array['dhl', 'postnl', 'letter'], 'dhl', case when r.ckind = 'case' then 90 else 60 end, 'letterbox',
            r.note, r.sort)
    on conflict (sku) do nothing
    returning id into v_prod;

    if v_prod is not null then
      insert into public.product_components (product_id, component_id, qty)
      values (v_prod, v_comp, case when r.ckind = 'case' then 1 else 2 end);
      foreach d in array r.devs loop
        insert into public.product_devices (product_id, device_slug, confirmed) values (v_prod, d, true);
      end loop;
      foreach d in array r.doubt loop
        insert into public.product_devices (product_id, device_slug, confirmed) values (v_prod, d, false);
      end loop;
    end if;
  end loop;

  -- Webshopbundels (vaste prijs, geen staffelkorting). Prijzen zijn voorstellen ter bevestiging door de eigenaar.
  insert into public.products (sku, slug, kind, product_type, title, subtitle, description, status, web_enabled, bol_enabled,
                               web_price_cents, allow_tier_discount, allowed_carriers, preferred_carrier, packed_weight_g,
                               package_format, review_note, sort)
  values ('TO-BND-IP14-CS-SP2', 'bundel-iphone-14-hoesje-2-screenprotectors', 'bundle', 'bundel',
          'Bundel iPhone 14: hoesje + 2 screenprotectors', 'MagSafe-hoesje met tweepack screenprotectors',
          'Een MagSafe-hoesje en twee screenprotectors van 9H gehard glas voor de iPhone 14, samen voor een vaste prijs.',
          'active', true, false, 2995, false, array['dhl', 'postnl'], 'dhl', 150, 'letterbox',
          'Bundelprijs is een voorstel; eigenaar bevestigt vóór livegang.', 47)
  on conflict (sku) do nothing
  returning id into v_prod;
  if v_prod is not null then
    insert into public.product_components (product_id, component_id, qty)
    select v_prod, id, case when kind = 'case' then 1 else 2 end from public.components where code in ('C-CS-IP14', 'C-SP-IP14-STD');
    insert into public.product_devices (product_id, device_slug, confirmed) values (v_prod, 'iphone-14', true);
  end if;

  insert into public.products (sku, slug, kind, product_type, title, subtitle, description, status, web_enabled, bol_enabled,
                               web_price_cents, allow_tier_discount, allowed_carriers, preferred_carrier, packed_weight_g,
                               package_format, review_note, sort)
  values ('TO-BND-IP14-CS-SP1', 'bundel-iphone-14-hoesje-1-screenprotector', 'bundle', 'bundel',
          'Bundel iPhone 14: hoesje + 1 screenprotector', 'MagSafe-hoesje met losse screenprotector',
          'Een MagSafe-hoesje en één screenprotector van 9H gehard glas voor de iPhone 14, samen voor een vaste prijs.',
          'active', true, false, 2495, false, array['dhl', 'postnl', 'letter'], 'dhl', 120, 'letterbox',
          'Bundelprijs is een voorstel; eigenaar bevestigt vóór livegang.', 48)
  on conflict (sku) do nothing
  returning id into v_prod;
  if v_prod is not null then
    insert into public.product_components (product_id, component_id, qty)
    select v_prod, id, 1 from public.components where code in ('C-CS-IP14', 'C-SP-IP14-STD');
    insert into public.product_devices (product_id, device_slug, confirmed) values (v_prod, 'iphone-14', true);
  end if;

  -- Voorbeeld-staffelkorting (inactief tot de eigenaar hem aanzet)
  if not exists (select 1 from public.discount_rules where name = 'Vanaf 2 sets 10% korting') then
    with rule as (
      insert into public.discount_rules (name, min_qty, discount_type, value, active)
      values ('Vanaf 2 sets 10% korting', 2, 'percent', 10, false)
      returning id
    )
    insert into public.discount_rule_products (rule_id, product_id)
    select rule.id, p.id from rule, public.products p where p.kind = 'set' and p.status = 'active';
  end if;
end $seed$;

select public.lockdown_privileges();
