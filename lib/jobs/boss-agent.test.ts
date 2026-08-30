import { describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { createDomainStore } from '@/lib/agent/domain-store'
import { buildJDRequirementAnalysis } from '@/lib/agent/jd-report'
import { normalizeResumeData } from '@/lib/resume-model'
import type { JobPosting, JobRecommendation } from './job-domain'
import { analyzeBossCandidateQueue, loadBossCandidateAnalysis, persistBossCandidateAnalysis, planBossCandidates, prepareBossCandidateResumeVariants, queueBossCandidates, upsertBossBrowserJobs } from './boss-agent'

const now = '2026-08-19T08:00:00.000Z'

function posting(id: string, url = `https://www.zhipin.com/job_detail/${id}.html`): JobPosting {
  return {
    id, sourceId: 'manual-boss', externalId: id, canonicalUrl: url, applyUrl: url,
    title: 'Platform Engineer', company: 'Example', description: 'Build TypeScript platforms.',
    locale: 'en', firstSeenAt: now, lastCheckedAt: now, status: 'open', contentHash: `hash:${id}`
  }
}

function recommendation(postingId: string, score: number, decision?: JobRecommendation['decision']): JobRecommendation {
  return {
    id: `recommendation-${postingId}`, postingId, searchProfileId: 'profile-1', sourceDraftId: 'draft-1',
    rubricVersion: 'v1', inputFingerprint: `fingerprint:${postingId}`, eligibility: 'eligible',
    preliminaryScore: score, decision, reasons: [], createdAt: now, updatedAt: now
  }
}

describe('BOSS job agent candidate queue', () => {
  it('queues score-qualified unknown candidates for deeper analysis while still rejecting exclusions', () => {
    const role = posting('unknown-1')
    const scored = recommendation(role.id, 80)
    expect(planBossCandidates({
      postings: [role],
      recommendations: [{ ...scored, eligibility: 'unknown' }],
      sourceDraftId: 'draft-1'
    })).toHaveLength(1)
    expect(planBossCandidates({
      postings: [role],
      recommendations: [{ ...scored, eligibility: 'excluded', preliminaryScore: undefined }],
      sourceDraftId: 'draft-1'
    })).toHaveLength(0)
  })
  it('selects only open, eligible BOSS roles above the threshold', () => {
    const boss = posting('boss-high')
    const low = posting('boss-low')
    const other = posting('other', 'https://www.liepin.com/job/other.shtml')
    const ignored = posting('boss-ignored')
    expect(planBossCandidates({
      postings: [boss, low, other, ignored],
      recommendations: [
        recommendation(boss.id, 91), recommendation(low.id, 69),
        recommendation(other.id, 99), recommendation(ignored.id, 95, 'ignored')
      ],
      sourceDraftId: 'draft-1'
    }).map((candidate) => candidate.posting.id)).toEqual(['boss-high'])
  })

  it('queues each candidate once and marks its recommendation saved', async () => {
    const store = createDomainStore({ databaseName: `boss-agent-${crypto.randomUUID()}`, indexedDB: new IDBFactory() })
    const role = posting('boss-role')
    await store.put('jobSources', {
      id: 'manual-boss', kind: 'manual', label: 'BOSS', enabled: true, createdAt: now, updatedAt: now
    })
    await store.put('jobSearchProfiles', {
      id: 'profile-1', name: 'BOSS roles', platforms: ['boss'], titles: ['Platform Engineer'],
      adjacentTitles: [], locations: [], excludedLocations: [], workplaceTypes: [], employmentTypes: [],
      requiredTerms: [], preferredTerms: [], excludedTerms: [], maximumAgeDays: 30,
      createdAt: now, updatedAt: now
    })
    await store.put('jobPostings', role)
    await store.put('jobRecommendations', recommendation(role.id, 88))

    const first = await queueBossCandidates({ store, sourceDraftId: 'draft-1', now })
    const second = await queueBossCandidates({ store, sourceDraftId: 'draft-1', now })

    expect(first.queued).toHaveLength(1)
    expect(second.queued).toHaveLength(0)
    expect(await store.list('applicationRecords')).toMatchObject([{ postingId: role.id, status: 'saved' }])
    expect(await store.list('jobRecommendations')).toMatchObject([{ decision: 'saved' }])
    await store.close()
  })

  it('stores bounded browser-discovered BOSS cards without arbitrary hosts', async () => {
    const store = createDomainStore({ databaseName: `boss-browser-${crypto.randomUUID()}`, indexedDB: new IDBFactory() })
    const stored = await upsertBossBrowserJobs({
      store,
      now,
      jobs: [{
        externalId: 'abc', url: 'https://www.zhipin.com/job_detail/abc.html',
        title: '平台工程师', company: '示例公司', summary: '负责 TypeScript 平台研发。', location: '杭州'
      }]
    })
    expect(stored).toMatchObject([{ externalId: 'abc', sourceId: 'job-source-boss-browser', locale: 'zh' }])
    const detailed = {
      ...stored[0],
      description: '完整岗位职责：负责 TypeScript Agent 平台开发与稳定性建设。',
      detailFetchedAt: now,
      contentHash: 'hash:detailed'
    }
    await store.put('jobPostings', detailed)
    const refreshed = await upsertBossBrowserJobs({
      store,
      now: '2026-08-20T08:00:00.000Z',
      jobs: [{
        externalId: 'abc', url: 'https://www.zhipin.com/job_detail/abc.html',
        title: '平台工程师', company: '示例公司', summary: '列表摘要', location: '杭州'
      }]
    })
    expect(refreshed[0]).toMatchObject({
      description: detailed.description,
      detailFetchedAt: now
    })
    await expect(upsertBossBrowserJobs({
      store,
      now,
      jobs: [{ externalId: 'evil', url: 'https://evil.example/job', title: 'X', company: 'Y', summary: 'Z' }]
    })).rejects.toThrow()
    await store.close()
  })

  it('persists an independent unconfirmed target-job analysis for a queued role', async () => {
    const store = createDomainStore({ databaseName: `boss-analysis-${crypto.randomUUID()}`, indexedDB: new IDBFactory() })
    const role = posting('boss-analysis')
    await store.put('jobSources', { id: 'manual-boss', kind: 'manual', label: 'BOSS', enabled: true, createdAt: now, updatedAt: now })
    await store.put('jobSearchProfiles', {
      id: 'profile-1', name: 'BOSS roles', platforms: ['boss'], titles: ['Platform Engineer'], adjacentTitles: [],
      locations: [], excludedLocations: [], workplaceTypes: [], employmentTypes: [], requiredTerms: [],
      preferredTerms: [], excludedTerms: [], maximumAgeDays: 30, createdAt: now, updatedAt: now
    })
    await store.put('jobPostings', role)
    await store.put('jobRecommendations', recommendation(role.id, 90))
    const queued = await queueBossCandidates({ store, sourceDraftId: 'draft-1', now })
    const analysis = buildJDRequirementAnalysis({
      report: {
        jobTitle: role.title,
        company: role.company,
        requirements: [{ text: 'TypeScript', category: 'skill', priority: 'must', weight: 5, keywords: ['TypeScript'] }],
        resumeEmphasis: [], interviewPrep: []
      },
      jobDescription: role.description,
      locale: 'en',
      resume: normalizeResumeData({ profile: { name: 'Ada', title: 'Engineer', summary: [], tags: [], links: [] } }),
      timestamp: now
    })
    const application = await persistBossCandidateAnalysis({
      store, applicationId: queued.queued[0].id, analysis, now
    })
    expect(application).toMatchObject({ status: 'analyzing', targetJobId: analysis.targetJob.id })
    expect(await store.list('jobRequirements')).toMatchObject([{ jobId: analysis.targetJob.id, userConfirmed: false }])
    expect(await store.list('optimizationRuns')).toMatchObject([{ stage: 'draft', targetJobId: analysis.targetJob.id }])
    expect(await loadBossCandidateAnalysis({
      store,
      applicationId: application.id,
      resume: normalizeResumeData({ profile: { name: 'Ada', title: 'Engineer', summary: [], tags: [], links: [] } })
    })).toMatchObject({ optimizationRunId: expect.any(String), analysis: { targetJob: { id: analysis.targetJob.id } } })
    const detailedPosting = { ...role, description: 'Build TypeScript platforms and operate Kubernetes production services.', contentHash: 'hash:detailed' }
    await store.put('jobPostings', detailedPosting)
    const detailedAnalysis = buildJDRequirementAnalysis({
      report: {
        jobTitle: role.title,
        company: role.company,
        requirements: [{ text: 'Operate Kubernetes services', category: 'skill', priority: 'must', weight: 6, keywords: ['Kubernetes'] }],
        resumeEmphasis: [], interviewPrep: []
      },
      jobDescription: detailedPosting.description,
      locale: 'en',
      resume: normalizeResumeData({ profile: { name: 'Ada', title: 'Engineer', summary: [], tags: [], links: [] } }),
      timestamp: now,
      targetIdentity: role.id
    })
    const rebased = await persistBossCandidateAnalysis({
      store, applicationId: application.id, analysis: detailedAnalysis, now
    })
    expect(rebased.targetJobId).toBe(detailedAnalysis.targetJob.id)
    expect(await store.list('optimizationRuns')).toMatchObject([{
      stage: 'draft', targetJobId: detailedAnalysis.targetJob.id,
      inputFingerprint: detailedAnalysis.matrix.inputFingerprint
    }])
    await store.close()
  })

  it('prepares multiple queued roles independently through an injected analysis runner', async () => {
    const store = createDomainStore({ databaseName: `boss-batch-${crypto.randomUUID()}`, indexedDB: new IDBFactory() })
    await store.put('jobSources', { id: 'manual-boss', kind: 'manual', label: 'BOSS', enabled: true, createdAt: now, updatedAt: now })
    await store.put('jobSearchProfiles', {
      id: 'profile-1', name: 'BOSS roles', platforms: ['boss'], titles: ['Platform Engineer'], adjacentTitles: [],
      locations: [], excludedLocations: [], workplaceTypes: [], employmentTypes: [], requiredTerms: [],
      preferredTerms: [], excludedTerms: [], maximumAgeDays: 30, createdAt: now, updatedAt: now
    })
    for (const id of ['boss-a', 'boss-b']) {
      const role = posting(id)
      await store.put('jobPostings', role)
      await store.put('jobRecommendations', recommendation(role.id, 90))
    }
    await queueBossCandidates({ store, sourceDraftId: 'draft-1', maximumCandidates: 2, now })
    const resume = normalizeResumeData({ profile: { name: 'Ada', title: 'Engineer', summary: [], tags: [], links: [] } })
    const result = await analyzeBossCandidateQueue({
      store,
      sourceDraftId: 'draft-1',
      maximumCandidates: 2,
      now: () => now,
      runAnalysis: async (role) => buildJDRequirementAnalysis({
        report: {
          jobTitle: role.title, company: role.company,
          requirements: [{ text: `Requirement ${role.id}`, category: 'skill', priority: 'must', weight: 5, keywords: [] }],
          resumeEmphasis: [], interviewPrep: []
        },
        jobDescription: role.description, locale: 'en', resume, timestamp: now, targetIdentity: role.id
      })
    })
    expect(result.prepared).toHaveLength(2)
    expect(new Set(result.prepared.map((application) => application.targetJobId)).size).toBe(2)
    expect(await store.list('jobRequirements')).toHaveLength(2)
    await store.close()
  })

  it('creates an independent job-specific copy without AI rewrites or master mutation', async () => {
    const store = createDomainStore({ databaseName: `boss-managed-variant-${crypto.randomUUID()}`, indexedDB: new IDBFactory() })
    const role = posting('boss-managed')
    await store.put('jobSources', { id: 'manual-boss', kind: 'manual', label: 'BOSS', enabled: true, createdAt: now, updatedAt: now })
    await store.put('jobSearchProfiles', {
      id: 'profile-1', name: 'BOSS roles', platforms: ['boss'], titles: ['Platform Engineer'], adjacentTitles: [],
      locations: [], excludedLocations: [], workplaceTypes: [], employmentTypes: [], requiredTerms: [],
      preferredTerms: [], excludedTerms: [], maximumAgeDays: 30, createdAt: now, updatedAt: now
    })
    await store.put('jobPostings', role)
    await store.put('jobRecommendations', recommendation(role.id, 92))
    const queued = await queueBossCandidates({ store, sourceDraftId: 'draft-1', now })
    const resume = normalizeResumeData({
      profile: { name: 'Ada', title: 'Software Engineer', summary: ['Builds reliable systems.'], tags: ['TypeScript'], links: [] },
      projects: [{ id: 'project-1', name: 'Platform', type: 'Work', tags: [], summary: 'Built a platform.', highlights: [] }]
    }, { source: 'paste', now })
    const original = structuredClone(resume)
    const analysis = buildJDRequirementAnalysis({
      report: {
        jobTitle: role.title,
        company: role.company,
        requirements: [{ text: 'TypeScript platform delivery', category: 'skill', priority: 'must', weight: 5, keywords: ['TypeScript'] }],
        resumeEmphasis: ['Mention TypeScript'],
        interviewPrep: []
      },
      jobDescription: role.description,
      locale: 'en',
      resume,
      timestamp: now,
      targetIdentity: role.id
    })
    await persistBossCandidateAnalysis({ store, applicationId: queued.queued[0].id, analysis, now })

    const prepared = await prepareBossCandidateResumeVariants({
      store,
      sourceDraftId: 'draft-1',
      resume,
      now: () => '2026-08-19T08:05:00.000Z'
    })

    expect(prepared).toHaveLength(1)
    expect(resume).toEqual(original)
    expect(await store.list('resumeVariants')).toMatchObject([{
      sourceDraftId: 'draft-1',
      targetJobId: analysis.targetJob.id,
      data: {
        targetRole: 'Platform Engineer',
        profile: { title: 'Software Engineer', summary: ['Builds reliable systems.'] },
        projects: original.projects
      }
    }])
    expect(await store.list('optimizationRuns')).toMatchObject([{
      stage: 'applied',
      acceptedChangeIds: [],
      changeSet: { changes: [] },
      appliedVariantId: expect.any(String)
    }])
    await store.close()
  })
})
