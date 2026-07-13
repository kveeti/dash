import { expect, type Page, test } from "@playwright/test";

async function login(page: Page, user: string) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Pick a dev user" }),
  ).toBeVisible();
  await page.getByPlaceholder("new-user-sub").fill(user);
  await page.getByRole("button", { name: "Log in as new user" }).click();
  await expect(page).toHaveURL(/\/transactions$/);
}

async function createBucket(
  page: Page,
  kind: "asset" | "expense" | "income",
  name: string,
  parentID?: string,
) {
  const response = await page.request.post("/api/v1/buckets", {
    data: { kind, name, ...(parentID ? { parent_id: parentID } : {}) },
  });
  expect(response).toBeOK();
  return (await response.json()) as { id: string };
}

async function createTransaction(
  page: Page,
  date: string,
  accountID: string,
  categoryID: string,
  amount: number,
  kind: "expense" | "income",
) {
  const accountAmount = kind === "expense" ? -amount : amount;
  const response = await page.request.post("/api/v1/transactions", {
    data: {
      date: `${date}T12:00:00Z`,
      postings: [
        { bucket_id: accountID, amount: accountAmount, currency: "EUR" },
        { bucket_id: categoryID, amount: -accountAmount, currency: "EUR" },
      ],
    },
  });
  expect(response).toBeOK();
}

async function localToday(page: Page) {
  return page.evaluate(() => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  });
}

function previousMonthStart(today: string) {
  const date = new Date(`${today}T12:00:00Z`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 10);
}

test("stats compare periods and roll up categories", async ({
  page,
}, testInfo) => {
  await login(page, `stats-${testInfo.project.name}-${testInfo.retry}`);

  const today = await localToday(page);
  const currentStart = `${today.slice(0, 7)}-01`;
  const comparisonStart = previousMonthStart(today);

  const bank = await createBucket(page, "asset", "Bank");
  const food = await createBucket(page, "expense", "Food");
  const groceries = await createBucket(page, "expense", "Groceries", food.id);
  const salary = await createBucket(page, "income", "Salary");

  await createTransaction(
    page,
    currentStart,
    bank.id,
    food.id,
    20_000,
    "expense",
  );
  await createTransaction(
    page,
    currentStart,
    bank.id,
    groceries.id,
    60_000,
    "expense",
  );
  await createTransaction(
    page,
    comparisonStart,
    bank.id,
    groceries.id,
    65_000,
    "expense",
  );
  await createTransaction(
    page,
    currentStart,
    bank.id,
    salary.id,
    200_000,
    "income",
  );
  await createTransaction(
    page,
    comparisonStart,
    bank.id,
    salary.id,
    200_000,
    "income",
  );

  await page.getByRole("link", { name: "stats", exact: true }).click();
  await expect(page).toHaveURL(/\/stats$/);

  const summary = page.locator('section[aria-label="Summary"]');
  await expect(
    summary
      .locator("article")
      .filter({ hasText: "Expenses" })
      .locator("strong"),
  ).toHaveText("€800.00");
  await expect(
    summary.locator("article").filter({ hasText: "Income" }).locator("strong"),
  ).toHaveText("€2,000.00");
  await expect(
    summary.locator("article").filter({ hasText: "Net" }).locator("strong"),
  ).toHaveText("€1,200.00");

  const foodRow = page.getByRole("button", { name: /Food/ });
  await expect(foodRow).toContainText("€800");
  await expect(foodRow).toContainText("€650");
  await foodRow.click();
  await expect(page.getByText("Other", { exact: true })).toBeVisible();
  await expect(page.getByText("Groceries", { exact: true })).toBeVisible();
  await expect(page.getByText("Salary", { exact: true })).toBeVisible();

  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);

  const yearResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/stats?") &&
      new URL(response.url()).searchParams.get("compare") === "year",
  );
  await page.getByRole("button", { name: "last year" }).click();
  await yearResponse;
  await expect(page).toHaveURL(/compare=year/);
  await expect(foodRow).toContainText("€0");

  await page.getByRole("button", { name: "custom" }).click();
  await expect(page).toHaveURL(/period=custom/);
  await expect(page.getByLabel("From date")).toHaveValue(currentStart);
  await expect(page.getByLabel("To date")).toHaveValue(today);
});
