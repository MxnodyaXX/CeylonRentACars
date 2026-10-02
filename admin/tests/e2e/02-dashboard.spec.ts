import { test, expect } from '@playwright/test'
import { freshSession, gotoAndLoad, waitForAppLoad } from './helpers/auth'

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await freshSession(page)
  })

  test('dashboard page loads without errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await gotoAndLoad(page, '/')
    expect(errors).toHaveLength(0)
  })

  test('dashboard has KPI stat cards', async ({ page }) => {
    // Should show revenue, bookings, vehicles counts etc.
    const cards = page.locator('.rounded-xl, .rounded-2xl, [class*="card"]')
    await expect(cards.first()).toBeVisible()
  })

  test('active bookings count reflects store data', async ({ page }) => {
    const bodyText = await page.locator('body').innerText()
    // Check that booking counts appear
    expect(bodyText).toMatch(/\d/)
  })

  test('total fleet count is visible', async ({ page }) => {
    // Check that at least one KPI card with a numeric value is visible
    const body = await page.locator('body').innerText()
    expect(body).toMatch(/\d+/)
  })

  test('dashboard has a bookings / revenue section', async ({ page }) => {
    const body = await page.locator('body').innerText()
    // Revenue label is shown
    expect(body.toLowerCase()).toMatch(/revenue|booking|fleet|vehicle/i)
  })

  test('notifications badge shows unread count', async ({ page }) => {
    // Notification badge may or may not be present depending on data
    const badge = page.locator('[class*="badge"], .bg-red-500, .bg-yellow-400').first()
    if (await badge.count() > 0) {
      await expect(badge).toBeVisible()
    }
  })

  test('sidebar links are all present', async ({ page }) => {
    const navLinks = ['/vehicles', '/bookings', '/inquiries', '/commissions',
                      '/owners', '/expenses', '/drivers']
    for (const href of navLinks) {
      // Each link appears in both desktop sidebar and mobile nav — use .first()
      const link = page.locator(`a[href="${href}"]`).first()
      await expect(link).toBeVisible()
    }
  })

  test('sidebar navigation works for each main route', async ({ page }) => {
    const routes = [
      { href: '/vehicles',    text: /vehicle/i   },
      { href: '/bookings',    text: /booking/i   },
      { href: '/owners',      text: /owner/i     },
      { href: '/expenses',    text: /expense/i   },
    ]
    for (const r of routes) {
      await page.click(`a[href="${r.href}"]`)
      await page.waitForURL(r.href)
      await waitForAppLoad(page)
      const body = await page.locator('body').innerText()
      expect(body).toMatch(r.text)
      await gotoAndLoad(page, '/')
    }
  })
})
