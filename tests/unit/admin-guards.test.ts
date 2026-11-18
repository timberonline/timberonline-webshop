import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Beheer mag niet alleen op de layout leunen (die rendert niet opnieuw bij client-navigatie).
 * Deze test bewaakt statisch dat elke pagina en server action zelf de rol controleert,
 * en draait de label- en dag-PDF-routes met een nagebootste sessie.
 */

// --- Nagebootste sessie voor getAdminSession (echte requireAdmin, nep Supabase/DB) ---
const auth = vi.hoisted(() => ({
  client: null as null | { auth: { getUser: () => Promise<unknown>; mfa: { getAuthenticatorAssuranceLevel: () => Promise<unknown> } } },
  admin: null as null | { user_id: string; email: string; role: string },
  shippingCalls: 0,
}));

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => undefined }));
vi.mock("@/server/auth/supabase", () => ({ createAuthClient: async () => auth.client }));
vi.mock("@/server/db", () => ({ getDb: () => ({ rpc: async () => auth.admin }) }));
vi.mock("@/server/services/runtime", () => ({ getCtx: () => ({}) }));
vi.mock("@/server/services/shipping", () => ({
  labelPdf: async () => (auth.shippingCalls++, null),
  dayPdf: async () => (auth.shippingCalls++, null),
}));

import { ROLES } from "@/server/auth/admin";
import { sectionFor } from "@/app/beheer/(app)/_sections";
import { GET as labelGET } from "@/app/beheer/label/[id]/route";
import { GET as dayGET } from "@/app/beheer/dagpdf/[date]/route";

// --- Statische controle ---
const APP_DIR = path.resolve(import.meta.dirname, "../../src/app/beheer/(app)");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

const files = walk(APP_DIR).map((f) => path.relative(APP_DIR, f).split(path.sep).join("/"));
const pages = files.filter((f) => f === "page.tsx" || f.endsWith("/page.tsx"));
const actionFiles = files.filter((f) => f === "actions.ts" || f.endsWith("/actions.ts"));
const read = (rel: string) => readFileSync(path.join(APP_DIR, rel), "utf8");

describe("beheerpagina's controleren zelf de rol", () => {
  it("vindt alle pagina's", () => {
    expect(pages.length).toBeGreaterThanOrEqual(13);
  });

  it.each(pages)("%s begint met requireAdminPage(ROLES.…) en past bij het menu", (rel) => {
    const src = read(rel);
    expect(src).toContain("requireAdminPage(ROLES.");
    const m = src.match(/export default async function \w+\(.*\)\s*\{\s*(?:const \w+ = )?await requireAdminPage\(ROLES\.(\w+)\);/);
    expect(m, "requireAdminPage(ROLES.…) moet de eerste regel van de pagina zijn").not.toBeNull();
    const area = m![1];
    expect(Object.keys(ROLES)).toContain(area);
    const route = `/beheer/${rel.replace(/(^|\/)page\.tsx$/, "")}`.replace(/\/$/, "");
    expect(sectionFor(route)?.area, `menu-onderdeel voor ${route}`).toBe(area);
  });
});

describe("server actions controleren zelf de rol", () => {
  it("vindt alle actiebestanden", () => {
    expect(actionFiles.length).toBeGreaterThanOrEqual(8);
  });

  it.each(actionFiles)("%s: elke export roept requireAdmin(ROLES.…) aan vóór databasewerk", (rel) => {
    const src = read(rel);
    expect(src.startsWith('"use server";')).toBe(true);
    // Alleen `export async function` toegestaan, zodat de scan hieronder volledig is.
    const exports = src.match(/^export .*$/gm) ?? [];
    for (const line of exports) expect(line).toMatch(/^export async function \w+\(/);
    const chunks = src.split(/^(?=export async function )/m).slice(1);
    expect(chunks.length).toBeGreaterThan(0);
    for (const body of chunks) {
      const name = body.match(/^export async function (\w+)/)![1];
      const guard = body.indexOf("await requireAdmin(ROLES.");
      expect(guard, `${name} mist requireAdmin(ROLES.…)`).toBeGreaterThan(-1);
      const work = ["getCtx(", "getDb(", "processBolQueue(", "processOutbox(", "reconcileBol(", "sendOrderEmail("]
        .map((w) => body.indexOf(w))
        .filter((i) => i >= 0);
      for (const i of work) expect(i, `${name} doet databasewerk vóór de rolcontrole`).toBeGreaterThan(guard);
    }
  });
});

// --- Route handlers ---
const user = { data: { user: { id: "u1" } }, error: null };
const noUser = { data: { user: null }, error: null };
const client = (u: unknown, level: "aal1" | "aal2") => ({ auth: { getUser: async () => u, mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: level } }) } } });
const ID = "00000000-0000-4000-8000-000000000001";

const callLabel = () => labelGET(new Request(`http://localhost/beheer/label/${ID}`), { params: Promise.resolve({ id: ID }) });
const callDay = () => dayGET(new Request("http://localhost/beheer/dagpdf/2026-11-18"), { params: Promise.resolve({ date: "2026-11-18" }) });

describe("label- en dag-PDF-routes", () => {
  beforeEach(() => {
    auth.client = null;
    auth.admin = null;
    auth.shippingCalls = 0;
  });

  const denied: [string, () => void][] = [
    ["niet geconfigureerd", () => (auth.client = null)],
    ["niet ingelogd", () => (auth.client = client(noUser, "aal2"))],
    ["zonder MFA", () => (auth.client = client(user, "aal1"))],
    ["geen actieve beheerder", () => ((auth.client = client(user, "aal2")), (auth.admin = null))],
  ];

  it.each(denied)("geeft 403 als %s", async (_label, setup) => {
    setup();
    for (const call of [callLabel, callDay]) {
      const res = await call();
      expect(res.status).toBe(403);
    }
    expect(auth.shippingCalls).toBe(0);
  });

  it("laat de rol verzending door (geen label: 404)", async () => {
    auth.client = client(user, "aal2");
    auth.admin = { user_id: "u1", email: "verzending@example.test", role: "fulfilment" };
    expect((await callLabel()).status).toBe(404);
    expect((await callDay()).status).toBe(404);
    expect(auth.shippingCalls).toBe(2);
  });
});
