import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createDomainStore } from '@/lib/agent/domain-store'
import type { JobPosting, JobSearchProfile, JobSource } from './job-domain'
import { scoreCurrentJobPostings } from './job-scoring'

const now = '2026-08-01T08:00:00.000Z'
const source: JobSource = {
  id: 'source-1', kind: 'manual', label: 'BOSS', enabled: true, createdAt: now, updatedAt: now
}
const posting: JobPosting = {
  id: 'posting-1', sourceId: source.id, externalId: 'job-1',
  canonicalUrl: 'https://www.zhipin.com/job_detail/job-1.html',
  applyUrl: 'https://www.zhipin.com/job_detail/job-1.html',
  title: 'Platform Engineer', company: 'Example Co',
  description: 'Build TypeScript platforms.', locale: 'en',
  firstSeenAt: now, lastCheckedAt: now, status: 'open', contentHash: 'hash:posting-1'
}
const profile: JobSearchProfile = {
  id: 'profile-1', name: 'Platform roles', titles: ['Platform Engineer'], adjacentTitles: [],
  locations: [], excludedLocations: [], workplaceTypes: [], employmentTypes: [],
  requiredTerms: [], preferredTerms: ['TypeScript'], excludedTerms: [], maximumAgeDays: 30,
  createdAt: now, updatedAt: now
}

describe('scoreCurrentJobPostings', () => {
  it('rescoring keeps the user decision while updating deterministic results', async () => {
    const store = createDomainStore({
      databaseName: `job-scoring-${crypto.randomUUID()}`,
      indexedDB: new IDBFactory()
    })
    await store.put('jobSources', source)
    await store.put('jobSearchProfiles', profile)
    await store.put('jobPostings', posting)

    await scoreCurrentJobPostings({ store, profile, sourceDraftId: 'draft-1', now })
    const [first] = await store.list('jobRecommendations')
    expect(first).toMatchObject({ postingId: posting.id, searchProfileId: profile.id })

    await store.put('jobRecommendations', { ...first, decision: 'ignored' })
    await scoreCurrentJobPostings({
      store,
      profile: { ...profile, preferredTerms: ['Rust'], updatedAt: '2026-08-02T08:00:00.000Z' },
      sourceDraftId: 'draft-1',
      now: '2026-08-02T08:00:00.000Z'
    })

    expect((await store.list('jobRecommendations'))[0]).toMatchObject({
      decision: 'ignored',
      createdAt: first.createdAt,
      updatedAt: '2026-08-02T08:00:00.000Z'
    })
    await store.close()
  })
})
