import { expect, test } from "@playwright/test";

test.use({ baseURL: "http://127.0.0.1:3001" });

test("transaction filters show applied sections and keep filter state in the URL", async ({
  page,
}) => {
  await page.route("**/api/v1/currencies", (route) =>
    route.fulfill({ json: [{ code: "EUR", exponent: 2 }] }),
  );
  await page.route("**/api/v1/users/@me", (route) =>
    route.fulfill({
      json: { id: "user", email: "user@example.com", home_currency: "EUR" },
    }),
  );
  const bucketRequests: string[] = [];
  await page.route("**/api/v1/buckets**", (route) => {
    bucketRequests.push(route.request().url());
    const search = new URL(route.request().url()).searchParams.get("q");
    return route.fulfill({
      json:
        search === "missing"
          ? []
          : [
              {
                id: "food",
                name: "Food",
                kind: "expense",
                hidden: false,
                parent_id: null,
              },
              {
                id: "bank",
                name: "Bank",
                kind: "asset",
                hidden: false,
                parent_id: null,
              },
            ],
    });
  });
  await page.route("**/api/v1/tags**", (route) =>
    route.fulfill({ json: { tags: ["travel"] } }),
  );
  const transactionRequests: string[] = [];
  await page.route("**/api/v1/transactions**", (route) => {
    transactionRequests.push(route.request().url());
    return route.fulfill({ json: { transactions: [], next_cursor: null } });
  });

  await page.goto("/e2e/fixture/?transactions");
  await expect.poll(() => transactionRequests.length).toBeGreaterThan(0);
  const initialParams = new URL(transactionRequests.at(-1)!).searchParams;
  expect(initialParams.has("occurred_from")).toBe(false);
  expect(initialParams.has("occurred_before")).toBe(false);

  const filters = page.getByRole("button", {
    name: "Filters",
    exact: true,
  });
  await expect(filters).toBeVisible();
  await filters.click();
  const clearFilters = page
    .getByRole("dialog")
    .getByRole("button", { name: "Clear filters" });
  await expect(clearFilters).toHaveCount(0);

  await page.getByRole("radio", { name: "Out" }).click();
  await expect(page).toHaveURL(/direction=out/);
  await expect(clearFilters).toBeVisible();
  await expect
    .poll(() =>
      transactionRequests.some((request) => {
        const params = new URL(request).searchParams;
        return params.get("direction") === "out" && !params.has("amount");
      }),
    )
    .toBe(true);
  const requestsBeforeAny = transactionRequests.length;
  await page.getByRole("radio", { name: "Any" }).click();
  await expect
    .poll(() => transactionRequests.length)
    .toBeGreaterThan(requestsBeforeAny);

  const amountRequestStart = transactionRequests.length;
  const amountInput = page.getByRole("textbox", { name: "Specific amount" });
  await amountInput.pressSequentially("12", { delay: 25 });
  await expect(page).toHaveURL(/amount=12/);
  await expect
    .poll(() => transactionRequests.length)
    .toBe(amountRequestStart + 1);
  const amountRequests = transactionRequests.slice(amountRequestStart);
  expect(new URL(amountRequests[0]).searchParams.get("amount")).toBe("12");
  expect(new URL(amountRequests[0]).searchParams.get("currency")).toBe("EUR");
  const minimumInput = page.getByRole("textbox", { name: "At least..." });
  const maximumInput = page.getByRole("textbox", { name: "No more than..." });
  await minimumInput.fill("5");
  await expect(page).toHaveURL(/amount_min=5/);
  await expect(page).not.toHaveURL(/[?&]amount=/);
  await expect(amountInput).toHaveValue("");
  await maximumInput.fill("10");
  await expect(page).toHaveURL(/amount_max=10/);
  await minimumInput.fill("");
  await maximumInput.fill("");
  await expect(page).not.toHaveURL(/[?&]amount_(min|max)=/);
  await expect(page).not.toHaveURL(/[?&]currency=/);

  await page.getByRole("tab", { name: "Date range" }).click();
  await page.getByRole("combobox", { name: "Quick select" }).click();
  await page.getByRole("combobox", { name: "Filter date ranges" }).fill("30");
  await page.getByRole("option", { name: "Last 30 days" }).click();
  await expect(
    page.getByRole("combobox", { name: "Filter date ranges" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Filters, 1 sections applied" }),
  ).toBeVisible();

  await page.getByRole("combobox", { name: "Quick select" }).click();
  await page.getByRole("combobox", { name: "Filter date ranges" }).fill("all");
  await page.getByRole("option", { name: "All time" }).click();
  await expect(page).not.toHaveURL(/[?&]range=/);
  await expect(
    page.getByRole("button", { name: "Filters", exact: true }),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Category" }).click();
  const categoryInput = page.getByRole("combobox", {
    name: "Filter categories",
  });
  await categoryInput.fill("food");
  await expect(page.getByRole("option", { name: "Food" })).toBeVisible();
  expect(
    bucketRequests.some((request) => new URL(request).searchParams.size === 0),
  ).toBe(false);
  await categoryInput.press("ArrowDown");
  await categoryInput.press("Space");
  await expect(page).toHaveURL(/category=food/);
  await expect(
    page.getByRole("button", { name: "Filters, 1 sections applied" }),
  ).toBeVisible();

  await categoryInput.fill("missing");
  await expect(page.getByRole("option", { name: "Food" })).toHaveCount(0);
  await expect(page).toHaveURL(/category=food/);

  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Clear filters" })
    .click();
  await expect(page).not.toHaveURL(/[?&]category=/);
  await expect(
    page.getByRole("button", { name: "Filters", exact: true }),
  ).toBeVisible();
});
