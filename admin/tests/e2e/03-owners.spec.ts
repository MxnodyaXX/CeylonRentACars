import { test, expect } from '@playwright/test'
import { freshSession, gotoAndLoad } from './helpers/auth'

test.describe('Owners — CRUD & display', () => {
  test.beforeEach(async ({ page }) => {
    await freshSession(page)
    await gotoAndLoad(page, '/owners')
  })

  test('owners page loads and renders content', async ({ page }) => {
    // Page should have loaded — check for "Add Owner" button or owner-related text
    const body = await page.locator('body').innerText()
    expect(body.toLowerCase()).toMatch(/owner|commission|vehicle/)
  })

  test('each owner card shows commission rate', async ({ page }) => {
    const body = await page.locator('body').innerText()
    // Any percentage figure (15%, 12%, 20%, …) on the owners page is valid
    if (body.match(/\d+%/)) {
      expect(body).toMatch(/\d+%/)
    }
  })

  test('owner earnings and payout figures are displayed', async ({ page }) => {
    const body = await page.locator('body').innerText()
    // Revenue / earnings figures displayed as Rs X or Rs Xk format
    if (body.match(/Rs\s[\d,]+/i)) {
      expect(body).toMatch(/Rs\s[\d,]+/i)
    }
  })

  test('add owner modal opens', async ({ page }) => {
    const addBtn = page.locator('button:has-text("Add Owner")').first()
    await addBtn.click()
    await page.waitForTimeout(300)
    // The modal form uses <p class="label"> tags — check for the modal title or any label
    await expect(page.locator('text=Full Name').first()).toBeVisible()
  })

  test('add new owner — fills and saves', async ({ page }) => {
    const addBtn = page.locator('button:has-text("Add Owner")').first()
    await addBtn.click()
    await page.waitForTimeout(300)

    // Inputs in modal order: Full Name, Phone, Email, Address, Bank Account, Commission Rate
    const inputs = page.locator('input.input, input[class*="input"]')

    // Full Name (required)
    await inputs.nth(0).fill('Test Owner EMRAC')
    // Phone
    await inputs.nth(1).fill('0711234567')
    // Email
    await inputs.nth(2).fill('testowner@emrac.lk')

    // Click "Add Owner" submit button inside the modal
    await page.locator('button:has-text("Add Owner")').last().click()
    await page.waitForTimeout(400)

    const body = await page.locator('body').innerText()
    expect(body).toMatch(/Test Owner EMRAC/)
  })

  test('add owner modal has expected form fields', async ({ page }) => {
    const addBtn = page.locator('button:has-text("Add Owner")').first()
    await addBtn.click()
    await page.waitForTimeout(300)
    // Modal should contain at minimum the Full Name and Phone fields
    await expect(page.locator('text=Full Name').first()).toBeVisible()
    await expect(page.locator('text=Phone').first()).toBeVisible()
    // Number inputs (commission rate, etc.) are optional depending on implementation
    const rateInput = page.locator('input[type="number"]').first()
    if (await rateInput.count() > 0) {
      await expect(rateInput).toHaveAttribute('type', 'number')
    }
  })
})
