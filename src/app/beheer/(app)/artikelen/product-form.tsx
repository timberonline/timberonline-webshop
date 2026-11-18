import { CARRIER_LABEL } from "@/lib/format";
import { saveProductAction } from "./actions";

type Device = { slug: string; name: string; family: string };
type Component = { id: string; code: string; name: string; kind: string; free: number };
export type ProductFull = {
  id: string; sku: string; slug: string; kind: string; title: string; subtitle: string | null; description: string | null; status: string;
  ean: string | null; bol_reference: string | null; bol_offer_id: string | null; bol_title: string | null; bol_title_fix_required: boolean;
  web_enabled: boolean; bol_enabled: boolean; bol_buffer_units: number | null; allow_tier_discount: boolean; allowed_carriers: string[];
  preferred_carrier: string; packed_weight_g: number; package_format: string; review_note: string | null; image_path: string | null;
  devices: { slug: string; confirmed: boolean }[]; components: { component_id: string; qty: number }[];
};

export function ProductForm({ product, devices, components, imageUrl }: { product: ProductFull | null; devices: Device[]; components: Component[]; imageUrl: string | null }) {
  const p = product;
  const isBundle = !p || p.kind === "bundle";
  const devState = (slug: string) => {
    const d = p?.devices.find((x) => x.slug === slug);
    return d ? (d.confirmed ? "confirmed" : "doubt") : "none";
  };
  const compQty = (id: string) => p?.components.find((c) => c.component_id === id)?.qty ?? 0;
  return (
    <form action={saveProductAction} encType="multipart/form-data" className="stack">
      {p ? <input type="hidden" name="id" value={p.id} /> : null}
      {p && isBundle ? <input type="hidden" name="is_bundle" value="1" /> : null}
      <section className="card">
        <h2 style={{ fontSize: "1.125rem" }}>Basis</h2>
        {!p ? (
          <div className="row">
            <div className="field"><label htmlFor="sku">SKU</label><input id="sku" name="sku" type="text" required placeholder="TO-BND-..." pattern="[A-Za-z0-9-]{4,40}" /></div>
            <div className="field"><label htmlFor="slug">Slug (URL)</label><input id="slug" name="slug" type="text" required placeholder="bundel-..." pattern="[a-z0-9-]{4,80}" /></div>
            <div className="field"><label htmlFor="web_price">Bundelprijs</label><input id="web_price" name="web_price" type="text" inputMode="decimal" required placeholder="29,95" /></div>
          </div>
        ) : (
          <p className="muted">SKU {p.sku} · /product/{p.slug}</p>
        )}
        <div className="field"><label htmlFor="title">Titel</label><input id="title" name="title" type="text" required defaultValue={p?.title ?? ""} /></div>
        <div className="field"><label htmlFor="subtitle">Ondertitel</label><input id="subtitle" name="subtitle" type="text" defaultValue={p?.subtitle ?? ""} /></div>
        <div className="field"><label htmlFor="description">Omschrijving</label><textarea id="description" name="description" defaultValue={p?.description ?? ""} /></div>
        <div className="row">
          <div className="field">
            <label htmlFor="status">Status</label>
            <select id="status" name="status" defaultValue={p?.status ?? "concept"}>
              <option value="concept">Concept (niet zichtbaar)</option>
              <option value="active">Actief</option>
              <option value="archived">Gearchiveerd</option>
            </select>
          </div>
          <label className="check"><input type="checkbox" name="web_enabled" defaultChecked={p?.web_enabled ?? true} /> Zichtbaar in webshop</label>
          <label className="check"><input type="checkbox" name="allow_tier_discount" defaultChecked={p?.allow_tier_discount ?? false} /> Staffelkorting toestaan</label>
        </div>
        <div className="field"><label htmlFor="review_note">Interne notitie (twijfels, controlepunten)</label><textarea id="review_note" name="review_note" defaultValue={p?.review_note ?? ""} /></div>
        <div className="field">
          <label htmlFor="image">Productfoto (PNG/JPG/WebP, max 5 MB)</label>
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt="Huidige productfoto" width={120} height={120} style={{ objectFit: "cover", borderRadius: 10, marginBottom: 8 }} />
          ) : null}
          <input id="image" name="image" type="file" accept="image/png,image/jpeg,image/webp" />
        </div>
      </section>

      <section className="card">
        <h2 style={{ fontSize: "1.125rem" }}>Compatibiliteit</h2>
        <p className="small muted">Alleen bevestigde toestellen zijn zichtbaar voor klanten. Twijfelgevallen blijven intern.</p>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 230px), 1fr))" }}>
          {devices.map((d) => (
            <div key={d.slug}>
              <label htmlFor={`dev_${d.slug}`}>{d.name}</label>
              <select id={`dev_${d.slug}`} name={`dev_${d.slug}`} defaultValue={devState(d.slug)}>
                <option value="none">Past niet</option>
                <option value="confirmed">Past (bevestigd)</option>
                <option value="doubt">Twijfel (concept)</option>
              </select>
            </div>
          ))}
        </div>
      </section>

      {isBundle ? (
        <section className="card">
          <h2 style={{ fontSize: "1.125rem" }}>Samenstelling bundel</h2>
          <p className="small muted">Aantal fysieke stuks per bundel. De bundel gebruikt dezelfde voorraad als de losse artikelen.</p>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 260px), 1fr))" }}>
            {components.map((c) => (
              <div key={c.id} className="row" style={{ alignItems: "center", flexWrap: "nowrap" }}>
                <label htmlFor={`comp_${c.id}`} style={{ fontWeight: 500, flex: 1 }}>{c.name} <span className="small muted">({c.free} vrij)</span></label>
                <input id={`comp_${c.id}`} name={`comp_${c.id}`} type="number" min={0} max={10} defaultValue={compQty(c.id)} style={{ maxWidth: 80 }} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {p && !isBundle ? (
        <section className="card">
          <h2 style={{ fontSize: "1.125rem" }}>Kanaalreferenties bol</h2>
          <div className="row">
            <div className="field"><label htmlFor="ean">EAN</label><input id="ean" name="ean" type="text" inputMode="numeric" defaultValue={p.ean ?? ""} /></div>
            <div className="field"><label htmlFor="bol_reference">bol-referentie</label><input id="bol_reference" name="bol_reference" type="text" defaultValue={p.bol_reference ?? ""} /></div>
            <div className="field"><label htmlFor="bol_offer_id">bol-offerId</label><input id="bol_offer_id" name="bol_offer_id" type="text" defaultValue={p.bol_offer_id ?? ""} /></div>
          </div>
          <div className="field"><label htmlFor="bol_title">Titel op bol</label><input id="bol_title" name="bol_title" type="text" defaultValue={p.bol_title ?? ""} /></div>
          <div className="row">
            <label className="check"><input type="checkbox" name="bol_title_fix_required" defaultChecked={p.bol_title_fix_required} /> bol-titel moet gecorrigeerd worden</label>
            <label className="check"><input type="checkbox" name="bol_enabled" defaultChecked={p.bol_enabled} /> Voorraad en prijs naar bol sturen</label>
            <div className="field"><label htmlFor="bol_buffer_units">Buffer (eenheden, leeg = standaard)</label><input id="bol_buffer_units" name="bol_buffer_units" type="number" min={0} defaultValue={p.bol_buffer_units ?? ""} /></div>
          </div>
        </section>
      ) : null}

      <section className="card">
        <h2 style={{ fontSize: "1.125rem" }}>Verzending</h2>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600 }}>Toegestane methoden</legend>
          <div className="row">
            {["dhl", "postnl", "letter"].map((c) => (
              <label key={c} className="check"><input type="checkbox" name={`carrier_${c}`} defaultChecked={(p?.allowed_carriers ?? ["dhl", "postnl"]).includes(c)} /> {CARRIER_LABEL[c]}</label>
            ))}
          </div>
        </fieldset>
        <div className="row">
          <div className="field">
            <label htmlFor="preferred_carrier">Voorkeur</label>
            <select id="preferred_carrier" name="preferred_carrier" defaultValue={p?.preferred_carrier ?? "dhl"}>
              {["dhl", "postnl", "letter"].map((c) => <option key={c} value={c}>{CARRIER_LABEL[c]}</option>)}
            </select>
          </div>
          <div className="field"><label htmlFor="packed_weight_g">Verpakt gewicht (g)</label><input id="packed_weight_g" name="packed_weight_g" type="number" min={1} defaultValue={p?.packed_weight_g ?? 150} /></div>
          <div className="field">
            <label htmlFor="package_format">Formaat</label>
            <select id="package_format" name="package_format" defaultValue={p?.package_format ?? "letterbox"}>
              <option value="letter">Brief</option>
              <option value="letterbox">Brievenbuspakje</option>
              <option value="parcel">Pakket</option>
            </select>
          </div>
        </div>
      </section>
      <div><button className="btn">{p ? "Opslaan" : "Bundel aanmaken"}</button></div>
    </form>
  );
}
