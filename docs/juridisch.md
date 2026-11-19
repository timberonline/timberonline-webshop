# Juridische uitgangspunten webshopteksten (concept 19-11-2026)

Dit document legt vast welke regels de verkoop- en privacyteksten volgen, waar ze in de code zitten en welke beleidskeuzes nog open
staan. Het is geen juridisch advies; laat de teksten vóór de commerciële livegang vaststellen door de eigenaar.

## Bedrijfsgegevens (bron)

| Gegeven | Waarde | Bron (gecontroleerd 19-11-2026) |
|---|---|---|
| Onderneming / webshop | Timber Services / Timber Online | timberservices.nl/algemene-voorwaarden (art. 2), JSON-LD op timberservices.nl |
| Adres | Abel Tasmanstraat 22, 6413 SX Heerlen | idem (beide) |
| KvK | 88562700 | timberservices.nl/algemene-voorwaarden |
| Btw-id | NL004626847B65 | algemene voorwaarden en JSON-LD (`vatID`) |
| Telefoon | +31 6 17028248 | JSON-LD (`telephone`); niet zichtbaar op de pagina's |
| E-mail webshop | timberonline@timberservices.nl | opgegeven door de eigenaar |

De gegevens staan in de instelling `business_info`; afzender- en retouradres apart in `sender_address` en `return_address`. Alle drie
moeten in beheer (Instellingen) worden bevestigd vóór de commerciële livegang. Elke order krijgt bij aanmaak een vaste kopie
(`orders.seller`), zodat latere wijzigingen bestaande orders, e-mails en documenten niet veranderen.

De bestaande voorwaarden van Timber Services zijn als achtergrond gebruikt, maar niet overgenomen: ze zijn gericht op opdrachten
(B2B/diensten) en bevatten bepalingen die tegenover consumenten niet gelden (o.a. garantie beperkt tot fabrieksgarantie, ruime
aansprakelijkheidsuitsluitingen, retour alleen na overleg, geen herroepingsrecht). De webshop heeft eigen consumentenvoorwaarden.

## Regels en uitwerking

| Onderwerp | Regel | Uitwerking |
|---|---|---|
| Informatie vóór bestellen | art. 6:230m, 6:230v lid 2 en 4, 6:227b, 6:234 lid 2 BW | `/info/*`, winkelwagen (levergebied, betaalmethoden, voorwaarden), stappen en invoerfouten in voorwaarden art. 4 |
| Bestelknop | art. 6:230v lid 3 BW | Stripe-knop "Betalen" met tekst erboven: "bestelling met betalingsverplichting" (`custom_text.submit`) |
| Bevestiging | art. 6:230v lid 7 BW | orderbevestiging met verkoper, herroepingsinformatie en modelformulier (`src/server/services/email.ts`) |
| Identificatie | art. 3:15d BW; btw-id i.p.v. omzetbelastingnummer (Belastingdienst) | footer, contact, voorwaarden, e-mails |
| Herroepingsrecht | art. 6:230o–6:230s BW | `/info/retourneren`, voorwaarden art. 8 |
| Modelformulier | Bijlage I deel B Richtlijn 2011/83/EU | `/info/herroepingsformulier`, ook in de orderbevestiging (`src/lib/legal.ts`) |
| Herroepingsknop | art. 6:230oa BW (Stb. 2026, 153), art. 11 bis Richtlijn 2011/83/EU (Richtlijn 2023/2673) | `/herroepen`: label "Hier de overeenkomst herroepen", bevestigingsknop "Herroeping bevestigen", direct ontvangstbevestiging met inhoud, datum en tijd; footer-link; beheer `/beheer/herroepingen` |
| Hygiëne-uitzondering | art. 6:230p onder f-3° BW; EC-richtsnoeren C/2021/525 | niet van toepassing op screenprotectors; wel waardevermindering (6:230s lid 3) |
| Conformiteit | art. 7:17, 7:18a lid 2 (bewijsvermoeden 1 jaar), 7:21–7:23 BW | `/info/garantie` |
| Levering en risico | art. 7:9 lid 4, 7:19a, 7:11 BW | `/info/verzending`, voorwaarden art. 7 |
| Vooruitbetaling | art. 7:26 lid 2 BW; ACM: optie om ≥ 50% na levering te betalen | **open** (beleidskeuze `payment_methods`) |
| ODR | Verordening (EU) 2024/3228: ODR-platform opgeheven per 20-07-2025 | geen ODR-link |
| ADR | art. 6:230m lid 1 onder t BW: alleen vermelden bij aansluiting | vermeld dat er geen aansluiting is (beleidskeuze `adr`) |
| Prijzen | art. 6:230m lid 1 onder e BW; art. 5a Besluit prijsaanduiding producten (laagste prijs 30 dagen bij korting) | "incl. btw" (beleidskeuze `vat`); kortingen tonen nu geen van-voorprijs buiten de winkelwagen |
| Productveiligheid | art. 19 Verordening (EU) 2023/988 (GPSR) | **open** (beleidskeuze `product_safety`) |
| Toegankelijkheid | art. 6:230fc lid 1 BW (micro-onderneming uitgezonderd) | geen verplichting; site wordt wel met axe getest |
| Consumentenkrediet | Richtlijn (EU) 2023/2225, van toepassing 20-11-2026; NL-wetsvoorstel 36924 | relevant bij Klarna (beleidskeuze `payment_methods`) |
| Privacy | art. 13, 28, 30 AVG; art. 52 lid 4 AWR (7 jaar) | `/info/privacy`; DPA's en register **open** |
| Cookies | art. 11.7a Telecommunicatiewet | `/info/cookies`; alleen functionele opslag, geen toestemming nodig |

## Open beleidskeuzes

De lijst staat in `src/lib/legal.ts` (`POLICY_CHOICES`). In de teksten zijn ze gemarkeerd ("Beleidskeuze: concept") en in beheer telt
het overzicht ze mee onder "Vóór commerciële livegang bevestigen". Zet `decided: true` (en daarna `LEGAL_TEXTS_FINAL = true`) zodra de
eigenaar heeft besloten en de tekst is aangepast.

## Bronnen

- Burgerlijk Wetboek Boek 6: https://wetten.overheid.nl/BWBR0005289/ · Boek 7: https://wetten.overheid.nl/BWBR0005290/ · Boek 3: https://wetten.overheid.nl/BWBR0005291/
- Staatsblad 2026, 153 (herroepingsknop, art. 6:230oa BW): https://zoek.officielebekendmakingen.nl/stb-2026-153.html
- Richtlijn (EU) 2023/2673 (NL): https://eur-lex.europa.eu/legal-content/NL/TXT/HTML/?uri=CELEX:32023L2673
- Richtlijn 2011/83/EU (geconsolideerd, NL; Bijlage I): https://eur-lex.europa.eu/legal-content/NL/TXT/HTML/?uri=CELEX:02011L0083-20220528
- ACM, bedenktijd: https://www.acm.nl/nl/verkoop-aan-consumenten/klantenservice/bedenktijd
- ACM, herroepingsknop: https://www.acm.nl/nl/publicaties/acm-roept-online-retailers-op-zich-voor-te-bereiden-op-herroepingsknop
- ACM, betaalmogelijkheden: https://www.acm.nl/nl/verkoop-aan-consumenten/de-koop-sluiten/betaalmogelijkheden-aanbieden
- KVK, herroepingsknop: https://www.kvk.nl/wetten-en-regels/herroepingsknop-verplicht-voor-webshops/
- EC-richtsnoeren Richtlijn 2011/83/EU (C/2021/525): https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:52021XC1229(04)
- Verordening (EU) 2024/3228 (ODR): https://eur-lex.europa.eu/eli/reg/2024/3228/oj
- Besluit prijsaanduiding producten, Stb. 2022, 485: https://zoek.officielebekendmakingen.nl/stb-2022-485.html
- Verordening (EU) 2023/988 (GPSR): https://eur-lex.europa.eu/eli/reg/2023/988/oj/eng
- Toegankelijkheid, Stb. 2024, 87: https://zoek.officielebekendmakingen.nl/stb-2024-87.html
- Richtlijn (EU) 2023/2225 (consumentenkrediet): https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023L2225 · wetsvoorstel 36924: https://www.eerstekamer.nl/wetsvoorstel/36924_implementatiewet_herziene
- Belastingdienst, btw-id: https://www.belastingdienst.nl/wps/wcm/connect/nl/btw/content/gebruik-vanaf-1-januari-2020-uw-nieuwe-btw-identificatienummer
- Belastingdienst, KOR: https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/btw/hoe_werkt_de_btw/kleineondernemersregeling/wat-betekent-meedoen-met-de-kleineondernemersregeling/
- Ondernemersplein, bedrijfscorrespondentie: https://ondernemersplein.overheid.nl/regels-voor-bedrijfscorrespondentie/
- Autoriteit Persoonsgegevens, verantwoordingsplicht: https://autoriteitpersoonsgegevens.nl/nl/onderwerpen/algemene-informatie-avg/verantwoordingsplicht
- Autoriteit Persoonsgegevens, cookies: https://www.autoriteitpersoonsgegevens.nl/en/themes/internet-and-smart-devices/cookies
- Algemene wet inzake rijksbelastingen (art. 52): https://wetten.overheid.nl/BWBR0002320/
- Telecommunicatiewet (art. 11.7a): https://wetten.overheid.nl/BWBR0009950/
- EU-VS Data Privacy Framework: hoger beroep Latombe C-703/25 P aanhangig (PB C/2025/6610): https://eur-lex.europa.eu/eli/C/2025/6610/oj/eng
- België: https://news.economie.fgov.be/214976-wettelijke-garantie-consument-is-beter-beschermd/ · https://consumentenombudsdienst.be/faq/
- Timber Services: https://timberservices.nl/algemene-voorwaarden · https://timberservices.nl
