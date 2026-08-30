'use client'

import { Monitor, Moon, Sun } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { readMigratedStorageValue } from '@/lib/brand-migration'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode
} from 'react'

export type ThemeMode = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

type ThemePreference = {
  mode: ThemeMode
  resolvedTheme: ResolvedTheme
  setMode(mode: ThemeMode): void
}

const STORAGE_KEY = 'job-seeker-agent-theme'
const LEGACY_STORAGE_KEY = 'resume-os-theme'
const CHANGE_EVENT = 'job-seeker-agent-theme-change'
const MEDIA_QUERY = '(prefers-color-scheme: dark)'
const MODES: readonly ThemeMode[] = ['system', 'light', 'dark']
const icons = { system: Monitor, light: Sun, dark: Moon }
const ThemePreferenceContext = createContext<ThemePreference | null>(null)
let memoryMode: ThemeMode = 'light'

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark'
}

function readMode(): ThemeMode {
  try {
    const value = readMigratedStorageValue(window.localStorage, STORAGE_KEY, LEGACY_STORAGE_KEY)
    memoryMode = isThemeMode(value) ? value : 'light'
    return memoryMode
  } catch {
    return memoryMode
  }
}

function subscribeMode(onStoreChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === LEGACY_STORAGE_KEY) onStoreChange()
  }
  const onChange = (event: Event) => {
    const mode = (event as CustomEvent<unknown>).detail
    if (!isThemeMode(mode)) return
    memoryMode = mode
    try {
      window.localStorage.setItem(STORAGE_KEY, mode)
    } catch {
      // The in-memory event still updates this session when storage is restricted.
    }
    onStoreChange()
  }

  window.addEventListener('storage', onStorage)
  window.addEventListener(CHANGE_EVENT, onChange)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(CHANGE_EVENT, onChange)
  }
}

function subscribeSystemTheme(onStoreChange: () => void) {
  const media = window.matchMedia?.(MEDIA_QUERY)
  if (!media) return () => {}
  const onChange = () => {
    if (readMode() === 'system') onStoreChange()
  }

  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }
  media.addListener?.(onChange)
  return () => media.removeListener?.(onChange)
}

function readSystemDark() {
  return window.matchMedia?.(MEDIA_QUERY).matches ?? false
}

export function ThemePreferenceProvider({ children }: { children: ReactNode }) {
  const mode = useSyncExternalStore<ThemeMode>(subscribeMode, readMode, () => 'light')
  const systemDark = useSyncExternalStore<boolean>(subscribeSystemTheme, readSystemDark, () => true)
  const resolvedTheme: ResolvedTheme = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.dataset.themeMode = mode
  }, [mode, resolvedTheme])

  const setMode = useCallback((nextMode: ThemeMode) => {
    memoryMode = nextMode
    try {
      window.localStorage.setItem(STORAGE_KEY, nextMode)
    } catch {
      // Keep the preference usable for this session.
    }
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: nextMode }))
  }, [])

  const value = useMemo(() => ({ mode, resolvedTheme, setMode }), [mode, resolvedTheme, setMode])
  return <ThemePreferenceContext.Provider value={value}>{children}</ThemePreferenceContext.Provider>
}

export function useThemePreference() {
  const value = useContext(ThemePreferenceContext)
  if (!value) throw new Error('useThemePreference must be used within ThemePreferenceProvider')
  return value
}

export function ThemeModeControl({ compact = false }: { compact?: boolean } = {}) {
  const { mode, setMode } = useThemePreference()
  const t = useTranslations('controls')
  const refs = useRef<Partial<Record<ThemeMode, HTMLButtonElement>>>({})

  function selectFromKeyboard(event: KeyboardEvent<HTMLButtonElement>, current: ThemeMode) {
    const index = MODES.indexOf(current)
    let next: ThemeMode | undefined
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = MODES[(index + 1) % MODES.length]
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = MODES[(index - 1 + MODES.length) % MODES.length]
    if (event.key === 'Home') next = MODES[0]
    if (event.key === 'End') next = MODES[MODES.length - 1]
    if (!next) return
    event.preventDefault()
    setMode(next)
    refs.current[next]?.focus()
  }

  return <div className={`theme-mode-control${compact ? ' theme-mode-control--compact' : ''}`} role={compact ? 'group' : 'radiogroup'} aria-label={t('themeLabel')}>
    {MODES.map((option) => {
      const Icon = icons[option]
      const label = t(`theme${option[0].toUpperCase()}${option.slice(1)}`)
      return <button
        key={option}
        ref={(element) => { refs.current[option] = element ?? undefined }}
        type="button"
        role={compact ? undefined : 'radio'}
        aria-checked={compact ? undefined : mode === option}
        aria-pressed={compact ? mode === option : undefined}
        aria-label={label}
        title={label}
        tabIndex={compact || mode === option ? 0 : -1}
        onClick={() => setMode(option)}
        onKeyDown={(event) => selectFromKeyboard(event, option)}
      >
        <Icon size={compact ? 14 : 16} aria-hidden="true" />
        {compact ? null : <span>{label}</span>}
      </button>
    })}
  </div>
}
