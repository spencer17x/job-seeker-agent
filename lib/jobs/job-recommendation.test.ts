import { describe, expect, it } from 'vitest'
import type { JobPosting, JobSearchProfile } from './job-domain'
import { JOB_RELEVANCE_RUBRIC_VERSION, scoreJobRecommendation } from './job-recommendation'

const now = '2026-08-10T00:00:00.000Z'
const posting: JobPosting = {
  id: 'posting-1', sourceId: 'source-1', externalId: '1',
  canonicalUrl: 'https://jobs.example/1', applyUrl: 'https://jobs.example/1/apply',
  title: 'Staff Frontend Engineer', company: 'Example',
  description: 'Lead TypeScript design systems for a product platform.', locale: 'en',
  location: 'Remote', workplaceType: 'remote', employmentType: 'full-time',
  firstSeenAt: '2026-08-08T00:00:00.000Z', lastCheckedAt: now,
  status: 'open', contentHash: 'hash-1'
}
const profile: JobSearchProfile = {
  id: 'profile-1', name: 'Staff frontend', titles: ['Staff Frontend Engineer'],
  adjacentTitles: ['Design Systems Engineer'], locations: ['Remote'], excludedLocations: [],
  workplaceTypes: ['remote'], employmentTypes: ['full-time'], requiredTerms: ['TypeScript'],
  preferredTerms: ['design systems'], excludedTerms: ['gambling'], maximumAgeDays: 30,
  createdAt: now, updatedAt: now
}
const facts = [
  { id: 'fact-1', tags: ['TypeScript', 'design systems'], updatedAt: now },
  { id: 'fact-2', tags: ['platform'], updatedAt: now }
]

describe('scoreJobRecommendation', () => {
  it('keeps the input fingerprint stable across operational refresh timestamps', () => {
    const first = scoreJobRecommendation({ posting, profile, sourceDraftId: 'draft-1', facts, now })
    const refreshed = scoreJobRecommendation({
      posting: { ...posting, lastCheckedAt: '2026-08-20T10:00:00.000Z' },
      profile: { ...profile, updatedAt: '2026-08-20T10:00:00.000Z' },
      sourceDraftId: 'draft-1',
      facts,
      now
    })
    expect(refreshed.inputFingerprint).toBe(first.inputFingerprint)
  })
  it('produces stable versioned contributions and evidence references', () => {
    const first = scoreJobRecommendation({ posting, profile, sourceDraftId: 'draft-1', facts, now })
    const second = scoreJobRecommendation({ posting, profile, sourceDraftId: 'draft-1', facts: [...facts].reverse(), now })
    expect(first).toEqual(second)
    expect(first).toMatchObject({
      eligibility: 'eligible', rubricVersion: JOB_RELEVANCE_RUBRIC_VERSION,
      preliminaryScore: expect.any(Number)
    })
    expect(first.reasons.find((reason) => reason.code === 'career-fact-tag-overlap')?.evidenceRefs)
      .toEqual(['fact-1', 'fact-2'])
  })

  it('applies hard exclusions before scoring', () => {
    const result = scoreJobRecommendation({
      posting: { ...posting, description: `${posting.description} Gambling products.` },
      profile, sourceDraftId: 'draft-1', facts, now
    })
    expect(result.eligibility).toBe('excluded')
    expect(result.preliminaryScore).toBeUndefined()
    expect(result.reasons[0].code).toBe('excluded-term')
  })

  it('marks missing structured hard-preference fields unknown rather than matched', () => {
    const result = scoreJobRecommendation({
      posting: { ...posting, location: undefined, workplaceType: undefined },
      profile, sourceDraftId: 'draft-1', facts, now
    })
    expect(result.eligibility).toBe('unknown')
    expect(result.preliminaryScore).toBeTypeOf('number')
  })

  it('treats an optional target company as a soft preference rather than a hard gate', () => {
    const preferred = scoreJobRecommendation({
      posting,
      profile: { ...profile, preferredCompanies: ['Example'] },
      sourceDraftId: 'draft-1',
      facts,
      now
    })
    const other = scoreJobRecommendation({
      posting: { ...posting, company: 'Other' },
      profile: { ...profile, preferredCompanies: ['Example'] },
      sourceDraftId: 'draft-1',
      facts,
      now
    })
    expect(preferred.eligibility).toBe('eligible')
    expect(other.eligibility).toBe('eligible')
    expect(preferred.preliminaryScore).toBeGreaterThan(other.preliminaryScore ?? 0)
  })

  it('rejects old and closed postings deterministically', () => {
    expect(scoreJobRecommendation({
      posting: { ...posting, status: 'closed' }, profile, sourceDraftId: 'draft-1', facts, now
    }).reasons[0].code).toBe('posting-not-open')
    expect(scoreJobRecommendation({
      posting: { ...posting, firstSeenAt: '2026-01-01T00:00:00.000Z' },
      profile, sourceDraftId: 'draft-1', facts, now
    }).reasons[0].code).toBe('posting-too-old')
  })

  it('enforces blocked companies and known salary boundaries', () => {
    expect(scoreJobRecommendation({
      posting,
      profile: { ...profile, blockedCompanies: ['Example'] },
      sourceDraftId: 'draft-1', facts, now
    }).reasons[0].code).toBe('blocked-company')
    expect(scoreJobRecommendation({
      posting: { ...posting, compensation: { minimum: 15_000, maximum: 20_000, currency: 'CNY', period: 'month' } },
      profile: { ...profile, minimumMonthlySalary: 25_000 },
      sourceDraftId: 'draft-1', facts, now
    }).reasons[0].code).toBe('salary-below-minimum')
  })
})
