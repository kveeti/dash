import { expect, test, type Page } from "@playwright/test";

import { createBucket, importNordea, login, nordeaRow } from "../helpers";

function row(page: Page, name: string) {
  return page.getByRole("listitem").filter({ hasText: name });
}

async function selectRow(page: Page, name: string) {
  await row(page, name).locator("div").first().click();
}

test("search, recategorize, tag, and remove persisted transactions", async ({
  page,
}, testInfo) => {
  await login(page, testInfo);
  const checking = await createBucket(page, "asset", "Checking");
  const groceries = await createBucket(page, "expense", "Groceries");
  await createBucket(page, "expense", "Dining");
  await importNordea(
    page,
    checking.id,
    nordeaRow("2026/07/01", "-12,00", "Market one") +
      nordeaRow("2026/07/02", "-8,00", "Market two"),
  );
  const inboxResponse = await page.request.get("/api/v1/inbox");
  const inbox = (await inboxResponse.json()) as { rows: { id: string }[] };
  const categorized = await page.request.post("/api/v1/inbox/categorize", {
    data: {
      row_ids: inbox.rows.map((item) => item.id),
      bucket_id: groceries.id,
    },
  });
  expect(categorized).toBeOK();

  await page.goto("/transactions");
  const search = page.getByPlaceholder("Search...");
  await search.fill("Market one");
  await expect(page).toHaveURL(/q=Market(%20|\+)one/);
  await expect(page.getByText("Market one")).toBeVisible();
  await expect(page.getByText("Market two")).not.toBeVisible();
  await page.reload();
  await expect(search).toHaveValue("Market one");
  await search.fill("");
  await expect(page.getByText("Market two")).toBeVisible();

  await page.getByRole("checkbox", { name: "Select transactions" }).check();
  await selectRow(page, "Market one");
  await page.getByRole("combobox").filter({ hasText: "Categorize…" }).click();
  await page.getByRole("option", { name: "Dining" }).click();
  await expect(row(page, "Market one")).toContainText("Dining");

  await page.getByRole("checkbox", { name: "Select transactions" }).check();
  await selectRow(page, "Market one");
  await page.getByRole("combobox").filter({ hasText: "Tag…" }).click();
  await page
    .getByRole("combobox", { name: "Find or create tag" })
    .fill("weekly");
  await page.getByRole("option", { name: "Create #weekly" }).click();
  const tag = page.getByRole("button", { name: "#weekly" });
  await expect(tag).toBeVisible();
  await tag.click();
  await expect(page).toHaveURL(/tag=weekly/);
  await expect(page.getByText("Market two")).not.toBeVisible();
  await page.getByRole("button", { name: "#weekly ×" }).click();
  await expect(page.getByText("Market two")).toBeVisible();

  await page.getByRole("checkbox", { name: "Select transactions" }).check();
  await selectRow(page, "Market two");
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Market two")).not.toBeVisible();

  await page.getByRole("link", { name: "inbox", exact: true }).click();
  await expect(page.getByText("Market two")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Market two")).toBeVisible();
});
