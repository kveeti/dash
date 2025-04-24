import { test, expect, Page } from "@playwright/test";

test("dev login", async ({ page }) => {
	await page.goto("/", { waitUntil: "networkidle" });
	await page.waitForSelector("h1");
	const devLoginLink = page.getByRole("link", { name: "dev login" });
	await expect(devLoginLink).toBeVisible();
	await devLoginLink.click();
	await page.waitForSelector("h1");
});

async function devLogin({ page }: { page: Page }) {
	await page.goto("/", { waitUntil: "networkidle" });
	await page.waitForSelector("h1");
	const devLoginLink = page.getByRole("link", { name: "dev login" });
	await expect(devLoginLink).toBeVisible();
	await devLoginLink.click();
	await page.waitForSelector("h1");
}

const login = devLogin;

test("get transactions", async ({ page }) => {
	await login({ page });
});
