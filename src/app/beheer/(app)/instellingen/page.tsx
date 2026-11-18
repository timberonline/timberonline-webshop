import { Fragment } from "react";
import { connection } from "next/server";
import { Flash } from "../_components/ui";
import { ROLE_LABEL, requireAdminPage, ROLES, type Role } from "@/server/auth/admin";
import { getDb } from "@/server/db";
import { integrationStatus } from "@/server/services/runtime";
import type { ShippingOption } from "@/server/services/types";
import { saveAdminAction, saveSettingsAction } from "./actions";

type Settings = {
  bol_buffer_units: number; reservation_minutes: number; delivery_promise: string; tracking_info: string; bol_requires_tracking: boolean;
  shipping_options: ShippingOption[]; sender_address: { name?: string; street?: string | null; house_number?: string | null; postal_code?: string | null; city?: string | null };
};
const euro = (c: number | null | undefined) => (c == null ? "" : (c / 100).toFixed(2).replace(".", ","));

export default async function SettingsPage({ searchParams }: PageProps<"/beheer/instellingen">) {
  await requireAdminPage(ROLES.settings);
  await connection();
  const sp = await searchParams;
  const db = getDb();
  const [st, admins] = await Promise.all([db.rpc<Settings>("api_admin_settings", {}), db.rpc<{ user_id: string; email: string; role: Role; active: boolean }[]>("api_admin_users", {})]);
  const integ = integrationStatus();
  const opt = (code: string) => st.shipping_options.find((o) => o.code === code);
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
        <section className="card">
          <h2 style={{ fontSize: "1.125rem" }}>Afzenderadres op labels</h2>
          <div className="row">
            <div className="field"><label htmlFor="s_name">Naam</label><input id="s_name" name="s_name" type="text" defaultValue={st.sender_address?.name ?? "Timber Online"} /></div>
            <div className="field"><label htmlFor="s_street">Straat</label><input id="s_street" name="s_street" type="text" defaultValue={st.sender_address?.street ?? ""} /></div>
            <div className="field" style={{ flex: "0 1 120px" }}><label htmlFor="s_house_number">Huisnummer</label><input id="s_house_number" name="s_house_number" type="text" defaultValue={st.sender_address?.house_number ?? ""} /></div>
            <div className="field" style={{ flex: "0 1 140px" }}><label htmlFor="s_postal_code">Postcode</label><input id="s_postal_code" name="s_postal_code" type="text" defaultValue={st.sender_address?.postal_code ?? ""} /></div>
            <div className="field"><label htmlFor="s_city">Plaats</label><input id="s_city" name="s_city" type="text" defaultValue={st.sender_address?.city ?? ""} /></div>
          </div>
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
          {Object.entries(integ).map(([k, v]) => (
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
