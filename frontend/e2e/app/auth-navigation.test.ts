import { expect, test } from "@playwright/test";

import { login } from "../helpers";

test("login, navigation, and command palette use the real app", async ({
  page,
}, testInfo) => {
  await login(page, testInfo);

  await page.getByRole("link", { name: "inbox", exact: true }).click();
  await expect(page).toHaveURL(/\/inbox$/);
  await expect(page.getByText("nothing to categorize")).toBeVisible();

  await page.keyboard.press("Meta+k");
  const search = page.getByRole("combobox", { name: "Search pages" });
  await expect(search).toBeVisible();
  await search.fill("stat");
  await page.getByRole("option", { name: "stats" }).click();

  await expect(page).toHaveURL(/\/stats$/);
  await expect(page.getByRole("button", { name: "month" })).toBeVisible();
});
