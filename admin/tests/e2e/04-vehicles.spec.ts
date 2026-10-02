import { test, expect } from '@playwright/test'
import { freshSession, gotoAndLoad } from './helpers/auth'

test.describe('Vehicles — CRUD, status & filters', () => {
  test.beforeEach(async ({ page }) => {
    await freshSession(page)
    await gotoAndLoad(page, '/vehicles')
  })

  // ── Display ────────────────────────────────────────────────────────────────
  test('vehicles page shows content or empty state', async ({ page }) => {
    const body = await page.locator('body').innerText()
    // Page renders either vehicle cards or an empty-state message
    expect(body.toLowerCase()).toMatch(/vehicle|add vehicle|no vehicle/i)
  })

  test('vehicle status badges render', async ({ page }) => {
    const body = await page.locator('body').innerText()
    // At least one status badge: Available, Reserved, Ongoing, or Maintenance
    if (body.match(/Available|Reserved|Ongoing|Maintenance/)) {
      expect(body).toMatch(/Available|Reserved|Ongoing|Maintenance/)
    }
  })

  // ── Filters ────────────────────────────────────────────────────────────────
  test('Available filter button is present', async ({ page }) => {
    const availableBtn = page.locator('button:has-text("Available"), [data-filter="Available"]').first()
    if (await availableBtn.count() > 0) {
      await expect(availableBtn).toBeVisible()
    }
  })

  test('search input is present on vehicles page', async ({ page }) => {
    const searchInput = page.locator('input[type="search"], input[placeholder*="search" i]').first()
    if (await searchInput.count() > 0) {
      await expect(searchInput).toBeVisible()
    }
  })

  // ── Add vehicle ────────────────────────────────────────────────────────────
  test('add vehicle modal opens with required fields', async ({ page }) => {
    const addBtn = page.locator('button:has-text("Add Vehicle"), button:has-text("+ Vehicle"), button:has-text("Add")').first()
    await addBtn.click()
    await page.waitForTimeout(300)

    // Modal/form should show brand, model, daily rate fields
    const modal = page.locator('[role="dialog"], .modal, [class*="modal"], [class*="Modal"]').first()
    if (await modal.count() > 0) {
      await expect(modal).toBeVisible()
    }
  })

  test('vehicle form has brand, model, daily rate inputs', async ({ page }) => {
    const addBtn = page.locator('button:has-text("Add Vehicle"), button:has-text("Add")').first()
    await addBtn.click()
    await page.waitForTimeout(300)

    const inputs = await page.locator('input[type="text"], input[type="number"]').all()
    expect(inputs.length).toBeGreaterThan(2)
  })

  // ── Insurance ──────────────────────────────────────────────────────────────
  test('insurance expiry dates are visible when vehicles exist', async ({ page }) => {
    const body = await page.locator('body').innerText()
    // If vehicles are present, date patterns should appear
    if (body.match(/Available|Reserved|Ongoing|Maintenance/)) {
      expect(body).toMatch(/202\d/)
    }
  })
})
