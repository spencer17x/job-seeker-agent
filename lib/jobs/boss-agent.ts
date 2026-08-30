import { resumeVariantSchema, type IndexedDbDomainStore } from '@/lib/agent/domain-store'
import type { BrowserBossJob } from './browser-agent-protocol'
import { jdRequirementAnalysisSchema, type JDRequirementAnalysis } from '@/lib/agent/jd-report'
import { createOptimizationRun, transitionOptimizationRun } from '@/lib/agent/optimization-run'
import { requirementMatrixSchema, scoreRequirementMatrix } from '@/lib/agent/requirement-matrix'
import { scoreResumeStructure } from '@/lib/agent/resume-structure-score'
import { normalizeResumeData, type ResumeData } from '@/lib/resume-model'
import { fingerprintOptimizationInputs } from '@/lib/agent/workflow-persistence'
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
      const description = existing?.detailFetchedAt ? existing.description : job.summary
      const posting = jobPostingSchema.parse({
        id,
        sourceId: BOSS_BROWSER_SOURCE_ID,
        externalId: job.externalId,
        canonicalUrl,
        applyUrl: canonicalUrl,
        title: job.title,
        company: job.company,
        description,
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
        ...(existing?.detailFetchedAt ? { detailFetchedAt: existing.detailFetchedAt } : {}),
        status: 'open',
        contentHash: createJobInputFingerprint({
          title: job.title,
          company: job.company,
          description,
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
      || recommendation.eligibility === 'excluded'
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
      const analysisChanged = existingRun && (
        existingRun.targetJobId !== analysis.targetJob.id
        || existingRun.inputFingerprint !== analysis.matrix.inputFingerprint
      )
      if (analysisChanged && existingRun.stage !== 'draft') {
        throw new TypeError('A reviewed BOSS analysis cannot be replaced by refreshed detail')
      }
      if (!existingRun || analysisChanged) {
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

/**
 * Creates a job-specific copy from the trusted resume without asking a model to
 * rewrite claims. The no-op change set still travels through the deterministic
 * optimization state machine so packet fingerprints and audit history remain
 * compatible with manually reviewed variants.
 */
export async function prepareBossCandidateResumeVariants(input: {
  store: IndexedDbDomainStore
  sourceDraftId: string
  resume: ResumeData
  maximumCandidates?: number
  now: () => string
}) {
  const maximumCandidates = input.maximumCandidates ?? 10
  if (!Number.isInteger(maximumCandidates) || maximumCandidates < 1 || maximumCandidates > 50) {
    throw new TypeError('BOSS resume variant batch size must be between 1 and 50')
  }
  const applications = (await input.store.listByIndex(
    'applicationRecords',
    'bySourceDraftId',
    input.sourceDraftId
  )).filter((application) => (
    application.targetJobId
    && !application.resumeVariantId
    && ['saved', 'analyzing', 'preparing'].includes(application.status)
  )).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    .slice(0, maximumCandidates)

  const prepared = [] as ApplicationRecord[]
  for (const candidate of applications) {
    const now = input.now()
    let next: ApplicationRecord | null = null
    try {
      next = await input.store.transaction([
      'applicationRecords', 'jobPostings', 'targetJobs', 'jobRequirements',
      'requirementMatches', 'optimizationRuns', 'resumeVariants', 'careerFacts'
    ], 'readwrite', async (transaction) => {
      const application = await transaction.get('applicationRecords', candidate.id)
      if (!application?.targetJobId || application.resumeVariantId) return null
      const [posting, targetJob, runs, requirements, allMatches, facts] = await Promise.all([
        transaction.get('jobPostings', application.postingId),
        transaction.get('targetJobs', application.targetJobId),
        transaction.listByIndex('optimizationRuns', 'bySourceDraftId', application.sourceDraftId),
        transaction.listByIndex('jobRequirements', 'byJobId', application.targetJobId),
        transaction.list('requirementMatches'),
        transaction.list('careerFacts')
      ])
      if (
        !posting
        || detectMarketplaceFromJobUrl(posting.canonicalUrl) !== 'boss'
        || !targetJob
        || requirements.length === 0
      ) return null
      const targetRuns = runs.filter((item) => item.targetJobId === application.targetJobId)
      const existingAppliedRun = targetRuns.find((item) => item.stage === 'applied')
      if (existingAppliedRun?.appliedVariantId) {
        const existingVariant = await transaction.get('resumeVariants', existingAppliedRun.appliedVariantId)
        if (
          existingVariant?.sourceDraftId === application.sourceDraftId
          && existingVariant.targetJobId === targetJob.id
          && existingAppliedRun.changeInputFingerprint
        ) {
          const relinked = applicationRecordSchema.parse({
            ...application,
            resumeVariantId: existingVariant.id,
            workflowInputFingerprint: existingAppliedRun.changeInputFingerprint,
            updatedAt: now
          })
          await transaction.put('applicationRecords', relinked)
          return relinked
        }
      }
      const managedRunId = createStableJobDomainId('optimization-run', [
        posting.id,
        application.sourceDraftId,
        'managed-copy-v2'
      ])
      const existingManagedRun = targetRuns.find((item) => item.id === managedRunId)
      if (existingManagedRun && existingManagedRun.stage !== 'draft') return null
      const run = targetRuns.find((item) => item.stage === 'draft')
        ?? existingManagedRun
        ?? createOptimizationRun({
          id: managedRunId,
          sourceDraftId: application.sourceDraftId,
          targetJobId: targetJob.id,
          inputFingerprint: requirements[0].jobId === targetJob.id
            ? targetRuns[0]?.inputFingerprint ?? createJobInputFingerprint({
                targetJobId: targetJob.id,
                requirements: requirements.map(({ id }) => id)
              })
            : createJobInputFingerprint(targetJob.id),
          now
        })
      const requirementIds = new Set(requirements.map(({ id }) => id))
      const existingMatches = new Map(
        allMatches
          .filter((match) => requirementIds.has(match.requirementId))
          .map((match) => [match.requirementId, match])
      )
      const matches = requirements.map((requirement) => existingMatches.get(requirement.id) ?? ({
        requirementId: requirement.id,
        factIds: [],
        status: 'gap' as const,
        rationale: targetJob.locale === 'zh'
          ? '托管副本不新增或改写职业事实；未关联要求保持为证据缺口。'
          : 'Managed copies do not add or rewrite career facts; unmatched requirements remain evidence gaps.'
      }))
      const matrix = requirementMatrixSchema.parse({
        version: 1,
        targetJobId: targetJob.id,
        inputFingerprint: run.inputFingerprint,
        requirements,
        matches
      })
      const score = scoreRequirementMatrix(matrix)
      const currentFingerprint = fingerprintOptimizationInputs({
        sourceDraftId: application.sourceDraftId,
        resume: input.resume,
        targetJob,
        requirements,
        requirementMatches: matches,
        careerFacts: facts
      })
      const variantId = createStableJobDomainId('resume-variant', [application.id, targetJob.id])
      const variant = resumeVariantSchema.parse({
        id: variantId,
        sourceDraftId: application.sourceDraftId,
        targetJobId: targetJob.id,
        name: `${targetJob.title}${targetJob.company ? ` · ${targetJob.company}` : ''}`,
        data: normalizeResumeData({
          ...structuredClone(input.resume),
          targetRole: targetJob.title
        }, {
          source: input.resume.metadata.source,
          locale: input.resume.metadata.locale,
          now
        }),
        createdAt: now,
        updatedAt: now
      })

      let appliedRun = transitionOptimizationRun(run, { type: 'requirements-ready' }, now)
      appliedRun = transitionOptimizationRun(appliedRun, {
        type: 'map-evidence',
        requirementMatches: matches,
        questions: [],
        scoreBefore: score
      }, now)
      appliedRun = transitionOptimizationRun(appliedRun, {
        type: 'prepare-plan',
        plan: {
          id: createStableJobDomainId('optimization-plan', [run.id, 'preserve']),
          summary: 'Create a job-specific copy from the trusted resume without AI-authored rewrites.',
          items: [{
            id: createStableJobDomainId('optimization-plan-item', [run.id, requirements[0].id]),
            requirementIds: [requirements[0].id],
            factIds: [],
            targetPath: 'projects',
            intent: 'Preserve all existing resume claims and structure in an independent job-specific copy.',
            transformation: 'reorder'
          }]
        }
      }, now)
      appliedRun = transitionOptimizationRun(appliedRun, { type: 'request-plan-approval' }, now)
      appliedRun = transitionOptimizationRun(appliedRun, { type: 'approve-plan' }, now)
      appliedRun = transitionOptimizationRun(appliedRun, {
        type: 'propose-changes',
        changeSet: {
          summary: 'No resume claims were rewritten; the trusted resume was copied for this role.',
          changes: [],
          questions: []
        },
        currentFingerprint
      }, now)
      appliedRun = transitionOptimizationRun(appliedRun, { type: 'approve-changes', acceptedChangeIds: [] }, now)
      appliedRun = transitionOptimizationRun(appliedRun, {
        type: 'apply',
        currentFingerprint,
        appliedVariantId: variant.id,
        scoreAfter: score
      }, now)
      const updatedApplication = applicationRecordSchema.parse({
        ...application,
        resumeVariantId: variant.id,
        workflowInputFingerprint: currentFingerprint,
        updatedAt: now
      })
      await transaction.put('resumeVariants', variant)
      await transaction.put('optimizationRuns', appliedRun)
      await transaction.put('applicationRecords', updatedApplication)
      return updatedApplication
      })
    } catch {
      // One stale legacy workflow must not block independent candidates.
      continue
    }
    if (next) prepared.push(next)
  }
  return prepared
}
