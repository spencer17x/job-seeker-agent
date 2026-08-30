import { z } from 'zod'
import { createJobInputFingerprint, createStableJobDomainId } from './job-domain'
import type { IndexedDbDomainStore } from '@/lib/agent/domain-store'
import { detectMarketplaceFromJobUrl } from './job-marketplace'
import type { BrowserBossResumeReceipt, BrowserBossSendReceipt } from './browser-agent-protocol'
import type { BrowserBossConversationSignal } from './browser-agent-protocol'
import { recruitmentStageSchema } from './interview-domain'

const stableIdSchema = z.string().trim().min(1).max(160)
const timestampSchema = z.iso.datetime({ offset: true })
const fingerprintSchema = z.string().trim().min(1).max(256)
const bossResumeReceiptSchema = z.object({
  resumeVariantId: stableIdSchema,
  platformAttachmentId: z.string().trim().min(1).max(500),
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.enum(['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  byteLength: z.number().int().positive().max(1_000_000),
  contentFingerprint: fingerprintSchema,
  observedAt: timestampSchema
}).strict()

export const BOSS_MESSAGE_STATUSES = [
  'draft', 'awaiting-approval', 'approved', 'sending', 'sent', 'delivered', 'read', 'failed'
] as const

export const BOSS_DEFAULT_GREETING = '刚刚看了您发布的这个职位，我特别喜欢，可否聊聊呢？'

export const bossConversationThreadSchema = z.object({
  id: stableIdSchema,
  applicationId: stableIdSchema,
  platform: z.literal('boss'),
  status: z.enum(['draft', 'ready', 'active', 'closed', 'failed']),
  recruitmentStage: recruitmentStageSchema.default('outreach-draft'),
  recipientName: z.string().trim().min(1).max(300).optional(),
  recipientTitle: z.string().trim().min(1).max(300).optional(),
  platformRecipientId: z.string().trim().min(1).max(500).optional(),
  conversationId: z.string().trim().min(1).max(500).optional(),
  recipientFingerprint: fingerprintSchema.optional(),
  recipientVerifiedAt: timestampSchema.optional(),
  lastPlatformSignalId: fingerprintSchema.optional(),
  lastPlatformSignalAt: timestampSchema.optional(),
  seenPlatformSignalIds: z.array(fingerprintSchema).max(100).default([]),
  outcomeSignal: z.enum(['offer', 'rejection']).optional(),
  resumeReceipt: bossResumeReceiptSchema.optional(),
  resumeSendAttemptCount: z.number().int().min(0).max(10).default(0),
  resumeSendFailureCode: z.string().trim().min(1).max(200).optional(),
  nextResumeRetryAt: timestampSchema.optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
}).strict().superRefine((thread, context) => {
  const recipientFields = [thread.recipientFingerprint, thread.recipientVerifiedAt, thread.platformRecipientId, thread.conversationId]
  if (recipientFields.some(Boolean) && !recipientFields.every(Boolean)) {
    context.addIssue({ code: 'custom', path: ['recipientFingerprint'], message: 'Recipient verification fields must be stored together' })
  }
  if (Date.parse(thread.updatedAt) < Date.parse(thread.createdAt)) {
    context.addIssue({ code: 'custom', path: ['updatedAt'], message: 'Updated timestamp cannot precede creation' })
  }
  if (Boolean(thread.lastPlatformSignalId) !== Boolean(thread.lastPlatformSignalAt)) {
    context.addIssue({ code: 'custom', path: ['lastPlatformSignalId'], message: 'Platform signal identity and timestamp must be stored together' })
  }
  if (new Set(thread.seenPlatformSignalIds).size !== thread.seenPlatformSignalIds.length) {
    context.addIssue({ code: 'custom', path: ['seenPlatformSignalIds'], message: 'Platform signal IDs must be unique' })
  }
  if (thread.recruitmentStage === 'resume-sent' && !thread.resumeReceipt) {
    context.addIssue({ code: 'custom', path: ['resumeReceipt'], message: 'Resume-sent stage requires a verified attachment receipt' })
  }
})

export const bossPlatformReceiptSchema = z.object({
  conversationId: z.string().trim().min(1).max(500),
  messageId: z.string().trim().min(1).max(500),
  bodyFingerprint: fingerprintSchema,
  recipientFingerprint: fingerprintSchema,
  observedStatus: z.enum(['sent', 'delivered', 'read']),
  observedAt: timestampSchema
}).strict()

export const bossConversationMessageSchema = z.object({
  id: stableIdSchema,
  threadId: stableIdSchema,
  direction: z.enum(['outbound', 'inbound']),
  kind: z.enum(['opener', 'follow-up', 'reply', 'system']),
  status: z.enum(BOSS_MESSAGE_STATUSES),
  body: z.string().trim().min(1).max(5_000),
  bodyFingerprint: fingerprintSchema,
  evidenceFactIds: z.array(stableIdSchema).max(100),
  sourcePlatformSignalId: fingerprintSchema.optional(),
  sourceMessageId: stableIdSchema.optional(),
  recipientFingerprint: fingerprintSchema.optional(),
  approvedAt: timestampSchema.optional(),
  sentAt: timestampSchema.optional(),
  deliveredAt: timestampSchema.optional(),
  readAt: timestampSchema.optional(),
  receipt: bossPlatformReceiptSchema.optional(),
  failureCode: z.string().trim().min(1).max(200).optional(),
  attemptCount: z.number().int().min(0).max(10).default(0),
  nextRetryAt: timestampSchema.optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
}).strict().superRefine((message, context) => {
  const approved = ['approved', 'sending', 'sent', 'delivered', 'read'].includes(message.status)
  if (approved && (!message.approvedAt || !message.recipientFingerprint)) {
    context.addIssue({ code: 'custom', path: ['approvedAt'], message: 'Approved outbound messages require recipient verification' })
  }
  const externallyObserved = ['sent', 'delivered', 'read'].includes(message.status)
  if (externallyObserved && (!message.sentAt || !message.receipt)) {
    context.addIssue({ code: 'custom', path: ['receipt'], message: 'External message states require a platform receipt' })
  }
  if (message.receipt && (
    message.receipt.bodyFingerprint !== message.bodyFingerprint
    || message.receipt.recipientFingerprint !== message.recipientFingerprint
  )) {
    context.addIssue({ code: 'custom', path: ['receipt'], message: 'Platform receipt must match the approved recipient and body' })
  }
  if (message.status === 'delivered' && !message.deliveredAt) {
    context.addIssue({ code: 'custom', path: ['deliveredAt'], message: 'Delivered messages require a timestamp' })
  }
  if (message.status === 'read' && (!message.deliveredAt || !message.readAt)) {
    context.addIssue({ code: 'custom', path: ['readAt'], message: 'Read messages require delivery and read timestamps' })
  }
  if (message.status === 'failed' && !message.failureCode) {
    context.addIssue({ code: 'custom', path: ['failureCode'], message: 'Failed messages require a safe failure code' })
  }
  if (Date.parse(message.updatedAt) < Date.parse(message.createdAt)) {
    context.addIssue({ code: 'custom', path: ['updatedAt'], message: 'Updated timestamp cannot precede creation' })
  }
})

export type BossConversationThread = z.infer<typeof bossConversationThreadSchema>
export type BossConversationMessage = z.infer<typeof bossConversationMessageSchema>
export type BossPlatformReceipt = z.infer<typeof bossPlatformReceiptSchema>
export type BossResumeReceipt = z.infer<typeof bossResumeReceiptSchema>

export function createBossConversationThread(input: { applicationId: string; now: string }): BossConversationThread {
  return bossConversationThreadSchema.parse({
    id: createStableJobDomainId('boss-thread', [input.applicationId]),
    applicationId: input.applicationId,
    platform: 'boss',
    status: 'draft',
    recruitmentStage: 'outreach-draft',
    seenPlatformSignalIds: [],
    createdAt: input.now,
    updatedAt: input.now
  })
}

export function createBossMessageDraft(input: {
  threadId: string
  kind: 'opener' | 'follow-up' | 'reply'
  body: string
  evidenceFactIds: string[]
  now: string
  sourcePlatformSignalId?: string
  sourceMessageId?: string
}): BossConversationMessage {
  const body = input.body.trim()
  return bossConversationMessageSchema.parse({
    id: createStableJobDomainId('boss-message', [
      input.threadId,
      input.kind,
      input.sourcePlatformSignalId ?? input.sourceMessageId ?? createJobInputFingerprint(body)
    ]),
    threadId: input.threadId,
    direction: 'outbound',
    kind: input.kind,
    status: 'awaiting-approval',
    body,
    bodyFingerprint: createJobInputFingerprint(body),
    evidenceFactIds: [...new Set(input.evidenceFactIds)],
    ...(input.sourcePlatformSignalId ? { sourcePlatformSignalId: input.sourcePlatformSignalId } : {}),
    ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}),
    createdAt: input.now,
    updatedAt: input.now
  })
}

export async function ensureBossSignalReplyDrafts(input: {
  store: IndexedDbDomainStore
  signals: BrowserBossConversationSignal[]
  now: string
}) {
  return input.store.transaction(
    ['bossConversationThreads', 'bossConversationMessages', 'applicationRecords', 'jobPostings'],
    'readwrite',
    async (transaction) => {
      const [threads, messages, applications, postings] = await Promise.all([
        transaction.list('bossConversationThreads'),
        transaction.list('bossConversationMessages'),
        transaction.list('applicationRecords'),
        transaction.list('jobPostings')
      ])
      const created: BossConversationMessage[] = []
      for (const signal of input.signals) {
        if (signal.kind === 'resume-request') continue
        if (messages.some((message) => message.sourcePlatformSignalId === signal.signalId)) continue
        const thread = threads.find((item) => item.conversationId === signal.conversationId)
        const application = thread ? applications.find((item) => item.id === thread.applicationId) : undefined
        const posting = application ? postings.find((item) => item.id === application.postingId) : undefined
        if (!thread || !posting || thread.outcomeSignal === 'rejection') continue
        const body = signalReplyBody({ kind: signal.kind, locale: posting.locale, title: posting.title })
        if (!body) continue
        const message = createBossMessageDraft({
          threadId: thread.id,
          kind: 'reply',
          body,
          evidenceFactIds: [],
          sourcePlatformSignalId: signal.signalId,
          now: input.now
        })
        await transaction.put('bossConversationMessages', message)
        messages.push(message)
        created.push(message)
      }
      return created
    }
  )
}

export async function ensureBossResumeReceiptReplyDraft(input: {
  store: IndexedDbDomainStore
  threadId: string
  now: string
}) {
  return input.store.transaction(
    ['bossConversationThreads', 'bossConversationMessages', 'applicationRecords', 'jobPostings'],
    'readwrite',
    async (transaction) => {
      const thread = await transaction.get('bossConversationThreads', input.threadId)
      if (!thread?.resumeReceipt) throw new TypeError('A verified BOSS resume receipt is required')
      const messages = await transaction.list('bossConversationMessages')
      const sourcePlatformSignalId = `resume-receipt:${thread.resumeReceipt.platformAttachmentId}`
      const existing = messages.find((message) => message.sourcePlatformSignalId === sourcePlatformSignalId)
      if (existing) return { message: existing, created: false }
      const application = await transaction.get('applicationRecords', thread.applicationId)
      const posting = application ? await transaction.get('jobPostings', application.postingId) : undefined
      if (!posting) throw new TypeError('BOSS posting unavailable for resume acknowledgement')
      const body = posting.locale === 'zh'
        ? `您好，针对${posting.title}岗位准备的简历已经发送，请查收。如需其他材料，我可以继续补充。`
        : `I have sent the resume tailored for the ${posting.title} role. Please let me know if any additional material would be helpful.`
      const message = createBossMessageDraft({
        threadId: thread.id,
        kind: 'reply',
        body,
        evidenceFactIds: [],
        sourcePlatformSignalId,
        now: input.now
      })
      await transaction.put('bossConversationMessages', message)
      return { message, created: true }
    }
  )
}

export async function ensureBossFollowUpDrafts(input: {
  store: IndexedDbDomainStore
  now: string
  delayMs?: number
}) {
  const delayMs = input.delayMs ?? 72 * 60 * 60 * 1_000
  if (!Number.isFinite(delayMs) || delayMs < 60 * 60 * 1_000) throw new TypeError('BOSS follow-up delay is invalid')
  return input.store.transaction(
    ['bossConversationThreads', 'bossConversationMessages', 'applicationRecords', 'jobPostings'],
    'readwrite',
    async (transaction) => {
      const [threads, messages, applications, postings] = await Promise.all([
        transaction.list('bossConversationThreads'),
        transaction.list('bossConversationMessages'),
        transaction.list('applicationRecords'),
        transaction.list('jobPostings')
      ])
      const created: BossConversationMessage[] = []
      for (const thread of threads) {
        if (thread.recruitmentStage !== 'awaiting-reply' || thread.status !== 'active') continue
        const threadMessages = messages.filter((message) => message.threadId === thread.id)
        if (threadMessages.some((message) => ['awaiting-approval', 'approved', 'sending'].includes(message.status))) continue
        if (threadMessages.filter((message) => message.kind === 'follow-up').length >= 2) continue
        const sent = threadMessages
          .filter((message) => message.direction === 'outbound' && message.sentAt)
          .sort((left, right) => right.sentAt!.localeCompare(left.sentAt!))[0]
        if (!sent?.sentAt || Date.parse(input.now) - Date.parse(sent.sentAt) < delayMs) continue
        if (threadMessages.some((message) => message.sourceMessageId === sent.id)) continue
        const application = applications.find((item) => item.id === thread.applicationId)
        const posting = application ? postings.find((item) => item.id === application.postingId) : undefined
        if (!posting) continue
        const body = posting.locale === 'zh'
          ? `您好，想跟进一下${posting.title}岗位的沟通进展。我仍然对这个机会感兴趣，如需补充材料或信息，请告诉我。`
          : `I wanted to follow up on the ${posting.title} role. I remain interested and would be happy to provide any additional information.`
        const message = createBossMessageDraft({
          threadId: thread.id,
          kind: 'follow-up',
          body,
          evidenceFactIds: [],
          sourceMessageId: sent.id,
          now: input.now
        })
        await transaction.put('bossConversationMessages', message)
        messages.push(message)
        created.push(message)
      }
      return created
    }
  )
}

function signalReplyBody(input: {
  kind: BrowserBossConversationSignal['kind']
  locale: 'zh' | 'en'
  title: string
}) {
  if (input.kind === 'rejection') return null
  if (input.locale === 'zh') {
    if (input.kind === 'recruiter-reply') return `感谢回复，我对${input.title}岗位仍然感兴趣，期待进一步沟通。`
    if (input.kind === 'interview-invite') return `感谢面试邀请，我愿意参加${input.title}岗位的面试。请告知可选时间和面试形式。`
    if (input.kind === 'interview-schedule') return `已收到${input.title}岗位的面试安排，我会按约参加。如安排有变化，请及时告知。`
    if (input.kind === 'offer') return `感谢认可，我已收到${input.title}岗位的录用信息，会认真查看并尽快回复。`
  } else {
    if (input.kind === 'recruiter-reply') return `Thank you for the reply. I remain interested in the ${input.title} role and look forward to continuing the conversation.`
    if (input.kind === 'interview-invite') return `Thank you for the interview invitation. I would be glad to interview for the ${input.title} role. Please share the available times and format.`
    if (input.kind === 'interview-schedule') return `I have received the interview schedule for the ${input.title} role and will attend as arranged. Please let me know if anything changes.`
    if (input.kind === 'offer') return `Thank you for the offer for the ${input.title} role. I will review the details carefully and respond soon.`
  }
  return null
}

export function verifyBossConversationRecipient(input: {
  thread: BossConversationThread
  platformRecipientId: string
  conversationId: string
  recipientName: string
  recipientTitle?: string
  now: string
}) {
  if (
    (input.thread.platformRecipientId && input.thread.platformRecipientId !== input.platformRecipientId.trim())
    || (input.thread.conversationId && input.thread.conversationId !== input.conversationId.trim())
  ) throw new TypeError('A verified BOSS thread cannot be rebound to another recipient or conversation')
  const recipientFingerprint = createJobInputFingerprint({
    platform: 'boss',
    platformRecipientId: input.platformRecipientId.trim(),
    conversationId: input.conversationId.trim(),
    recipientName: input.recipientName.trim()
  })
  return bossConversationThreadSchema.parse({
    ...input.thread,
    status: 'ready',
    recipientName: input.recipientName,
    ...(input.recipientTitle ? { recipientTitle: input.recipientTitle } : {}),
    recipientFingerprint,
    platformRecipientId: input.platformRecipientId,
    conversationId: input.conversationId,
    recipientVerifiedAt: input.now,
    updatedAt: input.now
  })
}

export function clearInvalidBossRecipientBinding(input: {
  thread: BossConversationThread
  now: string
}) {
  if (
    !input.thread.platformRecipientId?.startsWith('target:')
    || !input.thread.conversationId?.startsWith('target:')
    || input.thread.recruitmentStage !== 'outreach-draft'
    || input.thread.resumeReceipt
  ) return input.thread
  return bossConversationThreadSchema.parse({
    ...input.thread,
    status: 'draft',
    recipientName: undefined,
    recipientTitle: undefined,
    platformRecipientId: undefined,
    conversationId: undefined,
    recipientFingerprint: undefined,
    recipientVerifiedAt: undefined,
    updatedAt: input.now
  })
}

export function isBossResumeRetryDue(input: {
  thread: BossConversationThread
  now: string
}) {
  return input.thread.recruitmentStage === 'resume-requested'
    && input.thread.resumeSendFailureCode === 'BOSS_RESUME_SEND_NOT_VERIFIED'
    && input.thread.resumeSendAttemptCount > 0
    && input.thread.resumeSendAttemptCount < 3
    && Boolean(input.thread.nextResumeRetryAt)
    && Date.parse(input.thread.nextResumeRetryAt!) <= Date.parse(input.now)
}

const signalStages: Record<BrowserBossConversationSignal['kind'], BossConversationThread['recruitmentStage']> = {
  'recruiter-reply': 'recruiter-replied',
  'resume-request': 'resume-requested',
  'interview-invite': 'interview-invited',
  'interview-schedule': 'interview-scheduled',
  offer: 'completed',
  rejection: 'completed'
}

export function applyBossConversationSignal(input: {
  thread: BossConversationThread
  signal: BrowserBossConversationSignal
  now: string
}) {
  const thread = bossConversationThreadSchema.parse(input.thread)
  if (!thread.conversationId || thread.conversationId !== input.signal.conversationId) {
    throw new TypeError('BOSS conversation signal does not match the verified thread')
  }
  if (thread.seenPlatformSignalIds.includes(input.signal.signalId)) return input.thread
  const currentIndex = RECRUITMENT_STAGE_ORDER.indexOf(thread.recruitmentStage)
  const proposedStage = signalStages[input.signal.kind]
  const proposedIndex = RECRUITMENT_STAGE_ORDER.indexOf(proposedStage)
  const recruitmentStage = proposedIndex >= currentIndex ? proposedStage : thread.recruitmentStage
  return bossConversationThreadSchema.parse({
    ...thread,
    status: 'active',
    recruitmentStage,
    lastPlatformSignalId: input.signal.signalId,
    lastPlatformSignalAt: input.signal.observedAt,
    seenPlatformSignalIds: [...thread.seenPlatformSignalIds, input.signal.signalId].slice(-100),
    ...(input.signal.kind === 'offer' || input.signal.kind === 'rejection'
      ? { outcomeSignal: input.signal.kind }
      : {}),
    updatedAt: input.now
  })
}

const RECRUITMENT_STAGE_ORDER: BossConversationThread['recruitmentStage'][] = [
  'outreach-draft', 'awaiting-reply', 'recruiter-replied', 'resume-requested',
  'resume-sent', 'interview-invited', 'interview-scheduled', 'interviewing',
  'awaiting-result', 'completed'
]

export async function syncBossConversationSignals(input: {
  store: IndexedDbDomainStore
  signals: BrowserBossConversationSignal[]
  now: string
}) {
  return input.store.transaction(['bossConversationThreads'], 'readwrite', async (transaction) => {
    const threads = await transaction.list('bossConversationThreads')
    const threadByConversation = new Map(threads.flatMap((thread) => (
      thread.conversationId ? [[thread.conversationId, thread] as const] : []
    )))
    const updated: BossConversationThread[] = []
    for (const signal of input.signals) {
      const thread = threadByConversation.get(signal.conversationId)
      if (!thread) continue
      const next = applyBossConversationSignal({ thread, signal, now: input.now })
      if (next !== thread) {
        await transaction.put('bossConversationThreads', next)
        threadByConversation.set(signal.conversationId, next)
        updated.push(next)
      }
    }
    return updated
  })
}

export function approveBossMessage(input: {
  message: BossConversationMessage
  recipientFingerprint: string
  now: string
}) {
  if (input.message.status !== 'awaiting-approval') throw new TypeError('Only reviewable BOSS messages can be approved')
  return bossConversationMessageSchema.parse({
    ...input.message,
    status: 'approved',
    recipientFingerprint: input.recipientFingerprint,
    approvedAt: input.now,
    updatedAt: input.now
  })
}

export async function approveBossConversationMessage(input: {
  store: IndexedDbDomainStore
  threadId: string
  messageId: string
  now: string
}) {
  return input.store.transaction(
    ['bossConversationThreads', 'bossConversationMessages'],
    'readwrite',
    async (transaction) => {
      const [thread, message] = await Promise.all([
        transaction.get('bossConversationThreads', input.threadId),
        transaction.get('bossConversationMessages', input.messageId)
      ])
      if (
        !thread
        || !message
        || message.threadId !== thread.id
        || thread.status !== 'ready'
        || !thread.recipientFingerprint
        || !thread.recipientVerifiedAt
      ) throw new TypeError('The BOSS recipient has not been verified for this message')
      const approved = approveBossMessage({
        message,
        recipientFingerprint: thread.recipientFingerprint,
        now: input.now
      })
      await transaction.put('bossConversationMessages', approved)
      return approved
    }
  )
}

export function reviseBossMessageDraft(input: {
  message: BossConversationMessage
  body: string
  now: string
}) {
  if (!['draft', 'awaiting-approval', 'approved', 'failed'].includes(input.message.status)) {
    throw new TypeError('A BOSS message already being sent cannot be revised')
  }
  const body = input.body.trim()
  return bossConversationMessageSchema.parse({
    ...input.message,
    status: 'awaiting-approval',
    body,
    bodyFingerprint: createJobInputFingerprint(body),
    recipientFingerprint: undefined,
    approvedAt: undefined,
    sentAt: undefined,
    deliveredAt: undefined,
    readAt: undefined,
    receipt: undefined,
    failureCode: undefined,
    attemptCount: 0,
    nextRetryAt: undefined,
    updatedAt: input.now
  })
}

export function assertBossMessageReadyToSend(input: {
  message: BossConversationMessage
  body: string
  recipientFingerprint: string
}) {
  const message = bossConversationMessageSchema.parse(input.message)
  if (
    message.status !== 'approved'
    || message.bodyFingerprint !== createJobInputFingerprint(input.body.trim())
    || message.recipientFingerprint !== input.recipientFingerprint
  ) throw new TypeError('BOSS message approval is stale or does not match the active recipient')
  return message
}

export function markBossMessageSending(input: {
  message: BossConversationMessage
  body: string
  recipientFingerprint: string
  now: string
}) {
  const message = assertBossMessageReadyToSend(input)
  return bossConversationMessageSchema.parse({
    ...message,
    status: 'sending',
    nextRetryAt: undefined,
    updatedAt: input.now
  })
}

export function failBossMessage(input: {
  message: BossConversationMessage
  failureCode: string
  now: string
}) {
  if (!['approved', 'sending'].includes(input.message.status)) {
    throw new TypeError('Only an approved or sending BOSS message can fail')
  }
  const attemptCount = Math.min(10, input.message.attemptCount + 1)
  const retryDelayMs = Math.min(6 * 60 * 60 * 1_000, 5 * 60 * 1_000 * (2 ** Math.max(0, attemptCount - 1)))
  return bossConversationMessageSchema.parse({
    ...input.message,
    status: 'failed',
    failureCode: input.failureCode,
    attemptCount,
    nextRetryAt: new Date(Date.parse(input.now) + retryDelayMs).toISOString(),
    updatedAt: input.now
  })
}

export function retryBossMessageDraft(input: {
  message: BossConversationMessage
  now: string
  maximumAttempts?: number
}) {
  const maximumAttempts = input.maximumAttempts ?? 3
  if (!Number.isInteger(maximumAttempts) || maximumAttempts < 1 || maximumAttempts > 10) {
    throw new TypeError('BOSS retry limit is invalid')
  }
  if (
    input.message.status !== 'failed'
    || input.message.attemptCount >= maximumAttempts
    || (input.message.nextRetryAt && Date.parse(input.message.nextRetryAt) > Date.parse(input.now))
  ) return null
  return bossConversationMessageSchema.parse({
    ...input.message,
    status: 'awaiting-approval',
    recipientFingerprint: undefined,
    approvedAt: undefined,
    failureCode: undefined,
    nextRetryAt: undefined,
    updatedAt: input.now
  })
}

export function recordBossMessageReceipt(input: {
  message: BossConversationMessage
  receipt: BossPlatformReceipt
  now: string
}) {
  if (!['approved', 'sending', 'sent', 'delivered'].includes(input.message.status)) {
    throw new TypeError('BOSS message is not awaiting a platform receipt')
  }
  const receipt = bossPlatformReceiptSchema.parse(input.receipt)
  const status = receipt.observedStatus
  return bossConversationMessageSchema.parse({
    ...input.message,
    status,
    receipt,
    nextRetryAt: undefined,
    sentAt: input.message.sentAt ?? receipt.observedAt,
    ...(status === 'delivered' || status === 'read' ? { deliveredAt: input.message.deliveredAt ?? receipt.observedAt } : {}),
    ...(status === 'read' ? { readAt: receipt.observedAt } : {}),
    updatedAt: input.now
  })
}

export async function executeApprovedBossMessage(input: {
  store: IndexedDbDomainStore
  thread: BossConversationThread
  message: BossConversationMessage
  now: () => string
  send: (input: {
    message: BossConversationMessage
    thread: BossConversationThread
  }) => Promise<BrowserBossSendReceipt>
}) {
  if (
    !input.thread.recipientFingerprint
    || !input.thread.platformRecipientId
    || !input.thread.conversationId
    || !input.thread.recipientName
  ) throw new TypeError('The BOSS recipient is not ready for sending')
  let sending = markBossMessageSending({
    message: input.message,
    body: input.message.body,
    recipientFingerprint: input.thread.recipientFingerprint,
    now: input.now()
  })
  await input.store.put('bossConversationMessages', sending)
  try {
    const receipt = await input.send({ message: sending, thread: input.thread })
    const observedRecipient = verifyBossConversationRecipient({
      thread: input.thread,
      ...receipt.observedRecipient,
      now: receipt.observedAt
    })
    if (
      observedRecipient.recipientFingerprint !== input.thread.recipientFingerprint
      || createJobInputFingerprint(receipt.observedBody) !== input.message.bodyFingerprint
      || receipt.conversationId !== input.thread.conversationId
    ) throw new TypeError('BOSS send receipt does not match approval')
    const persisted = recordBossMessageReceipt({
      message: sending,
      receipt: {
        conversationId: receipt.conversationId,
        messageId: receipt.platformMessageId,
        bodyFingerprint: input.message.bodyFingerprint,
        recipientFingerprint: input.thread.recipientFingerprint,
        observedStatus: receipt.observedStatus,
        observedAt: receipt.observedAt
      },
      now: input.now()
    })
    await input.store.transaction(['bossConversationThreads', 'bossConversationMessages'], 'readwrite', async (transaction) => {
      await transaction.put('bossConversationMessages', persisted)
      await transaction.put('bossConversationThreads', bossConversationThreadSchema.parse({
        ...input.thread,
        status: 'active',
        recruitmentStage: RECRUITMENT_STAGE_ORDER.indexOf(input.thread.recruitmentStage)
          > RECRUITMENT_STAGE_ORDER.indexOf('awaiting-reply')
          ? input.thread.recruitmentStage
          : 'awaiting-reply',
        updatedAt: persisted.updatedAt
      }))
    })
    return persisted
  } catch (error) {
    sending = failBossMessage({
      message: sending,
      failureCode: 'BOSS_SEND_NOT_VERIFIED',
      now: input.now()
    })
    await input.store.put('bossConversationMessages', sending)
    throw error
  }
}

export async function executeBossResumeAttachment(input: {
  store: IndexedDbDomainStore
  thread: BossConversationThread
  fileName: string
  bytesBase64: string
  byteLength: number
  mimeType: 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  contentFingerprint: string
  now: () => string
  send: () => Promise<BrowserBossResumeReceipt>
}) {
  if (
    input.thread.recruitmentStage !== 'resume-requested'
    || !input.thread.recipientFingerprint
    || !input.thread.platformRecipientId
    || !input.thread.conversationId
    || !input.thread.recipientName
  ) throw new TypeError('The BOSS thread is not ready to send a requested resume')
  const [application, variants] = await Promise.all([
    input.store.get('applicationRecords', input.thread.applicationId),
    input.store.list('resumeVariants')
  ])
  const variant = application?.resumeVariantId
    ? variants.find((item) => item.id === application.resumeVariantId)
    : undefined
  if (
    !application?.targetJobId
    || !variant
    || variant.targetJobId !== application.targetJobId
    || variant.sourceDraftId !== application.sourceDraftId
  ) throw new TypeError('A related job-specific resume variant is required')

  let receipt: BrowserBossResumeReceipt
  try {
    receipt = await input.send()
    const observedRecipient = verifyBossConversationRecipient({
      thread: input.thread,
      ...receipt.observedRecipient,
      now: receipt.observedAt
    })
    if (
      observedRecipient.recipientFingerprint !== input.thread.recipientFingerprint
      || receipt.conversationId !== input.thread.conversationId
      || receipt.observedFileName !== input.fileName
      || receipt.observedByteLength !== input.byteLength
      || receipt.observedMimeType !== input.mimeType
      || receipt.contentFingerprint !== input.contentFingerprint
    ) throw new TypeError('BOSS resume receipt does not match the approved variant artifact')
  } catch (error) {
    const resumeSendAttemptCount = Math.min(10, input.thread.resumeSendAttemptCount + 1)
    const retryDelayMs = Math.min(
      6 * 60 * 60 * 1_000,
      5 * 60 * 1_000 * (2 ** Math.max(0, resumeSendAttemptCount - 1))
    )
    await input.store.put('bossConversationThreads', bossConversationThreadSchema.parse({
      ...input.thread,
      resumeSendAttemptCount,
      resumeSendFailureCode: 'BOSS_RESUME_SEND_NOT_VERIFIED',
      nextResumeRetryAt: new Date(Date.parse(input.now()) + retryDelayMs).toISOString(),
      updatedAt: input.now()
    }))
    throw error
  }

  const next = bossConversationThreadSchema.parse({
    ...input.thread,
    status: 'active',
    recruitmentStage: 'resume-sent',
    resumeReceipt: {
      resumeVariantId: variant.id,
      platformAttachmentId: receipt.platformAttachmentId,
      fileName: input.fileName,
      mimeType: receipt.observedMimeType,
      byteLength: input.byteLength,
      contentFingerprint: input.contentFingerprint,
      observedAt: receipt.observedAt
    },
    resumeSendFailureCode: undefined,
    nextResumeRetryAt: undefined,
    updatedAt: input.now()
  })
  await input.store.put('bossConversationThreads', next)
  return next
}

export async function ensureBossOpeningDraft(input: {
  store: IndexedDbDomainStore
  applicationId: string
  now: string
}) {
  return input.store.transaction(
    ['applicationRecords', 'jobPostings', 'optimizationRuns', 'careerFacts', 'bossConversationThreads', 'bossConversationMessages'],
    'readwrite',
    async (transaction) => {
      const application = await transaction.get('applicationRecords', input.applicationId)
      if (!application || application.status !== 'ready-to-apply' || !application.targetJobId || !application.resumeVariantId) {
        throw new TypeError('A validated job-specific resume is required before drafting BOSS outreach')
      }
      const posting = await transaction.get('jobPostings', application.postingId)
      if (!posting || detectMarketplaceFromJobUrl(posting.canonicalUrl) !== 'boss') {
        throw new TypeError('The application is not a BOSS role')
      }
      const existingThreads = await transaction.list('bossConversationThreads')
      const existingMessages = await transaction.list('bossConversationMessages')
      let thread = existingThreads.find((item) => item.applicationId === application.id)
      if (!thread) {
        thread = createBossConversationThread({ applicationId: application.id, now: input.now })
        await transaction.put('bossConversationThreads', thread)
      }
      const existing = existingMessages.find((message) => message.threadId === thread.id && message.kind === 'opener')
      if (existing) return { thread, message: existing, created: false }

      const [runs, facts] = await Promise.all([
        transaction.list('optimizationRuns'),
        transaction.list('careerFacts')
      ])
      const run = runs.find((item) => (
        item.targetJobId === application.targetJobId
        && item.sourceDraftId === application.sourceDraftId
        && item.stage === 'applied'
        && item.appliedVariantId === application.resumeVariantId
      ))
      if (!run) throw new TypeError('The applied BOSS optimization run is missing')
      const supportedFactIds = [...new Set(run.requirementMatches.flatMap((match) => match.factIds))]
      const supportedFacts = supportedFactIds.flatMap((id) => {
        const fact = facts.find((item) => item.id === id)
        return fact ? [fact] : []
      })
      const evidence = supportedFacts[0]
      const body = BOSS_DEFAULT_GREETING
      const message = createBossMessageDraft({
        threadId: thread.id,
        kind: 'opener',
        body,
        evidenceFactIds: evidence ? [evidence.id] : [],
        now: input.now
      })
      await transaction.put('bossConversationMessages', message)
      return { thread, message, created: true }
    }
  )
}
