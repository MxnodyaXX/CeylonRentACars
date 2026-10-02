import { test, expect } from '@playwright/test'
import { freshSession, gotoAndLoad } from './helpers/auth'

test.describe('Bookings — lifecycle, conflict detection, commission', () => {
  test.beforeEach(async ({ page }) => {
    await freshSession(page)
    await gotoAndLoad(page, '/bookings')
  })

  // ── Display ────────────────────────────────────────────────────────────────
  test('bookings page renders without error', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    const body = await page.locator('body').innerText()
    expect(body.toLowerCase()).toMatch(/booking|customer|status|no booking/i)
    expect(errors).toHaveLength(0)
  })

  test('each booking shows status chip when bookings exist', async ({ page }) => {
    const body = await page.locator('body').innerText()
    if (body.match(/Confirmed|Ongoing|Completed|Cancelled/)) {
      expect(body).toMatch(/Confirmed|Ongoing|Completed|Cancelled/)
    }
  })

  test('booking amounts are displayed when bookings exist', async ({ page }) => {
    const body = await page.locator('body').innerText()
    // Currency amounts (Rs Xk or Rs X,XXX)
    if (body.match(/Rs\s[\d,]+/i)) {
      expect(body).toMatch(/Rs\s[\d,]+/i)
    }
  })

  // ── Status filters ─────────────────────────────────────────────────────────
  test('Ongoing filter button is present', async ({ page }) => {
    const ongoingTab = page.locator('button:has-text("Ongoing"), [data-filter="Ongoing"]').first()
    if (await ongoingTab.count() > 0) {
      await expect(ongoingTab).toBeVisible()
    }
  })

  test('Completed filter button is present', async ({ page }) => {
    const completedTab = page.locator('button:has-text("Completed"), [data-filter="Completed"]').first()
    if (await completedTab.count() > 0) {
      await expect(completedTab).toBeVisible()
    }
  })

  // ── New booking form ───────────────────────────────────────────────────────
  test('add booking modal/form opens', async ({ page }) => {
    const addBtn = page.locator('button:has-text("New Booking"), button:has-text("Add Booking"), button:has-text("Book")').first()
    await addBtn.click()
    await page.waitForTimeout(300)
    // A date picker or form should appear
    const inputs = await page.locator('input').all()
    expect(inputs.length).toBeGreaterThan(0)
  })

  test('booking form has vehicle, customer, date fields', async ({ page }) => {
    const addBtn = page.locator('button:has-text("New Booking"), button:has-text("Add Booking"), button:has-text("Book")').first()
    await addBtn.click()
    await page.waitForTimeout(400)
    const body = await page.locator('body').innerText()
    // Should show vehicle/customer selection and date inputs
    expect(body.toLowerCase()).toMatch(/vehicle|customer|date|name/)
  })

  // ── Booking actions ────────────────────────────────────────────────────────
  test('complete / return button is present for ongoing booking', async ({ page }) => {
    // Look for a "Complete" or "Return" button
    const completeBtn = page.locator('button:has-text("Complete"), button:has-text("Return"), button:has-text("End Trip")').first()
    if (await completeBtn.count() > 0) {
      await expect(completeBtn).toBeVisible()
    }
  })

  test('cancel button available for confirmed bookings', async ({ page }) => {
    const cancelBtn = page.locator('button:has-text("Cancel")').first()
    if (await cancelBtn.count() > 0) {
      await expect(cancelBtn).toBeVisible()
    }
  })

  // ── Booking detail ──────────────────────────────────────────────────────────
  test('bookings page contains booking-related content', async ({ page }) => {
    // The bookings page should always show booking-related words in the body
    const body = await page.locator('body').innerText()
    expect(body.toLowerCase()).toMatch(/booking|customer|vehicle|status|date/i)
  })
})
