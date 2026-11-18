import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** Beheerflows lokaal (ontwikkelmodus zonder login, gesimuleerde koppelingen). Niet tegen productie draaien. */
test.skip(!!process.env.E2E_BASE_URL && !process.env.E2E_ADMIN, "Beheertests alleen lokaal");
test.describe.configure({ mode: "serial" });

const SHOTS = process.env.E2E_SHOTS;

async function a11y(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
}

test("overzicht, voorraadcorrectie en logboek", async ({ page }, info) => {
  await page.goto("/beheer");
  await expect(page.getByRole("heading", { name: "Overzicht" })).toBeVisible();
  await expect(page.locator(".kpi").filter({ hasText: "Protectors op voorraad" })).toBeVisible();
  await a11y(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/beheer-overzicht-${info.project.name}.png`, fullPage: true });
  if (info.project.name !== "desktop") return;
  await page.goto("/beheer/voorraad");
  const row = page.locator("tr", { hasText: "C-CS-IP13PM" });
  await row.getByLabel("Aantal").fill("1");
  await row.getByLabel("Reden").fill("E2E-test telling");
  await row.getByRole("button", { name: "Boeken" }).click();
  await expect(page.locator(".notice-ok")).toContainText("Nieuwe voorraad");
  await row.getByLabel("Aantal").fill("-1");
  await row.getByLabel("Reden").fill("E2E-test herstel");
  await row.getByRole("button", { name: "Boeken" }).click();
  await expect(page.locator(".notice-ok")).toContainText("Nieuwe voorraad: 3");
  await page.goto("/beheer/audit?entity=component");
  await expect(page.locator("table.data")).toContainText("stock_correction");
  await a11y(page);
});

test("prijsassistent: voorstel tonen, bevestigen en terugzetten", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await page.goto("/beheer/prijsassistent");
  await page.getByLabel("Opdracht").fill("Zet de webshopprijs van alle iPhone 15-privacysets op €14,95");
  await page.getByRole("button", { name: "Voorstel maken" }).click();
  await expect(page.getByRole("heading", { name: "Voorstel" })).toBeVisible();
  const table = page.locator("table.data").first();
  await expect(table).toContainText("TO-SP2-IP15-PRV");
  await expect(table).toContainText("TO-SP2-IP15PL-PRV");
  await expect(table).toContainText("Webshop");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/beheer-prijsassistent-voorstel.png`, fullPage: true });
  await page.getByLabel(/Toepassen op TO-SP2-IP15PL-PRV/).uncheck();
  await page.getByRole("button", { name: "Geselecteerde wijzigingen bevestigen" }).click();
  await expect(page.locator(".notice-ok")).toContainText("3 prijswijziging");
  await a11y(page);
  // terugzetten via dezelfde assistent
  await page.getByLabel("Opdracht").fill("Zet de webshopprijs van TO-SP2-IP15-PRV TO-SP2-IP15P-PRV TO-SP2-IP15PM-PRV op 19,95");
  await page.getByRole("button", { name: "Voorstel maken" }).click();
  await page.getByRole("button", { name: "Geselecteerde wijzigingen bevestigen" }).click();
  await expect(page.locator(".notice-ok")).toContainText("3 prijswijziging");
});

test("bol: artikel activeren, simuleer bol-order en zie sync", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await page.goto("/beheer/artikelen");
  await page.getByRole("link", { name: "Privacy-screenprotector iPhone 15 Pro Max" }).click();
  await page.getByLabel("bol-offerId").fill("e2e-sim-offer-15pm");
  await page.getByLabel("Voorraad en prijs naar bol sturen").check();
  await page.getByRole("button", { name: "Opslaan", exact: true }).last().click();
  await expect(page.locator(".notice-ok")).toContainText("Artikel opgeslagen");
  await page.goto("/beheer/bol");
  await expect(page.locator("tr", { hasText: "TO-SP2-IP15PM-PRV" })).toContainText("Verwerkt");
  await page.getByLabel("Artikel (actief op bol)").selectOption({ label: "Privacy-screenprotector iPhone 15 Pro Max" });
  await page.getByRole("button", { name: "Order simuleren" }).click();
  await expect(page.locator(".notice-ok")).toContainText("Gesimuleerde bol-order");
  await expect(page.locator("table.data").last()).toContainText("e2e-sim-offer-15pm");
  await a11y(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/beheer-bol.png`, fullPage: true });
});

test("verzendingen: label, dag-PDF, overdracht en gesimuleerde status", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop");
  await page.goto("/beheer/instellingen");
  await page.getByLabel("Straat").fill("Voorbeeldweg");
  await page.getByLabel("Huisnummer").fill("1");
  await page.getByLabel("Postcode").fill("1000 AA");
  await page.getByLabel("Plaats").fill("Amsterdam");
  await page.getByRole("button", { name: "Instellingen opslaan" }).click();
  await expect(page.locator(".notice-ok")).toContainText("Instellingen opgeslagen");
  await page.goto("/beheer/verzendingen");
  const card = page.locator("article").filter({ has: page.getByRole("button", { name: "Label maken" }) }).first();
  await card.getByRole("button", { name: "Label maken" }).click();
  await expect(page.locator(".notice-ok")).toContainText("Label klaar");
  const labelLink = page.getByRole("link", { name: "Label (PDF)" }).first();
  const href = await labelLink.getAttribute("href");
  const pdf = await request.get(href!);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  const date = await page.locator("#date").inputValue();
  const day = await request.get(`/beheer/dagpdf/${date}`);
  expect(day.status()).toBe(200);
  expect(day.headers()["content-type"]).toBe("application/pdf");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/beheer-verzendingen.png`, fullPage: true });
  await page.getByRole("button", { name: "Overdracht bevestigen" }).first().click();
  await expect(page.locator(".notice-ok")).toContainText("Overdracht bevestigd");
  await page.getByRole("button", { name: "Bezorgd" }).first().click();
  await expect(page.locator(".notice-ok")).toContainText("Gesimuleerde vervoerdersstatus");
  await a11y(page);
  await page.goto("/beheer/bol");
  await page.getByRole("button", { name: "Nu synchroniseren" }).click();
  await expect(page.locator("table.data").nth(1)).toContainText("Klaar");
});

test("orders en artikelenoverzicht zijn bereikbaar en toegankelijk", async ({ page }, info) => {
  await page.goto("/beheer/orders");
  await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();
  await a11y(page);
  await page.goto("/beheer/artikelen");
  await expect(page.locator("table.data")).toContainText("TO-CS-IP13P-MS");
  await expect(page.locator("table.data")).toContainText("bol-titel moet gecorrigeerd worden");
  await a11y(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/beheer-artikelen-${info.project.name}.png`, fullPage: false });
});
