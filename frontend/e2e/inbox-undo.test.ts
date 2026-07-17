import { expect, test, type Page, type Route } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

const rows = ["One", "Two", "Three"].map((counterparty, i) => ({
  id: `r${i + 1}`,
  counterparty,
  date: "2026-07-01",
  amount: -1000,
  currency: "EUR",
  description: "",
  account: "Checking",
}));

async function mockInbox(
  page: Page,
  categorize: (route: Route, rowIds: string[]) => Promise<boolean>,
) {
  const categorized = new Set<string>();

  await page.route("**/api/v1/currencies", (route) =>
    route.fulfill({ json: [{ code: "EUR", exponent: 2 }] }),
  );
  await page.route("**/api/v1/buckets", (route) =>
    route.fulfill({
      json: [
        { id: "groceries", kind: "expense", name: "Groceries", hidden: false },
      ],
    }),
  );
  await page.route("**/api/v1/inbox", (route) =>
    route.fulfill({
      json: {
        rows: rows.filter((row) => !categorized.has(row.id)),
        next_cursor: null,
      },
    }),
  );
  await page.route("**/api/v1/inbox/categorize", async (route) => {
    const rowIds = (route.request().postDataJSON() as { row_ids: string[] })
      .row_ids;
    for (const id of rowIds) categorized.add(id);
    if (!(await categorize(route, rowIds)))
      for (const id of rowIds) categorized.delete(id);
  });
  await page.route("**/api/v1/inbox/restore", async (route) => {
    const rowIds = (route.request().postDataJSON() as { row_ids: string[] })
      .row_ids;
    for (const id of rowIds) categorized.delete(id);
    await route.fulfill({ json: { restored: rowIds.length } });
  });
}

async function categorizeOne(page: Page, name = "One") {
  await page.getByRole("button", { name: new RegExp(name) }).press("Enter");
  await page.getByRole("option", { name: "Groceries" }).click();
}

test("undo is available and restores the row before categorization finishes", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await mockInbox(page, async (route) => {
    await gate;
    await route.fulfill({ json: { categorized: 1 } });
    return true;
  });
  await page.goto("/e2e/fixture/");

  await categorizeOne(page);
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  await expect(page.getByText("One", { exact: true })).not.toBeVisible();

  const restored = page.waitForResponse("**/api/v1/inbox/restore");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("One", { exact: true })).toBeVisible();
  release();
  await restored;
  await page.reload();
  await expect(page.getByText("One", { exact: true })).toBeVisible();
});

test("an older failure does not remove a newer undo", async ({ page }) => {
  let releaseFirst!: () => void;
  let firstFailed!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const failed = new Promise<void>((resolve) => {
    firstFailed = resolve;
  });
  await mockInbox(page, async (route, rowIds) => {
    if (rowIds[0] === "r1") {
      await firstGate;
      await route.fulfill({ status: 500, json: { error: "failed" } });
      firstFailed();
      return false;
    }
    await route.fulfill({ json: { categorized: 1 } });
    return true;
  });
  await page.goto("/e2e/fixture/");

  await categorizeOne(page);
  await categorizeOne(page, "Two");
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();

  releaseFirst();
  await failed;
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();

  const restoreRequest = page.waitForRequest("**/api/v1/inbox/restore");
  await page.getByRole("button", { name: "Undo" }).click();
  expect((await restoreRequest).postDataJSON()).toEqual({ row_ids: ["r2"] });
});

test("failed bulk categorization restores selection and removes its undo", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await mockInbox(page, async (route) => {
    await gate;
    await route.fulfill({ status: 500, json: { error: "failed" } });
    return false;
  });
  await page.goto("/e2e/fixture/");

  await page.getByRole("checkbox", { name: "Select rows" }).check();
  for (const name of ["One", "Two"]) {
    await page
      .getByRole("listitem")
      .filter({ hasText: name })
      .locator("div")
      .first()
      .evaluate((row) => (row as HTMLElement).click());
  }
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: "Groceries" }).click();
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  await expect(page.getByText("2 selected")).not.toBeVisible();

  release();
  await expect(page.getByText("2 selected")).toBeVisible();
  await expect(page.locator("ul input[type=checkbox]:checked")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Undo" })).not.toBeVisible();
});
