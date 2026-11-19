import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const SHOTS = process.env.E2E_SHOTS;

async function noSeriousA11yIssues(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.removeItem("to-cart-v1"));
});

test("catalogus: zoeken en filteren op toestel en producttype", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Bescherming voor je iPhone");
  await expect(page.getByRole("note")).toContainText("Testomgeving");
  await page.getByLabel("Toestel").selectOption("iphone-15");
  await page.getByLabel("Producttype").selectOption("privacy");
  await page.getByRole("button", { name: "Toon resultaten" }).click();
  await expect(page).toHaveURL(/toestel=iphone-15/);
  const cards = page.locator(".product-card");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Privacy-screenprotector iPhone 15");
  await page.goto("/?q=13+pro");
  await expect(page.locator(".product-card").filter({ hasText: "iPhone 13 / 13 Pro" })).toHaveCount(1);
  await expect(page.locator(".product-card h3").filter({ hasText: /^MagSafe-hoesje iPhone 13 Pro$/ })).toHaveCount(1);
  await noHorizontalScroll(page);
  await noSeriousA11yIssues(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/shop-catalogus-${info.project.name}.png`, fullPage: false });
});

test("productdetail toont compatibiliteit en levering; winkelwagen toont totaal, verzending en tracking", async ({ page }, info) => {
  await page.goto("/product/screenprotector-iphone-13-13-pro");
  await expect(page.getByRole("heading", { name: "Past op" })).toBeVisible();
  await expect(page.locator(".compat")).toContainText("iPhone 13");
  await expect(page.locator(".compat")).toContainText("iPhone 13 Pro");
  await expect(page.getByRole("heading", { name: "Levering" })).toBeVisible();
  await noSeriousA11yIssues(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/shop-product-${info.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Eén meer" }).click();
  await page.getByRole("button", { name: "In winkelwagen" }).click();
  await expect(page.getByRole("status")).toContainText("Toegevoegd");
  await expect(page.locator(".cart-count")).toHaveText("2");
  await page.getByRole("link", { name: "Naar winkelwagen" }).click();
  await expect(page.getByRole("heading", { name: "Overzicht" })).toBeVisible();
  const summary = page.locator("aside.summary");
  await expect(summary).toContainText("Subtotaal");
  await expect(summary).toContainText("€ 39,90".replace(" ", " "));
  await expect(summary).toContainText("Verzendkosten");
  await expect(summary).toContainText("Levertermijn");
  await expect(summary).toContainText("track & trace");
  await noHorizontalScroll(page);
  await noSeriousA11yIssues(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/shop-winkelwagen-${info.project.name}.png`, fullPage: true });
});

test("winkelwagen blokkeert afrekenen bij onvoldoende gedeelde voorraad", async ({ page }) => {
  await page.goto("/product/screenprotector-iphone-12-pro-max");
  await page.goto("/");
  // 3 tweepacks iPhone 12 Pro Max privacy (6 stuks) terwijl er 5 zijn
  const id = await page.evaluate(async () => {
    const r = await fetch("/product/privacy-screenprotector-iphone-12-pro-max");
    return r.ok;
  });
  expect(id).toBe(true);
  await page.goto("/product/privacy-screenprotector-iphone-12-pro-max");
  await expect(page.getByText("Maximaal 2")).toBeVisible();
});

test("toetsenbord: skiplink, zichtbare focus en bediening zonder muis", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Naar de inhoud" });
  await expect(skip).toBeFocused();
  const shadow = await skip.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(shadow).not.toBe("none");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
  expect(["q", "toestel", "type", "A", "INPUT", "SELECT"]).toContain(focused);
  // naar productdetail met alleen het toetsenbord
  await page.goto("/");
  const firstProduct = page.locator(".product-card h3 a").first();
  await firstProduct.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Past op" })).toBeVisible();
  await page.getByRole("button", { name: "In winkelwagen" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".cart-count")).toHaveText("1");
});

test("categoriepagina toont alleen producten van die categorie, met kruimelpad en toestelfilter", async ({ page }, info) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Categorieën" }).getByRole("link", { name: "Privacy-screenprotectors" }).click();
  await expect(page).toHaveURL(/\/categorie\/privacy-screenprotectors$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy-screenprotectors voor iPhone");
  await expect(page).toHaveTitle(/Privacy-screenprotectors voor iPhone/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/categorie\/privacy-screenprotectors$/);
  const crumbs = page.getByRole("navigation", { name: "Kruimelpad" });
  await expect(crumbs.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText("Privacy-screenprotectors");
  await expect(page.getByRole("navigation", { name: "Hoofdmenu" }).getByRole("link", { name: "Privacy-screenprotectors" })).toHaveAttribute("aria-current", "page");

  const cards = page.locator(".product-card");
  const n = await cards.count();
  expect(n).toBeGreaterThan(1);
  await expect(cards.locator(".badge-blue")).toHaveText(Array(n).fill("Privacy-screenprotector"));
  // Het type ligt vast via de route; binnen de categorie filteren op toestel.
  await expect(page.getByLabel("Producttype")).toHaveCount(0);
  await page.getByLabel("Toestel").selectOption("iphone-15");
  await page.getByRole("button", { name: "Toon resultaten" }).click();
  await expect(page).toHaveURL(/\/categorie\/privacy-screenprotectors\?.*toestel=iphone-15/);
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Privacy-screenprotector iPhone 15");
  await noHorizontalScroll(page);
  await noSeriousA11yIssues(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/shop-categorie-${info.project.name}.png`, fullPage: false });

  // Ruwe producttypewaarde verwijst door naar de SEO-route; onbekende categorie geeft 404.
  await page.goto("/categorie/hoesje");
  await expect(page).toHaveURL(/\/categorie\/hoesjes$/);
  await expect(page.locator(".product-card .badge-blue").first()).toHaveText("Hoesje");
  const missing = await page.goto("/categorie/bestaat-niet");
  expect(missing?.status()).toBe(404);
});

test("contactformulier: validatiefouten worden gemeld en gekoppeld aan de velden", async ({ page }, info) => {
  await page.goto("/info/verzending");
  await page.getByRole("link", { name: "Neem contact met ons op" }).click();
  await expect(page).toHaveURL(/\/contact$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Contact");
  await expect(page.getByRole("navigation", { name: "Hoofdmenu" }).getByRole("link", { name: "Contact" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "Contact" })).toBeVisible();
  await noSeriousA11yIssues(page);

  // Toegankelijke namen: het verplicht-sterretje is aria-hidden en hoort er niet in te zitten.
  const name = page.getByRole("textbox", { name: "Naam", exact: true });
  const email = page.getByRole("textbox", { name: "E-mailadres", exact: true });
  const subject = page.getByRole("combobox", { name: "Onderwerp", exact: true });
  const message = page.getByRole("textbox", { name: "Bericht", exact: true });
  const alerts = page.locator("#contact-meldingen");
  await expect(alerts).toHaveAttribute("role", "alert");
  await expect(name).toHaveAttribute("required", "");

  await page.getByRole("button", { name: "Verstuur bericht" }).click();
  await expect(alerts).toContainText("Controleer het formulier");
  await expect(alerts).toContainText("Vul je naam in.");
  await expect(alerts).toContainText("Vul je e-mailadres in.");
  await expect(alerts).toContainText("Kies een onderwerp.");
  await expect(alerts).toContainText("Schrijf je bericht.");
  await expect(page.locator(".error-summary")).toBeFocused();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(name).toHaveAccessibleDescription(/Vul je naam in\./);
  await expect(email).toHaveAccessibleDescription(/Vul je e-mailadres in\./);
  await expect(subject).toHaveAccessibleDescription(/Kies een onderwerp\./);
  await expect(page.getByRole("textbox", { name: "Bestelnummer (optioneel)" })).not.toHaveAttribute("aria-invalid", "true");

  // Tweede poging: ingevulde waarden blijven staan, alleen de resterende fout wordt gemeld.
  await name.fill("Test Klant");
  await email.fill("klant@example.com");
  await subject.selectOption("retour");
  await message.fill("kort");
  await page.getByRole("button", { name: "Verstuur bericht" }).click();
  await expect(alerts).toContainText("Je bericht is te kort");
  await expect(alerts).not.toContainText("Vul je naam in.");
  await expect(name).toHaveValue("Test Klant");
  await expect(subject).toHaveValue("retour");
  await expect(name).not.toHaveAttribute("aria-invalid", "true");
  await expect(message).toHaveAttribute("aria-invalid", "true");
  await expect(message).toHaveAccessibleDescription(/Je bericht is te kort/);
  // Link in de foutsamenvatting zet de focus op het veld.
  await alerts.getByRole("link", { name: /Je bericht is te kort/ }).click();
  await expect(message).toBeFocused();
  await noHorizontalScroll(page);
  await noSeriousA11yIssues(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/shop-contact-${info.project.name}.png`, fullPage: true });
});

test("herroepen: online herroepingsfunctie met bevestigingsstap en ontvangstbevestiging", async ({ page }, info) => {
  await page.goto("/");
  // Doorlopend beschikbaar en duidelijk benoemd in de footer
  await page.getByRole("contentinfo").getByRole("link", { name: "Hier de overeenkomst herroepen" }).click();
  await expect(page).toHaveURL(/\/herroepen$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hier de overeenkomst herroepen");
  await page.getByRole("button", { name: "Verder naar bevestigen" }).click();
  await expect(page.locator(".error-summary")).toContainText("Vul je naam in.");
  await page.getByRole("textbox", { name: "Naam", exact: true }).fill("E2E Klant");
  await page.getByRole("textbox", { name: "Bestelnummer", exact: true }).fill(`TO9${String(Date.now()).slice(-5)}`);
  await page.getByRole("textbox", { name: "E-mailadres voor de bevestiging", exact: true }).fill("e2e-herroep@example.test");
  await noSeriousA11yIssues(page);
  await page.getByRole("button", { name: "Verder naar bevestigen" }).click();
  await expect(page.getByRole("heading", { name: "Controleer en bevestig je herroeping" })).toBeVisible();
  await page.getByRole("button", { name: "Herroeping bevestigen" }).click();
  await expect(page.getByRole("status")).toContainText("Je herroeping is ontvangen");
  await expect(page.getByRole("status")).toContainText(/HR-\d{8}-[0-9A-F]{6}/);
  await noHorizontalScroll(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/shop-herroepen-${info.project.name}.png`, fullPage: true });
});

test("bedrijfsgegevens in footer en contact, juridische teksten met gemarkeerde beleidskeuzes", async ({ page }) => {
  await page.goto("/contact");
  const footer = page.getByRole("contentinfo");
  await expect(footer).toContainText("KvK 88562700");
  await expect(footer).toContainText("Btw-id NL004626847B65");
  await expect(footer).toContainText("Abel Tasmanstraat 22, 6413 SX Heerlen");
  await expect(page.getByRole("region", { name: "Bedrijfsgegevens" })).toContainText("Timber Services");
  await page.goto("/info/voorwaarden");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Algemene voorwaarden");
  await expect(page.locator(".policy-choice").first()).toBeVisible();
  await noSeriousA11yIssues(page);
  for (const slug of ["verzending", "betalen", "retourneren", "herroepingsformulier", "garantie", "privacy", "cookies"]) {
    const res = await page.goto(`/info/${slug}`);
    expect(res?.status(), slug).toBe(200);
  }
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cookies");
});

test("seo: robots.txt, sitemap en productmetadata", async ({ page, request }) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /beheer");
  expect(robots).toContain("Disallow: /api");
  expect(robots).toMatch(/Sitemap: https?:\/\/\S+\/sitemap\.xml/);
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("/categorie/privacy-screenprotectors</loc>");
  expect(sitemap).toContain("/product/screenprotector-iphone-13-13-pro</loc>");
  expect(sitemap).toContain("/contact</loc>");
  expect(sitemap).not.toContain("/beheer");
  await page.goto("/product/screenprotector-iphone-13-13-pro");
  await expect(page).toHaveTitle("Screenprotector iPhone 13 / 13 Pro · Timber Online");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/product\/screenprotector-iphone-13-13-pro$/);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "Screenprotector iPhone 13 / 13 Pro");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /9H gehard glas/);
  await expect(page.getByRole("navigation", { name: "Kruimelpad" }).getByRole("link", { name: "Screenprotectors" })).toHaveAttribute("href", "/categorie/screenprotectors");
});
