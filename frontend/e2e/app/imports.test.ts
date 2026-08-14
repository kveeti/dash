import { expect, test, type Page } from "@playwright/test";

import { login, nordeaHeader, nordeaRow } from "../helpers";

const nordeaCSV =
  nordeaHeader + nordeaRow("2026/07/01", "-12,34", "Duplicate shop");
const duplicatePageCSV =
  nordeaHeader +
  [
    ...Array.from({ length: 50 }, (_, index) =>
      nordeaRow("2026/07/02", "-1,00", `Duplicate page ${index + 1}`),
    ),
    nordeaRow("2026/07/01", "-1,00", "Older duplicate page"),
  ].join("");

async function goToImports(page: Page) {
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("menuitem", { name: "import" }).click();
}

async function upload(page: Page, input: { csv?: string } = {}) {
  await page.getByLabel("File", { exact: true }).setInputFiles({
    name: "transactions.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(input.csv ?? nordeaCSV),
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
  await expect(page.getByLabel("Timestamps without an offset")).toHaveValue(
    "Europe/Helsinki",
  );
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

test("dropping a CSV anywhere opens a recognized import", async ({
  page,
}, testInfo) => {
  await login(page, testInfo);

  await page.evaluate((csv) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([csv], "transactions.csv", { type: "text/csv" }),
    );
    window.dispatchEvent(
      new DragEvent("dragenter", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
  }, nordeaCSV);
  await expect(page.getByText("Drop CSV to import")).toBeVisible();
  await expect(page.getByText("You’ll choose the account next")).toBeVisible();

  await page.evaluate((csv) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([csv], "transactions.csv", { type: "text/csv" }),
    );
    window.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
  }, nordeaCSV);

  await expect(page).toHaveURL(/\/imports$/);
  await expect(page.getByText("Drop CSV to import")).not.toBeVisible();
  await expect(
    page.getByText("transactions.csv", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("Choose a file")).toHaveCount(0);
  await expect(page.getByText("Select an account")).toBeVisible();
});

test("upload, duplicate import, import anyway, and undo use the real backend", async ({
  page,
}, testInfo) => {
  await login(page, testInfo);
  await goToImports(page);

  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("Choose a file")).toBeVisible();
  await expect(page.getByText("Select an account")).toBeVisible();
  await expect(page.getByLabel("File", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(
    page.getByRole("combobox").filter({ hasText: "Select account" }).first(),
  ).toHaveAttribute("aria-invalid", "true");

  await upload(page);
  await expect(page.getByText("1 imported · 0 duplicates")).toBeVisible();

  await goToImports(page);
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

test("an import report loads older duplicate rows", async ({
  page,
}, testInfo) => {
  await login(page, testInfo);
  await goToImports(page);
  await upload(page, { csv: duplicatePageCSV });

  await goToImports(page);
  await upload(page, { csv: duplicatePageCSV });
  await expect(page.getByText("0 imported · 51 duplicates")).toBeVisible();
  await expect(page.getByText("Older duplicate page")).not.toBeVisible();
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByText("Older duplicate page")).toBeVisible();
});

test("an import report shows skipped CSV rows", async ({ page }, testInfo) => {
  await login(page, testInfo);
  await goToImports(page);
  await upload(page, {
    csv:
      nordeaHeader +
      nordeaRow("2026/07/01", "-12,34", "Valid shop") +
      nordeaRow("bad-date", "-1,00", "Broken shop") +
      nordeaRow("2026/07/03", "50,00", "Refund"),
  });
  await expect(page.getByText("2 imported · 0 duplicates")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Skipped rows" }),
  ).toBeVisible();
  await expect(page.getByText(/Line 3:/)).toBeVisible();
});
