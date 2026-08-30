import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { ThemeScript } from './theme-script'

afterEach(() => {
  vi.restoreAllMocks()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-theme-mode')
})

it('applies the readable light theme when local storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('restricted') })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false })
  })
  const container = document.createElement('div')
  container.innerHTML = renderToStaticMarkup(<ThemeScript />)
  const source = container.querySelector('script')?.textContent

  expect(source).toBeTruthy()
  expect(() => Function(source!)()).not.toThrow()
  expect(document.documentElement.dataset.themeMode).toBe('light')
  expect(document.documentElement.dataset.theme).toBe('light')
})
