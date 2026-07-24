import { expect, test, type Page } from "@playwright/test";

test.use({ baseURL: "http://127.0.0.1:3001" });

const buckets = [
  "Restaurants",
  "Subscriptions",
  "Electronics",
  "Utilities",
  "Rent",
  "Barber",
  "Bars",
  "Gifts",
  "Passthrough-phone",
  "Salary",
  "Groceries",
  "Transport",
].map((name, i) => ({
  id: `b${i + 1}`,
  kind: "expense",
  name,
  hidden: false,
}));

function makeRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `r${i + 1}`,
    counterparty: `Row ${i + 1}`,
    date: "2026-07-01",
    amount: -1000,
    currency: "EUR",
    description: "",
    account: "Checking",
  }));
}

async function mockApi(page: Page, rowCount: number) {
  let categorizedId: string | null = null;

  await page.route("**/api/v1/currencies", (route) =>
    route.fulfill({ json: [{ code: "EUR", exponent: 2 }] }),
  );
  await page.route("**/api/v1/buckets**", (route) =>
    route.fulfill({ json: buckets }),
  );
  await page.route(/\/api\/v1\/inbox(?:\?.*)?$/, async (route) => {
    const rows = makeRows(rowCount).filter((row) => row.id !== categorizedId);
    await route.fulfill({ json: { rows, next_cursor: null } });
  });
  await page.route("**/api/v1/inbox/categorize", async (route) => {
    categorizedId = (route.request().postDataJSON() as { row_ids: string[] })
      .row_ids[0];
    await new Promise((r) => setTimeout(r, 20));
    await route.fulfill({
      json: { categorized: 1 },
    });
  });
}

type Sample = {
  t: number;
  mounted: boolean;
  attrs: string;
  popupOpacity: string;
  popupScale: string;
  posRect: string;
};

async function categorizeAndSample(page: Page, rowName: string) {
  await page.getByRole("button", { name: rowName }).click();
  const popup = page.locator('[aria-label^="Choose category"]');
  await expect(popup).toBeVisible();
  await expect(popup).toHaveCSS("opacity", "1");

  await page.evaluate(() => {
    const samples: Sample[] = [];
    (window as unknown as { __samples: Sample[] }).__samples = samples;
    const t0 = performance.now();
    function tick() {
      const el = document.querySelector<HTMLElement>(
        '[aria-label^="Choose category"]',
      );
      const pos = el?.parentElement;
      const rect = pos?.getBoundingClientRect();
      samples.push({
        t: Math.round(performance.now() - t0),
        mounted: !!el,
        attrs: el
          ? [
              "data-open",
              "data-closed",
              "data-starting-style",
              "data-ending-style",
              "data-anchor-hidden",
            ]
              .filter((a) => el.hasAttribute(a))
              .join(",")
          : "",
        popupOpacity: el ? getComputedStyle(el).opacity : "",
        popupScale: el ? getComputedStyle(el).scale : "",
        posRect: rect
          ? [rect.x, rect.y, rect.width, rect.height].map(Math.round).join(",")
          : "",
      });
      if (performance.now() - t0 < 1000) requestAnimationFrame(tick);
    }
    tick();
  });

  await page.getByRole("option", { name: "Restaurants" }).click();
  await page.waitForTimeout(1100);

  return page.evaluate(
    () => (window as unknown as { __samples: Sample[] }).__samples,
  );
}

function expectAnimatedOutInPlace(samples: Sample[]) {
  const ending = samples.filter((s) => s.attrs.includes("data-ending-style"));
  expect(ending.length).toBeGreaterThan(1);
  // Fade-out must be gradual (several frames mid-fade) and not drift position.
  expect(
    ending.filter((s) => {
      const opacity = Number(s.popupOpacity);
      return opacity > 0.1 && opacity < 0.9;
    }).length,
  ).toBeGreaterThanOrEqual(3);
  expect(
    ending.filter((s) => {
      const scale = Number(s.popupScale);
      return scale > 0.97 && scale < 1;
    }).length,
  ).toBeGreaterThanOrEqual(2);
  const positions = new Set(ending.map((s) => s.posRect.split(",")[0]));
  expect(positions.size).toBe(1);
}

test("categorizing a row animates the popup out in place", async ({ page }) => {
  await mockApi(page, 3);
  await page.goto("/e2e/fixture/");
  const samples = await categorizeAndSample(page, "Row 2");
  expectAnimatedOutInPlace(samples);
});

test("categorizing the last row animates the popup out in place", async ({
  page,
}) => {
  await mockApi(page, 1);
  await page.goto("/e2e/fixture/");
  const samples = await categorizeAndSample(page, "Row 1");
  expectAnimatedOutInPlace(samples);
});

test("control: escape-close animation profile", async ({ page }) => {
  await mockApi(page, 3);
  await page.goto("/e2e/fixture/");
  await page.getByRole("button", { name: "Row 2" }).click();
  const popup = page.locator('[aria-label^="Choose category"]');
  await expect(popup).toBeVisible();
  await expect(popup).toHaveCSS("opacity", "1");

  await page.evaluate(() => {
    const samples: Sample[] = [];
    (window as unknown as { __samples: Sample[] }).__samples = samples;
    const t0 = performance.now();
    function tick() {
      const el = document.querySelector<HTMLElement>(
        '[aria-label^="Choose category"]',
      );
      const rect = el?.parentElement?.getBoundingClientRect();
      samples.push({
        t: Math.round(performance.now() - t0),
        mounted: !!el,
        attrs: el
          ? [
              "data-open",
              "data-closed",
              "data-starting-style",
              "data-ending-style",
              "data-anchor-hidden",
            ]
              .filter((a) => el.hasAttribute(a))
              .join(",")
          : "",
        popupOpacity: el ? getComputedStyle(el).opacity : "",
        popupScale: el ? getComputedStyle(el).scale : "",
        posRect: rect
          ? [rect.x, rect.y, rect.width, rect.height].map(Math.round).join(",")
          : "",
      });
      if (performance.now() - t0 < 1000) requestAnimationFrame(tick);
    }
    tick();
  });

  await page.keyboard.press("Escape");
  await page.waitForTimeout(1100);
  const samples = await page.evaluate(
    () => (window as unknown as { __samples: Sample[] }).__samples,
  );
  expectAnimatedOutInPlace(samples);
});

test("opening does not flash an oversized list", async ({ page }) => {
  await mockApi(page, 3);
  await page.goto("/e2e/fixture/");

  await page.evaluate(() => {
    const samples: Sample[] = [];
    (window as unknown as { __samples: Sample[] }).__samples = samples;
    const t0 = performance.now();
    function tick() {
      const el = document.querySelector<HTMLElement>(
        '[aria-label^="Choose category"]',
      );
      const rect = el?.parentElement?.getBoundingClientRect();
      samples.push({
        t: Math.round(performance.now() - t0),
        mounted: !!el,
        attrs: el
          ? [
              "data-open",
              "data-closed",
              "data-starting-style",
              "data-ending-style",
              "data-anchor-hidden",
            ]
              .filter((a) => el.hasAttribute(a))
              .join(",")
          : "",
        popupOpacity: el ? getComputedStyle(el).opacity : "",
        popupScale: el ? getComputedStyle(el).scale : "",
        posRect: rect
          ? [rect.x, rect.y, rect.width, rect.height].map(Math.round).join(",")
          : "",
      });
      if (performance.now() - t0 < 800) requestAnimationFrame(tick);
    }
    tick();
  });

  await page.getByRole("button", { name: "Row 2" }).click();
  await page.waitForTimeout(900);

  const samples = await page.evaluate(
    () => (window as unknown as { __samples: Sample[] }).__samples,
  );

  const visible = samples.filter(
    (s) => s.mounted && Number(s.popupOpacity) > 0.05,
  );
  expect(visible.length).toBeGreaterThan(3);
  expect(
    visible.filter((s) => {
      const scale = Number(s.popupScale);
      return scale > 0.97 && scale < 1;
    }).length,
  ).toBeGreaterThanOrEqual(2);
  const heights = visible.map((s) => Number(s.posRect.split(",")[3]));
  const settled = heights[heights.length - 1];
  // No visible frame may be taller than the settled height (oversized flash).
  expect(Math.max(...heights)).toBeLessThanOrEqual(settled + 1);
});
