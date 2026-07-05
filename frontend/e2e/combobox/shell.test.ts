// Guards the pointerdown open/close behavior in combobox.tsx: Kobalte toggles
// the trigger on click, so we toggle on pointerdown ourselves and swallow the
// toggle Kobalte fires on the trailing click. aria-expanded reflects our state.
import { expect, test } from "@playwright/test";

test.describe("combobox trigger pointerdown toggle", async () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/combobox/shell");
  });

  const pressCenter = async (page: import("@playwright/test").Page) => {
    const box = await page.locator("[aria-haspopup='dialog']").boundingBox();
    if (!box) throw new Error("no trigger");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    return {
      down: () => page.mouse.down(),
      up: () => page.mouse.up(),
    };
  };

  test("opens on pointerdown and the trailing click does not close it", async ({
    page,
  }) => {
    const trigger = page.locator("[aria-haspopup='dialog']");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    const mouse = await pressCenter(page);
    await mouse.down();
    await expect(trigger).toHaveAttribute("aria-expanded", "true"); // on pointerdown
    await mouse.up();
    await expect(trigger).toHaveAttribute("aria-expanded", "true"); // click swallowed
  });

  test("re-pressing an open trigger closes it on pointerdown, not on click", async ({
    page,
  }) => {
    const trigger = page.locator("[aria-haspopup='dialog']");
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");

    const mouse = await pressCenter(page);
    await mouse.down();
    await expect(trigger).toHaveAttribute("aria-expanded", "false"); // on pointerdown
    await mouse.up();
    await expect(trigger).toHaveAttribute("aria-expanded", "false"); // click swallowed
  });

  test("keyboard Enter still toggles (swallow flag does not leak)", async ({
    page,
  }) => {
    const trigger = page.locator("[aria-haspopup='dialog']");
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Enter");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});
