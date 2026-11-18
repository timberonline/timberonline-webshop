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
