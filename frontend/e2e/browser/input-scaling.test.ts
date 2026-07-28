import { expect, test } from "@playwright/test";

test.use({ baseURL: "http://127.0.0.1:3001" });

test("text controls use a 16px native control fitted to an unscaled shell", async ({
  page,
}) => {
  await page.goto("/design");

  for (const label of [
    "Text",
    "Search",
    "Date",
    "Category",
    "Amount",
    "Currency",
  ]) {
    const control = page.getByLabel(label);
    const shell = control.locator("..");

    await expect(control).toHaveCSS("font-size", "16px");
    await expect(control).toHaveCSS("transform", /0\.875/);
    await expect(control).toHaveCSS("outline-style", "none");
    await expect(shell).toHaveCSS("outline-width", "2px");

    const controlBox = await control.boundingBox();
    const shellSize = await shell.evaluate((element) => ({
      width: element.clientWidth,
      height: element.clientHeight,
    }));
    expect(controlBox).not.toBeNull();
    expect(
      Math.abs(controlBox!.width - shellSize.width),
      `${label} width`,
    ).toBeLessThan(0.1);
    expect(
      Math.abs(controlBox!.height - shellSize.height),
      `${label} height`,
    ).toBeLessThan(0.1);
  }
});

test("invalid focus and grouped control geometry stay on their shells", async ({
  page,
}) => {
  await page.goto("/design");

  const invalidControl = page.getByPlaceholder("Description");
  const invalidShell = invalidControl.locator("..");
  const invalidOutline = await invalidShell.evaluate(
    (element) => getComputedStyle(element).outlineColor,
  );
  await invalidControl.focus();
  await expect(invalidShell).toHaveCSS("outline-color", invalidOutline);

  const amountShell = page.getByLabel("Amount").locator("..");
  const currencyShell = page.getByLabel("Currency").locator("..");
  const group = amountShell.locator("..");

  await expect(amountShell).toHaveCSS("border-top-left-radius", "12px");
  await expect(amountShell).toHaveCSS("border-top-right-radius", "0px");
  await expect(currencyShell).toHaveCSS("border-top-left-radius", "0px");
  await expect(currencyShell).toHaveCSS("border-top-right-radius", "12px");

  const amountBox = await amountShell.boundingBox();
  const currencyBox = await currencyShell.boundingBox();
  const groupBox = await group.boundingBox();
  expect(amountBox).not.toBeNull();
  expect(currencyBox).not.toBeNull();
  expect(groupBox).not.toBeNull();
  expect(currencyBox!.width).toBe(80);
  expect(
    Math.abs(amountBox!.width + currencyBox!.width - groupBox!.width),
  ).toBeLessThan(0.1);
});

test("file controls show Chromium-style labels and selected file names", async ({
  page,
}) => {
  await page.goto("/design");

  const input = page.getByLabel("Statement");
  await expect(page.getByRole("button", { name: "Choose File" })).toBeVisible();
  await expect(page.getByText("No file chosen", { exact: true })).toBeVisible();

  await input.setInputFiles([
    {
      name: "january.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("date,amount"),
    },
    {
      name: "february.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("date,amount"),
    },
  ]);
  await expect(
    page.getByText("january.csv, february.csv", { exact: true }),
  ).toBeVisible();
});

test("combobox searches use the same fitted native control", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/design");
  await page.keyboard.press("Meta+k");

  const control = page.getByRole("combobox", { name: "Search pages" });
  const shell = control.locator("..");

  await expect(control).toHaveCSS("font-size", "16px");
  await expect(control).toHaveCSS("transform", /0\.875/);

  const controlBox = await control.boundingBox();
  const shellBox = await shell.boundingBox();
  expect(controlBox).not.toBeNull();
  expect(shellBox).not.toBeNull();
  expect(Math.abs(controlBox!.width - shellBox!.width)).toBeLessThan(0.1);
  expect(Math.abs(controlBox!.height - shellBox!.height)).toBeLessThan(1.1);
});

test.describe("desktop controls", () => {
  test.use({
    hasTouch: false,
    isMobile: false,
    viewport: { width: 1280, height: 720 },
  });

  test("native controls stay at their visual size without scaling", async ({
    page,
  }) => {
    await page.goto("/design");

    const control = page.getByLabel("Text");
    const shell = control.locator("..");
    await expect(control).toHaveCSS("font-size", "14px");
    await expect(control).toHaveCSS("transform", "none");

    const controlBox = await control.boundingBox();
    const shellBox = await shell.boundingBox();
    expect(controlBox).not.toBeNull();
    expect(shellBox).not.toBeNull();
    expect(controlBox!.width).toBe(shellBox!.width);
    expect(controlBox!.height).toBe(shellBox!.height);
  });
});
