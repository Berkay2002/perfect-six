import { expect, test, type Page } from "@playwright/test";

async function chooseOwnedPokemon(
  page: Page,
  slot: number,
  name: string,
) {
  const input = page.getByRole("combobox", { name: `Owned slot ${slot}` });
  await input.fill(name);
  await page
    .getByRole("option", { name: new RegExp(`^${name}(?: Starter)?$`) })
    .click();
}

test("offers alternatives for generated members without changing the entered party", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Team score" })).toBeVisible({
    timeout: 30_000,
  });

  await chooseOwnedPokemon(page, 1, "Greninja");
  await chooseOwnedPokemon(page, 2, "Lucario");
  await chooseOwnedPokemon(page, 3, "Dragapult");
  await page.getByRole("button", { name: "Forge my team" }).click();

  await expect(
    page.getByRole("button", { name: "Find alternatives for Greninja" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Find alternatives for/ }),
  ).toHaveCount(3);

  const generatedAlternative = page.getByRole("button", {
    name: "Find alternatives for Aurorus",
  });
  await generatedAlternative.click();
  await expect(
    page.getByRole("heading", { name: "Three legal alternatives" }),
  ).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: /^Use / }).first().click();
  await expect(page.getByRole("button", { name: "Clear selection" })).toHaveCount(
    3,
  );
  await expect(
    page.getByRole("button", { name: "Greninja", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Lucario", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Dragapult", exact: true }),
  ).toBeVisible();
});
