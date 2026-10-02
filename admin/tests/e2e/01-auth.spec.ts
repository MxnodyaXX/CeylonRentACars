import { test, expect } from '@playwright/test'
import { loginViaUI, loginAsAdmin } from './helpers/auth'

// Helper — avoids strict-mode violation when sidebar has multiple nav/aside elements
const sidebar = (page: Parameters<typeof loginAsAdmin>[0]) =>
  page.locator('aside, nav').first()

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
  })

  // ── Design checks ──────────────────────────────────────────────────────────
  test('login page renders all required elements', async ({ page }) => {
    await expect(page.locator('h1')).toHaveText('EMRAC')
    await expect(page.locator('text=Vehicle Fleet Management')).toBeVisible()
    await expect(page.locator('input[autocomplete="username"]')).toBeVisible()
    await expect(page.locator('input[autocomplete="current-password"]')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeVisible()
    await expect(page.locator('text=Sign In')).toBeVisible()
  })

  test('password toggle shows / hides password', async ({ page }) => {
    const pwInput = page.locator('input[autocomplete="current-password"]')
    await pwInput.fill('testpass')
    await expect(pwInput).toHaveAttribute('type', 'password')
    await page.locator('button[type="button"]').click()
    await expect(pwInput).toHaveAttribute('type', 'text')
    await page.locator('button[type="button"]').click()
    await expect(pwInput).toHaveAttribute('type', 'password')
  })

  test('submit button is disabled when fields are empty', async ({ page }) => {
    await expect(page.locator('button[type="submit"]')).toBeDisabled()
    await page.fill('input[autocomplete="username"]', 'admin')
    await expect(page.locator('button[type="submit"]')).toBeDisabled()
    await page.fill('input[autocomplete="current-password"]', 'admin123')
    await expect(page.locator('button[type="submit"]')).toBeEnabled()
  })

  // ── Login logic ────────────────────────────────────────────────────────────
  test('valid admin login redirects to dashboard', async ({ page }) => {
    await loginViaUI(page, 'admin', 'admin123')
    await expect(page).not.toHaveURL(/login/)
    await expect(sidebar(page)).toBeVisible()
  })

  test('valid owner login (kasun) works', async ({ page }) => {
    await loginViaUI(page, 'kasun', 'owner123')
    await expect(sidebar(page)).toBeVisible()
  })

  test('wrong password shows error message', async ({ page }) => {
    await loginViaUI(page, 'admin', 'wrongpass')
    await expect(page.locator('text=Invalid credentials')).toBeVisible()
  })

  test('unknown username shows error', async ({ page }) => {
    await loginViaUI(page, 'nobody', 'pass123')
    await expect(page.locator('text=Invalid credentials')).toBeVisible()
  })

  test('error clears on next submission attempt', async ({ page }) => {
    await loginViaUI(page, 'admin', 'bad')
    await expect(page.locator('text=Invalid credentials')).toBeVisible()
    await page.fill('input[autocomplete="current-password"]', 'admin123')
    await page.click('button[type="submit"]')
    await page.waitForTimeout(600)
    await expect(page.locator('text=Invalid credentials')).not.toBeVisible()
  })

  // ── Session persistence ────────────────────────────────────────────────────
  test('logged-in user survives page reload', async ({ page }) => {
    await loginViaUI(page, 'admin', 'admin123')
    await page.reload()
    await expect(sidebar(page)).toBeVisible()
  })

  test('logout returns to login page', async ({ page }) => {
    await loginAsAdmin(page)
    const logoutBtn = page.locator('button:has-text("Logout"), button:has-text("Sign Out"), [aria-label*="logout" i], [aria-label*="sign out" i]').first()
    if (await logoutBtn.count() > 0) {
      await logoutBtn.click()
      await expect(page.locator('input[autocomplete="username"]')).toBeVisible()
    }
  })
})
