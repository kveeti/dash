import { expect, type Page, test } from "@playwright/test";

const nordeaHeader =
  "Kirjauspäivä;Määrä;Maksaja;Maksunsaaja;Nimi;Otsikko;Viesti;Viitenumero;Saldo;Valuutta;\n";

function nordeaRow(date: string, amount: string, payee: string, message = "") {
  return `${date};${amount};;;;${payee};${message};;;EUR\n`;
}

async function login(page: Page, user: string) {
  await page.goto("/");
  await page.getByPlaceholder("new-user-sub").fill(user);
  await page.getByRole("button", { name: "Log in as new user" }).click();
  await expect(page).toHaveURL(/\/transactions$/);
}

async function createBucket(
  page: Page,
  kind: "asset" | "expense",
  name: string,
) {
  const response = await page.request.post("/api/v1/buckets", {
    data: { kind, name },
  });
  expect(response).toBeOK();
  return (await response.json()) as { id: string };
}

async function importRows(page: Page, bucketID: string, csv: string) {
  const response = await page.request.post("/api/v1/imports", {
    multipart: {
      bucket_id: bucketID,
      format: "nordea",
      timezone: "Europe/Helsinki",
      file: {
        name: "export.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csv),
      },
    },
  });
  expect(response).toBeOK();
  const { batch_id: batchID } = (await response.json()) as {
    batch_id: string;
  };
  await expect
    .poll(async () => {
      const report = await page.request.get(`/api/v1/imports/${batchID}`);
      return ((await report.json()) as { status: string }).status;
    })
    .toBe("done");
}

test("matching keeps the inbox in place and matches through the dialog", async ({
  page,
}, testInfo) => {
  await login(page, `inbox-${testInfo.project.name}-${testInfo.retry}`);
  const checking = await createBucket(page, "asset", "Checking");
  const savings = await createBucket(page, "asset", "Savings");
  const fillers = Array.from({ length: 30 }, (_, index) =>
    nordeaRow("2026/07/01", "-1,00", `Filler ${index}`),
  ).join("");
  await importRows(
    page,
    checking.id,
    nordeaHeader +
      fillers +
      nordeaRow("2026/06/01", "-5,00", "Source transfer"),
  );
  await importRows(
    page,
    savings.id,
    nordeaHeader + nordeaRow("2026/06/02", "5,00", "Candidate transfer"),
  );

  await page.goto("/inbox");
  const source = page.getByText("Source transfer", { exact: true });
  await source.scrollIntoViewIfNeeded();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  expect(scrollBefore).toBeGreaterThan(0);

  await source.click();
  await page.getByRole("option", { name: "Match transactions" }).click();
  const dialog = page.getByRole("dialog", { name: "Match transactions" });
  const input = dialog.getByPlaceholder("Search possible matches");
  await expect(dialog).toBeVisible();
  await expect(input).toBeFocused();
  await expect(dialog.getByText("Candidate transfer")).toBeVisible();
  const matchID = new URL(page.url()).searchParams.get("match");
  expect(matchID).toBeTruthy();

  let releaseSearch!: () => void;
  const searchGate = new Promise<void>((resolve) => {
    releaseSearch = resolve;
  });
  await page.route("**/api/v1/inbox/*/matches?*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("q") === "candidate") {
      await searchGate;
    }
    await route.continue();
  });
  await input.fill("candidate");
  await expect(dialog.getByText("loading…")).toBeVisible();
  await expect(dialog.getByText("Candidate transfer")).toBeVisible();
  releaseSearch();
  await expect(dialog.getByText("loading…")).toBeHidden();

  await page.goBack();
  await expect(dialog).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBe(scrollBefore);

  await page.goto(`/inbox?match=${matchID}`);
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/inbox$/);

  await page.goto(`/inbox?match=${matchID}`);
  await dialog.getByRole("option", { name: /Candidate transfer/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Source transfer", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("Candidate transfer", { exact: true }),
  ).toHaveCount(0);
});

test("new transaction rejects precision the currency cannot store", async ({
  page,
}, testInfo) => {
  await login(page, `amount-${testInfo.project.name}-${testInfo.retry}`);
  await createBucket(page, "asset", "Bank");
  await createBucket(page, "expense", "Food");

  await page.goto("/transactions/new");
  await page.getByLabel("Counterparty").fill("Shop");
  await page.getByLabel("Amount").fill("1.2");
  await page.getByLabel("Currency").selectOption("JPY");

  await page.getByRole("button", { name: "Select account" }).click();
  await page.getByRole("option", { name: "Bank" }).click();
  await page.getByRole("button", { name: "Select category" }).click();
  await page.getByRole("option", { name: "Food" }).click();
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("JPY does not use decimal places")).toBeVisible();
  await expect(page).toHaveURL(/\/transactions\/new$/);

  await page.getByLabel("Amount").fill("1");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/\/transactions$/);
});
