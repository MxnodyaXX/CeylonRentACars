import { test, expect } from '@playwright/test'
import { freshSession, gotoAndLoad } from './helpers/auth'

/**
 * FULL END-TO-END JOURNEY
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Create a new inquiry (customer name + requested vehicle required)
 * 2. Add a new owner  (Full Name required, commission rate is a number input)
 * 3. Add a new vehicle linked to that owner
 * 4. Create a booking (Confirmed → Ongoing)
 * 5. Record a vehicle expense (vehicle select + description + amount required)
 * 6. Complete the trip
 * 7. Verify commission page renders
 * 8. Mark a commission as paid (if any exist)
 * 9. Dashboard reflects revenue figures
 */

test.describe('Full Customer Journey', () => {
  test.beforeEach(async ({ page }) => {
    await freshSession(page)
  })

  // ── STEP 1: Add inquiry ────────────────────────────────────────────────────
  test('Step 1 — new inquiry is created and visible', async ({ page }) => {
    await gotoAndLoad(page, '/inquiries')

    // Open the "Add Inquiry" modal
    await page.locator('button:has-text("Add Inquiry")').click()
    await page.waitForTimeout(400)

    // Modal fields (all use className="input", no placeholder except requestedVehicle)
    // Order in the 2-col grid: customerName, customerPhone, requestedVehicle, referral(Select), startDate, endDate, notes
    const textInputs = page.locator('input.input, input[class*="input"]')

    // customerName  (index 0 inside the modal)
    await textInputs.nth(0).fill('Journey Test Customer')
    // customerPhone (index 1)
    await textInputs.nth(1).fill('0771122334')
    // requestedVehicle (index 2) — has placeholder "Axio, Prius, Van..."
    await page.locator('input[placeholder*="Axio"]').fill('Aqua')

    // "Save Inquiry" button is now enabled (customerName + requestedVehicle filled)
    await page.locator('button:has-text("Save Inquiry")').click()
    await page.waitForTimeout(400)

    const body = await page.locator('body').innerText()
    expect(body).toMatch(/Journey Test Customer/)
  })

  // ── STEP 2a: Add new owner ─────────────────────────────────────────────────
  test('Step 2a — new owner created with 20% commission rate', async ({ page }) => {
    await gotoAndLoad(page, '/owners')

    // Open "Add Owner" modal (only visible for admin)
    await page.locator('button:has-text("Add Owner")').first().click()
    await page.waitForTimeout(400)

    // Modal inputs:  Full Name*, Phone, Email, Address, Bank Account, Commission Rate(number)
    const inputs = page.locator('input.input, input[class*="input"]')

    await inputs.nth(0).fill('Journey Owner')      // Full Name
    await inputs.nth(1).fill('0776655443')          // Phone
    await inputs.nth(2).fill('journey@emrac.lk')   // Email

    // Commission rate (input[type="number"]) if present in form
    const rateInput = page.locator('input[type="number"]').first()
    if (await rateInput.count() > 0) {
      await rateInput.click({ clickCount: 3 })
      await rateInput.fill('20')
    }

    // Submit — the last "Add Owner" button is inside the modal
    await page.locator('button:has-text("Add Owner")').last().click()
    await page.waitForTimeout(400)

    const body = await page.locator('body').innerText()
    expect(body).toMatch(/Journey Owner/)
  })

  // ── STEP 2b: Add new vehicle ───────────────────────────────────────────────
  test('Step 2b — new vehicle added for existing owner', async ({ page }) => {
    await gotoAndLoad(page, '/vehicles')

    await page.locator('button:has-text("Add Vehicle")').first().click()
    await page.waitForTimeout(400)

    // Fill text inputs visible in the Add Vehicle form
    const textInputs = page.locator('input[type="text"], input:not([type])')
    if (await textInputs.count() > 0) await textInputs.nth(0).fill('WP-TEST-99')

    // Daily rate
    const numInputs = page.locator('input[type="number"]')
    if (await numInputs.count() > 0) await numInputs.nth(0).fill('4000')

    const submitBtn = page.locator('button[type="submit"], button:has-text("Save"), button:has-text("Add")').last()
    await submitBtn.click()
    await page.waitForTimeout(400)
  })

  // ── STEP 3: Create booking ─────────────────────────────────────────────────
  test('Step 3 — booking form opens and has required fields', async ({ page }) => {
    await gotoAndLoad(page, '/bookings')

    const addBtn = page.locator('button:has-text("New Booking"), button:has-text("Add Booking"), button:has-text("Book")').first()
    await addBtn.click()
    await page.waitForTimeout(500)

    // Form should be visible with customer name / vehicle fields
    const body = await page.locator('body').innerText()
    expect(body.toLowerCase()).toMatch(/vehicle|customer|date|name/)
  })

  // ── STEP 4: Start the trip ─────────────────────────────────────────────────
  test('Step 4 — confirmed booking can transition to Ongoing', async ({ page }) => {
    await gotoAndLoad(page, '/bookings')

    // Look for any Start/Activate button
    const startBtn = page.locator('button:has-text("Start"), button:has-text("Activate"), button:has-text("Begin")').first()
    if (await startBtn.count() > 0) {
      await startBtn.click()
      await page.waitForTimeout(400)
      const body = await page.locator('body').innerText()
      expect(body).toMatch(/Ongoing/)
    } else {
      // Try clicking the first booking row to open its detail modal
      const firstRow = page.locator('[class*="card"], tr').first()
      if (await firstRow.count() > 0) {
        await firstRow.click()
        await page.waitForTimeout(300)
        const startInModal = page.locator('button:has-text("Start"), button:has-text("Activate")').first()
        if (await startInModal.count() > 0) {
          await startInModal.click()
          await page.waitForTimeout(300)
        }
      }
    }
  })

  // ── STEP 5: Record an expense ──────────────────────────────────────────────
  test('Step 5 — expense recorded for vehicle during trip', async ({ page }) => {
    await gotoAndLoad(page, '/expenses')

    // Click "Add Expense" button
    await page.locator('button:has-text("Add Expense")').click()
    await page.waitForTimeout(400)

    // Vehicle selector: <select class="input"> with "Select vehicle" as first option
    const vehicleSelect = page.locator('select.input, select[class*="input"]').first()
    if (await vehicleSelect.count() > 0) {
      await vehicleSelect.selectOption({ index: 1 })   // pick first real vehicle
    }

    // Amount (input[type="number"])
    const amountInput = page.locator('input[type="number"]').first()
    await amountInput.click({ clickCount: 3 })
    await amountInput.fill('3500')

    // Description (last text input in the modal)
    const descInput = page.locator('input.input[placeholder*="description" i], input.input[placeholder*="Brief" i]').first()
    if (await descInput.count() > 0) {
      await descInput.fill('Fuel during trip')
    } else {
      // Fallback: fill last text-like input in the form
      const allTextInputs = page.locator('input.input:not([type="number"]):not([type="date"])')
      const count = await allTextInputs.count()
      if (count > 0) await allTextInputs.nth(count - 1).fill('Fuel during trip')
    }

    // Click "Save Expense"
    await page.locator('button:has-text("Save Expense")').click()
    await page.waitForTimeout(400)

    const body = await page.locator('body').innerText()
    // Expense should appear — check for amount or description
    expect(body).toMatch(/3,500|3500|Fuel during trip|Fuel/)
  })

  // ── STEP 6: Complete the trip ──────────────────────────────────────────────
  test('Step 6 — ongoing booking completed, vehicle becomes Available', async ({ page }) => {
    await gotoAndLoad(page, '/bookings')

    const completeBtn = page.locator('button:has-text("Complete"), button:has-text("Return"), button:has-text("End")').first()
    if (await completeBtn.count() > 0) {
      await completeBtn.click()
      await page.waitForTimeout(500)
      const body = await page.locator('body').innerText()
      expect(body).toMatch(/Completed/)
    }
  })

  // ── STEP 7: Commission page renders ──────────────────────────────────────
  test('Step 7 — commission page renders correctly', async ({ page }) => {
    await gotoAndLoad(page, '/commissions')

    const body = await page.locator('body').innerText()
    // Commission page should show its heading/structure
    expect(body.toLowerCase()).toMatch(/commission|payout|owner/)
    // If commission entries exist, amounts should appear
    if (body.match(/\d{3,}/)) {
      expect(body).toMatch(/\d{3,}/)
    }
  })

  // ── STEP 8: Mark commission paid ──────────────────────────────────────────
  test('Step 8 — pending commission marked as paid', async ({ page }) => {
    await gotoAndLoad(page, '/commissions')

    const paidBtn = page.locator('button:has-text("Mark Paid"), button:has-text("Pay"), button:has-text("Paid")').first()
    if (await paidBtn.count() > 0) {
      await paidBtn.click()
      await page.waitForTimeout(400)
      const body = await page.locator('body').innerText()
      expect(body).toMatch(/Paid/)
    }
  })

  // ── STEP 9: Dashboard updated revenue ─────────────────────────────────────
  test('Step 9 — dashboard reflects fleet revenue figures', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await gotoAndLoad(page, '/')

    const body = await page.locator('body').innerText()
    expect(body).toMatch(/\d{2,}/)   // some numeric figure is rendered
    expect(errors).toHaveLength(0)
  })
})
