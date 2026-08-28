import type { IndexedDbDomainStore } from '@/lib/agent/domain-store'
import type { BrowserBossJob } from './browser-agent-protocol'
import { jdRequirementAnalysisSchema, type JDRequirementAnalysis } from '@/lib/agent/jd-report'
import { createOptimizationRun } from '@/lib/agent/optimization-run'
import { requirementMatrixSchema, scoreRequirementMatrix } from '@/lib/agent/requirement-matrix'
import { scoreResumeStructure } from '@/lib/agent/resume-structure-score'
import type { ResumeData } from '@/lib/resume-model'
import {
  applicationRecordSchema,
  createJobInputFingerprint,
  createStableJobDomainId,
  jobPostingSchema,
  jobSourceSchema,
  type ApplicationRecord,
  type JobPosting,
  type JobRecommendation
} from './job-domain'
import { assertMarketplaceJobUrl, detectMarketplaceFromJobUrl } from './job-marketplace'

const BOSS_BROWSER_SOURCE_ID = 'job-source-boss-browser'

export async function upsertBossBrowserJobs(input: {
  store: IndexedDbDomainStore
  jobs: readonly BrowserBossJob[]
  now: string
}) {
  const uniqueJobs = new Map(input.jobs.map((job) => [job.externalId, job]))
  const stored: JobPosting[] = []
  await input.store.transaction(['jobSources', 'jobPostings'], 'readwrite', async (transaction) => {
    const existingSource = await transaction.get('jobSources', BOSS_BROWSER_SOURCE_ID)
    await transaction.put('jobSources', jobSourceSchema.parse(existingSource ?? {
      id: BOSS_BROWSER_SOURCE_ID,
      kind: 'manual',
      label: 'BOSS Zhipin Browser Agent',
      enabled: true,
      createdAt: input.now,
      updatedAt: input.now
    }))
    for (const job of uniqueJobs.values()) {
      const canonicalUrl = assertMarketplaceJobUrl('boss', job.url)
      const id = createStableJobDomainId('job-posting', ['boss', job.externalId])
      const existing = await transaction.get('jobPostings', id)
      const posting = jobPostingSchema.parse({
        id,
        sourceId: BOSS_BROWSER_SOURCE_ID,
        externalId: job.externalId,
        canonicalUrl,
        applyUrl: canonicalUrl,
        title: job.title,
        company: job.company,
        description: job.summary,
        locale: 'zh',
        ...(job.location ? { location: job.location } : {}),
        ...(job.minimumMonthlySalary !== undefined || job.maximumMonthlySalary !== undefined ? {
          compensation: {
            ...(job.minimumMonthlySalary !== undefined ? { minimum: job.minimumMonthlySalary } : {}),
            ...(job.maximumMonthlySalary !== undefined ? { maximum: job.maximumMonthlySalary } : {}),
            currency: 'CNY',
            period: 'month'
          }
        } : {}),
        firstSeenAt: existing?.firstSeenAt ?? input.now,
        lastCheckedAt: input.now,
        status: 'open',
        contentHash: createJobInputFingerprint({
          title: job.title,
          company: job.company,
          summary: job.summary,
          location: job.location,
          minimumMonthlySalary: job.minimumMonthlySalary,
          maximumMonthlySalary: job.maximumMonthlySalary
        })
      })
      await transaction.put('jobPostings', posting)
      stored.push(posting)
    }
  })
  return stored
}

export type BossCandidatePlan = {
  posting: JobPosting
  recommendation: JobRecommendation
}

export function planBossCandidates(input: {
  postings: readonly JobPosting[]
  recommendations: readonly JobRecommendation[]
  sourceDraftId: string
  minimumScore?: number
  maximumCandidates?: number
}) {
  const minimumScore = input.minimumScore ?? 70
  const maximumCandidates = input.maximumCandidates ?? 10
  if (!Number.isFinite(minimumScore) || minimumScore < 0 || minimumScore > 100) {
    throw new TypeError('BOSS candidate score threshold must be between 0 and 100')
  }
  if (!Number.isInteger(maximumCandidates) || maximumCandidates < 1 || maximumCandidates > 50) {
    throw new TypeError('BOSS candidate limit must be between 1 and 50')
  }

  const postingById = new Map(input.postings.map((posting) => [posting.id, posting]))
  return input.recommendations.flatMap((recommendation): BossCandidatePlan[] => {
    const posting = postingById.get(recommendation.postingId)
    if (
      !posting
      || recommendation.sourceDraftId !== input.sourceDraftId
      || recommendation.eligibility !== 'eligible'
      || recommendation.decision === 'ignored'
      || (recommendation.preliminaryScore ?? -1) < minimumScore
      || posting.status !== 'open'
      || detectMarketplaceFromJobUrl(posting.canonicalUrl) !== 'boss'
    ) return []
    return [{ posting, recommendation }]
  }).sort((left, right) => (
    (right.recommendation.preliminaryScore ?? 0) - (left.recommendation.preliminaryScore ?? 0)
    || right.posting.lastCheckedAt.localeCompare(left.posting.lastCheckedAt)
    || left.posting.id.localeCompare(right.posting.id)
  )).slice(0, maximumCandidates)
}

export async function queueBossCandidates(input: {
  store: IndexedDbDomainStore
  sourceDraftId: string
  minimumScore?: number
  maximumCandidates?: number
  now: string
}) {
  const [postings, recommendations, applications] = await Promise.all([
    input.store.list('jobPostings'),
    input.store.listByIndex('jobRecommendations', 'bySourceDraftId', input.sourceDraftId),
    input.store.listByIndex('applicationRecords', 'bySourceDraftId', input.sourceDraftId)
  ])
  const planned = planBossCandidates({
    postings,
    recommendations,
    sourceDraftId: input.sourceDraftId,
    minimumScore: input.minimumScore,
    maximumCandidates: input.maximumCandidates
  })
  const existingIds = new Set(applications.map((application) => application.id))
  const queued: ApplicationRecord[] = []

  await input.store.transaction(['applicationRecords', 'jobRecommendations'], 'readwrite', async (transaction) => {
    for (const candidate of planned) {
      const id = createStableJobDomainId('application', [candidate.posting.id, input.sourceDraftId])
      if (existingIds.has(id)) continue
      const record = applicationRecordSchema.parse({
        id,
        postingId: candidate.posting.id,
        sourceDraftId: input.sourceDraftId,
        status: 'saved',
        notes: '',
        createdAt: input.now,
        updatedAt: input.now
      })
      await transaction.put('applicationRecords', record)
      await transaction.put('jobRecommendations', {
        ...candidate.recommendation,
        decision: 'saved',
        updatedAt: input.now
      })
      queued.push(record)
    }
  })

  return { plannedCount: planned.length, queued }
}

export async function persistBossCandidateAnalysis(input: {
  store: IndexedDbDomainStore
  applicationId: string
  analysis: JDRequirementAnalysis
  now: string
}) {
  const analysis = jdRequirementAnalysisSchema.parse(input.analysis)
  return input.store.transaction(
    ['applicationRecords', 'jobPostings', 'jobRecommendations', 'targetJobs', 'jobRequirements', 'requirementMatches', 'optimizationRuns'],
    'readwrite',
    async (transaction) => {
      const application = await transaction.get('applicationRecords', input.applicationId)
      if (!application) throw new TypeError('The queued BOSS application does not exist')
      const posting = await transaction.get('jobPostings', application.postingId)
      if (!posting || detectMarketplaceFromJobUrl(posting.canonicalUrl) !== 'boss') {
        throw new TypeError('The queued application is not a BOSS role')
      }
      if (analysis.targetJob.description !== posting.description) {
        throw new TypeError('The analysis does not belong to the queued BOSS posting')
      }
      const recommendations = await transaction.list('jobRecommendations')
      const recommendation = recommendations.find((item) => (
        item.postingId === posting.id && item.sourceDraftId === application.sourceDraftId
      ))
      if (!recommendation || recommendation.inputFingerprint === '') {
        throw new TypeError('The queued BOSS recommendation is missing')
      }

      await transaction.put('targetJobs', analysis.targetJob)
      for (const requirement of analysis.matrix.requirements) {
        await transaction.put('jobRequirements', requirement)
      }
      for (const match of analysis.matrix.matches) {
        await transaction.put('requirementMatches', match)
      }
      const runId = createStableJobDomainId('optimization-run', [posting.id, application.sourceDraftId])
      const existingRun = await transaction.get('optimizationRuns', runId)
      if (!existingRun) {
        await transaction.put('optimizationRuns', createOptimizationRun({
          id: runId,
          sourceDraftId: application.sourceDraftId,
          targetJobId: analysis.targetJob.id,
          inputFingerprint: analysis.matrix.inputFingerprint,
          now: input.now
        }))
      }
      await transaction.put('jobRecommendations', {
        ...recommendation,
        analyzedTargetJobId: analysis.targetJob.id,
        decision: 'saved',
        updatedAt: input.now
      })
      const nextApplication = applicationRecordSchema.parse({
        ...application,
        targetJobId: analysis.targetJob.id,
        postingContentHash: posting.contentHash,
        recommendationFingerprint: recommendation.inputFingerprint,
        status: application.status === 'saved' ? 'analyzing' : application.status,
        updatedAt: input.now
      })
      await transaction.put('applicationRecords', nextApplication)
      return nextApplication
    }
  )
}

export async function loadBossCandidateAnalysis(input: {
  store: IndexedDbDomainStore
  applicationId: string
  resume: ResumeData
}) {
  const [application, requirements, matches, runs] = await Promise.all([
    input.store.get('applicationRecords', input.applicationId),
    input.store.list('jobRequirements'),
    input.store.list('requirementMatches'),
    input.store.list('optimizationRuns')
  ])
  if (!application?.targetJobId) return null
  const targetJob = await input.store.get('targetJobs', application.targetJobId)
  if (!targetJob) return null
  const run = runs.find((item) => (
    item.targetJobId === targetJob.id && item.sourceDraftId === application.sourceDraftId
  ))
  if (!run) return null
  const targetRequirements = requirements.filter((item) => item.jobId === targetJob.id)
  if (targetRequirements.length === 0) return null
  const requirementIds = new Set(targetRequirements.map((item) => item.id))
  const targetMatches = matches.filter((item) => requirementIds.has(item.requirementId))
  const matrix = requirementMatrixSchema.parse({
    version: 1,
    targetJobId: targetJob.id,
    inputFingerprint: run.inputFingerprint,
    requirements: targetRequirements,
    matches: targetMatches
  })
  return {
    optimizationRunId: run.id,
    analysis: jdRequirementAnalysisSchema.parse({
      targetJob,
      matrix,
      score: scoreRequirementMatrix(matrix),
      structureScore: scoreResumeStructure(input.resume)
    })
  }
}

export async function analyzeBossCandidateQueue(input: {
  store: IndexedDbDomainStore
  sourceDraftId: string
  maximumCandidates?: number
  signal?: AbortSignal
  now: () => string
  runAnalysis: (posting: JobPosting, signal?: AbortSignal) => Promise<JDRequirementAnalysis>
}) {
  const maximumCandidates = input.maximumCandidates ?? 3
  if (!Number.isInteger(maximumCandidates) || maximumCandidates < 1 || maximumCandidates > 10) {
    throw new TypeError('BOSS analysis batch size must be between 1 and 10')
  }
  const [applications, postings] = await Promise.all([
    input.store.listByIndex('applicationRecords', 'bySourceDraftId', input.sourceDraftId),
    input.store.list('jobPostings')
  ])
  const postingById = new Map(postings.map((posting) => [posting.id, posting]))
  const candidates = applications.filter((application) => (
    application.sourceDraftId === input.sourceDraftId
    && application.status === 'saved'
    && !application.targetJobId
    && detectMarketplaceFromJobUrl(postingById.get(application.postingId)?.canonicalUrl ?? '') === 'boss'
  )).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    .slice(0, maximumCandidates)

  const prepared: ApplicationRecord[] = []
  const failures: Array<{ applicationId: string; message: string }> = []
  for (const application of candidates) {
    if (input.signal?.aborted) throw new DOMException('BOSS analysis batch aborted', 'AbortError')
    const posting = postingById.get(application.postingId)
    if (!posting) continue
    try {
      const analysis = await input.runAnalysis(posting, input.signal)
      prepared.push(await persistBossCandidateAnalysis({
        store: input.store,
        applicationId: application.id,
        analysis,
        now: input.now()
      }))
    } catch (error) {
      if (input.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error
      failures.push({
        applicationId: application.id,
        message: error instanceof Error ? error.message.slice(0, 300) : 'BOSS analysis failed'
      })
    }
  }
  return { candidateCount: candidates.length, prepared, failures }
}
