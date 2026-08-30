import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createDomainStore } from '@/lib/agent/domain-store'
import { createOptimizationRun, transitionOptimizationRun } from '@/lib/agent/optimization-run'
import { scoreRequirementMatrix } from '@/lib/agent/requirement-matrix'
import { fingerprintOptimizationInputs } from '@/lib/agent/workflow-persistence'
import { normalizeResumeData } from '@/lib/resume-model'
import type { ApplicationRecord } from './job-domain'
import {
  BOSS_DEFAULT_GREETING,
  approveBossConversationMessage,
  applyBossConversationSignal,
  executeApprovedBossMessage,
  executeBossResumeAttachment,
  ensureBossFollowUpDrafts,
  ensureBossSignalReplyDrafts,
  verifyBossConversationRecipient
} from './boss-conversation'
import {
  ApplicationRecordError,
  loadApplicationPacket,
  markApplicationApplied,
  prepareApplicationPacket,
  prepareReadyBossApplicationPackets,
  transitionApplicationRecord
} from './application-record'

const now = '2026-08-01T08:00:00.000Z'
const later = '2026-08-01T09:00:00.000Z'
const muchLater = '2026-08-05T09:00:00.000Z'
const resume = normalizeResumeData({
  profile: { name: 'Ada', title: 'Engineer', summary: ['Builds systems.'], tags: [], links: [] },
  metadata: { source: 'paste', locale: 'en', updatedAt: now }
})

function baseRecord(): ApplicationRecord {
  return {
    id: 'application-1', postingId: 'posting-1', sourceDraftId: 'draft-1', status: 'saved',
    notes: '', createdAt: now, updatedAt: now
  }
}

async function readyHarness() {
  const store = createDomainStore({ databaseName: `application-${crypto.randomUUID()}`, indexedDB: new IDBFactory() })
  const source = { id: 'source-1', kind: 'manual' as const, label: 'BOSS', enabled: true, createdAt: now, updatedAt: now }
  const profile = { id: 'profile-1', name: 'Roles', titles: ['Engineer'], adjacentTitles: [], locations: [], excludedLocations: [], workplaceTypes: [], employmentTypes: [], requiredTerms: [], preferredTerms: [], excludedTerms: [], maximumAgeDays: 30, createdAt: now, updatedAt: now }
  const posting = { id: 'posting-1', sourceId: source.id, externalId: '1', canonicalUrl: 'https://www.zhipin.com/job_detail/1.html', applyUrl: 'https://www.zhipin.com/job_detail/1.html', title: 'Engineer', company: 'Example', description: 'Build reliable systems.', locale: 'en' as const, firstSeenAt: now, lastCheckedAt: now, status: 'open' as const, contentHash: 'hash:posting' }
  const target = { id: 'target-1', title: posting.title, company: posting.company, description: posting.description, locale: 'en' as const, createdAt: now, updatedAt: now }
  const requirement = { id: 'requirement-1', jobId: target.id, text: 'Build reliable systems', category: 'experience' as const, priority: 'must' as const, weight: 5, keywords: ['reliable'], userConfirmed: true }
  const match = { requirementId: requirement.id, factIds: ['fact-1'], status: 'direct' as const, rationale: 'Verified experience.' }
  const fact = { id: 'fact-1', kind: 'experience' as const, text: 'Built reliable systems.', evidenceRefs: ['evidence-1'], verification: 'user-confirmed' as const, tags: ['reliable'], createdAt: now, updatedAt: now }
  const workflowFingerprint = fingerprintOptimizationInputs({ sourceDraftId: 'draft-1', resume, targetJob: target, requirements: [requirement], requirementMatches: [match], careerFacts: [fact] })
  const score = scoreRequirementMatrix({ version: 1, targetJobId: target.id, inputFingerprint: 'matrix:fingerprint', requirements: [requirement], matches: [match] })
  let run = createOptimizationRun({ id: 'run-1', sourceDraftId: 'draft-1', targetJobId: target.id, inputFingerprint: 'matrix:fingerprint', now })
  run = transitionOptimizationRun(run, { type: 'requirements-ready' }, now)
  run = transitionOptimizationRun(run, { type: 'map-evidence', requirementMatches: [match], questions: [], scoreBefore: score }, now)
  run = transitionOptimizationRun(run, { type: 'prepare-plan', plan: { id: 'plan-1', summary: 'Emphasize verified evidence.', items: [{ id: 'item-1', requirementIds: [requirement.id], factIds: [fact.id], targetPath: 'profile.summary.0', intent: 'Clarify evidence.', transformation: 'emphasize' }] } }, now)
  run = transitionOptimizationRun(run, { type: 'request-plan-approval' }, now)
  run = transitionOptimizationRun(run, { type: 'approve-plan' }, now)
  run = transitionOptimizationRun(run, { type: 'propose-changes', currentFingerprint: workflowFingerprint, changeSet: { summary: 'Clarify.', questions: [], changes: [{ id: 'change-1', path: 'profile.summary.0', original: 'Builds systems.', proposed: 'Builds reliable systems.', reason: 'Approved evidence.', needsConfirmation: false, evidence: { requirementIds: [requirement.id], factIds: [fact.id], matchType: 'direct', support: 'verified', confidence: 0.9, transformation: 'emphasize' } }] } }, now)
  run = transitionOptimizationRun(run, { type: 'approve-changes', acceptedChangeIds: ['change-1'] }, now)
  run = transitionOptimizationRun(run, { type: 'apply', currentFingerprint: workflowFingerprint, appliedVariantId: 'variant-1', scoreAfter: score }, now)
  const variant = { id: 'variant-1', sourceDraftId: 'draft-1', targetJobId: target.id, name: 'Ada · Engineer', data: resume, createdAt: now, updatedAt: now }
  const recommendation = { id: 'recommendation-1', postingId: posting.id, searchProfileId: profile.id, sourceDraftId: 'draft-1', rubricVersion: 'job-seeker-agent-job-relevance-v1', inputFingerprint: 'recommendation:fingerprint', eligibility: 'eligible' as const, preliminaryScore: 90, decision: 'saved' as const, reasons: [], analyzedTargetJobId: target.id, createdAt: now, updatedAt: now }
  const application: ApplicationRecord = { ...baseRecord(), targetJobId: target.id, postingContentHash: posting.contentHash, recommendationFingerprint: recommendation.inputFingerprint, status: 'analyzing' }
  await store.put('evidenceSources', { id: 'evidence-1', type: 'user-answer', label: 'Synthetic evidence', excerpt: 'Built reliable systems.', createdAt: now })
  await store.put('careerFacts', fact)
  await store.put('targetJobs', target)
  await store.put('jobRequirements', requirement)
  await store.put('requirementMatches', match)
  await store.put('resumeVariants', variant)
  await store.put('optimizationRuns', run)
  await store.put('jobSources', source)
  await store.put('jobSearchProfiles', profile)
  await store.put('jobPostings', posting)
  await store.put('jobRecommendations', recommendation)
  await store.put('applicationRecords', application)
  return { store, posting, application, workflowFingerprint }
}

describe('application records', () => {
  it('uses an explicit deterministic transition table and submission event', () => {
    const preparing = transitionApplicationRecord({ record: baseRecord(), status: 'preparing', now: later })
    const ready = transitionApplicationRecord({ record: preparing, status: 'ready-to-apply', now: later })
    expect(() => transitionApplicationRecord({ record: ready, status: 'applied', now: later })).toThrow(ApplicationRecordError)
    expect(transitionApplicationRecord({ record: ready, status: 'applied', now: later, explicitSubmission: true })).toMatchObject({ status: 'applied', submittedAt: later })
    expect(() => transitionApplicationRecord({ record: baseRecord(), status: 'applied', now: later, explicitSubmission: true })).toThrow(ApplicationRecordError)
  })

  it('becomes ready only for a current posting, applied run, related variant, and current evidence inputs', async () => {
    const { store, application, workflowFingerprint } = await readyHarness()
    const automatic = await prepareReadyBossApplicationPackets({
      store, sourceDraftId: application.sourceDraftId, resume, now: () => later
    })
    const prepared = automatic.packets.find((packet) => packet.record.id === application.id)!
    expect(prepared.ready).toBe(true)
    expect(automatic.preparedIds).toEqual([application.id])
    expect(prepared.record).toMatchObject({ status: 'ready-to-apply', resumeVariantId: 'variant-1', workflowInputFingerprint: workflowFingerprint })
    const [conversationThread] = await store.list('bossConversationThreads')
    const [conversationMessage] = await store.list('bossConversationMessages')
    expect(conversationMessage).toMatchObject({
      status: 'awaiting-approval', evidenceFactIds: ['fact-1']
    })
    expect(conversationMessage.body).toBe(BOSS_DEFAULT_GREETING)
    const repeated = await prepareReadyBossApplicationPackets({
      store, sourceDraftId: application.sourceDraftId, resume, now: () => later
    })
    expect(repeated.preparedIds).toEqual([])
    expect(await store.list('bossConversationThreads')).toHaveLength(1)
    expect(await store.list('bossConversationMessages')).toHaveLength(1)
    const verifiedThread = verifyBossConversationRecipient({
      thread: conversationThread,
      platformRecipientId: 'boss-user-1',
      conversationId: 'conversation-1',
      recipientName: 'Recruiter',
      now: later
    })
    await store.put('bossConversationThreads', verifiedThread)
    const approved = await approveBossConversationMessage({
      store, threadId: verifiedThread.id, messageId: conversationMessage.id, now: later
    })
    const delivered = await executeApprovedBossMessage({
      store,
      thread: verifiedThread,
      message: approved,
      now: () => later,
      send: async ({ message, thread }) => ({
        platformMessageId: 'platform-message-1',
        conversationId: thread.conversationId!,
        observedBody: message.body,
        observedStatus: 'delivered',
        observedRecipient: {
          platformRecipientId: thread.platformRecipientId!,
          conversationId: thread.conversationId!,
          recipientName: thread.recipientName!
        },
        observedAt: later
      })
    })
    expect(delivered).toMatchObject({ status: 'delivered', receipt: { messageId: 'platform-message-1' } })
    const activeThread = (await store.get('bossConversationThreads', verifiedThread.id))!
    const followUps = await ensureBossFollowUpDrafts({ store, now: muchLater })
    expect(followUps).toHaveLength(1)
    expect(followUps[0]).toMatchObject({ kind: 'follow-up', sourceMessageId: conversationMessage.id })
    await expect(ensureBossFollowUpDrafts({ store, now: muchLater })).resolves.toEqual([])
    await store.delete('bossConversationMessages', followUps[0].id)
    const replySignal = {
      signalId: 'fnv1a64:recruiter-reply', conversationId: 'conversation-1',
      kind: 'recruiter-reply' as const, observedAt: later
    }
    const recruiterReplied = applyBossConversationSignal({ thread: activeThread, signal: replySignal, now: later })
    await store.put('bossConversationThreads', recruiterReplied)
    const replies = await ensureBossSignalReplyDrafts({ store, signals: [replySignal], now: later })
    expect(replies).toHaveLength(1)
    expect(replies[0]).toMatchObject({ kind: 'reply', sourcePlatformSignalId: replySignal.signalId })
    await expect(ensureBossSignalReplyDrafts({ store, signals: [replySignal], now: later })).resolves.toEqual([])
    await store.delete('bossConversationMessages', replies[0].id)
    const resumeRequested = applyBossConversationSignal({
      thread: recruiterReplied,
      signal: {
        signalId: 'fnv1a64:resume-request', conversationId: 'conversation-1',
        kind: 'resume-request', observedAt: later
      },
      now: later
    })
    await store.put('bossConversationThreads', resumeRequested)
    const resumeSent = await executeBossResumeAttachment({
      store,
      thread: resumeRequested,
      fileName: 'ada-engineer.docx',
      bytesBase64: 'ZG9jeA==',
      byteLength: 4,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      contentFingerprint: 'fnv1a64:docx',
      now: () => later,
      send: async () => ({
        platformAttachmentId: 'attachment-1',
        conversationId: 'conversation-1',
        observedFileName: 'ada-engineer.docx',
        observedMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        observedByteLength: 4,
        contentFingerprint: 'fnv1a64:docx',
        observedRecipient: {
          platformRecipientId: 'boss-user-1', conversationId: 'conversation-1', recipientName: 'Recruiter'
        },
        observedAt: later
      })
    })
    expect(resumeSent).toMatchObject({
      recruitmentStage: 'resume-sent',
      resumeReceipt: { resumeVariantId: 'variant-1', platformAttachmentId: 'attachment-1' }
    })
    const applied = await markApplicationApplied({ store, recordId: application.id, resume, now: later })
    expect(applied).toMatchObject({ status: 'applied', submittedAt: later })
  })

  it('rebinds stale metadata fingerprints only when the reviewed job content is unchanged', async () => {
    const { store, posting, application } = await readyHarness()
    await store.put('jobPostings', { ...posting, contentHash: 'hash:changed' })
    const prepared = await prepareApplicationPacket({ store, recordId: application.id, resume, now: later })
    expect(prepared.ready).toBe(true)
    expect(prepared.record).toMatchObject({ status: 'ready-to-apply', postingContentHash: 'hash:changed' })
  })

  it('backs off a resume upload when BOSS does not return a verified attachment receipt', async () => {
    const { store, application } = await readyHarness()
    await prepareReadyBossApplicationPackets({
      store, sourceDraftId: application.sourceDraftId, resume, now: () => later
    })
    const [thread] = await store.list('bossConversationThreads')
    const verified = verifyBossConversationRecipient({
      thread,
      platformRecipientId: 'boss-user-1', conversationId: 'conversation-1',
      recipientName: 'Recruiter', now: later
    })
    const resumeRequested = applyBossConversationSignal({
      thread: { ...verified, status: 'active', recruitmentStage: 'awaiting-reply' },
      signal: {
        signalId: 'fnv1a64:resume-failure', conversationId: 'conversation-1',
        kind: 'resume-request', observedAt: later
      },
      now: later
    })
    await store.put('bossConversationThreads', resumeRequested)
    await expect(executeBossResumeAttachment({
      store,
      thread: resumeRequested,
      fileName: 'ada-engineer.pdf',
      bytesBase64: 'cGRm',
      byteLength: 3,
      mimeType: 'application/pdf',
      contentFingerprint: 'fnv1a64:pdf',
      now: () => later,
      send: async () => { throw new TypeError('receipt missing') }
    })).rejects.toThrow('receipt missing')
    expect(await store.get('bossConversationThreads', thread.id)).toMatchObject({
      recruitmentStage: 'resume-requested',
      resumeSendAttemptCount: 1,
      resumeSendFailureCode: 'BOSS_RESUME_SEND_NOT_VERIFIED',
      nextResumeRetryAt: '2026-08-01T09:05:00.000Z'
    })
  })

  it('invalidates packet readiness when reviewed job content actually changes', async () => {
    const { store, posting, application } = await readyHarness()
    await store.put('jobPostings', {
      ...posting,
      description: 'Build a materially different payments platform.',
      contentHash: 'hash:material-change'
    })
    const packet = await loadApplicationPacket({ store, recordId: application.id, resume })
    expect(packet.ready).toBe(false)
    expect(packet.checks.find((check) => check.code === 'posting-current')?.passed).toBe(false)
    await expect(prepareApplicationPacket({ store, recordId: application.id, resume, now: later }))
      .rejects.toMatchObject({ code: 'PACKET_NOT_READY' })
    expect(await store.get('applicationRecords', application.id)).toMatchObject({ status: 'preparing' })
  })
})
