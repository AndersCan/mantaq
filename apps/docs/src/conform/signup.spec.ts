import { assertMatchesModel } from "@mantaq/test";
import { expect, test, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { signupModel } from "./signup-model";

const EMAIL_CHECK = "if (!EMAIL.test(email)) {";
const pagePath = new URL("./signup-page/index.html", import.meta.url);

function checkPage({ page, url }: { page: Page; url: string }) {
  return assertMatchesModel({
    model: () => signupModel.create(),
    start: async () => {
      await page.goto(url);
      return page;
    },
    events: {
      typeEmail: async (app, { payload: { email } }) => {
        const field = app.getByLabel("Email");
        if (await field.isVisible()) await field.fill(email);
      },
      typePassword: async (app, { payload: { password } }) => {
        const field = app.getByLabel("Password");
        if (await field.isVisible()) await field.fill(password);
      },
      pressSignUp: async (app) => {
        const button = app.getByRole("button", { name: "Sign up" });
        if (await button.isVisible()) await button.click();
      },
    },
    payloads: {
      typeEmail: [{ email: "ada@example.com" }, { email: "ada@example" }],
      typePassword: [{ password: "correct horse" }, { password: "short" }],
    },
    state: async (app) => {
      if (await app.getByRole("status").isVisible()) return "signedUp";
      const problem = app.getByRole("alert");
      if (!(await problem.isVisible())) return "fillingForm";
      return (await problem.innerText()).includes("password")
        ? "showingPasswordProblem"
        : "showingEmailProblem";
    },
  });
}

test("keeps the sign-up page in step with its model", async ({ page }) => {
  test.setTimeout(180_000);
  await checkPage({ page, url: pagePath.href });
});

test("a page that lets ada@example through fails with the printed actions", async ({ page }) => {
  test.setTimeout(180_000);
  const html = await readFile(pagePath, "utf8");
  expect(html.split(EMAIL_CHECK)).toHaveLength(2);
  const file = test.info().outputPath("index.html");
  await writeFile(file, html.replace(EMAIL_CHECK, 'if (!email.includes("@")) {'));
  const failure = await readFile(new URL("./signup-broken.txt", import.meta.url), "utf8");
  await expect(checkPage({ page, url: pathToFileURL(file).href })).rejects.toThrow(
    new Error(failure.trim()),
  );
});
