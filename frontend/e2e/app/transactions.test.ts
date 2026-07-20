import {
  expect,
  test,
  type Page,
  type Route,
  type TestInfo,
} from "@playwright/test";

import {
  createBucket,
  createTransaction,
  importNordea,
  login,
  nordeaRow,
} from "../helpers";

function row(page: Page, name: string) {
  return page.getByRole("listitem").filter({ hasText: name });
}

async function selectRow(page: Page, name: string) {
  await row(page, name).locator("div").first().click();
}

async function setupTransactions(page: Page, testInfo: TestInfo) {
  await login(page, testInfo);
  const checking = await createBucket(page, "asset", "Checking");
  const groceries = await createBucket(page, "expense", "Groceries");
  await createBucket(page, "expense", "Dining");
  await importNordea(
    page,
    checking.id,
    nordeaRow("2026/07/01", "-12,00", "Failure one") +
      nordeaRow("2026/07/02", "-8,00", "Failure two"),
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

  const transactionsResponse = await page.request.get("/api/v1/transactions");
  const transactions = (await transactionsResponse.json()) as {
    transactions: { id: string; counterparty: string }[];
  };
  const ids = transactions.transactions.map((transaction) => transaction.id);
  await page.goto("/transactions");
  return { ids };
}

test("transaction date and month headings group only matching dates", async ({
  page,
}, testInfo) => {
  await login(page, testInfo);
  const checking = await createBucket(page, "asset", "Checking");
  const groceries = await createBucket(page, "expense", "Groceries");
  const headings = await page.evaluate(() => {
    const dateParts = (date: Date) =>
      Object.fromEntries(
        new Intl.DateTimeFormat("en-CA", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        })
          .formatToParts(date)
          .filter(({ type }) => type !== "literal")
          .map(({ type, value }) => [type, value]),
      );
    const today = new Date();
    const format = (date: Date) => ({
      date: new Intl.DateTimeFormat("fi-FI", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(date),
      month: new Intl.DateTimeFormat("fi-FI", {
        month: "long",
        year: "numeric",
      }).format(date),
    });
    const todayParts = dateParts(today);

    return {
      today: `${todayParts.year}-${todayParts.month}-${todayParts.day}`,
      todayDate: new Intl.DateTimeFormat("fi-FI", {
        weekday: "short",
        month: "short",
        day: "numeric",
      }).format(today),
      todayMonth: new Intl.DateTimeFormat("fi-FI", { month: "long" }).format(
        today,
      ),
      july2001: format(new Date("2001-07-01T12:00:00Z")),
      july2000: format(new Date("2000-07-02T12:00:00Z")),
    };
  });

  for (const [date, counterparty] of [
    [headings.today, "Today one"],
    [headings.today, "Today two"],
    ["2001-07-01", "July 2001"],
    ["2000-07-02", "July 2000"],
  ]) {
    await createTransaction(page, {
      date,
      counterparty,
      accountId: checking.id,
      categoryId: groceries.id,
      amount: 12,
    });
  }

  await page.goto("/transactions");
  await expect(
    page.getByRole("heading", {
      level: 3,
      name: headings.todayDate,
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("heading", {
      level: 3,
      name: headings.july2001.date,
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("heading", {
      level: 3,
      name: headings.july2000.date,
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: headings.todayMonth,
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: headings.july2001.month,
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: headings.july2000.month,
      exact: true,
    }),
  ).toHaveCount(1);
});

async function selectFailureTransactions(page: Page) {
  await page.getByRole("checkbox", { name: "Select transactions" }).click();
  await selectRow(page, "Failure one");
  await selectRow(page, "Failure two");
}

async function holdFailedRequest(
  page: Page,
  url: string,
  method: string,
  action: () => Promise<void>,
) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route(url, async (route) => {
    if (route.request().method() !== method) {
      await route.continue();
      return;
    }
    await gate;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "test failure" }),
    });
  });

  const response = page.waitForResponse(
    (next) =>
      next.url().includes(url.replace("**", "")) &&
      next.request().method() === method &&
      next.status() === 500,
  );
  await action();

  return async () => {
    release();
    await response;
    await page.unroute(url);
  };
}

test("search, recategorize, tag, and remove persisted transactions", async ({
  page,
}, testInfo) => {
  await login(page, testInfo);
  const checking = await createBucket(page, "asset", "Checking");
  const groceries = await createBucket(page, "expense", "Groceries");
  await createBucket(page, "expense", "Dining");
  await createBucket(page, "person", "Bob");
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

  await page.getByRole("checkbox", { name: "Select transactions" }).click();
  await selectRow(page, "Market one");
  await page.getByRole("combobox").filter({ hasText: "Actions" }).click();
  await expect(page.getByText("Categorize as…")).toBeVisible();
  await expect(page.getByRole("option", { name: "Bob" })).toBeVisible();
  await page.getByRole("option", { name: "Dining" }).click();
  await expect(row(page, "Market one")).toContainText("Dining");

  const transactionsResponse = await page.request.get("/api/v1/transactions");
  const transactions = (await transactionsResponse.json()) as {
    transactions: { id: string; counterparty: string }[];
  };
  const marketOne = transactions.transactions.find(
    (transaction) => transaction.counterparty === "Market one",
  )!;
  const partialTagResponse = await page.request.post(
    "/api/v1/transactions/tags",
    {
      data: { transaction_ids: [marketOne.id], tag: "partial" },
    },
  );
  expect(partialTagResponse).toBeOK();
  await page.reload();

  await page.getByRole("checkbox", { name: "Select transactions" }).click();
  await selectRow(page, "Market one");
  await selectRow(page, "Market two");
  await page.getByRole("combobox").filter({ hasText: "Actions" }).click();
  await expect(page.getByText("Categorize all as…")).toBeVisible();
  await expect(page.getByText("Change or add tags…")).toBeVisible();

  const partialOption = page
    .getByRole("option")
    .filter({ hasText: "#partial" });
  const partialCheckbox = partialOption.getByRole("checkbox");
  const partialCheckboxHitbox = partialOption.locator("[data-tag-checkbox]");
  await expect(partialCheckbox).toHaveAttribute("aria-checked", "mixed");
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/transactions/tags") &&
        response.request().method() === "POST",
    ),
    partialCheckboxHitbox.click(),
  ]);
  await expect(partialCheckbox).toBeChecked();
  await expect(
    page.getByRole("combobox", { name: "Filter transaction actions" }),
  ).toBeVisible();

  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/transactions/tags") &&
        response.request().method() === "DELETE",
    ),
    partialCheckboxHitbox.click(),
  ]);
  await expect(partialCheckbox).not.toBeChecked();
  await expect(
    page.getByRole("combobox", { name: "Filter transaction actions" }),
  ).toBeVisible();

  await page
    .getByRole("combobox", { name: "Filter transaction actions" })
    .fill("weekly");
  const createWeekly = page
    .getByRole("option")
    .filter({ hasText: "Create #weekly" });
  await expect(createWeekly.getByRole("checkbox")).not.toBeChecked();
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/transactions/tags") &&
        response.request().method() === "POST",
    ),
    createWeekly.getByText("Create #weekly", { exact: true }).click(),
  ]);
  await expect(
    page.getByRole("combobox", { name: "Filter transaction actions" }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Close selection" }).click();

  const tag = page.getByRole("button", { name: "#weekly" }).first();
  await expect(tag).toBeVisible();
  await tag.click();
  await expect(page).toHaveURL(/tag=weekly/);
  await expect(page.getByText("Market two")).toBeVisible();
  await page.getByRole("button", { name: "#weekly ×" }).click();

  await page.getByRole("checkbox", { name: "Select transactions" }).click();
  await selectRow(page, "Market two");
  await page.getByRole("combobox").filter({ hasText: "Actions" }).click();
  await page.getByRole("option", { name: "Remove transactions" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Are you sure?");
  await expect(page.getByText("Market two")).toBeVisible();
  await page
    .getByRole("button", { name: "Remove transaction", exact: true })
    .click();
  await expect(page.getByText("Market two")).not.toBeVisible();

  await page.getByRole("link", { name: "inbox", exact: true }).click();
  await expect(page.getByText("Market two")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Market two")).toBeVisible();
});

test("transaction action search keeps previous actions while results load", async ({
  page,
}, testInfo) => {
  await setupTransactions(page, testInfo);
  await selectFailureTransactions(page);
  await page.getByRole("combobox").filter({ hasText: "Actions" }).click();
  const input = page.getByRole("combobox", {
    name: "Filter transaction actions",
  });
  await expect(page.getByRole("option", { name: "Groceries" })).toBeVisible();
  await page.evaluate(() => {
    const recordingWindow = window as typeof window & {
      actionOptionsFlashed: boolean;
      actionOptionsObserver?: MutationObserver;
    };
    const record = () => {
      const options = [...document.querySelectorAll('[role="option"]')];
      if (
        options.length === 1 &&
        options[0]?.textContent?.includes("Remove transactions")
      ) {
        recordingWindow.actionOptionsFlashed = true;
      }
    };
    recordingWindow.actionOptionsFlashed = false;
    recordingWindow.actionOptionsObserver = new MutationObserver(record);
    recordingWindow.actionOptionsObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  });

  let heldQuery = "";
  let pendingSearches = 0;
  let gate = Promise.resolve();
  let release = () => {};
  function holdSearchesFor(query: string) {
    heldQuery = query;
    pendingSearches = 0;
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
  }
  const holdSearch = async (route: Route) => {
    if (new URL(route.request().url()).searchParams.get("q") !== heldQuery) {
      await route.continue();
      return;
    }
    pendingSearches += 1;
    const requestGate = gate;
    await requestGate;
    await route.continue();
  };
  await page.route("**/api/v1/buckets?*", holdSearch);
  await page.route("**/api/v1/tags?*", holdSearch);

  holdSearchesFor("nothin");
  await input.fill("nothin");
  await expect.poll(() => pendingSearches).toBe(2);
  await expect(page.getByRole("option", { name: "Groceries" })).toBeVisible();
  release();
  await expect(
    page.getByRole("option", { name: "Create expense “nothin”" }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "Create #nothin" }),
  ).toBeVisible();

  holdSearchesFor("nothing");
  await input.fill("nothing");
  await expect.poll(() => pendingSearches).toBe(2);
  await expect(
    page.getByRole("option", { name: "Create expense “nothin”" }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "Create #nothin" }),
  ).toBeVisible();
  release();
  await expect(
    page.getByRole("option", { name: "Create expense “nothing”" }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "Create #nothing" }),
  ).toBeVisible();

  holdSearchesFor("");
  await input.fill("");
  await expect.poll(() => pendingSearches).toBe(2);
  await expect(
    page.getByRole("option", { name: "Create expense “nothing”" }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "Create #nothing" }),
  ).toBeVisible();
  release();
  await expect(page.getByRole("option", { name: "Groceries" })).toBeVisible();
  const flashed = await page.evaluate(() => {
    const recordingWindow = window as typeof window & {
      actionOptionsFlashed: boolean;
      actionOptionsObserver?: MutationObserver;
    };
    recordingWindow.actionOptionsObserver?.disconnect();
    return recordingWindow.actionOptionsFlashed;
  });
  expect(flashed).toBe(false);
});

test("transaction action keyboard looping preserves scroll padding", async ({
  page,
}, testInfo) => {
  await setupTransactions(page, testInfo);
  await Promise.all(
    Array.from({ length: 16 }, (_, index) =>
      createBucket(
        page,
        "expense",
        `Category ${String(index).padStart(2, "0")}`,
      ),
    ),
  );
  await page.reload();
  await selectFailureTransactions(page);
  await page.getByRole("combobox").filter({ hasText: "Actions" }).click();
  const input = page.getByRole("combobox", {
    name: "Filter transaction actions",
  });
  await expect(page.getByRole("option", { name: "Category 15" })).toBeVisible();

  const scroll = page.locator("[data-transaction-actions-scroll]");
  await input.press("ArrowUp");
  await expect(page.locator("[data-highlighted]")).toContainText(
    "Remove transactions",
  );
  const bottomGap = await scroll.evaluate((element) => {
    const item = element.querySelector<HTMLElement>("[data-highlighted]");
    if (!item) throw new Error("No highlighted action");
    return (
      element.getBoundingClientRect().bottom -
      item.getBoundingClientRect().bottom
    );
  });
  expect(bottomGap).toBeGreaterThanOrEqual(3);

  await input.press("ArrowDown");
  await expect(page.locator("[data-highlighted]")).not.toContainText(
    "Remove transactions",
  );
  const topGap = await scroll.evaluate((element) => {
    const item = element.querySelector<HTMLElement>("[data-highlighted]");
    if (!item) throw new Error("No highlighted action");
    return (
      item.getBoundingClientRect().top - element.getBoundingClientRect().top
    );
  });
  expect(topGap).toBeGreaterThanOrEqual(3);
});

test("transaction action keyboard semantics keep checkbox toggles open", async ({
  page,
}, testInfo) => {
  const { ids } = await setupTransactions(page, testInfo);
  const tagged = await page.request.post("/api/v1/transactions/tags", {
    data: { transaction_ids: [ids[0]], tag: "partial" },
  });
  expect(tagged).toBeOK();
  await page.reload();

  await selectFailureTransactions(page);
  await page.getByRole("combobox").filter({ hasText: "Actions" }).click();
  const input = page.getByRole("combobox", {
    name: "Filter transaction actions",
  });
  await input.fill("partial");
  await input.press("Space");
  await expect(input).toHaveValue("partial ");

  await input.fill("partial");
  const option = page.getByRole("option").filter({ hasText: "#partial" });
  await expect(option).toBeVisible();
  await expect(
    page.getByRole("option", { name: "Create expense “partial”" }),
  ).toBeVisible();
  await input.press("ArrowDown");
  const checkbox = option.getByRole("checkbox");
  await expect(checkbox).toHaveAttribute("aria-checked", "mixed");

  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/transactions/tags") &&
        response.request().method() === "POST",
    ),
    input.press("Space"),
  ]);
  await expect(input).toHaveValue("partial");
  await expect(checkbox).toBeChecked();
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();

  await input.dispatchEvent("keydown", {
    key: " ",
    code: "Space",
    repeat: true,
    bubbles: true,
  });
  await expect(checkbox).toBeChecked();

  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/transactions/tags") &&
        response.request().method() === "DELETE",
    ),
    input.press("Enter"),
  ]);
  await expect(input).not.toBeVisible();
  await expect(row(page, "Failure one")).not.toContainText("#partial");
  await expect(row(page, "Failure two")).not.toContainText("#partial");
});

test("failed transaction actions roll back and preserve selection", async ({
  page,
}, testInfo) => {
  const { ids } = await setupTransactions(page, testInfo);
  for (const tag of ["partial", "stable"]) {
    const tagged = await page.request.post("/api/v1/transactions/tags", {
      data: {
        transaction_ids: tag === "partial" ? [ids[0]] : ids,
        tag,
      },
    });
    expect(tagged).toBeOK();
  }
  await page.reload();
  await selectFailureTransactions(page);
  await page.getByRole("combobox").filter({ hasText: "Actions" }).click();

  const input = page.getByRole("combobox", {
    name: "Filter transaction actions",
  });
  await input.fill("partial");
  const partialOption = page
    .getByRole("option")
    .filter({ hasText: "#partial" });
  const partialCheckbox = partialOption.getByRole("checkbox");
  await expect(partialCheckbox).toHaveAttribute("aria-checked", "mixed");
  const finishFailedAdd = await holdFailedRequest(
    page,
    "**/api/v1/transactions/tags",
    "POST",
    () => partialOption.locator("[data-tag-checkbox]").click(),
  );
  await expect(partialCheckbox).toBeChecked();
  await finishFailedAdd();
  await expect(partialCheckbox).toHaveAttribute("aria-checked", "mixed");

  await input.fill("stable");
  const stableOption = page.getByRole("option").filter({ hasText: "#stable" });
  const stableCheckbox = stableOption.getByRole("checkbox");
  await expect(stableCheckbox).toBeChecked();
  const finishFailedRemove = await holdFailedRequest(
    page,
    "**/api/v1/transactions/tags",
    "DELETE",
    () => stableOption.locator("[data-tag-checkbox]").click(),
  );
  await expect(stableCheckbox).not.toBeChecked();
  await finishFailedRemove();
  await expect(stableCheckbox).toBeChecked();

  await input.fill("");
  const finishFailedCategorize = await holdFailedRequest(
    page,
    "**/api/v1/transactions/categorize",
    "POST",
    async () => {
      await page.getByRole("option", { name: "Dining" }).click();
    },
  );
  await expect(row(page, "Failure one")).toContainText("Dining");
  await expect(row(page, "Failure two")).toContainText("Dining");
  await finishFailedCategorize();
  await expect(row(page, "Failure one")).toContainText("Groceries");
  await expect(row(page, "Failure two")).toContainText("Groceries");
  await expect(page.getByText("2 selected")).toBeVisible();

  await page.getByRole("combobox").filter({ hasText: "Actions" }).click();
  await page.getByRole("option", { name: "Remove transactions" }).click();
  const finishFailedRemoveTransactions = await holdFailedRequest(
    page,
    "**/api/v1/transactions",
    "DELETE",
    async () => {
      await page.getByRole("button", { name: "Remove transactions" }).click();
    },
  );
  await expect(row(page, "Failure one")).not.toBeVisible();
  await expect(row(page, "Failure two")).not.toBeVisible();
  await finishFailedRemoveTransactions();
  await expect(row(page, "Failure one")).toBeVisible();
  await expect(row(page, "Failure two")).toBeVisible();
  await expect(page.getByText("2 selected")).toBeVisible();
});
