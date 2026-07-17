import { expect, test } from "@playwright/test";

import { createBucket, login } from "../helpers";

test("manual income validation and creation persist", async ({
  page,
}, testInfo) => {
  await login(page, testInfo);
  await createBucket(page, "asset", "Checking");
  await createBucket(page, "income", "Salary");
  await page.goto("/imports");

  const manual = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Import manually" }) });
  await manual.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Enter a counterparty")).toBeVisible();
  await expect(page.getByText("Enter an amount")).toBeVisible();

  await manual.getByLabel("Counterparty").fill("Employer");
  await manual.getByLabel("Amount").fill("1234.56");
  await manual
    .getByRole("combobox")
    .filter({ hasText: "Select account" })
    .click();
  await page.getByRole("option", { name: "Checking" }).click();
  await manual.getByRole("button", { name: "Income" }).click();
  await manual
    .getByRole("combobox")
    .filter({ hasText: "Select category" })
    .click();
  await page.getByRole("option", { name: "Salary" }).click();
  await manual.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL(/\/transactions$/);
  const transaction = page
    .getByRole("listitem")
    .filter({ hasText: "Employer" });
  await expect(transaction).toContainText("Salary");
  await expect(transaction).toContainText("1 234,56 €");
  await page.reload();
  await expect(page.getByText("Employer")).toBeVisible();
});
