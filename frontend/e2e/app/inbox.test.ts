import { expect, test } from "@playwright/test";

import { createBucket, importNordea, login, nordeaRow } from "../helpers";

test("search, select all, and create a category against the real inbox", async ({
  page,
}, testInfo) => {
  await login(page, testInfo);
  const checking = await createBucket(page, "asset", "Checking");
  await createBucket(page, "expense", "Food");
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

  await page.getByRole("checkbox", { name: "Select rows" }).click();
  await page.getByRole("button", { name: "Select all" }).click();
  await expect(page.getByText("3 selected")).toBeVisible();
  await page.getByRole("button", { name: "Deselect all" }).click();
  await expect(page.getByText("0 selected")).toBeVisible();
  const hotelRow = page.getByRole("listitem").filter({ hasText: "Hotel" });
  await hotelRow.locator("div").first().click();
  await expect(page.getByText("1 selected")).toBeVisible();
  await expect(
    page.getByRole("combobox").filter({ hasText: "Categorize as..." }),
  ).toBeVisible();
  await hotelRow.locator("div").first().click();
  await page.getByRole("button", { name: "Select all" }).click();

  await page
    .getByRole("combobox")
    .filter({ hasText: "Categorize all as..." })
    .click();
  const actionFilter = page.getByRole("combobox", { name: "Filter buckets" });
  await expect(actionFilter).toHaveAttribute(
    "placeholder",
    "Filter categories...",
  );
  await expect(
    page.getByText("Categorize as...", { exact: true }),
  ).toBeVisible();
  await actionFilter.fill("Travel");
  await page.getByRole("option", { name: 'Expense "Travel"' }).click();
  await expect(page.getByText("No transactions to categorize")).toBeVisible();

  await page.getByRole("link", { name: "transactions", exact: true }).click();
  await expect(page.getByText("Train")).toBeVisible();
  await expect(page.getByText("Hotel")).toBeVisible();
  await expect(page.getByText("Museum")).toBeVisible();
  await expect(page.getByText("Travel")).toHaveCount(3);
});

test("inbox and transactions load older rows from the real backend", async ({
  page,
}, testInfo) => {
  await login(page, testInfo);
  const checking = await createBucket(page, "asset", "Checking");
  const groceries = await createBucket(page, "expense", "Groceries");
  const rows = [
    ...Array.from({ length: 100 }, (_, index) =>
      nordeaRow("2026/07/02", "-1,00", `Current page ${index + 1}`),
    ),
    nordeaRow("2026/07/01", "-1,00", "Older page row"),
  ].join("");
  await importNordea(page, checking.id, rows);

  await page.goto("/inbox");
  await expect(page.locator("main").getByRole("listitem")).toHaveCount(100);
  await expect(page.getByText("Older page row")).not.toBeVisible();
  await page.getByRole("button", { name: "Load older" }).click();
  await expect(page.getByText("Older page row")).toBeVisible();
  await expect(page.locator("main").getByRole("listitem")).toHaveCount(101);

  const firstPage = await page.request.get("/api/v1/inbox");
  expect(firstPage).toBeOK();
  const first = (await firstPage.json()) as {
    rows: { id: string }[];
    next_cursor: { date: string; id: string } | null;
  };
  expect(first.next_cursor).toBeTruthy();
  const secondPage = await page.request.get(
    `/api/v1/inbox?before_date=${encodeURIComponent(first.next_cursor!.date)}&before_id=${first.next_cursor!.id}`,
  );
  expect(secondPage).toBeOK();
  const second = (await secondPage.json()) as { rows: { id: string }[] };
  const categorized = await page.request.post("/api/v1/inbox/categorize", {
    data: {
      row_ids: [...first.rows, ...second.rows].map((row) => row.id),
      bucket_id: groceries.id,
    },
  });
  expect(categorized).toBeOK();

  await page.goto("/transactions");
  await expect(page.locator("main").getByRole("listitem")).toHaveCount(100);
  await expect(page.getByText("Older page row")).not.toBeVisible();
  await page.getByRole("button", { name: "Load older" }).click();
  await expect(page.getByText("Older page row")).toBeVisible();
  await page.getByRole("checkbox", { name: "Select transactions" }).click();
  await page.getByRole("button", { name: "Select all" }).click();
  await expect(page.getByText("101 selected")).toBeVisible();
});
