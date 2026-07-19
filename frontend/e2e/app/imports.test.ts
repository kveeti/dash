import { expect, test, type Page } from "@playwright/test";

import { login, nordeaHeader, nordeaRow } from "../helpers";

const csv = nordeaHeader + nordeaRow("2026/07/01", "-12,34", "Duplicate shop");

async function upload(page: Page) {
  await page.getByLabel("File").setInputFiles({
    name: "transactions.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page
    .getByRole("combobox")
    .filter({ hasText: "Select account" })
    .first()
    .click();
  const filter = page.getByRole("combobox", { name: "Filter buckets" });
  await filter.fill("E2E Checking");
  const existing = page.getByRole("option", {
    name: "E2E Checking",
    exact: true,
  });
  if (await existing.count()) {
    await existing.click();
  } else {
    await page.getByRole("option", { name: 'Asset "E2E Checking"' }).click();
  }
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/imports") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const { batch_id: batchId } = (await (await created).json()) as {
    batch_id: string;
  };
  await page.locator(`a[href="/imports/${batchId}"]`).click();
}

test("upload, duplicate import, import anyway, and undo use the real backend", async ({
  page,
}, testInfo) => {
  await login(page, testInfo);
  await page.getByRole("link", { name: "import", exact: true }).click();

  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("Choose a file")).toBeVisible();
  await expect(page.getByText("Select an account")).toBeVisible();
  await expect(page.getByLabel("File")).toHaveAttribute("aria-invalid", "true");
  await expect(
    page.getByRole("combobox").filter({ hasText: "Select account" }).first(),
  ).toHaveAttribute("aria-invalid", "true");

  await upload(page);
  await expect(page.getByText("1 imported · 0 duplicates")).toBeVisible();

  await page.getByRole("link", { name: "import", exact: true }).click();
  await upload(page);
  await expect(page.getByText("0 imported · 1 duplicates")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Duplicates" })).toBeVisible();
  await page.getByRole("button", { name: "import anyway" }).click();
  await expect(page.getByText("1 imported · 0 duplicates")).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Undo import" }).click();
  await expect(page).toHaveURL(/\/imports$/);

  await page
    .getByRole("link", { name: "inbox", exact: true })
    .dispatchEvent("mousedown", { button: 0 });
  await expect(page).toHaveURL(/\/inbox$/);
  await expect(page.getByText("Duplicate shop")).toHaveCount(1);
});
