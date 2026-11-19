import { Fragment } from "react";
import { connection } from "next/server";
import { Flash } from "../_components/ui";
import { ROLE_LABEL, requireAdminPage, ROLES, type Role } from "@/server/auth/admin";
import { getDb } from "@/server/db";
import { integrationStatus } from "@/server/services/runtime";
import type { ShippingOption } from "@/server/services/types";
import type { BusinessInfo, Confirmation, PostalAddress } from "@/server/services/business";
import { dateTime } from "@/lib/format";
import { saveAdminAction, saveSettingsAction } from "./actions";

type Settings = {
  bol_buffer_units: number; reservation_minutes: number; delivery_promise: string; tracking_info: string; bol_requires_tracking: boolean; letter_max_weight_g?: number;
  shipping_options: ShippingOption[];
  sender_address?: Partial<PostalAddress> & Confirmation; return_address?: Partial<PostalAddress> & Confirmation;
  business_info?: Partial<BusinessInfo> & Confirmation & { source?: string | null };
};

/** Status en vinkje "bevestigd vóór livegang" per toepassing. */
function ConfirmBox({ prefix, value }: { prefix: string; value?: Confirmation }) {
  return (
    <div style={{ marginTop: 8 }}>
      {value?.confirmed_at ? (
        <p className="small" style={{ margin: "0 0 6px" }}><span className="badge badge-ok">Bevestigd</span> {dateTime(value.confirmed_at)} door {value.confirmed_by}</p>
      ) : (
        <p className="notice notice-warn small" style={{ margin: "0 0 6px" }}>Nog te bevestigen vóór de commerciële livegang.</p>
      )}
      <label className="check"><input type="checkbox" name={`${prefix}confirmed`} defaultChecked={Boolean(value?.confirmed_at)} /> Gecontroleerd en bevestigd voor commerciële livegang</label>
    </div>
  );
}

function AddressFields({ prefix, value }: { prefix: string; value?: Partial<PostalAddress> }) {
  return (
    <div className="row">
      <div className="field"><label htmlFor={`${prefix}name`}>Naam</label><input id={`${prefix}name`} name={`${prefix}name`} type="text" required defaultValue={value?.name ?? "Timber Online"} /></div>
      <div className="field"><label htmlFor={`${prefix}street`}>Straat</label><input id={`${prefix}street`} name={`${prefix}street`} type="text" autoComplete="off" defaultValue={value?.street ?? ""} /></div>
      <div className="field" style={{ flex: "0 1 120px" }}><label htmlFor={`${prefix}house_number`}>Huisnummer</label><input id={`${prefix}house_number`} name={`${prefix}house_number`} type="text" defaultValue={value?.house_number ?? ""} /></div>
      <div className="field" style={{ flex: "0 1 140px" }}><label htmlFor={`${prefix}postal_code`}>Postcode</label><input id={`${prefix}postal_code`} name={`${prefix}postal_code`} type="text" defaultValue={value?.postal_code ?? ""} /></div>
      <div className="field"><label htmlFor={`${prefix}city`}>Plaats</label><input id={`${prefix}city`} name={`${prefix}city`} type="text" defaultValue={value?.city ?? ""} /></div>
      <div className="field" style={{ flex: "0 1 160px" }}><label htmlFor={`${prefix}country`}>Land</label><select id={`${prefix}country`} name={`${prefix}country`} defaultValue={value?.country ?? "NL"}><option value="NL">Nederland</option><option value="BE">België</option></select></div>
    </div>
  );
}
const euro = (c: number | null | undefined) => (c == null ? "" : (c / 100).toFixed(2).replace(".", ","));

export default async function SettingsPage({ searchParams }: PageProps<"/beheer/instellingen">) {
  await requireAdminPage(ROLES.settings);
  await connection();
  const sp = await searchParams;
  const db = getDb();
  const [st, admins] = await Promise.all([db.rpc<Settings>("api_admin_settings", {}), db.rpc<{ user_id: string; email: string; role: Role; active: boolean }[]>("api_admin_users", {})]);
  const integ = integrationStatus();
  const opt = (code: string) => st.shipping_options.find((o) => o.code === code);
  const B = st.business_info;
  return (
    <>
      <div className="page-head"><h1>Instellingen</h1></div>
      <Flash sp={sp} />
      <form action={saveSettingsAction} className="stack">
        <section className="card">
          <h2 style={{ fontSize: "1.125rem" }}>Voorraad en bol</h2>
          <div className="row">
            <div className="field"><label htmlFor="bol_buffer_units">bol-buffer (verkoopbare eenheden per SKU voor de webshop)</label><input id="bol_buffer_units" name="bol_buffer_units" type="number" min={0} max={20} defaultValue={st.bol_buffer_units} /></div>
            <div className="field"><label htmlFor="reservation_minutes">Reservering tijdens betalen (minuten)</label><input id="reservation_minutes" name="reservation_minutes" type="number" min={31} max={120} defaultValue={st.reservation_minutes} /></div>
            <label className="check"><input type="checkbox" name="bol_requires_tracking" defaultChecked={st.bol_requires_tracking} /> bol-orders altijd met track & trace</label>
            <div className="field"><label htmlFor="letter_max_weight_g">Briefpost tot (gram verpakt)</label><input id="letter_max_weight_g" name="letter_max_weight_g" type="number" min={20} max={2000} defaultValue={st.letter_max_weight_g ?? 250} aria-describedby="letter_max_hint" /><span id="letter_max_hint" className="small muted">Zwaardere orders of pakketformaat krijgen geen briefpost-voorstel.</span></div>
          </div>
        </section>
        <section className="card">
          <h2 style={{ fontSize: "1.125rem" }}>Klantbelofte</h2>
          <div className="field"><label htmlFor="delivery_promise">Verwachte levertermijn (zichtbaar vóór betaling)</label><input id="delivery_promise" name="delivery_promise" type="text" defaultValue={st.delivery_promise} /></div>
          <div className="field"><label htmlFor="tracking_info">Trackinginformatie</label><input id="tracking_info" name="tracking_info" type="text" defaultValue={st.tracking_info} /></div>
          {["tracked", "letter"].map((code) => {
            const o = opt(code);
            return (
              <fieldset key={code} style={{ border: "1px solid var(--to-border)", borderRadius: 10, padding: 12, marginBottom: 12 }}>
                <legend style={{ fontWeight: 600, padding: "0 4px" }}>{code === "tracked" ? "Verzendoptie met track & trace (DHL/PostNL)" : "Verzendoptie briefpost (zonder track & trace)"}</legend>
                <div className="row">
                  <div className="field"><label htmlFor={`${code}_label`}>Naam</label><input id={`${code}_label`} name={`${code}_label`} type="text" defaultValue={o?.label ?? ""} required /></div>
                  <div className="field"><label htmlFor={`${code}_description`}>Toelichting</label><input id={`${code}_description`} name={`${code}_description`} type="text" defaultValue={o?.description ?? ""} /></div>
                </div>
                <div className="row">
                  <div className="field"><label htmlFor={`${code}_cost`}>Kosten (€)</label><input id={`${code}_cost`} name={`${code}_cost`} type="text" inputMode="decimal" defaultValue={euro(o?.cost_cents ?? 0)} /></div>
                  <div className="field"><label htmlFor={`${code}_free_from`}>Gratis vanaf (€, optioneel)</label><input id={`${code}_free_from`} name={`${code}_free_from`} type="text" inputMode="decimal" defaultValue={euro(o?.free_from_cents)} /></div>
                  <div className="field"><label htmlFor={`${code}_delivery`}>Levertijd</label><input id={`${code}_delivery`} name={`${code}_delivery`} type="text" defaultValue={o?.delivery ?? ""} /></div>
                  <label className="check"><input type="checkbox" name={`${code}_enabled`} defaultChecked={o?.enabled ?? false} /> Aan</label>
                </div>
              </fieldset>
            );
          })}
        </section>
        <section className="card" id="bedrijf" aria-labelledby="bedrijf-titel">
          <h2 id="bedrijf-titel" style={{ fontSize: "1.125rem" }}>Bedrijfsgegevens</h2>
          <p className="small muted">Zichtbaar in de footer, op de contactpagina, in de voorwaarden en privacyverklaring en in e-mails. Bestaande orders houden de gegevens van het moment van bestellen.{st.business_info?.source ? ` Bron: ${st.business_info.source}.` : ""}</p>
          <div className="row">
            <div className="field"><label htmlFor="b_legal_name">Onderneming</label><input id="b_legal_name" name="b_legal_name" type="text" required defaultValue={B?.legal_name ?? ""} /></div>
            <div className="field"><label htmlFor="b_shop_name">Webshopnaam</label><input id="b_shop_name" name="b_shop_name" type="text" required defaultValue={B?.shop_name ?? "Timber Online"} /></div>
          </div>
          <div className="row">
            <div className="field"><label htmlFor="b_street">Straat</label><input id="b_street" name="b_street" type="text" defaultValue={B?.street ?? ""} /></div>
            <div className="field" style={{ flex: "0 1 120px" }}><label htmlFor="b_house_number">Huisnummer</label><input id="b_house_number" name="b_house_number" type="text" defaultValue={B?.house_number ?? ""} /></div>
            <div className="field" style={{ flex: "0 1 140px" }}><label htmlFor="b_postal_code">Postcode</label><input id="b_postal_code" name="b_postal_code" type="text" defaultValue={B?.postal_code ?? ""} /></div>
            <div className="field"><label htmlFor="b_city">Plaats</label><input id="b_city" name="b_city" type="text" defaultValue={B?.city ?? ""} /></div>
            <div className="field" style={{ flex: "0 1 160px" }}><label htmlFor="b_country">Land</label><select id="b_country" name="b_country" defaultValue={B?.country ?? "NL"}><option value="NL">Nederland</option><option value="BE">België</option></select></div>
          </div>
          <div className="row">
            <div className="field"><label htmlFor="b_kvk">KvK-nummer</label><input id="b_kvk" name="b_kvk" type="text" inputMode="numeric" defaultValue={B?.kvk ?? ""} /></div>
            <div className="field"><label htmlFor="b_vat_id">Btw-identificatienummer</label><input id="b_vat_id" name="b_vat_id" type="text" defaultValue={B?.vat_id ?? ""} /></div>
            <div className="field"><label htmlFor="b_phone">Telefoon</label><input id="b_phone" name="b_phone" type="tel" defaultValue={B?.phone ?? ""} /></div>
            <div className="field"><label htmlFor="b_email">E-mail webshop</label><input id="b_email" name="b_email" type="email" defaultValue={B?.email ?? ""} /></div>
          </div>
          <ConfirmBox prefix="b_" value={st.business_info} />
        </section>
        <section className="card" id="afzender" aria-labelledby="afzender-titel">
          <h2 id="afzender-titel" style={{ fontSize: "1.125rem" }}>Afzenderadres op labels</h2>
          <p className="small muted">Staat als afzender op verzendlabels. Al gemaakte labels veranderen niet.</p>
          <AddressFields prefix="s_" value={st.sender_address} />
          <ConfirmBox prefix="s_" value={st.sender_address} />
        </section>
        <section className="card" id="retour" aria-labelledby="retour-titel">
          <h2 id="retour-titel" style={{ fontSize: "1.125rem" }}>Retouradres</h2>
          <p className="small muted">Adres waar klanten retourzendingen naartoe sturen (retourinformatie, herroeping, e-mails).</p>
          <AddressFields prefix="r_" value={st.return_address} />
          <ConfirmBox prefix="r_" value={st.return_address} />
        </section>
        <div><button className="btn">Instellingen opslaan</button></div>
      </form>

      <section className="card" style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: "1.125rem" }}>Beheerders</h2>
        <p className="small muted">Elke beheerder logt in met e-mail en wachtwoord plus verplichte tweestapsverificatie. Nieuwe accounts worden aangemaakt in Supabase Auth; koppel hier de rol.</p>
        <div className="table-wrap" style={{ boxShadow: "none", border: "1px solid var(--to-border)", marginBottom: 12 }}>
          <table className="data">
            <thead><tr><th>E-mail</th><th>Rol</th><th>Actief</th></tr></thead>
            <tbody>{admins.map((a) => <tr key={a.user_id}><td>{a.email}</td><td>{ROLE_LABEL[a.role]}</td><td>{a.active ? "Ja" : "Nee"}</td></tr>)}</tbody>
          </table>
        </div>
        <form action={saveAdminAction} className="row">
          <div><label htmlFor="user_id">Supabase user-id</label><input id="user_id" name="user_id" type="text" required pattern="[0-9a-f-]{36}" /></div>
          <div><label htmlFor="email">E-mail</label><input id="email" name="email" type="email" required /></div>
          <div><label htmlFor="role">Rol</label><select id="role" name="role" defaultValue="fulfilment"><option value="owner">Eigenaar</option><option value="admin">Beheerder</option><option value="fulfilment">Verzending</option></select></div>
          <label className="check" style={{ flex: "0 0 auto" }}><input type="checkbox" name="active" defaultChecked /> Actief</label>
          <button className="btn btn-secondary" style={{ flex: "0 0 auto" }}>Opslaan</button>
        </form>
      </section>

      <section className="card" style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: "1.125rem" }}>Koppelingen</h2>
        <dl className="dl">
          {Object.entries(integ).filter(([, v]) => typeof v === "string").map(([k, v]) => (
            <Fragment key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </Fragment>
          ))}
        </dl>
      </section>
    </>
  );
}
