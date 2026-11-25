/** On events, Zoom in and then Fit each change the percent the toolbar shows, and Fit then has nothing left to do. */
export async function toolbarFailures(options) {
  const tab = await options.browser.newPage();
  await tab.goto(`${options.origin}${options.base}getting-started/events/`);
  const viewer = tab.locator(".mantaq-tutorial").first();
  await viewer.locator(".zoom-percent").waitFor({ timeout: 10_000 });
  function percent() {
    return viewer.locator(".zoom-percent").textContent();
  }
  const opened = await percent();
  await viewer.getByRole("button", { name: "Zoom in" }).click();
  const zoomed = await percent();
  const fit = viewer.getByRole("button", { name: "Zoom to fit" });
  if (await fit.isDisabled()) {
    await tab.close();
    return [
      `events: Fit is off at ${zoomed} after Zoom in from ${opened}, so it cannot be checked`,
    ];
  }
  await fit.click();
  const fitted = await percent();
  const done = await fit.isDisabled();
  await tab.close();
  const changed = zoomed !== opened && fitted !== zoomed;
  if (changed && done) return [];
  return [
    `events: the percent reads ${opened}, ${zoomed} after Zoom in and ${fitted} after Fit (Fit off: ${done}); each must change it and Fit must turn off`,
  ];
}
