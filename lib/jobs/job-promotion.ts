import { z } from 'zod'
import { isTrustedResumeSource } from '@/lib/resume-model'
import { createDomainStore, type IndexedDbDomainStore } from '@/lib/agent/domain-store'
import { readMigratedStorageValue } from '@/lib/brand-migration'
import {
  applicationRecordSchema,
  createStableJobDomainId,
  type ApplicationRecord,
  type JobPosting,
  type JobRecommendation
} from './job-domain'

export const JOB_PROMOTION_STORAGE_KEY = 'job-seeker-agent-job-promotion-v1'
const LEGACY_JOB_PROMOTION_STORAGE_KEY = 'resume-os-job-promotion-v1'

const jobPromotionIntentSchema = z.object({
  postingId: z.string().trim().min(1).max(160),
  recommendationId: z.string().trim().min(1).max(160),
  sourceDraftId: z.string().trim().min(1).max(160),
  postingContentHash: z.string().trim().min(1).max(256),
  recommendationFingerprint: z.string().trim().min(1).max(256),
  createdAt: z.iso.datetime({ offset: true })
}).strict()

export type JobPromotionIntent = z.infer<typeof jobPromotionIntentSchema>
type PromotionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export class JobPromotionError extends Error {
  constructor(readonly code:
    | 'NOT_FOUND'
    | 'WRONG_DRAFT'
    | 'UNTRUSTED_DRAFT'
    | 'STALE_POSTING'
    | 'BROKEN_REFERENCE'
  ) {
    super(code)
    this.name = 'JobPromotionError'
  }
}

export function createJobPromotionIntent(input: {
  posting: JobPosting
  recommendation: JobRecommendation
  sourceDraftId: string
  now?: string
}): JobPromotionIntent {
  if (
    input.recommendation.postingId !== input.posting.id
    || input.recommendation.sourceDraftId !== input.sourceDraftId
  ) throw new JobPromotionError('BROKEN_REFERENCE')
  return jobPromotionIntentSchema.parse({
    postingId: input.posting.id,
    recommendationId: input.recommendation.id,
    sourceDraftId: input.sourceDraftId,
    postingContentHash: input.posting.contentHash,
    recommendationFingerprint: input.recommendation.inputFingerprint,
    createdAt: input.now ?? new Date().toISOString()
  })
}

export function saveJobPromotionIntent(
  intent: JobPromotionIntent,
  storage: PromotionStorage | null = browserStorage()
) {
  storage?.setItem(JOB_PROMOTION_STORAGE_KEY, JSON.stringify(jobPromotionIntentSchema.parse(intent)))
}

export function readJobPromotionIntent(
  storage: PromotionStorage | null = browserStorage()
): JobPromotionIntent | null {
  if (!storage) return null
  try {
    return jobPromotionIntentSchema.parse(JSON.parse(readMigratedStorageValue(
      storage,
      JOB_PROMOTION_STORAGE_KEY,
      LEGACY_JOB_PROMOTION_STORAGE_KEY
    ) ?? 'null'))
  } catch {
    return null
  }
}

export function clearJobPromotionIntent(storage: PromotionStorage | null = browserStorage()) {
  storage?.removeItem(JOB_PROMOTION_STORAGE_KEY)
  storage?.removeItem(LEGACY_JOB_PROMOTION_STORAGE_KEY)
}

export async function resolveJobPromotion(input: {
  store: IndexedDbDomainStore
  intent: JobPromotionIntent
  activeDraft: { id: string; source: string }
}): Promise<{ posting: JobPosting; recommendation: JobRecommendation; closed: boolean }> {
  const intent = jobPromotionIntentSchema.parse(input.intent)
  if (input.activeDraft.id !== intent.sourceDraftId) throw new JobPromotionError('WRONG_DRAFT')
  if (!isTrustedResumeSource(input.activeDraft.source)) {
    throw new JobPromotionError('UNTRUSTED_DRAFT')
  }
  const [posting, recommendation] = await Promise.all([
    input.store.get('jobPostings', intent.postingId),
    input.store.get('jobRecommendations', intent.recommendationId)
  ])
  if (
    !posting
    || !recommendation
    || recommendation.postingId !== posting.id
    || recommendation.sourceDraftId !== intent.sourceDraftId
  ) throw new JobPromotionError('BROKEN_REFERENCE')
  if (
    posting.contentHash !== intent.postingContentHash
    || recommendation.inputFingerprint !== intent.recommendationFingerprint
  ) throw new JobPromotionError('STALE_POSTING')
  return { posting, recommendation, closed: posting.status === 'closed' }
}

export async function completeJobPromotion(input: {
  store: IndexedDbDomainStore
  intent: JobPromotionIntent
  targetJobId: string
  now?: string
}): Promise<ApplicationRecord> {
  const intent = jobPromotionIntentSchema.parse(input.intent)
  const now = input.now ?? new Date().toISOString()
  return input.store.transaction(
    ['jobPostings', 'jobRecommendations', 'targetJobs', 'applicationRecords'],
    'readwrite',
    async (transaction) => {
      const [posting, recommendation, targetJob] = await Promise.all([
        transaction.get('jobPostings', intent.postingId),
        transaction.get('jobRecommendations', intent.recommendationId),
        transaction.get('targetJobs', input.targetJobId)
      ])
      if (!posting || !recommendation || !targetJob) throw new JobPromotionError('BROKEN_REFERENCE')
      if (
        posting.contentHash !== intent.postingContentHash
        || recommendation.inputFingerprint !== intent.recommendationFingerprint
        || recommendation.postingId !== posting.id
        || recommendation.sourceDraftId !== intent.sourceDraftId
      ) throw new JobPromotionError('STALE_POSTING')

      await transaction.put('jobRecommendations', {
        ...recommendation,
        analyzedTargetJobId: targetJob.id,
        decision: 'saved',
        updatedAt: now
      })
      const applicationId = createStableJobDomainId('application', [posting.id, intent.sourceDraftId])
      const existing = await transaction.get('applicationRecords', applicationId)
      const application = applicationRecordSchema.parse({
        id: applicationId,
        postingId: posting.id,
        sourceDraftId: intent.sourceDraftId,
        targetJobId: targetJob.id,
        postingContentHash: posting.contentHash,
        recommendationFingerprint: recommendation.inputFingerprint,
        status: existing?.status === 'saved' || !existing ? 'analyzing' : existing.status,
        notes: existing?.notes ?? '',
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        ...(existing?.resumeVariantId ? { resumeVariantId: existing.resumeVariantId } : {}),
        ...(existing?.submittedAt ? { submittedAt: existing.submittedAt } : {})
      })
      await transaction.put('applicationRecords', application)
      return application
    }
  )
}

export async function loadBrowserJobPromotion(input: {
  activeDraft: { id: string; source: string }
  storage?: PromotionStorage | null
  store?: IndexedDbDomainStore
}) {
  const intent = readJobPromotionIntent(input.storage)
  if (!intent) return null
  const store = input.store ?? createDomainStore()
  try {
    return { intent, ...(await resolveJobPromotion({ store, intent, activeDraft: input.activeDraft })) }
  } finally {
    if (!input.store) await store.close()
  }
}

function browserStorage(): PromotionStorage | null {
  return typeof window === 'undefined' ? null : window.localStorage
}
