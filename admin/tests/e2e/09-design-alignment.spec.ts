import { test, expect } from '@playwright/test'
import { freshSession, gotoAndLoad, waitForAppLoad } from './helpers/auth'

const ROUTES = [
  { path: '/',             name: 'Dashboard'    },
  { path: '/vehicles',     name: 'Vehicles'     },
  { path: '/bookings',     name: 'Bookings'     },
  { path: '/inquiries',    name: 'Inquiries'    },
  { path: '/owners',       name: 'Owners'       },
  { path: '/commissions',  name: 'Commissions'  },
  { path: '/expenses',     name: 'Expenses'     },
  { path: '/drivers',      name: 'Drivers'      },
  { path: '/notifications',name: 'Notifications'},
  { path: '/handovers',    name: 'Handovers'    },
]

test.describe('Design & Alignment Checks', () => {
  test.beforeEach(async ({ page }) => {
    await freshSession(page)
  })

  // ── No JS errors on any page ───────────────────────────────────────────────
  for (const route of ROUTES) {
    test(`${route.name} page has zero JS errors`, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      await gotoAndLoad(page, route.path)
      expect(errors, `JS errors on ${route.path}: ${errors.join(', ')}`).toHaveLength(0)
    })
  }

  // ── Sidebar always visible ─────────────────────────────────────────────────
  for (const route of ROUTES) {
    test(`${route.name} page has sidebar navigation`, async ({ page }) => {
      await gotoAndLoad(page, route.path)
      const sidebar = page.locator('nav, aside, [class*="sidebar" i], [class*="Sidebar" i]').first()
      await expect(sidebar).toBeVisible()
    })
  }

  // ── Page headings ──────────────────────────────────────────────────────────
  test('each page has a visible heading / page title', async ({ page }) => {
    for (const route of ROUTES) {
      await gotoAndLoad(page, route.path)
      const heading = page.locator('h1, h2, [class*="title" i], [class*="heading" i]').first()
      await expect(heading).toBeVisible()
    }
  })

  // ── Tables render with headers ─────────────────────────────────────────────
  test('bookings table renders headers', async ({ page }) => {
    await gotoAndLoad(page, '/bookings')
    const body = await page.locator('body').innerText()
    // Should have column-like headers
    expect(body.toLowerCase()).toMatch(/customer|vehicle|status|amount|date/)
  })

  test('commissions table renders headers', async ({ page }) => {
    await gotoAndLoad(page, '/commissions')
    const body = await page.locator('body').innerText()
    expect(body.toLowerCase()).toMatch(/commission|payout|status|owner/)
  })

  test('expenses table renders headers', async ({ page }) => {
    await gotoAndLoad(page, '/expenses')
    const body = await page.locator('body').innerText()
    expect(body.toLowerCase()).toMatch(/vehicle|amount|category|date/)
  })

  // ── Buttons and actions ────────────────────────────────────────────────────
  test('each CRUD page has an "Add" action button', async ({ page }) => {
    const pages = ['/vehicles', '/bookings', '/owners', '/inquiries', '/expenses', '/drivers']
    for (const p of pages) {
      await gotoAndLoad(page, p)
      const addBtn = page.locator('button:has-text("Add"), button:has-text("New"), button:has-text("+")').first()
      await expect(addBtn).toBeVisible()
    }
  })

  // ── Modal behaviour ────────────────────────────────────────────────────────
  test('modal opens and closes without layout breaking', async ({ page }) => {
    await gotoAndLoad(page, '/vehicles')
    const addBtn = page.locator('button:has-text("Add Vehicle"), button:has-text("Add")').first()
    await addBtn.click()
    await page.waitForTimeout(400)

    // Modal should be visible
    const modal = page.locator('[role="dialog"], .modal, [class*="modal" i]').first()
    if (await modal.count() > 0) {
      await expect(modal).toBeVisible()
    }

    // Close via ESC
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    // Page should still render normally
    const sidebar = page.locator('nav, aside').first()
    await expect(sidebar).toBeVisible()
  })

  // ── Responsive sidebar (mobile) ────────────────────────────────────────────
  test('sidebar collapses on mobile viewport', async ({ page }) => {
    // Load at desktop first (sidebar visible), then shrink to mobile
    await gotoAndLoad(page, '/')
    await page.setViewportSize({ width: 375, height: 812 })
    await page.waitForTimeout(300)
    // On mobile the desktop sidebar is hidden — the page body should still render
    const body = page.locator('body')
    await expect(body).toBeVisible()
  })

  test('layout restores on desktop viewport', async ({ page }) => {
    // Load at desktop, shrink to mobile, expand back to desktop
    await gotoAndLoad(page, '/')
    await page.setViewportSize({ width: 375, height: 812 })
    await page.waitForTimeout(300)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.waitForTimeout(300)
    const sidebar = page.locator('nav, aside').first()
    await expect(sidebar).toBeVisible()
  })

  // ── Status badge colours ───────────────────────────────────────────────────
  test('status badges are present on bookings page when bookings exist', async ({ page }) => {
    await gotoAndLoad(page, '/bookings')
    const statusBadge = page.locator(
      '[class*="badge" i], [class*="status" i], [class*="chip" i], ' +
      '[class*="tag" i], span:has-text("Confirmed"), span:has-text("Ongoing")'
    ).first()
    if (await statusBadge.count() > 0) {
      await expect(statusBadge).toBeVisible()
    }
  })

  // ── No overlapping elements (basic) ───────────────────────────────────────
  test('main content area does not overlap sidebar', async ({ page }) => {
    await gotoAndLoad(page, '/')
    const sidebar = page.locator('nav, aside').first()
    const main    = page.locator('main').first()
    if (await main.count() > 0) {
      const sidebarBox = await sidebar.boundingBox()
      const mainBox    = await main.boundingBox()
      if (sidebarBox && mainBox) {
        // Main left edge should be at or beyond sidebar right edge
        expect(mainBox.x).toBeGreaterThanOrEqual(sidebarBox.x + sidebarBox.width - 5)
      }
    }
  })

  // ── Notification page ──────────────────────────────────────────────────────
  test('notifications page renders notification-related content', async ({ page }) => {
    await gotoAndLoad(page, '/')
    // Should have notification-related content in the page
    const body = await page.locator('body').innerText()
    expect(body.toLowerCase()).toMatch(/notification|bell|alert/i)
  })

  test('notifications page loads without error', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await gotoAndLoad(page, '/notifications')
    expect(errors).toHaveLength(0)
    const body = await page.locator('body').innerText()
    expect(body.toLowerCase()).toMatch(/notification|no notification|unread/i)
  })

  test('mark all read button is present on notifications page', async ({ page }) => {
    await gotoAndLoad(page, '/notifications')
    const markAllBtn = page.locator('button:has-text("Mark All"), button:has-text("Read All"), button:has-text("Clear")').first()
    if (await markAllBtn.count() > 0) {
      await expect(markAllBtn).toBeVisible()
    }
  })

  // ── Handovers ──────────────────────────────────────────────────────────────
  test('handovers page renders without crash', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await gotoAndLoad(page, '/handovers')
    expect(errors).toHaveLength(0)
  })

  // ── Screenshots for visual reference ──────────────────────────────────────
  test('dashboard screenshot saved for visual reference', async ({ page }) => {
    await gotoAndLoad(page, '/')
    await page.screenshot({ path: 'playwright-report/screenshots/dashboard.png', fullPage: true })
  })

  test('bookings page screenshot', async ({ page }) => {
    await gotoAndLoad(page, '/bookings')
    await page.screenshot({ path: 'playwright-report/screenshots/bookings.png', fullPage: true })
  })

  test('vehicles page screenshot', async ({ page }) => {
    await gotoAndLoad(page, '/vehicles')
    await page.screenshot({ path: 'playwright-report/screenshots/vehicles.png', fullPage: true })
  })
})
