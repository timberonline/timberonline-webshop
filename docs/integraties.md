# Koppelingen en livegang

Standaard staat alles in testmodus. Echte bestellingen pas openen nadat onderstaande punten zijn gecontroleerd.

| Koppeling | Testmodus | Live zetten |
|---|---|---|
| **Stripe Checkout** | `sk_test_…`; testkaarten en iDEAL-test. Webhook `POST /api/webhooks/stripe` met events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`. | Bevestig welke methoden het account ondersteunt (iDEAL \| Wero, achterafbetalen zoals Klarna). Zet ze aan in het Stripe-dashboard, optioneel filter via `STRIPE_PAYMENT_METHOD_TYPES`. Daarna `STRIPE_LIVE_ENABLED=true` en live sleutels + live webhook. |
| **Resend** | `MAIL_MODE=simulated` of `resend` met `MAIL_TEST_RECIPIENT` (alle mail naar één gecontroleerd adres). | Afzenderdomein verifiëren (DNS-records van Resend), `MAIL_TEST_RECIPIENT` leegmaken. |
| **bol** | `BOL_MODE=simulated`: updates gaan naar `bol_sim_offers`; bol-orders simuleren in beheer. | Retailer API-sleutels (`BOL_CLIENT_ID/SECRET`), per artikel `bol-offerId` invullen, beginstanden en titels controleren (o.a. hoesje EAN 9509916568396 → iPhone 13 Pro), artikel per artikel activeren, `BOL_MODE=live`. Transportercodes (DHL → `DHLFORYOU`, PostNL → `TNT`, briefpost → `BRIEFPOST`) bij livegang verifiëren. |
| **DHL / PostNL** | Voorbeeldlabels (A6-PDF, gemarkeerd als niet geldig) en gesimuleerde tracking; scans simuleren in Verzendingen. | Zakelijke accounts/API-sleutels; live labelaanvraag implementeren in `src/server/integrations/carriers` (interface staat klaar). Afgiftepuntoptie testen met de gekozen zakelijke DHL-dienst. |
| **Briefpost** | Volledig werkend: adreslabel, handmatig frankeren, bevestigen na posten. | Verzendoptie "Briefpost" aanzetten in Instellingen en prijs bepalen. |
| **AI-prijsassistent** | Regelgebaseerde testimplementatie (geen kosten). | Na akkoord over provider en budget: `AI_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_MODEL`. Voorstellen blijven altijd bevestiging vereisen. |
| **Beheerlogin** | Supabase Auth, MFA verplicht. Inschrijving bij eerste login. | Publieke registratie uit, site-URL en redirect-URL's (`/beheer/auth/callback`) instellen. |

## Checklist vóór echte bestellingen

1. Live betaalmethoden incl. achterafbetalen bevestigd en getest.
2. Catalogus bevestigd (titels, compatibiliteit, twijfelgevallen, bundelprijzen, verzendkosten en levertermijn).
3. bol: aanbiedingen gekoppeld (offerId), beginstanden en buffer gecontroleerd, titelcorrecties gedaan.
4. Verzending: afzenderadres, zakelijke vervoerdersaccounts of bewuste keuze voor handmatige labels.
5. Verkoop- en privacyinformatie vastgesteld (pagina's onder `/info/` zijn concept).
6. Herstel getest (back-up terugzetten in een testproject).
7. Eventuele nieuwe kosten (Vercel Pro voor commercieel gebruik, Supabase-abonnement, AI) akkoord.
8. `NEXT_PUBLIC_SHOP_MODE=live` om de testbalk te verwijderen.
