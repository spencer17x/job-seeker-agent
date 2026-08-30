import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemePreferenceProvider, useThemePreference } from './theme-preference'

type MediaListener = (event: MediaQueryListEvent) => void

const media = {
  matches: false,
  listeners: new Set<MediaListener>()
}

function Probe() {
  const { mode, resolvedTheme, setMode } = useThemePreference()
  return <div>
    <output data-testid="mode">{mode}</output>
    <output data-testid="resolved">{resolvedTheme}</output>
    <button type="button" onClick={() => setMode('system')}>System</button>
    <button type="button" onClick={() => setMode('light')}>Light</button>
    <button type="button" onClick={() => setMode('dark')}>Dark</button>
  </div>
}

function setSystemDark(matches: boolean) {
  media.matches = matches
  for (const listener of media.listeners) listener({ matches } as MediaQueryListEvent)
}

beforeEach(() => {
  window.localStorage.clear()
  media.matches = false
  media.listeners.clear()
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({
      get matches() { return media.matches },
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addEventListener: (_type: 'change', listener: MediaListener) => media.listeners.add(listener),
      removeEventListener: (_type: 'change', listener: MediaListener) => media.listeners.delete(listener),
      addListener: (listener: MediaListener) => media.listeners.add(listener),
      removeListener: (listener: MediaListener) => media.listeners.delete(listener),
      dispatchEvent: () => true
    })
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ThemePreferenceProvider', () => {
  it('persists explicit light and dark modes and applies them to the document', async () => {
    render(<ThemePreferenceProvider><Probe /></ThemePreferenceProvider>)

    fireEvent.click(screen.getByRole('button', { name: 'Light' }))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'))
    expect(window.localStorage.getItem('job-seeker-agent-theme')).toBe('light')
    expect(screen.getByTestId('resolved')).toHaveTextContent('light')

    fireEvent.click(screen.getByRole('button', { name: 'Dark' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem('job-seeker-agent-theme')).toBe('dark')
  })

  it('reacts to OS color scheme changes only while system mode is selected', async () => {
    render(<ThemePreferenceProvider><Probe /></ThemePreferenceProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'System' }))
    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('system'))

    act(() => setSystemDark(true))
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')

    fireEvent.click(screen.getByRole('button', { name: 'Light' }))
    act(() => setSystemDark(false))
    act(() => setSystemDark(true))
    expect(screen.getByTestId('resolved')).toHaveTextContent('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('accepts same-tab preference events without hydration-only state', async () => {
    render(<ThemePreferenceProvider><Probe /></ThemePreferenceProvider>)
    act(() => window.dispatchEvent(new CustomEvent('job-seeker-agent-theme-change', { detail: 'dark' })))
    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('dark'))
    expect(document.documentElement.dataset.themeMode).toBe('dark')
  })

  it('keeps theme changes in memory when local storage is restricted', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('restricted') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('restricted') })
    render(<ThemePreferenceProvider><Probe /></ThemePreferenceProvider>)

    fireEvent.click(screen.getByRole('button', { name: 'Light' }))

    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('light'))
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('hydrates from a stable system snapshot before applying the stored browser theme', async () => {
    vi.stubGlobal('window', undefined)
    const markup = renderToString(<ThemePreferenceProvider><Probe /></ThemePreferenceProvider>)
    vi.unstubAllGlobals()
    window.localStorage.setItem('job-seeker-agent-theme', 'dark')
    const container = document.createElement('div')
    container.innerHTML = markup
    document.body.append(container)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    let root: ReturnType<typeof hydrateRoot>

    await act(async () => {
      root = hydrateRoot(container, <ThemePreferenceProvider><Probe /></ThemePreferenceProvider>)
      await Promise.resolve()
    })

    await waitFor(() => expect(container.querySelector('[data-testid="mode"]')).toHaveTextContent('dark'))
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('Hydration'))
    await act(async () => root!.unmount())
    container.remove()
    consoleError.mockRestore()
  })
})
