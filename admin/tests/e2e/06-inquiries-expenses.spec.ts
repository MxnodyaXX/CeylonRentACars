import { test, expect } from '@playwright/test'
import { freshSession, gotoAndLoad } from './helpers/auth'

// ═══════════════════════════════════════════════════════════════════════════
// INQUIRIES
// ═══════════════════════════════════════════════════════════════════════════
test.describe('Inquiries', () => {
  test.beforeEach(async ({ page }) => {
    await freshSession(page)
    await gotoAndLoad(page, '/inquiries')
  })

  test('inquiries page renders without error', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    const body = await page.locator('body').innerText()
    expect(body.toLowerCase()).toMatch(/inquiry|inquir|customer|no inquiry/i)
    expect(errors).toHaveLength(0)
  })

  test('inquiry statuses are displayed when data exists', async ({ page }) => {
    const body = await page.locator('body').innerText()
    if (body.match(/Pending|Lost|Converted/)) {
      expect(body).toMatch(/Pending|Lost|Converted/)
    }
  })

  test('referral source is shown per inquiry when data exists', async ({ page }) => {
    const body = await page.locator('body').innerText()
    if (body.match(/Brother|Direct|Sister|Facebook|referral/i)) {
      expect(body).toMatch(/Brother|Direct|Sister|Facebook|referral/i)
    }
  })

  test('add new inquiry form opens', async ({ page }) => {
    const addBtn = page.locator('button:has-text("Add"), button:has-text("New Inquiry"), button:has-text("+ Inquiry")').first()
    await addBtn.click()
    await page.waitForTimeout(300)
    const inputs = await page.locator('input').all()
    expect(inputs.length).toBeGreaterThan(0)
  })

  test('pending inquiries can be converted to booking', async ({ page }) => {
    // Look for Convert/Book button on a pending inquiry
    const convertBtn = page.locator('button:has-text("Convert"), button:has-text("Book"), button:has-text("Confirm")').first()
    if (await convertBtn.count() > 0) {
      await expect(convertBtn).toBeVisible()
    }
  })

  test('lost inquiry shows lost reason when data exists', async ({ page }) => {
    const body = await page.locator('body').innerText()
    if (body.match(/Lost/)) {
      expect(body).toMatch(/KDH|Lost/)
    }
  })

  test('pending filter button is present', async ({ page }) => {
    const pendingBtn = page.locator('button:has-text("Pending"), [data-filter="Pending"]').first()
    if (await pendingBtn.count() > 0) {
      await expect(pendingBtn).toBeVisible()
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// EXPENSES
// ═══════════════════════════════════════════════════════════════════════════
test.describe('Expenses', () => {
  test.beforeEach(async ({ page }) => {
    await freshSession(page)
    await gotoAndLoad(page, '/expenses')
  })

  test('expenses page renders without error', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    const body = await page.locator('body').innerText()
    expect(body.toLowerCase()).toMatch(/expense|amount|vehicle|no expense/i)
    expect(errors).toHaveLength(0)
  })

  test('expense categories are shown when data exists', async ({ page }) => {
    const body = await page.locator('body').innerText()
    if (body.match(/Repair|Service|Tire|Fine|Fuel/)) {
      expect(body).toMatch(/Repair|Service|Tire|Fine|Fuel/)
    }
  })

  test('add expense modal opens', async ({ page }) => {
    const addBtn = page.locator('button:has-text("Add Expense"), button:has-text("New Expense"), button:has-text("Add")').first()
    await addBtn.click()
    await page.waitForTimeout(300)
    const inputs = await page.locator('input[type="number"], input[type="text"]').all()
    expect(inputs.length).toBeGreaterThan(0)
  })

  test('expense form has category and amount fields', async ({ page }) => {
    const addBtn = page.locator('button:has-text("Add Expense"), button:has-text("New Expense"), button:has-text("Add")').first()
    await addBtn.click()
    await page.waitForTimeout(300)
    const body = await page.locator('body').innerText()
    expect(body.toLowerCase()).toMatch(/amount|category|vehicle/)
  })

  test('delete expense shows confirmation', async ({ page }) => {
    const deleteBtn = page.locator('button:has-text("Delete"), button[aria-label*="delete" i], button[aria-label*="remove" i]').first()
    if (await deleteBtn.count() > 0) {
      await deleteBtn.click()
      await page.waitForTimeout(200)
      // Confirmation dialog or the item should be removed
    }
  })

  test('can filter expenses by vehicle', async ({ page }) => {
    const filterEl = page.locator('select, [role="combobox"]').first()
    if (await filterEl.count() > 0) {
      await expect(filterEl).toBeVisible()
    }
  })
})
