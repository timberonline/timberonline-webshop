import Link from "next/link";
import type { ReactNode } from "react";
import { money } from "@/lib/format";
import { LEGAL_VERSION, WITHDRAWAL_DAYS, WITHDRAWAL_LABELS, WITHDRAWAL_PATH, modelWithdrawalForm, policy } from "@/lib/legal";
import { addressLine, COUNTRY_NAME, sellerName, telHref, type BusinessInfo, type PostalAddress } from "@/server/services/business";
import type { ShippingOption } from "@/server/services/types";

export type InfoCtx = {
  b: Partial<BusinessInfo>;
  ret: Partial<PostalAddress>;
  shipping: ShippingOption[];
  deliveryPromise: string | null;
};

/** Markeert een beleidskeuze die de eigenaar nog moet vaststellen (verdwijnt zodra de keuze is besloten). */
function Choice({ id, children }: { id: string; children: ReactNode }) {
  const c = policy(id);
  if (c.decided) return <>{children}</>;
  return (
    <span className="policy-choice">
      <mark>{children}</mark> <span className="badge badge-warn" title={`Nog vast te stellen: ${c.open}`}>Beleidskeuze: concept</span>
    </span>
  );
}

function Seller({ b }: { b: Partial<BusinessInfo> }) {
  return (
    <dl className="dl">
      <dt>Webshop</dt>
      <dd>{b.shop_name ?? "Timber Online"}</dd>
      <dt>Onderneming</dt>
      <dd>{b.legal_name ?? "–"}</dd>
      <dt>Adres</dt>
      <dd>{addressLine(b) ? `${addressLine(b)}, ${COUNTRY_NAME[b.country ?? "NL"] ?? b.country}` : "–"}</dd>
      {b.email ? (<><dt>E-mail</dt><dd><a href={`mailto:${b.email}`}>{b.email}</a></dd></>) : null}
      {b.phone ? (<><dt>Telefoon</dt><dd><a href={telHref(b.phone)}>{b.phone}</a></dd></>) : null}
      {b.kvk ? (<><dt>KvK-nummer</dt><dd>{b.kvk}</dd></>) : null}
      {b.vat_id ? (<><dt>Btw-identificatienummer</dt><dd>{b.vat_id}</dd></>) : null}
    </dl>
  );
}

const retLine = (c: InfoCtx) => (c.ret.street ? `${c.ret.name ?? sellerName(c.b)}, ${addressLine(c.ret)}` : null);
const H = ({ children }: { children: ReactNode }) => <h2 style={{ fontSize: "1.125rem", marginTop: 24 }}>{children}</h2>;

function shippingCost(o: ShippingOption) {
  if (!o.cost_cents) return "gratis";
  return `${money(o.cost_cents)}${o.free_from_cents ? `, gratis vanaf ${money(o.free_from_cents)}` : ""}`;
}

export const BODIES: Record<string, (c: InfoCtx) => ReactNode> = {
  verzending: (c) => {
    const enabled = c.shipping.filter((o) => o.enabled);
    return (
      <>
        <p>
          We verzenden naar adressen in <Choice id="shipping_costs">Nederland en België</Choice>. Je ziet de verzendkosten en de verwachte levertijd in je
          winkelwagen voordat je betaalt.
        </p>
        <H>Verzendopties</H>
        <ul>
          {enabled.map((o) => (
            <li key={o.code}>
              <strong>{o.label}</strong>
              {o.description ? ` (${o.description})` : ""}: <Choice id="shipping_costs">{shippingCost(o)}</Choice>
              {o.delivery ? `, levertijd ${o.delivery}` : ""}. {o.tracking ? "Met track & trace." : "Zonder track & trace."}
            </li>
          ))}
        </ul>
        <H>Levertijd</H>
        <p>{c.deliveryPromise ?? "We verzenden je bestelling zo snel mogelijk na betaling."}</p>
        <p>
          We leveren in elk geval binnen 30 dagen na je bestelling, tenzij we samen een andere termijn afspreken. Lukt dat niet, dan laten we het je weten.
          Je kunt ons dan een redelijke extra termijn geven; leveren we ook dan niet, dan mag je de koop ontbinden en betalen we je direct terug.
        </p>
        <H>Track & trace</H>
        <p>
          Zodra je zending aan DHL of PostNL is overgedragen, ontvang je een e-mail met de track & trace-code. Briefpost heeft geen track & trace; we
          mailen je zodra de brief is gepost.
        </p>
        <H>Risico tijdens verzending</H>
        <p>
          Tot de zending bij jou (of bij iemand die jij daarvoor hebt aangewezen) is bezorgd, is het risico van verlies of beschadiging voor ons. Is je
          pakje beschadigd of niet aangekomen? <Link href="/contact">Neem contact met ons op</Link>, dan lossen we het op.
        </p>
      </>
    );
  },

  betalen: () => (
    <>
      <p>
        Je betaalt op de beveiligde betaalpagina van onze betaaldienstverlener Stripe. Daar kies je{" "}
        <Choice id="payment_methods">iDEAL | Wero of een andere methode die op de betaalpagina wordt getoond</Choice>. Wij zien en bewaren geen
        bankgegevens of kaartgegevens.
      </p>
      <p>
        Alle prijzen zijn in euro en <Choice id="vat">inclusief btw</Choice>. De verzendkosten zie je vóór je betaalt. Je bestelling is definitief als
        je op de betaalpagina op <strong>Betalen</strong> klikt en de betaling lukt. Lukt de betaling niet of breek je af, dan vervalt de bestelling en
        geven we de gereserveerde artikelen weer vrij.
      </p>
      <p>
        We verzenden je bestelling nadat de betaling is ontvangen. Volgens de wet hoef je niet meer dan de helft vooruit te betalen.{" "}
        <Choice id="payment_methods">
          Wil je niet (volledig) vooruitbetalen, <Link href="/contact">neem dan vóór je bestelling contact met ons op</Link> voor een andere afspraak.
        </Choice>
      </p>
      <p>Een terugbetaling (bijvoorbeeld na herroeping) doen we met hetzelfde betaalmiddel als waarmee je hebt betaald.</p>
    </>
  ),

  retourneren: (c) => (
    <>
      <p>
        Je mag je bestelling binnen <strong>{WITHDRAWAL_DAYS} dagen</strong> zonder opgave van redenen herroepen (ontbinden). Deze bedenktijd gaat in
        op de dag nadat jij, of iemand die jij hebt aangewezen, de bestelling hebt ontvangen. Ontvang je een bestelling in meerdere zendingen, dan gaat
        de bedenktijd in na ontvangst van de laatste zending.
      </p>
      <H>Zo herroep je</H>
      <ul>
        <li>
          Online, op elk moment tijdens de bedenktijd: <Link href={WITHDRAWAL_PATH}>{WITHDRAWAL_LABELS.entry}</Link>. Je krijgt direct een
          ontvangstbevestiging per e-mail.
        </li>
        <li>
          Of met het <Link href="/info/herroepingsformulier">modelformulier voor herroeping</Link> of een andere duidelijke verklaring
          {c.b.email ? (<> per e-mail aan <a href={`mailto:${c.b.email}`}>{c.b.email}</a></>) : null}
          {addressLine(c.b) ? <> of per post aan {sellerName(c.b)}, {addressLine(c.b)}</> : null}.
        </li>
      </ul>
      <p>Het is op tijd als je je herroeping verstuurt vóór het einde van de bedenktijd.</p>
      <H>Terugsturen</H>
      <p>
        Stuur de artikelen uiterlijk {WITHDRAWAL_DAYS} dagen na je herroeping terug{retLine(c) ? <> naar <strong>{retLine(c)}</strong></> : null}.
        Vermeld je bestelnummer. <Choice id="return_costs">{policy("return_costs").proposal}</Choice> Bewaar het verzendbewijs.
      </p>
      <p>
        Tijdens de bedenktijd mag je het artikel bekijken zoals je dat in een winkel zou doen. Ga je verder dan nodig is om de aard, kenmerken en
        werking vast te stellen, dan ben je aansprakelijk voor de waardevermindering.{" "}
        <Choice id="applied_protector">
          Een screenprotector die je al op je telefoon hebt aangebracht, is gebruikt en kan niet opnieuw worden verkocht; die waardevermindering kunnen
          we verrekenen, tot maximaal het aankoopbedrag.
        </Choice>
      </p>
      <H>Terugbetaling</H>
      <p>
        We betalen het aankoopbedrag terug, inclusief de kosten van de standaardverzending, uiterlijk {WITHDRAWAL_DAYS} dagen nadat we je herroeping
        hebben ontvangen. We gebruiken hetzelfde betaalmiddel als waarmee je hebt betaald. We mogen wachten met terugbetalen tot we de artikelen terug
        hebben ontvangen of tot je aantoont dat je ze hebt teruggestuurd, als dat eerder is.
      </p>
      <H>Defect of verkeerd geleverd?</H>
      <p>
        Dan kun je binnen de bedenktijd herroepen zoals hierboven beschreven, maar je kunt ook een beroep doen op je wettelijke garantie: dan zorgen we
        kosteloos voor herstel of vervanging, of volgt prijsvermindering of ontbinding. Bij een beroep op de garantie betaal je geen kosten voor
        het terugsturen. Lees <Link href="/info/garantie">garantie en klachten</Link>.
      </p>
    </>
  ),

  herroepingsformulier: (c) => {
    const f = modelWithdrawalForm(c.b, c.ret.street ? c.ret : c.b);
    return (
      <>
        <p>
          Je kunt dit formulier gebruiken, maar dat hoeft niet: herroepen kan ook online via{" "}
          <Link href={WITHDRAWAL_PATH}>{WITHDRAWAL_LABELS.entry}</Link> of met een andere duidelijke verklaring.
        </p>
        <div className="card" style={{ boxShadow: "none", border: "1px solid var(--to-border)" }}>
          <h2 style={{ fontSize: "1.125rem", marginTop: 0 }}>Modelformulier voor herroeping</h2>
          <p className="small">{f.intro}</p>
          <p>
            Aan:
            <br />
            {f.to.map((l) => (
              <span key={l}>
                {l}
                <br />
              </span>
            ))}
          </p>
          <ul style={{ listStyle: "none", paddingLeft: 0 }}>
            {f.lines.map((l) => (
              <li key={l} style={{ marginBottom: 12 }}>
                — {l}
              </li>
            ))}
          </ul>
          <p className="small">{f.footnote}</p>
        </div>
      </>
    );
  },

  garantie: (c) => (
    <>
      <p>
        Je hebt recht op een product dat doet wat je ervan mag verwachten (de wettelijke garantie of conformiteit). Dat recht kunnen we niet beperken.
        Blijkt een product binnen een jaar na levering niet te deugen, dan gaat de wet ervan uit dat het gebrek er bij levering al was, tenzij wij het
        tegendeel aantonen.
      </p>
      <p>
        <Choice id="guarantee_notice">De officiële Europese kennisgeving over de wettelijke garantie wordt hier nog toegevoegd.</Choice>
      </p>
      <p>
        <Choice id="warranty">We geven geen extra (commerciële) garantie bovenop de wettelijke garantie.</Choice>
      </p>
      <H>Wat je kunt vragen</H>
      <p>
        Voldoet een product niet, dan kun je kosteloos herstel of vervanging vragen. Lukt dat niet, duurt het te lang of is het ernstig ongemak voor
        je, dan kun je prijsvermindering vragen of de koop ontbinden.
      </p>
      <H>Een klacht melden</H>
      <p>
        Meld een gebrek of klacht zo snel mogelijk nadat je het hebt ontdekt; een melding binnen twee maanden na ontdekking is in elk geval op tijd.
        Mail{c.b.email ? <> naar <a href={`mailto:${c.b.email}`}>{c.b.email}</a></> : " ons"} of gebruik het <Link href="/contact">contactformulier</Link>,
        met je bestelnummer, een omschrijving en zo mogelijk een foto. We bevestigen je klacht en laten je zo snel mogelijk weten hoe we die oplossen.
      </p>
      <H>Komen we er samen niet uit?</H>
      <p>
        <Choice id="adr">
          {sellerName(c.b)} is niet aangesloten bij een geschilleninstantie. Je kunt een geschil voorleggen aan de bevoegde rechter.
        </Choice>{" "}
        Voor consumentenvragen kun je ook terecht bij ConsuWijzer van de Autoriteit Consument &amp; Markt.
      </p>
    </>
  ),

  voorwaarden: (c) => (
    <>
      <p className="small muted">
        Versie: {LEGAL_VERSION}. Deze voorwaarden gelden voor bestellingen van consumenten in de webshop {c.b.shop_name ?? "Timber Online"}. Je kunt ze
        opslaan of afdrukken. Gaat de wet verder dan deze voorwaarden, dan geldt de wet.
      </p>
      <H>1. Wie zijn wij</H>
      <Seller b={c.b} />
      <H>2. Toepasselijkheid</H>
      <p>
        Deze voorwaarden gelden voor elk aanbod in de webshop en voor elke overeenkomst op afstand tussen {sellerName(c.b)} en jou als consument. Je
        kunt ze vóór je bestelling lezen; we sturen een samenvatting van je rechten met je orderbevestiging mee. Is een bepaling ongeldig, dan blijven
        de andere bepalingen gelden.
      </p>
      <H>3. Aanbod</H>
      <p>
        We beschrijven onze producten zo volledig en nauwkeurig mogelijk, inclusief de toestellen waarop ze passen. Afbeeldingen geven het product
        waarheidsgetrouw weer. Kennelijke vergissingen of fouten in het aanbod (zoals een duidelijk verkeerde prijs) binden ons niet.
      </p>
      <H>4. Bestellen en totstandkoming van de overeenkomst</H>
      <p>
        Je bestelt in deze stappen: je legt artikelen in je winkelwagen, kiest een verzendoptie en klikt op <strong>Afrekenen</strong>. Op de
        betaalpagina van Stripe vul je je gegevens en bezorgadres in en kies je een betaalmethode. Tot je op <strong>Betalen</strong> klikt, kun je
        alles controleren en invoerfouten herstellen: aantallen in de winkelwagen, gegevens op de betaalpagina, of je gaat terug naar de winkelwagen.
      </p>
      <p>
        De overeenkomst komt tot stand als je op de betaalpagina op <strong>Betalen</strong> klikt en de betaling lukt. Je artikelen worden tijdens het
        betalen voor je gereserveerd. Je ontvangt direct een orderbevestiging per e-mail met je bestelling, deze belangrijkste afspraken en het
        modelformulier voor herroeping. Wij bewaren je bestelling; bewaar zelf de bevestiging. De overeenkomst wordt in het Nederlands gesloten.
      </p>
      <H>5. Prijzen</H>
      <p>
        Prijzen zijn in euro en <Choice id="vat">inclusief btw</Choice>. Verzendkosten zie je vóór je betaalt. Tijdens de geldigheid van het aanbod
        verhogen we de prijs niet.
      </p>
      <H>6. Betaling</H>
      <p>
        Je betaalt via de betaalpagina van Stripe met de daar getoonde betaalmethoden. Wij ontvangen geen bank- of kaartgegevens. Je kunt niet worden
        verplicht meer dan de helft van de prijs vooruit te betalen;{" "}
        <Choice id="payment_methods">wil je niet (volledig) vooruitbetalen, neem dan vóór je bestelling contact met ons op.</Choice> We verzenden na
        ontvangst van de betaling.
      </p>
      <H>7. Levering en risico</H>
      <p>
        We leveren op het adres dat je bij de bestelling opgeeft, binnen de levertijd die we vóór de bestelling tonen en uiterlijk binnen 30 dagen,
        tenzij we iets anders afspreken. Lukt dat niet, dan mag je ons een redelijke extra termijn geven en daarna de overeenkomst kosteloos ontbinden.
        Het risico van verlies of beschadiging gaat pas op jou over als de bestelling bij jou (of een door jou aangewezen persoon) is bezorgd. Meer in{" "}
        <Link href="/info/verzending">Verzending en levering</Link>.
      </p>
      <H>8. Herroepingsrecht</H>
      <p>
        Je kunt de overeenkomst binnen {WITHDRAWAL_DAYS} dagen na ontvangst zonder opgave van redenen herroepen, online via{" "}
        <Link href={WITHDRAWAL_PATH}>{WITHDRAWAL_LABELS.entry}</Link>, met het <Link href="/info/herroepingsformulier">modelformulier</Link> of met een
        andere duidelijke verklaring. Je stuurt de artikelen binnen {WITHDRAWAL_DAYS} dagen na je herroeping terug.{" "}
        <Choice id="return_costs">{policy("return_costs").proposal}</Choice> We betalen binnen {WITHDRAWAL_DAYS} dagen na je herroeping terug, inclusief
        de standaard verzendkosten. Alle details in <Link href="/info/retourneren">Herroepen en retourneren</Link>.
      </p>
      <H>9. Garantie en klachten</H>
      <p>
        Je hebt altijd de wettelijke garantie: een product moet doen wat je ervan mag verwachten. Hoe je een gebrek of klacht meldt, staat in{" "}
        <Link href="/info/garantie">Garantie en klachten</Link>. Deze voorwaarden beperken je wettelijke rechten niet.
      </p>
      <H>10. Aansprakelijkheid</H>
      <p>
        We zijn aansprakelijk zoals de wet bepaalt. Deze voorwaarden beperken onze aansprakelijkheid tegenover jou als consument niet verder dan de wet
        toestaat.
      </p>
      <H>11. Persoonsgegevens</H>
      <p>
        We gebruiken je gegevens alleen om je bestelling af te handelen en om aan wettelijke verplichtingen te voldoen. Zie de{" "}
        <Link href="/info/privacy">privacyverklaring</Link>.
      </p>
      <H>12. Geschillen en toepasselijk recht</H>
      <p>
        Op deze voorwaarden en de overeenkomst is Nederlands recht van toepassing. Woon je in een ander land, dan houd je de bescherming van de
        dwingende regels van dat land. <Choice id="adr">We zijn niet aangesloten bij een geschilleninstantie; je kunt een geschil voorleggen aan de bevoegde rechter.</Choice>
      </p>
      <H>13. Wijzigingen</H>
      <p>Op je bestelling zijn de voorwaarden van toepassing die golden op het moment van je bestelling.</p>
    </>
  ),

  privacy: (c) => (
    <>
      <p className="small muted">Versie: {LEGAL_VERSION}.</p>
      <H>Wie is verantwoordelijk</H>
      <p>
        {sellerName(c.b)} is verantwoordelijk voor de verwerking van je persoonsgegevens in deze webshop. Vragen of een verzoek over je gegevens?
        {c.b.email ? <> Mail naar <a href={`mailto:${c.b.email}`}>{c.b.email}</a>.</> : " Neem contact met ons op."}
      </p>
      <Seller b={c.b} />
      <H>Welke gegevens en waarvoor</H>
      <ul>
        <li>
          <strong>Je bestelling afhandelen</strong> (uitvoering van de overeenkomst): naam, bezorgadres, e-mailadres, bestelde artikelen, bedragen en
          betaalstatus. Je vult deze gegevens in op de betaalpagina van Stripe.
        </li>
        <li>
          <strong>Verzenden</strong>: naam, adres en zo nodig e-mailadres voor het verzendlabel en de track & trace van de vervoerder.
        </li>
        <li>
          <strong>Contact, klachten en herroeping</strong>: de gegevens en het bericht dat je ons stuurt.
        </li>
        <li>
          <strong>Administratie</strong> (wettelijke plicht): bestel- en betaalgegevens, die we volgens de fiscale bewaarplicht 7 jaar bewaren.
        </li>
        <li>
          <strong>Beveiliging en misbruik voorkomen</strong> (gerechtvaardigd belang): een versleutelde (gehashte) afgeleide van je IP-adres om het
          aantal formulierberichten te beperken; die bewaren we kort.
        </li>
      </ul>
      <p>
        We gebruiken je gegevens niet voor reclame of nieuwsbrieven, verkopen ze niet en nemen geen besluiten die alleen op automatische verwerking
        berusten. Je hebt geen account nodig.
      </p>
      <H>Diensten die we gebruiken</H>
      <p>
        <Choice id="processors">Deze diensten verwerken gegevens voor ons of zijn zelf verantwoordelijk voor hun deel:</Choice>
      </p>
      <ul>
        <li>
          <strong>Stripe</strong> (betalingen): verwerkt je betaling en de gegevens op de betaalpagina. Stripe is voor een deel zelf verantwoordelijk
          (bijvoorbeeld fraudepreventie) en heeft een eigen privacyverklaring.
        </li>
        <li>
          <strong>Supabase</strong> (database en beheerlogin): bewaart bestellingen en voorraad; de database staat in de EU (Ierland).
        </li>
        <li>
          <strong>Vercel</strong> (hosting van de webshop): verwerkt technische gegevens zoals je IP-adres om de website te leveren.
        </li>
        <li>
          <strong>Resend</strong> (e-mail): verstuurt orderbevestigingen, verzendberichten en bevestigingen van herroepingen; verzending vanuit de EU
          (Ierland).
        </li>
        <li>
          <strong>DHL en PostNL</strong> (bezorging): ontvangen je naam, adres en zo nodig e-mailadres om je pakje te bezorgen.
        </li>
        <li>
          <strong>bol</strong>: bestel je via bol, dan is bol verantwoordelijk voor de verkoop via zijn platform en ontvangen wij de gegevens die nodig
          zijn om te leveren.
        </li>
      </ul>
      <p>
        Sommige van deze bedrijven zijn (ook) in de Verenigde Staten gevestigd. Als gegevens buiten de EU worden verwerkt, gebeurt dat op basis van
        het EU-VS Data Privacy Framework of standaardcontractbepalingen van de Europese Commissie.
      </p>
      <H>Hoe lang we gegevens bewaren</H>
      <p>
        <Choice id="retention">{policy("retention").proposal}</Choice>
      </p>
      <H>Je rechten</H>
      <p>
        Je kunt ons vragen je gegevens in te zien, te verbeteren, te verwijderen of over te dragen, en je kunt bezwaar maken tegen of een beperking
        vragen van de verwerking. Gegevens die we wettelijk moeten bewaren, verwijderen we pas na afloop van de bewaartermijn. We reageren binnen een
        maand. Ben je niet tevreden over hoe we met je gegevens omgaan, dan kun je een klacht indienen bij de Autoriteit Persoonsgegevens.
      </p>
      <H>Beveiliging</H>
      <p>
        De website gebruikt een versleutelde verbinding (HTTPS). Alleen bevoegde beheerders hebben toegang, met wachtwoord en verplichte
        tweestapsverificatie, en wijzigingen worden vastgelegd in een logboek.
      </p>
      <H>Cookies</H>
      <p>
        We gebruiken geen tracking- of advertentiecookies. Zie <Link href="/info/cookies">Cookies</Link>.
      </p>
    </>
  ),

  cookies: () => (
    <>
      <p>
        {"We gebruiken geen analyse-, tracking- of advertentiecookies en geen social-mediaknoppen die je volgen. Daarom vragen we geen toestemming voor cookies."}
      </p>
      <H>Wat we wel opslaan</H>
      <ul>
        <li>
          <strong>Winkelwagen</strong>: je winkelwagen wordt alleen in je eigen browser bewaard (lokale opslag), zodat die blijft staan als je verder
          winkelt. Dit is nodig voor de webshop en wordt niet naar ons verstuurd tot je afrekent.
        </li>
        <li>
          <strong>Beheer</strong>: medewerkers die inloggen in het beheer krijgen een sessiecookie. Bezoekers van de webshop krijgen dat niet.
        </li>
      </ul>
      <H>Betaalpagina</H>
      <p>
        Bij het afrekenen ga je naar de betaalpagina van Stripe. Stripe plaatst daar eigen, functionele cookies, onder meer om fraude te voorkomen.
        Daarvoor geldt het cookiebeleid van Stripe.
      </p>
      <p>Je kunt de lokale opslag en cookies altijd wissen via de instellingen van je browser; je winkelwagen is dan leeg.</p>
    </>
  ),
};
