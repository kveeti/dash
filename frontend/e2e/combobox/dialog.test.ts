// Ported from the React cmdk Playwright suite (https://github.com/dip/cmdk),
// via https://github.com/create-signal/cmdk-solid.
import { expect, test } from "@playwright/test";

test.describe("dialog", async () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/combobox/dialog");
  });

  test("dialog renders in portal", async ({ page }) => {
    await expect(page.locator(`[cmdk-dialog]`)).toHaveCount(1);
    await expect(page.locator(`[cmdk-overlay]`)).toHaveCount(1);
  });
});
