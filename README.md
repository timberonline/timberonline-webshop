# Timber Online 2.0

Webshop en beheeromgeving voor Timber Online: screenprotectors en hoesjes voor iPhone, verkocht via de eigen webshop en bol.

- **Stack:** Next.js 16 (App Router), React 19, TypeScript, Supabase (Postgres, Auth met MFA, Storage), Stripe Checkout, Resend.
- **Eén app** voor storefront (`/`) en beheer (`/beheer`).
- **Merk:** TO-BRAND-01 v1.1, concept A, Inter, kleuren `#0066FF`, `#0F2937`, `#374151`, `#F3F4F6`, `#FFFFFF`.

## Architectuur in het kort

| Onderdeel | Waar |
|---|---|
| Domeinlogica (voorraad, reserveren, betalingen, bol-sync, verzending, audit) | `supabase/migrations/*.sql`: Postgres-functies `api_*(p jsonb)`; elke mutatie is één transactie |
| Server-diensten (Stripe, e-mail, labels, bol, AI) | `src/server/services`, `src/server/integrations` |
| Storefront | `src/app/(shop)` |
| Beheer | `src/app/beheer` (login + MFA), `src/app/beheer/(app)` (afgeschermd) |
| Tests | `tests/` (Vitest tegen een echte Postgres 17), `e2e/` (Playwright) |

### Voorraadmodel

- Fysieke voorraad wordt **per stuk** bijgehouden in `components` (één protector, één hoesje). Supabase is leidend voor webshop én bol.
- Verkoopbare artikelen (`products`) zijn sets (tweepack = 2 protectors), hoesjes of bundels. Elk artikel verwijst naar componenten; sets en bundels delen dus dezelfde voorraad.
- Afrekenen reserveert componenten in één transactie (`api_create_web_order`, rijvergrendeling in vaste volgorde). Vrij = fysiek − open, niet-verlopen reserveringen.
- Na een geverifieerde betaalmelding wordt de reservering precies één keer afgeboekt (`api_mark_order_paid`; idempotent per orderregel). Verlopen of mislukte pogingen geven de voorraad vrij. Een late betaling krijgt opnieuw voorraad of wordt als **tekort** zichtbaar in beheer.
- bol krijgt `vrije verkoopbare eenheden − buffer` (standaard 1 eenheid per SKU). Updates gaan via een wachtrij met versienummers: nooit twee tegelijk per aanbod, altijd de nieuwste stand, mislukte updates met oplopende wachttijd en zichtbaar in beheer.

### Beveiliging

- Alle tabellen hebben RLS aan; `anon` en `authenticated` hebben geen rechten op tabellen of functies. Alleen de server (service-role) roept `api_*` aan.
- Beheer vereist een Supabase-sessie, **MFA (aal2)** en een actieve rij in `admin_users` (rollen: eigenaar, beheerder, verzending). Elke pagina en server action controleert dit zelf.
- Verzendlabels staan in een privé bucket en zijn alleen via `/beheer/label/:id` te downloaden.
- Live Stripe-sleutels worden geweigerd tot `STRIPE_LIVE_ENABLED=true`.

## Lokaal ontwikkelen

Vereist Node 24. Docker is niet nodig: de lokale database is een embedded Postgres 17.

```bash
npm install
npm run db:local          # start Postgres op poort 54329 en past migraties toe (laat open)
cp .env.example .env.local
# vul in .env.local: DATA_DRIVER=pg, DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/timberonline,
# STORAGE_DRIVER=local, ADMIN_DEV_BYPASS=1 (alleen lokaal: beheer zonder login)
npm run dev
```

## Controles

```bash
npm run typecheck && npm run lint && npm test && npm run build
npx playwright test                         # browsertests tegen http://localhost:3000 (desktop + mobiel, axe)
E2E_BASE_URL=https://… npx playwright test  # alleen de storefronttests tegen een deployment
```

## Database-migraties

Migraties staan in `supabase/migrations` en zijn niet-destructief (alleen nieuwe objecten; de seed overschrijft niets).
Toepassen op Supabase: `npx supabase db push` (na `supabase link`) of via de SQL-editor in volgorde van bestandsnaam.

## Back-up en herstel

| Wat | Back-up | Herstel |
|---|---|---|
| Database | Supabase maakt dagelijkse back-ups (afhankelijk van abonnement). Extra logische back-up: `DATABASE_URL=… scripts/backup/database.sh backup ./backup` | Nieuw/leeg project: `scripts/backup/database.sh restore schema-….sql` en daarna `data-….sql`. Binnen Supabase: Database → Backups → Restore. |
| Productfoto's | `npx tsx scripts/backup/storage.ts backup ./backup product-images` | `npx tsx scripts/backup/storage.ts restore ./backup product-images` |
| Verzendlabels | Zelfde script met bucket `shipping-labels` (bevat adressen: versleuteld bewaren) | Zelfde script, `restore` |

Back-ups bevatten klantgegevens en horen nooit in Git of in een gedeelde map.

## Periodiek onderhoud

`/api/cron/tick` (Vercel Cron, `Authorization: Bearer $CRON_SECRET`): verlopen reserveringen opruimen, bol-wachtrij en verzendbevestigingen verwerken, mislukte e-mails opnieuw proberen. Relevante acties starten deze verwerking ook direct; in beheer staat een knop **Nu synchroniseren**.

## Koppelingen en livegang

Zie `docs/integraties.md` voor de status per koppeling en de stappen om live te gaan.
