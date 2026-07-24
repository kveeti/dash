import { expect, test } from "@playwright/test";

test.use({ baseURL: "http://127.0.0.1:3001" });

test("inbox filters use amount, date, and account sections", async ({
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
  await page.route("**/api/v1/buckets**", (route) =>
    route.fulfill({
      json: [
        {
          id: "bank",
          name: "Bank",
          kind: "asset",
          hidden: false,
          parent_id: null,
        },
      ],
    }),
  );
  const inboxRequests: string[] = [];
  await page.route(/\/api\/v1\/inbox(?:\?.*)?$/, (route) => {
    inboxRequests.push(route.request().url());
    return route.fulfill({ json: { rows: [], next_cursor: null } });
  });

  await page.goto("/e2e/fixture/");
  await expect.poll(() => inboxRequests.length).toBeGreaterThan(0);
  const initialParams = new URL(inboxRequests.at(-1)!).searchParams;
  expect(initialParams.has("occurred_from")).toBe(false);
  expect(initialParams.has("occurred_before")).toBe(false);

  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Amount" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Date range" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Account" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Category" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Tags" })).toHaveCount(0);

  await page.getByRole("radio", { name: "Out" }).click();
  await expect(page).toHaveURL(/direction=out/);
  await expect(
    page.getByRole("button", { name: "Filters, 1 sections applied" }),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Date range" }).click();
  await page.getByRole("combobox", { name: "Quick select" }).click();
  await page.getByRole("option", { name: "Last 30 days" }).click();
  await expect(
    page.getByRole("combobox", { name: "Filter date ranges" }),
  ).toHaveCount(0);
  await expect(page).toHaveURL(/range=last-30-days/);
  await expect(
    page.getByRole("button", { name: "Filters, 2 sections applied" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      inboxRequests.some((request) => {
        const params = new URL(request).searchParams;
        return (
          params.get("direction") === "out" &&
          params.has("occurred_from") &&
          params.has("occurred_before")
        );
      }),
    )
    .toBe(true);

  await page.getByRole("combobox", { name: "Quick select" }).click();
  await page.getByRole("option", { name: "All time" }).click();
  await expect(page).not.toHaveURL(/[?&]range=/);

  await page.getByRole("tab", { name: "Account" }).click();
  const accountInput = page.getByRole("combobox", { name: "Filter accounts" });
  await accountInput.fill("bank");
  await page.getByRole("option", { name: "Bank" }).click();
  await expect(page).toHaveURL(/account=bank/);
  await expect(
    page.getByRole("button", { name: "Filters, 2 sections applied" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      inboxRequests.some((request) => {
        const params = new URL(request).searchParams;
        return (
          params.get("direction") === "out" &&
          params.get("account") === "bank" &&
          !params.has("occurred_from")
        );
      }),
    )
    .toBe(true);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const search = page.getByPlaceholder("Search...");
  await search.fill("coffee");
  await expect(page).toHaveURL(/q=coffee/);
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(search).toHaveValue("");
  await expect(page).not.toHaveURL(/[?&]q=/);
  await expect(page).toHaveURL(/direction=out/);
  await expect(page).toHaveURL(/account=bank/);

  await page
    .getByRole("button", { name: "Filters, 2 sections applied" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Clear filters" })
    .click();
  await expect(page).not.toHaveURL(/[?&](direction|account|range)=/);
  await expect(
    page.getByRole("button", { name: "Filters", exact: true }),
  ).toBeVisible();
});
