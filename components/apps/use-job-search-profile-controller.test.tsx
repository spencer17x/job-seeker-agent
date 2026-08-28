import { act, renderHook, waitFor } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import en from '@/messages/en.json'
import { createDomainStore } from '@/lib/agent/domain-store'
import { DEFAULT_JOB_AGENT_PREFERENCES } from '@/lib/jobs/job-agent-policy'
import { createResumeDraft, normalizeResumeData } from '@/lib/resume-model'
import { useJobSearchProfileController } from './use-job-search-profile-controller'

const now = '2026-08-01T08:00:00.000Z'
const draft = createResumeDraft(normalizeResumeData({
  profile: { name: 'Ada Candidate', title: 'Platform Engineer', summary: [], tags: [], links: [] },
  skills: [{ category: 'Engineering', items: ['TypeScript'] }],
  experiences: [], projects: [], education: [], certifications: [], awards: [], languages: [], openSource: [],
  metadata: { source: 'paste', locale: 'en', updatedAt: now }
}), { id: 'draft-1', source: 'paste', now })

const wrapper = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="en" messages={en}>{children}</NextIntlClientProvider>
)

describe('useJobSearchProfileController', () => {
  it('seeds a trusted resume and persists normalized search configuration', async () => {
    const store = createDomainStore({
      databaseName: `search-profile-controller-${crypto.randomUUID()}`,
      indexedDB: new IDBFactory()
    })
    const reload = vi.fn(async () => undefined)
    const setNotice = vi.fn()
    const { result } = renderHook(() => useJobSearchProfileController({
      store,
      profiles: [],
      activeDraft: draft,
      trustedDraft: true,
      loaded: true,
      preferences: DEFAULT_JOB_AGENT_PREFERENCES,
      setPreferences: vi.fn(),
      reload,
      setError: vi.fn(),
      setNotice
    }), { wrapper })

    await waitFor(() => expect(result.current.profileName).toBe('Platform Engineer search'))
    expect(result.current.titles).toContain('Platform Engineer')

    act(() => {
      result.current.setLocations('Shanghai, Remote, Shanghai')
      result.current.setRequiredTerms('TypeScript，Node.js')
    })
    let saved = null
    await act(async () => { saved = await result.current.saveProfile() })

    expect(saved).toMatchObject({
      locations: ['Shanghai', 'Remote'],
      requiredTerms: ['TypeScript', 'Node.js']
    })
    expect(await store.list('jobSearchProfiles')).toHaveLength(1)
    expect(reload).toHaveBeenCalledOnce()
    expect(setNotice).toHaveBeenCalledWith('Search profile saved and current jobs rescored.')
    await store.close()
  })
})
