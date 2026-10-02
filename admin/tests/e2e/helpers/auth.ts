import { Page } from '@playwright/test'

// Must match { name: 'emrac-auth-v2' } in useAuthStore.ts
const AUTH_STORE_KEY = 'emrac-auth-v2'

const ADMIN_AUTH = {
  state: {
    currentUser: {
      id: 'u_admin', username: 'admin', password: 'admin123',
      name: 'EMRAC Admin', role: 'admin',
    },
    permissions: {},
  },
  version: 0,
}

/**
 * Wait for the app to finish its boot loading sequence.
 * The loading screen stays visible for at least 900 ms (minDone timer) plus
 * however long the Supabase fetch takes (capped at 12s by loadAll timeout).
 * The sidebar nav link is a reliable "content ready" signal.
 */
export async function waitForAppLoad(page: Page) {
  await page.waitForSelector('a[href="/vehicles"]', { timeout: 20_000 })
}

/**
 * Navigate to a path and wait for the app to fully load (loading screen gone).
 * Use this instead of page.goto(path) + waitForTimeout() in every test.
 */
export async function gotoAndLoad(page: Page, path: string) {
  await page.goto(path)
  await waitForAppLoad(page)
}

/** Inject admin auth via localStorage and reload — skips login UI */
export async function loginAsAdmin(page: Page) {
  await page.goto('/')
  await page.evaluate(
    ({ key, auth }) => { localStorage.setItem(key, JSON.stringify(auth)) },
    { key: AUTH_STORE_KEY, auth: ADMIN_AUTH },
  )
  await page.reload()
  await page.waitForURL('/')
}

/** Wipe all app state then inject fresh admin auth */
export async function freshSession(page: Page) {
  await page.goto('/')
  await page.evaluate(
    ({ key, auth }) => {
      // Preserve insurance-reminder rate-limit keys so tests don't
      // reset the 7-day gate and trigger real SMS sends on every run.
      const preserved: [string, string][] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!
        if (k.startsWith('EMRAC_ins_reminder_')) preserved.push([k, localStorage.getItem(k)!])
      }
      localStorage.clear()
      for (const [k, v] of preserved) localStorage.setItem(k, v)
      localStorage.setItem(key, JSON.stringify(auth))
    },
    { key: AUTH_STORE_KEY, auth: ADMIN_AUTH },
  )
  await page.reload()
  await page.waitForURL('/')
  await waitForAppLoad(page)
}

/** Log in through the actual login UI (used in auth tests) */
export async function loginViaUI(page: Page, username: string, password: string) {
  await page.goto('/')
  await page.evaluate(
    (key) => { localStorage.removeItem(key) },
    AUTH_STORE_KEY,
  )
  await page.reload()
  await page.waitForSelector('input[autocomplete="username"]')
  await page.fill('input[autocomplete="username"]', username)
  await page.fill('input[autocomplete="current-password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForTimeout(600)          // login has 400 ms delay
}
