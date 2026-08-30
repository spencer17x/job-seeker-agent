import type { ResumeData } from '@/lib/resume-model'
import {
  fingerprintOptimizationInputs
} from '@/lib/agent/workflow-persistence'
import type { DomainStoreTransaction, IndexedDbDomainStore } from '@/lib/agent/domain-store'
import {
  applicationRecordSchema,
  type ApplicationRecord,
  type JobPosting,
  type JobRecommendation
} from './job-domain'
import type { OptimizationRun } from '@/lib/agent/optimization-run'
import type { ResumeVariant } from '@/lib/agent/domain-store'
import { ensureBossOpeningDraft } from './boss-conversation'
import { detectMarketplaceFromJobUrl } from './job-marketplace'

export const APPLICATION_PACKET_CHECKS = [
  'posting-current',
  'recommendation-current',
  'workflow-applied',
  'variant-related',
  'workflow-current'
] as const

export type ApplicationPacketCheckCode = typeof APPLICATION_PACKET_CHECKS[number]
export type ApplicationPacket = {
  record: ApplicationRecord
  posting: JobPosting
  recommendation: JobRecommendation | null
  run: OptimizationRun | null
  variant: ResumeVariant | null
  checks: Array<{ code: ApplicationPacketCheckCode; passed: boolean }>
  ready: boolean
}

const packetStoreNames = [
  'applicationRecords', 'jobPostings', 'jobRecommendations', 'optimizationRuns',
  'resumeVariants', 'jobRequirements', 'careerFacts', 'targetJobs'
] as const

const allowedTransitions: Record<ApplicationRecord['status'], readonly ApplicationRecord['status'][]> = {
  saved: ['analyzing', 'preparing', 'archived'],
  analyzing: ['saved', 'preparing', 'archived'],
  preparing: ['analyzing', 'ready-to-apply', 'archived'],
  'ready-to-apply': ['preparing', 'applied', 'withdrawn', 'archived'],
  applied: ['interviewing', 'rejected', 'withdrawn', 'archived'],
  interviewing: ['offered', 'rejected', 'withdrawn', 'archived'],
  offered: ['withdrawn', 'archived'],
  rejected: ['archived'],
  withdrawn: ['archived'],
  archived: []
}

export class ApplicationRecordError extends Error {
  constructor(readonly code: 'INVALID_TRANSITION' | 'NOT_FOUND' | 'PACKET_NOT_READY') {
    super(code)
    this.name = 'ApplicationRecordError'
  }
}

export function transitionApplicationRecord(input: {
  record: ApplicationRecord
  status: ApplicationRecord['status']
  now: string
  explicitSubmission?: boolean
}) {
  const record = applicationRecordSchema.parse(input.record)
  if (record.status === input.status) return record
  if (!allowedTransitions[record.status].includes(input.status)) {
    throw new ApplicationRecordError('INVALID_TRANSITION')
  }
  if (input.status === 'applied' && !input.explicitSubmission) {
    throw new ApplicationRecordError('INVALID_TRANSITION')
  }
  return applicationRecordSchema.parse({
    ...record,
    status: input.status,
    updatedAt: input.now,
    ...(input.status === 'applied' ? { submittedAt: input.now } : {})
  })
}

export async function loadApplicationPacket(input: {
  store: IndexedDbDomainStore
  recordId: string
  resume: ResumeData
}): Promise<ApplicationPacket> {
  return input.store.transaction([...packetStoreNames], 'readonly', (transaction) => (
    buildApplicationPacket(transaction, input.recordId, input.resume)
  ))
}

async function buildApplicationPacket(
  store: Pick<DomainStoreTransaction<(typeof packetStoreNames)[number]>, 'get' | 'list' | 'listByIndex'>,
  recordId: string,
  resume: ResumeData
): Promise<ApplicationPacket> {
  const record = await store.get('applicationRecords', recordId)
  if (!record) throw new ApplicationRecordError('NOT_FOUND')
  const [posting, recommendations, runs, variants, facts, targetJob] = await Promise.all([
    store.get('jobPostings', record.postingId),
    store.listByIndex('jobRecommendations', 'bySourceDraftId', record.sourceDraftId),
    store.listByIndex('optimizationRuns', 'bySourceDraftId', record.sourceDraftId),
    store.listByIndex('resumeVariants', 'bySourceDraftId', record.sourceDraftId),
    store.list('careerFacts'),
    record.targetJobId ? store.get('targetJobs', record.targetJobId) : Promise.resolve(undefined)
  ])
  if (!posting) throw new ApplicationRecordError('NOT_FOUND')
  const recommendation = recommendations.find((item) => (
    item.postingId === posting.id && item.sourceDraftId === record.sourceDraftId
  )) ?? null
  const candidateRuns = runs.filter((item) => (
    item.sourceDraftId === record.sourceDraftId && item.targetJobId === record.targetJobId
  )).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  const run = candidateRuns.find((item) => item.stage === 'applied') ?? candidateRuns[0] ?? null
  const variant = variants.find((item) => item.id === (record.resumeVariantId ?? run?.appliedVariantId)) ?? null
  const requirementIds = new Set(run?.requirementMatches.map((match) => match.requirementId) ?? [])
  const runRequirements = run
    ? (await store.listByIndex('jobRequirements', 'byJobId', run.targetJobId))
      .filter((item) => requirementIds.has(item.id))
    : []
  const currentWorkflowFingerprint = run && targetJob && runRequirements.length === requirementIds.size
    ? fingerprintOptimizationInputs({
        sourceDraftId: record.sourceDraftId,
        resume,
        targetJob,
        requirements: runRequirements,
        requirementMatches: run.requirementMatches,
        careerFacts: facts
      })
    : null
  const expectedWorkflowFingerprint = run?.changeInputFingerprint ?? null
  const checks = [
    {
      code: 'posting-current' as const,
      passed: posting.status === 'open'
        && Boolean(record.postingContentHash)
        && record.postingContentHash === posting.contentHash
    },
    {
      code: 'recommendation-current' as const,
      passed: Boolean(
        recommendation
        && recommendation.eligibility !== 'excluded'
        && recommendation.analyzedTargetJobId === record.targetJobId
        && record.recommendationFingerprint === recommendation.inputFingerprint
      )
    },
    {
      code: 'workflow-applied' as const,
      passed: Boolean(run?.stage === 'applied' && run.sourceDraftId === record.sourceDraftId)
    },
    {
      code: 'variant-related' as const,
      passed: Boolean(
        run?.appliedVariantId
        && variant?.id === run.appliedVariantId
        && variant.sourceDraftId === record.sourceDraftId
        && variant.targetJobId === record.targetJobId
      )
    },
    {
      code: 'workflow-current' as const,
      passed: Boolean(
        expectedWorkflowFingerprint
        && currentWorkflowFingerprint === expectedWorkflowFingerprint
        && (!record.workflowInputFingerprint || record.workflowInputFingerprint === currentWorkflowFingerprint)
      )
    }
  ]
  return {
    record,
    posting,
    recommendation,
    run,
    variant,
    checks,
    ready: checks.every((check) => check.passed)
  }
}

export async function prepareApplicationPacket(input: {
  store: IndexedDbDomainStore
  recordId: string
  resume: ResumeData
  now: string
}): Promise<ApplicationPacket> {
  const result = await input.store.transaction([...packetStoreNames], 'readwrite', async (transaction) => {
    let packet = await buildApplicationPacket(transaction, input.recordId, input.resume)
    if (!packet.ready && packet.record.targetJobId) {
      const targetJob = await transaction.get('targetJobs', packet.record.targetJobId)
      const stableWorkflowChecks = packet.checks
        .filter((check) => !['posting-current', 'recommendation-current'].includes(check.code))
        .every((check) => check.passed)
      const canRebindCurrentMetadata = Boolean(
        stableWorkflowChecks
        && packet.posting.status === 'open'
        && targetJob
        && targetJob.title === packet.posting.title
        && (targetJob.company ?? '') === packet.posting.company
        && targetJob.description === packet.posting.description
        && packet.recommendation
        && packet.recommendation.eligibility !== 'excluded'
        && packet.recommendation.analyzedTargetJobId === targetJob.id
      )
      if (canRebindCurrentMetadata) {
        const rebound = applicationRecordSchema.parse({
          ...packet.record,
          postingContentHash: packet.posting.contentHash,
          recommendationFingerprint: packet.recommendation!.inputFingerprint,
          updatedAt: input.now
        })
        await transaction.put('applicationRecords', rebound)
        packet = await buildApplicationPacket(transaction, input.recordId, input.resume)
      }
    }
    if (!packet.ready || !packet.run?.changeInputFingerprint || !packet.variant) {
      const current = packet.record.status === 'ready-to-apply' || packet.record.status === 'analyzing'
        ? transitionApplicationRecord({ record: packet.record, status: 'preparing', now: input.now })
        : packet.record
      if (current !== packet.record) await transaction.put('applicationRecords', current)
      return { ...packet, record: current, ready: false }
    }
    let record = packet.record
    if (record.status === 'saved' || record.status === 'analyzing') {
      record = transitionApplicationRecord({ record, status: 'preparing', now: input.now })
    }
    if (record.status !== 'preparing' && record.status !== 'ready-to-apply') {
      throw new ApplicationRecordError('INVALID_TRANSITION')
    }
    const ready = record.status === 'ready-to-apply'
      ? record
      : transitionApplicationRecord({
          record: applicationRecordSchema.parse({
            ...record,
            resumeVariantId: packet.variant.id,
            workflowInputFingerprint: packet.run.changeInputFingerprint,
            updatedAt: input.now
          }),
          status: 'ready-to-apply',
          now: input.now
        })
    await transaction.put('applicationRecords', ready)
    return buildApplicationPacket(transaction, ready.id, input.resume)
  })
  if (!result.ready) throw new ApplicationRecordError('PACKET_NOT_READY')
  return result
}

export async function markApplicationApplied(input: {
  store: IndexedDbDomainStore
  recordId: string
  resume: ResumeData
  now: string
}) {
  return input.store.transaction([...packetStoreNames], 'readwrite', async (transaction) => {
    const packet = await buildApplicationPacket(transaction, input.recordId, input.resume)
    if (!packet.ready || packet.record.status !== 'ready-to-apply') {
      throw new ApplicationRecordError('PACKET_NOT_READY')
    }
    const applied = transitionApplicationRecord({
      record: packet.record,
      status: 'applied',
      now: input.now,
      explicitSubmission: true
    })
    await transaction.put('applicationRecords', applied)
    return applied
  })
}

export async function prepareReadyBossApplicationPackets(input: {
  store: IndexedDbDomainStore
  sourceDraftId: string
  resume: ResumeData
  now: () => string
}) {
  const applications = await input.store.listByIndex(
    'applicationRecords',
    'bySourceDraftId',
    input.sourceDraftId
  )
  const results = await Promise.allSettled(applications.map((application) => (
    loadApplicationPacket({ store: input.store, recordId: application.id, resume: input.resume })
  )))
  const packets = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
  const prepared = [] as ApplicationPacket[]
  for (const packet of packets) {
    if (detectMarketplaceFromJobUrl(packet.posting.canonicalUrl) !== 'boss') continue
    const now = input.now()
    let next: ApplicationPacket | null = null
    try {
      next = packet.record.status === 'ready-to-apply' && packet.ready
        ? packet
        : ['saved', 'analyzing', 'preparing', 'ready-to-apply'].includes(packet.record.status)
          ? await prepareApplicationPacket({
              store: input.store,
              recordId: packet.record.id,
              resume: input.resume,
              now
            })
          : null
    } catch (error) {
      if (!(error instanceof ApplicationRecordError) || error.code !== 'PACKET_NOT_READY') throw error
      continue
    }
    if (!next) continue
    const conversation = await ensureBossOpeningDraft({ store: input.store, applicationId: packet.record.id, now })
    if (packet.record.status !== 'ready-to-apply' || conversation.created) prepared.push(next)
  }
  const preparedById = new Map(prepared.map((packet) => [packet.record.id, packet]))
  return {
    packets: packets.map((packet) => preparedById.get(packet.record.id) ?? packet),
    preparedIds: prepared.map((packet) => packet.record.id)
  }
}
