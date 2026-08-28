import { act, renderHook } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '@/messages/en.json'
import { createDomainStore } from '@/lib/agent/domain-store'
import type { JobSearchProfile } from '@/lib/jobs/job-domain'
import { DEFAULT_JOB_AGENT_PREFERENCES } from '@/lib/jobs/job-agent-policy'
import { createResumeDraft, normalizeResumeData } from '@/lib/resume-model'
import { useJobDiscoveryController } from './use-job-discovery-controller'

const now = '2026-08-01T08:00:00.000Z'
const draft = createResumeDraft(normalizeResumeData({
  profile: { name: 'Ada Candidate', title: 'Platform Engineer', summary: [], tags: [], links: [] },
  skills: [{ category: 'Engineering', items: ['TypeScript'] }],
  experiences: [], projects: [], education: [], certifications: [], awards: [], languages: [], openSource: [],
  metadata: { source: 'paste', locale: 'en', updatedAt: now }
}), { id: 'draft-1', source: 'paste', now })
const profile: JobSearchProfile = {
  id: 'profile-1', name: 'Platform roles', platforms: ['boss'], titles: ['Platform Engineer'],
  adjacentTitles: [], locations: [], excludedLocations: [], workplaceTypes: [], employmentTypes: [],
  requiredTerms: [], preferredTerms: ['TypeScript'], excludedTerms: [], maximumAgeDays: 30,
  createdAt: now, updatedAt: now
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="en" messages={en}>{children}</NextIntlClientProvider>
)

afterEach(() => window.localStorage.clear())

describe('useJobDiscoveryController', () => {
  it('parses a clipboard job and hands an imported posting to Target Job', async () => {
    const store = createDomainStore({
      databaseName: `discovery-controller-${crypto.randomUUID()}`,
      indexedDB: new IDBFactory()
    })
    await store.put('jobSearchProfiles', profile)
    const navigate = vi.fn()
    const reload = vi.fn(async () => undefined)
    const setNotice = vi.fn()
    const { result } = renderHook(() => useJobDiscoveryController({
      store,
      activeDraft: draft,
      trustedDraft: true,
      browserAgentAvailable: false,
      sources: [], profiles: [profile], postings: [], recommendations: [], applications: [],
      preferences: DEFAULT_JOB_AGENT_PREFERENCES,
      selectedPlatforms: ['boss'],
      titles: 'Platform Engineer',
      saveProfile: vi.fn(async () => profile),
      reload,
      navigate,
      setError: vi.fn(),
      setNotice
    }), { wrapper })

    act(() => result.current.setClipboardJobText(`
Job title: Platform Engineer
Company: Example Co
Location: Shanghai
URL: https://www.zhipin.com/job_detail/example.html
Job description: Build reliable TypeScript systems.
    `))
    act(() => result.current.prefillFromClipboard())

    expect(result.current.importTitle).toBe('Platform Engineer')
    expect(result.current.importCompany).toBe('Example Co')
    expect(result.current.importPlatform).toBe('boss')
    expect(setNotice).toHaveBeenCalledWith('The pasted text was parsed locally. Review the prefilled fields before importing.')

    await act(() => result.current.importAndAnalyze())

    expect(await store.list('jobPostings')).toHaveLength(1)
    expect(await store.list('jobRecommendations')).toHaveLength(1)
    expect(navigate).toHaveBeenCalledWith('/jobs/target-job')
    expect(result.current.importTitle).toBe('')
    await store.close()
  })
})
