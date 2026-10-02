import { afterEach, vi } from 'vitest'

// Mock localStorage for Zustand persist
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem:   (k: string) => store[k] ?? null,
    setItem:   (k: string, v: string) => { store[k] = v },
    removeItem:(k: string) => { delete store[k] },
    clear:     () => { store = {} },
  }
})()

Object.defineProperty(window, 'localStorage', { value: localStorageMock })

afterEach(() => {
  localStorageMock.clear()
  vi.clearAllMocks()
})
