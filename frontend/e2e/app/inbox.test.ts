import { expect, test } from "@playwright/test";

import { createBucket, importNordea, login, nordeaRow } from "../helpers";

test("search, select all, and create a category against the real inbox", async ({
  page,
}, testInfo) => {
  await login(page, testInfo);
  const checking = await createBucket(page, "asset", "Checking");
  await importNordea(
    page,
    checking.id,
    nordeaRow("2026/07/01", "-10,00", "Train") +
      nordeaRow("2026/07/02", "-20,00", "Hotel") +
      nordeaRow("2026/07/03", "-30,00", "Museum"),
  );

  await page.goto("/inbox");
  const search = page.getByPlaceholder("Search...");
  await search.fill("Hotel");
  await expect(page).toHaveURL(/q=Hotel/);
  await expect(page.getByText("Hotel")).toBeVisible();
  await expect(page.getByText("Train")).not.toBeVisible();
  await page.reload();
  await expect(search).toHaveValue("Hotel");
  await search.fill("");
  await expect(page.getByText("Train")).toBeVisible();

  await page.getByRole("checkbox", { name: "Select rows" }).check();
  await page.getByRole("button", { name: "Select all" }).click();
  await expect(page.getByText("3 selected")).toBeVisible();
  await page.getByRole("button", { name: "Deselect all" }).click();
  await expect(page.getByText("0 selected")).toBeVisible();
  await page.getByRole("button", { name: "Select all" }).click();

  await page
    .getByRole("combobox")
    .filter({ hasText: "Category or person" })
    .click();
  await page.getByRole("combobox", { name: "Filter buckets" }).fill("Travel");
  await page.getByRole("option", { name: 'Expense "Travel"' }).click();
  await expect(page.getByText("nothing to categorize")).toBeVisible();

  await page.getByRole("link", { name: "transactions", exact: true }).click();
  await expect(page.getByText("Train")).toBeVisible();
  await expect(page.getByText("Hotel")).toBeVisible();
  await expect(page.getByText("Museum")).toBeVisible();
  await expect(page.getByText("Travel")).toHaveCount(3);
});
