import { expect, test } from "@playwright/test";

test("home page renders hero and primary actions", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Autonomous RWA Agents");
  await expect(page.getByRole("link", { name: /Launch an Agent/ })).toHaveAttribute("href", "/create");
  await expect(page.getByRole("link", { name: "Explore Agents" }).first()).toBeVisible();
});

test("marketplace search updates the URL and results", async ({ page }) => {
  await page.goto("/explore");
  await page.getByLabel("Search agents").fill("treasury");
  await expect(page).toHaveURL(/q=treasury/);
  await page.getByRole("button", { name: "Gold" }).click();
  await expect(page).toHaveURL(/specialization=GOLD/);
});

test("create studio asks unauthenticated users to connect a wallet", async ({ page }) => {
  await page.goto("/create");
  await expect(page.getByRole("button", { name: /Connect wallet/ }).last()).toBeVisible();
  await page.getByRole("button", { name: /Connect wallet/ }).last().click();
  await expect(page.getByRole("dialog")).toContainText(/Connect a wallet/);
});

test("dashboard is gated", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByText("Sign in to open your dashboard")).toBeVisible();
});

test("docs expose methodology and API reference", async ({ page }) => {
  await page.goto("/docs");
  await expect(page.locator("#methodology")).toBeVisible();
  await expect(page.locator("#api")).toBeVisible();
});

test("unknown agent returns 404", async ({ page }) => {
  const res = await page.goto("/agents/does-not-exist");
  expect(res?.status()).toBe(404);
});

test("mobile navigation drawer opens", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile only");
  await page.goto("/");
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("navigation", { name: "Mobile" })).toBeVisible();
});
