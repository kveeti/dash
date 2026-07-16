import { expect, test, type Page } from "@playwright/test";

const inboxRows = Array.from({ length: 5 }, (_, i) => ({
  id: `r${i + 1}`,
  counterparty: `Inbox row ${i + 1}`,
  date: "2026-07-01",
  amount: -1000,
  currency: "EUR",
  description: "",
  account: "Checking",
}));

const transactions = Array.from({ length: 5 }, (_, i) => ({
  id: `t${i + 1}`,
  counterparty: `Transaction ${i + 1}`,
  description: "",
  date: "2026-07-01",
  tags: [],
  postings: [
    {
      id: `asset-${i + 1}`,
      bucket: { id: "asset", name: "Checking", kind: "asset" },
      amount: -1000,
      currency: "EUR",
    },
    {
      id: `expense-${i + 1}`,
      bucket: { id: "expense", name: "Groceries", kind: "expense" },
      amount: 1000,
      currency: "EUR",
    },
  ],
}));

async function mockCommonApi(page: Page) {
  await page.route("**/api/v1/currencies", (route) =>
    route.fulfill({ json: [{ code: "EUR", exponent: 2 }] }),
  );
  await page.route("**/api/v1/buckets", (route) =>
    route.fulfill({
      json: [
        { id: "asset", kind: "asset", name: "Checking", hidden: false },
        { id: "expense", kind: "expense", name: "Groceries", hidden: false },
      ],
    }),
  );
}

test("inbox selects and deselects every visible row", async ({ page }) => {
  await mockCommonApi(page);
  await page.route("**/api/v1/inbox", (route) =>
    route.fulfill({ json: { rows: inboxRows, next_cursor: null } }),
  );

  await page.goto("/e2e/fixture/");
  await page.getByRole("checkbox", { name: "Select rows" }).check();
  await page.getByRole("button", { name: "Select all" }).click();

  await expect(page.getByText("5 selected")).toBeVisible();
  await expect(page.locator("ul input[type=checkbox]:checked")).toHaveCount(5);

  await page.getByRole("button", { name: "Deselect all" }).click();

  await expect(page.getByText("0 selected")).toBeVisible();
  await expect(page.locator("ul input[type=checkbox]:checked")).toHaveCount(0);
});

test("inbox shift-click resizes the selected range", async ({ page }) => {
  await mockCommonApi(page);
  await page.route("**/api/v1/inbox", (route) =>
    route.fulfill({ json: { rows: inboxRows, next_cursor: null } }),
  );

  await page.goto("/e2e/fixture/");
  await page.getByRole("checkbox", { name: "Select rows" }).check();
  await page
    .getByRole("listitem")
    .filter({ hasText: "Inbox row 2" })
    .locator("div")
    .first()
    .click();
  await page
    .getByRole("listitem")
    .filter({ hasText: "Inbox row 5" })
    .locator("div")
    .first()
    .click({ modifiers: ["Shift"] });
  await expect(page.getByText("4 selected")).toBeVisible();

  await page
    .getByRole("listitem")
    .filter({ hasText: "Inbox row 3" })
    .locator("div")
    .first()
    .click({ modifiers: ["Shift"] });

  await expect(page.getByText("2 selected")).toBeVisible();
  await expect(page.locator("ul input[type=checkbox]:checked")).toHaveCount(2);
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: "Inbox row 4" })
      .getByRole("checkbox"),
  ).not.toBeChecked();
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: "Inbox row 5" })
      .getByRole("checkbox"),
  ).not.toBeChecked();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
});

test("transactions select all follows the rows loaded on the page", async ({
  page,
}) => {
  await mockCommonApi(page);
  await page.route("**/api/v1/tags", (route) =>
    route.fulfill({ json: { tags: [] } }),
  );
  await page.route("**/api/v1/transactions**", (route) => {
    const nextPage = new URL(route.request().url()).searchParams.has(
      "before_id",
    );
    return route.fulfill(
      nextPage
        ? { json: { transactions: transactions.slice(2), next_cursor: null } }
        : {
            json: {
              transactions: transactions.slice(0, 2),
              next_cursor: { date: "2026-07-01", id: "t2" },
            },
          },
    );
  });

  await page.goto("/e2e/fixture/?transactions");
  await page.getByRole("checkbox", { name: "Select transactions" }).check();
  await page.getByRole("button", { name: "Select all" }).click();
  await expect(page.getByText("2 selected")).toBeVisible();

  await page.getByRole("button", { name: "Load older" }).click();
  await expect(page.getByText("Transaction 3")).toBeVisible();
  await expect(page.getByRole("button", { name: "Select all" })).toBeVisible();

  await page.getByRole("button", { name: "Select all" }).click();
  await expect(page.getByText("5 selected")).toBeVisible();
  await expect(page.locator("ul input[type=checkbox]:checked")).toHaveCount(5);

  await page.getByRole("button", { name: "Deselect all" }).click();
  await expect(page.getByText("0 selected")).toBeVisible();
});

test("transactions shift-click resizes the selected range", async ({
  page,
}) => {
  await mockCommonApi(page);
  await page.route("**/api/v1/tags", (route) =>
    route.fulfill({ json: { tags: [] } }),
  );
  await page.route("**/api/v1/transactions**", (route) =>
    route.fulfill({ json: { transactions, next_cursor: null } }),
  );

  await page.goto("/e2e/fixture/?transactions");
  await page.getByRole("checkbox", { name: "Select transactions" }).check();
  await page
    .getByRole("listitem")
    .filter({ hasText: "Transaction 2" })
    .locator("div")
    .first()
    .click();
  await page
    .getByRole("listitem")
    .filter({ hasText: "Transaction 5" })
    .locator("div")
    .first()
    .click({ modifiers: ["Shift"] });
  await expect(page.getByText("4 selected")).toBeVisible();

  await page
    .getByRole("listitem")
    .filter({ hasText: "Transaction 3" })
    .locator("div")
    .first()
    .click({ modifiers: ["Shift"] });

  await expect(page.getByText("2 selected")).toBeVisible();
  await expect(page.locator("ul input[type=checkbox]:checked")).toHaveCount(2);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
});
