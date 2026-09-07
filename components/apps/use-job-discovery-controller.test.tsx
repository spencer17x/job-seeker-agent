import { act, renderHook, waitFor } from '@testing-library/react'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '@/messages/en.json'
import { createDomainStore } from '@/lib/agent/domain-store'
import { createStableJobDomainId, type JobPosting, type JobSearchProfile } from '@/lib/jobs/job-domain'
import { scoreJobRecommendation } from '@/lib/jobs/job-recommendation'
import * as browserAgentProtocol from '@/lib/jobs/browser-agent-protocol'
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

afterEach(() => { window.localStorage.clear(); vi.restoreAllMocks() })

const posting: JobPosting = {
  id: 'posting-1', sourceId: 'source-1', externalId: '1',
  canonicalUrl: 'https://www.zhipin.com/job_detail/example.html',
  applyUrl: 'https://www.zhipin.com/job_detail/example.html',
  title: 'Platform Engineer', company: 'Example Systems', description: 'Build TypeScript systems.',
  locale: 'en', status: 'open', contentHash: 'hash:example', firstSeenAt: now, lastCheckedAt: now
}

async function decisionFixture(browserAgentAvailable = false) {
  const store = createDomainStore({ databaseName: `decision-${crypto.randomUUID()}`, indexedDB: new IDBFactory() })
  const recommendation = scoreJobRecommendation({ posting, profile, sourceDraftId: draft.id, facts: [], now })
  await store.put('jobSources', { id: posting.sourceId, kind: 'greenhouse', label: 'Example', sourceKey: 'example', enabled: true, createdAt: now, updatedAt: now })
  await store.put('jobPostings', posting)
  await store.put('jobSearchProfiles', profile)
  await store.put('jobRecommendations', recommendation)
  const hook = renderHook(() => useJobDiscoveryController({
    store, activeDraft: draft, trustedDraft: true, browserAgentAvailable,
    sources: [], profiles: [profile], postings: [posting], recommendations: [recommendation], applications: [],
    preferences: DEFAULT_JOB_AGENT_PREFERENCES, selectedPlatforms: ['boss'], titles: 'Platform Engineer',
    saveProfile: vi.fn(async () => profile), reload: vi.fn(async () => undefined), navigate: vi.fn(), setError: vi.fn(), setNotice: vi.fn()
  }), { wrapper })
  return { store, recommendation, ...hook }
}

describe('useJobDiscoveryController', () => {
  it('ignores a late browser fallback response after discovery is canceled', async () => {
    vi.spyOn(browserAgentProtocol, 'searchBossBrowserJobs').mockResolvedValue({ requestId: 'search', ok: true, jobs: [] })
    let finishCollection: (value: browserAgentProtocol.BrowserAgentResponse) => void = () => {}
    const collect = vi.spyOn(browserAgentProtocol, 'collectBossBrowserJobs').mockImplementation(() => new Promise((resolve) => { finishCollection = resolve }))
    const { store, result, unmount } = await decisionFixture(true)
    try {
      let search: Promise<void> = Promise.resolve()
      act(() => { search = result.current.searchMarket() })
      await waitFor(() => expect(collect).toHaveBeenCalledOnce())
      act(() => result.current.cancel())
      await act(async () => {
        finishCollection({ requestId: 'collect', ok: true, jobs: [{
          externalId: 'late-job', url: 'https://www.zhipin.com/job_detail/late-job.html',
          title: 'Platform Engineer', company: 'Late Example', summary: 'Build TypeScript platforms.'
        }] })
        await search
      })
      expect(await store.list('jobPostings')).toEqual([posting])
      expect(await store.list('applicationRecords')).toEqual([])
      expect(result.current.busySourceId).toBe('')
    } finally {
      unmount()
      await store.close()
    }
  })

  it('preserves an already submitted application when saving from a stale view', async () => {
    const { store, recommendation, result, unmount } = await decisionFixture()
    try {
      const application = {
        id: createStableJobDomainId('application', [posting.id, draft.id]), postingId: posting.id, sourceDraftId: draft.id,
        status: 'applied' as const, submittedAt: now, notes: 'Submitted through the employer site.', createdAt: now, updatedAt: now
      }
      await store.put('applicationRecords', application)
      await act(() => result.current.decide(recommendation, 'saved'))
      expect(await store.get('applicationRecords', application.id)).toEqual(application)
      expect((await store.get('jobRecommendations', recommendation.id))?.decision).toBe('saved')
    } finally {
      unmount()
      await store.close()
    }
  })

  it('rolls back the recommendation if the related application cannot be written', async () => {
    const { store, recommendation, result, unmount } = await decisionFixture()
    const originalPut = IDBObjectStore.prototype.put
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === 'applicationRecords') throw new DOMException('Storage full', 'QuotaExceededError')
      return originalPut.call(this, value, key)
    })
    try {
      await act(async () => { await expect(result.current.decide(recommendation, 'saved')).rejects.toThrow() })
      expect((await store.get('jobRecommendations', recommendation.id))?.decision).toBe('new')
      expect(await store.list('applicationRecords')).toEqual([])
    } finally {
      put.mockRestore()
      unmount()
      await store.close()
    }
  })

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
