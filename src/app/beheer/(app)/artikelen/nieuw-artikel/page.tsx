import Link from "next/link";
import { connection } from "next/server";
import { Flash } from "../../_components/ui";
import { requireAdminPage, ROLES } from "@/server/auth/admin";
import { getDb } from "@/server/db";
import { createProductAction, saveDeviceAction } from "../actions";

type Device = { slug: string; name: string; family: string };
type Comp = { id: string; code: string; name: string; kind: string; free: number };

export default async function NewProduct({ searchParams }: PageProps<"/beheer/artikelen/nieuw-artikel">) {
  await requireAdminPage(ROLES.catalog);
  await connection();
  const sp = await searchParams;
  const db = getDb();
  const [devices, comps] = await Promise.all([
    db.rpc<Device[]>("api_admin_devices", {}),
    db.rpc<{ components: Comp[] }>("api_admin_components", { limit: 1 }),
  ]);
  return (
    <>
      <div className="page-head">
        <h1>Nieuw artikel</h1>
        <Link href="/beheer/artikelen">← Alle artikelen</Link>
      </div>
      <Flash sp={sp} />
      <p className="muted">
        Een nieuwe set (screenprotectors) of een nieuw hoesje. Het artikel start altijd als <strong>concept</strong>. Fysieke voorraad
        voeg je daarna toe via Voorraad; zet het artikel pas op actief als prijs, onderdelen en een bevestigd toestel kloppen.
        Bundels maak je via <Link href="/beheer/artikelen/nieuwe-bundel">Nieuwe bundel</Link>.
      </p>

      <form action={createProductAction} className="stack">
        <section className="card" aria-labelledby="soort">
          <h2 id="soort" style={{ fontSize: "1.125rem" }}>Soort en kenmerken</h2>
          <div className="row">
            <div className="field">
              <label htmlFor="kind">Soort</label>
              <select id="kind" name="kind" defaultValue="set" required>
                <option value="set">Set screenprotectors</option>
                <option value="case">Hoesje</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="product_type">Producttype (voor sets)</label>
              <select id="product_type" name="product_type" defaultValue="screenprotector">
                <option value="screenprotector">Screenprotector</option>
                <option value="privacy">Privacy-screenprotector</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="pack_qty">Stuks per set</label>
              <input id="pack_qty" name="pack_qty" type="number" min={1} max={10} defaultValue={2} aria-describedby="pack_qty_hint" />
              <span id="pack_qty_hint" className="small muted">Een tweepack verbruikt 2 losse protectors. Voor hoesjes altijd 1.</span>
            </div>
          </div>
          <div className="row">
            <div className="field"><label htmlFor="sku">Eigen SKU</label><input id="sku" name="sku" type="text" required placeholder="TO-SP2-..." pattern="[A-Za-z0-9-]{4,40}" /></div>
            <div className="field"><label htmlFor="slug">Slug (URL)</label><input id="slug" name="slug" type="text" required placeholder="screenprotector-iphone-..." pattern="[a-z0-9-]{4,80}" /></div>
          </div>
          <div className="field"><label htmlFor="title">Titel</label><input id="title" name="title" type="text" required /></div>
          <div className="field"><label htmlFor="subtitle">Ondertitel</label><input id="subtitle" name="subtitle" type="text" placeholder="Tweepack · 9H gehard glas" /></div>
          <div className="field"><label htmlFor="description">Omschrijving</label><textarea id="description" name="description" /></div>
        </section>

        <section className="card" aria-labelledby="prijzen">
          <h2 id="prijzen" style={{ fontSize: "1.125rem" }}>Prijzen en koppelingen</h2>
          <div className="row">
            <div className="field"><label htmlFor="web_price">Webshopprijs</label><input id="web_price" name="web_price" type="text" inputMode="decimal" required placeholder="19,95" /></div>
            <div className="field"><label htmlFor="bol_price">bol-prijs (optioneel)</label><input id="bol_price" name="bol_price" type="text" inputMode="decimal" placeholder="19,95" /></div>
          </div>
          <div className="row">
            <div className="field"><label htmlFor="ean">EAN</label><input id="ean" name="ean" type="text" inputMode="numeric" pattern="[0-9]{8,14}" /></div>
            <div className="field"><label htmlFor="bol_reference">bol-referentie</label><input id="bol_reference" name="bol_reference" type="text" /></div>
            <div className="field"><label htmlFor="bol_offer_id">bol-offerId</label><input id="bol_offer_id" name="bol_offer_id" type="text" /></div>
          </div>
          <div className="field"><label htmlFor="bol_title">bol-titel</label><input id="bol_title" name="bol_title" type="text" /></div>
          <div className="field"><label htmlFor="review_note">Interne notitie (twijfels, controlepunten)</label><textarea id="review_note" name="review_note" /></div>
        </section>

        <section className="card" aria-labelledby="onderdeel">
          <h2 id="onderdeel" style={{ fontSize: "1.125rem" }}>Fysiek onderdeel</h2>
          <p className="small muted">Kies een bestaand onderdeel (gedeelde voorraad) of maak een nieuw onderdeel aan; een nieuw onderdeel start met voorraad 0.</p>
          <div className="field">
            <label htmlFor="component_id">Bestaand onderdeel</label>
            <select id="component_id" name="component_id" defaultValue="">
              <option value="">Nieuw onderdeel (hieronder)</option>
              {comps.components.map((c) => (
                <option key={c.id} value={c.id}>{c.code} · {c.name} ({c.kind === "case" ? "hoesje" : "protector"}, vrij {c.free})</option>
              ))}
            </select>
          </div>
          <div className="row">
            <div className="field"><label htmlFor="new_component_code">Code nieuw onderdeel</label><input id="new_component_code" name="new_component_code" type="text" placeholder="C-SP-..." pattern="[A-Za-z0-9-]{3,40}" /></div>
            <div className="field"><label htmlFor="new_component_name">Naam nieuw onderdeel</label><input id="new_component_name" name="new_component_name" type="text" /></div>
          </div>
        </section>

        <section className="card" aria-labelledby="compat">
          <h2 id="compat" style={{ fontSize: "1.125rem" }}>Compatibiliteit</h2>
          <p className="small muted">Alleen bevestigde toestellen zijn zichtbaar voor klanten. Twijfelgevallen blijven intern.</p>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 230px), 1fr))" }}>
            {devices.map((d) => (
              <div key={d.slug}>
                <label htmlFor={`dev_${d.slug}`}>{d.name}</label>
                <select id={`dev_${d.slug}`} name={`dev_${d.slug}`} defaultValue="none">
                  <option value="none">Past niet</option>
                  <option value="confirmed">Past (bevestigd)</option>
                  <option value="doubt">Twijfel (concept)</option>
                </select>
              </div>
            ))}
          </div>
        </section>

        <div><button type="submit" className="btn">Artikel aanmaken als concept</button></div>
      </form>

      <section className="card" aria-labelledby="toestel" style={{ marginTop: 24 }}>
        <h2 id="toestel" style={{ fontSize: "1.125rem" }}>Toestel toevoegen of wijzigen</h2>
        <form action={saveDeviceAction} className="row">
          <div className="field"><label htmlFor="dev_new_slug">Slug</label><input id="dev_new_slug" name="slug" type="text" required placeholder="iphone-16" pattern="[a-z0-9]+(-[a-z0-9]+)*" /></div>
          <div className="field"><label htmlFor="dev_new_name">Naam</label><input id="dev_new_name" name="name" type="text" required placeholder="iPhone 16" /></div>
          <div className="field"><label htmlFor="dev_new_family">Serie</label><input id="dev_new_family" name="family" type="text" placeholder="iPhone 16" /></div>
          <div className="field"><label htmlFor="dev_new_sort">Volgorde</label><input id="dev_new_sort" name="sort" type="number" min={0} max={999} /></div>
          <div><button type="submit" className="btn btn-secondary">Toestel opslaan</button></div>
        </form>
      </section>
    </>
  );
}
