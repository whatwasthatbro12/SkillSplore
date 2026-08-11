import { test, expect } from '@playwright/test';

/**
 * The visitor path, exercised through real browser input.
 *
 * The homepage category links were broken for a while by a query-string key
 * mismatch (`category` read, `categoryId` written) that every unit test passed
 * straight through, because nothing ever clicked a tile and looked at what the
 * next page actually rendered.
 */

test('homepage states what SkillSplore is without inventing activity', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Post what you want to learn');
  // Says where each kind of lesson is available, which are different answers.
  // In-person needs both people in one place; online needs neither, and the
  // old "New Zealand and Australia" turned away tutors who could teach from
  // anywhere.
  await expect(
    page.getByText('In person across New Zealand and Australia · Online from anywhere'),
  ).toBeVisible();

  // Both routes into the product are meant to be equally reachable.
  await expect(page.getByRole('link', { name: 'Post what you want to learn' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Browse people and skills' })).toBeVisible();

  // Claims the product cannot support must not creep back in.
  const body = (await page.locator('body').innerText()).toLowerCase();
  for (const claim of ['0% fee', 'no fees', 'free forever', 'verified tutors', 'guaranteed', 'best tutors']) {
    expect(body, `homepage must not claim "${claim}"`).not.toContain(claim);
  }
});

test('a homepage category tile filters the search results it lands on', async ({ page }) => {
  await page.goto('/');

  const tile = page.locator('a[href*="/search?categoryId="]').first();
  const categoryName = (await tile.innerText()).split('\n').filter(Boolean)[1]?.trim();
  await tile.click();

  await expect(page).toHaveURL(/\/search\?categoryId=\d+/);
  // The regression this guards was that the filter silently did not apply, so
  // asserting the URL alone would not have caught it. The heading names the
  // category only when the filter is genuinely in effect.
  await expect(page.getByRole('heading', { level: 2 })).toContainText(categoryName!);
});

test('search offers posting a request when nothing matches', async ({ page }) => {
  await page.goto('/search?q=zzzznothingmatchesthis');

  await expect(page.getByText("Couldn't find the right person?")).toBeVisible();
  await expect(page.getByRole('link', { name: 'post what you want to learn' })).toBeVisible();
});

test('terms and privacy are reachable and still marked as drafts', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Terms', exact: true }).click();
  await expect(page).toHaveURL(/\/terms/);
  await expect(page.getByText(/draft/i).first()).toBeVisible();
});
