'use client'

import { useCallback, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { IndexedDbDomainStore } from '@/lib/agent/domain-store'
import { createJobInputFingerprint } from '@/lib/jobs/job-domain'
import type { JobAgentPreferences } from '@/lib/jobs/job-agent-policy'
import { canExecuteJobAgentAction } from '@/lib/jobs/job-agent-policy'
import {
  BOSS_DEFAULT_GREETING,
  approveBossConversationMessage,
  clearInvalidBossRecipientBinding,
  ensureBossFollowUpDrafts,
  ensureBossResumeReceiptReplyDraft,
  ensureBossSignalReplyDrafts,
  executeApprovedBossMessage,
  executeBossResumeAttachment,
  isBossResumeRetryDue,
  reviseBossMessageDraft,
  retryBossMessageDraft,
  syncBossConversationSignals,
  verifyBossConversationRecipient,
  type BossConversationMessage,
  type BossConversationThread
} from '@/lib/jobs/boss-conversation'
import {
  collectBossConversationSignals,
  diagnoseBossBrowserAdapter,
  inspectBossBrowserConversation,
  openBossBrowserConversation,
  sendBossBrowserMessage,
  sendBossResumeAttachment,
  type BrowserBossConversationSignal
} from '@/lib/jobs/browser-agent-protocol'

type ControllerInput = {
  store: IndexedDbDomainStore
  preferences: JobAgentPreferences
  threads: BossConversationThread[]
  messages: BossConversationMessage[]
  reload: () => Promise<void>
  setError: (message: string) => void
  setNotice: (message: string) => void
}

export function useBossConversationController(input: ControllerInput) {
  const t = useTranslations('jobRadar')
  const inputRef = useRef(input)
  const translationsRef = useRef(t)
  inputRef.current = input
  translationsRef.current = t
  const [busyMessageId, setBusyMessageId] = useState('')
  const [busyResumeThreadId, setBusyResumeThreadId] = useState('')
  const drainingRef = useRef(false)
  const signalThreadCursorRef = useRef(0)
  const autopilotMessageCursorRef = useRef(0)

  const hasAutomaticContactCapacity = useCallback(async () => {
    const current = inputRef.current
    const today = new Date().toISOString().slice(0, 10)
    const messages = (await Promise.all(current.threads.map((thread) => (
      current.store.listByIndex('bossConversationMessages', 'byThreadId', thread.id)
    )))).flat()
    return messages.filter((message) => message.sentAt?.slice(0, 10) === today).length
      < current.preferences.dailyContactLimit
  }, [])

  const sendApproved = useCallback(async (
    messageId: string,
    preparedMessage?: BossConversationMessage,
    preparedThread?: BossConversationThread
  ) => {
    const current = inputRef.current
    const t = translationsRef.current
    const message = preparedMessage ?? current.messages.find((item) => item.id === messageId)
    const thread = preparedThread ?? (message
      ? current.threads.find((item) => item.id === message.threadId)
      : undefined)
    if (
      !message
      || !thread?.recipientFingerprint
      || !thread.platformRecipientId
      || !thread.conversationId
      || !thread.recipientName
    ) return
    setBusyMessageId(messageId)
    current.setError('')
    try {
      const persisted = await executeApprovedBossMessage({
        store: current.store,
        thread,
        message,
        now: () => new Date().toISOString(),
        send: async ({ message: approved, thread: verified }) => {
          const response = await sendBossBrowserMessage({
            window,
            messageId: approved.id,
            body: approved.body,
            bodyFingerprint: approved.bodyFingerprint,
            recipient: {
              platformRecipientId: verified.platformRecipientId!,
              conversationId: verified.conversationId!,
              recipientName: verified.recipientName!,
              ...(verified.recipientTitle ? { recipientTitle: verified.recipientTitle } : {})
            },
            timeoutMs: 10_000
          })
          if (!response.ok || !response.sendReceipt) throw new TypeError('BOSS send receipt unavailable')
          return response.sendReceipt
        }
      })
      current.setNotice(t('jobAgent.messageSent', {
        status: t(`jobAgent.messageStatus.${persisted.status}`)
      }))
    } catch {
      current.setError(t('jobAgent.messageSendFailed'))
    } finally {
      setBusyMessageId('')
      await current.reload()
    }
  }, [])

  const tryAutopilotMessage = useCallback(async (message: BossConversationMessage) => {
    const current = inputRef.current
    try {
      if (!canExecuteJobAgentAction({
        action: 'send-message',
        preferences: current.preferences,
        connectorAuthorized: true
      })) return 'blocked'
      if (!await hasAutomaticContactCapacity()) return 'blocked'
      const storedThread = await current.store.get('bossConversationThreads', message.threadId)
      if (!storedThread) return 'skipped'
      const thread = clearInvalidBossRecipientBinding({
        thread: storedThread,
        now: new Date().toISOString()
      })
      const recipientBindingRepaired = thread !== storedThread
      if (recipientBindingRepaired) await current.store.put('bossConversationThreads', thread)
      const application = await current.store.get('applicationRecords', thread.applicationId)
      const posting = application
        ? await current.store.get('jobPostings', application.postingId)
        : undefined
      if (!posting) return 'skipped'
      let pendingMessage = await current.store.get('bossConversationMessages', message.id)
      if (!pendingMessage) return 'skipped'
      if (recipientBindingRepaired && ['approved', 'failed'].includes(pendingMessage.status)) {
        pendingMessage = reviseBossMessageDraft({
          message: pendingMessage,
          body: pendingMessage.body,
          now: new Date().toISOString()
        })
        await current.store.put('bossConversationMessages', pendingMessage)
      }
      if (pendingMessage.status === 'failed') {
        const retry = retryBossMessageDraft({
          message: pendingMessage,
          now: new Date().toISOString()
        })
        if (!retry) return 'skipped'
        pendingMessage = retry
        await current.store.put('bossConversationMessages', pendingMessage)
      }
      if (
        pendingMessage.kind === 'opener'
        && pendingMessage.status === 'awaiting-approval'
        && pendingMessage.body !== BOSS_DEFAULT_GREETING
      ) {
        pendingMessage = reviseBossMessageDraft({
          message: pendingMessage,
          body: BOSS_DEFAULT_GREETING,
          now: new Date().toISOString()
        })
        await current.store.put('bossConversationMessages', pendingMessage)
      }
      let verified = thread
      let observedOpeningReceipt
      {
        const response = await openBossBrowserConversation({
          window,
          url: posting.canonicalUrl,
          title: posting.title,
          company: posting.company,
          openingBody: BOSS_DEFAULT_GREETING,
          timeoutMs: 20_000
        })
        if (response.attention) {
          current.setNotice(translationsRef.current(`jobAgent.userAttention.${response.attention}`))
          return 'blocked'
        }
        if (!response.ok || !response.recipient) return 'skipped'
        if (pendingMessage.kind === 'opener') observedOpeningReceipt = response.sendReceipt
        verified = verifyBossConversationRecipient({
          thread,
          ...response.recipient,
          now: new Date().toISOString()
        })
        await current.store.put('bossConversationThreads', verified)
      }
      if (
        !verified.recipientFingerprint
        || !verified.platformRecipientId
        || !verified.conversationId
        || !verified.recipientName
      ) return 'skipped'
      const persistedMessage = await current.store.get('bossConversationMessages', pendingMessage.id)
      if (!persistedMessage || !['awaiting-approval', 'approved'].includes(persistedMessage.status)) return 'skipped'
      if (persistedMessage.kind === 'opener' && !observedOpeningReceipt) return 'skipped'
      const approved = persistedMessage.status === 'approved'
        ? persistedMessage
        : await approveBossConversationMessage({
            store: current.store,
            threadId: verified.id,
            messageId: persistedMessage.id,
            now: new Date().toISOString()
          })
      if (approved.kind === 'opener') {
        const persisted = await executeApprovedBossMessage({
          store: current.store,
          thread: verified,
          message: approved,
          now: () => new Date().toISOString(),
          send: async () => observedOpeningReceipt!
        })
        current.setNotice(translationsRef.current('jobAgent.messageSent', {
          status: translationsRef.current(`jobAgent.messageStatus.${persisted.status}`)
        }))
        await current.reload()
        return 'handled'
      }
      await sendApproved(approved.id, approved, verified)
      return 'handled'
    } catch {
      // The draft remains queued when the exact job conversation cannot be verified.
      return 'skipped'
    }
  }, [hasAutomaticContactCapacity, sendApproved])

  const drainAutopilotQueue = useCallback(async () => {
    const current = inputRef.current
    if (
      drainingRef.current
      || !current.preferences.enabled
      || current.preferences.autonomy !== 'autopilot'
    ) return
    drainingRef.current = true
    try {
      const now = Date.now()
      const eligibleMessages = (await current.store.list('bossConversationMessages'))
        .filter((message) => (
          ['awaiting-approval', 'approved'].includes(message.status)
          || (
            message.status === 'failed'
            && message.attemptCount < 3
            && (!message.nextRetryAt || Date.parse(message.nextRetryAt) <= now)
          )
        ))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      const start = eligibleMessages.length > 0
        ? autopilotMessageCursorRef.current % eligibleMessages.length
        : 0
      const messages = Array.from(
        { length: Math.min(5, eligibleMessages.length) },
        (_, index) => eligibleMessages[(start + index) % eligibleMessages.length]
      )
      let advanced = 0
      for (const message of messages) {
        if (!inputRef.current.preferences.enabled) break
        if (!await hasAutomaticContactCapacity()) break
        const result = await tryAutopilotMessage(message)
        advanced += 1
        if (result === 'blocked') break
      }
      if (eligibleMessages.length > 0 && advanced > 0) {
        autopilotMessageCursorRef.current = (start + advanced) % eligibleMessages.length
      }
    } finally {
      drainingRef.current = false
    }
  }, [hasAutomaticContactCapacity, tryAutopilotMessage])

  const sendRequestedResume = useCallback(async (thread: BossConversationThread) => {
    const current = inputRef.current
    const t = translationsRef.current
    if (
      thread.resumeSendAttemptCount >= 3
      || (thread.nextResumeRetryAt && Date.parse(thread.nextResumeRetryAt) > Date.now())
    ) return
    if (
      !thread.recipientFingerprint
      || !thread.platformRecipientId
      || !thread.conversationId
      || !thread.recipientName
    ) return
    setBusyResumeThreadId(thread.id)
    current.setError('')
    try {
      const application = await current.store.get('applicationRecords', thread.applicationId)
      const posting = application
        ? await current.store.get('jobPostings', application.postingId)
        : undefined
      const variant = application?.resumeVariantId
        ? await current.store.get('resumeVariants', application.resumeVariantId)
        : undefined
      if (!variant || !posting) throw new TypeError('Job-specific resume variant unavailable')
      let verifiedThread = thread
      let diagnosticResponse = await diagnoseBossBrowserAdapter({ window })
      const conversationFingerprint = createJobInputFingerprint(verifiedThread.conversationId)
      let chatDiagnostic = diagnosticResponse.diagnostics?.find((item) => (
        item.pageKind === 'chat'
        && item.ready.conversation
        && item.ready.resumeUpload
        && item.conversationFingerprint === conversationFingerprint
      ))
      if (!chatDiagnostic) {
        const opened = await openBossBrowserConversation({
          window,
          url: posting.canonicalUrl,
          title: posting.title,
          company: posting.company,
          openingBody: BOSS_DEFAULT_GREETING,
          timeoutMs: 20_000
        })
        if (opened.attention) {
          current.setNotice(t(`jobAgent.userAttention.${opened.attention}`))
          return
        }
        if (!opened.ok || !opened.recipient) throw new TypeError('BOSS conversation unavailable')
        verifiedThread = verifyBossConversationRecipient({
          thread,
          ...opened.recipient,
          now: new Date().toISOString()
        })
        await current.store.put('bossConversationThreads', verifiedThread)
        diagnosticResponse = await diagnoseBossBrowserAdapter({ window })
        chatDiagnostic = diagnosticResponse.diagnostics?.find((item) => (
          item.pageKind === 'chat'
          && item.ready.conversation
          && item.ready.resumeUpload
          && item.conversationFingerprint === createJobInputFingerprint(verifiedThread.conversationId!)
        ))
        if (!chatDiagnostic) {
          throw new TypeError('No unique BOSS PDF resume input is available')
        }
      }
      const mimeType = 'application/pdf' as const
      const artifactModule = await import('@/lib/resume-pdf')
      const bytes = artifactModule.renderResumePdf(variant.data)
      const bytesBase64 = bytesToBase64(bytes)
      const fileName = artifactModule.resumePdfFileName(variant.data, variant.name)
      const contentFingerprint = createJobInputFingerprint(bytesBase64)
      const sentThread = await executeBossResumeAttachment({
        store: current.store,
        thread: verifiedThread,
        fileName,
        bytesBase64,
        byteLength: bytes.byteLength,
        mimeType,
        contentFingerprint,
        now: () => new Date().toISOString(),
        send: async () => {
          const response = await sendBossResumeAttachment({
            window,
            fileName,
            bytesBase64,
            byteLength: bytes.byteLength,
            mimeType,
            contentFingerprint,
            recipient: {
              platformRecipientId: verifiedThread.platformRecipientId!,
              conversationId: verifiedThread.conversationId!,
              recipientName: verifiedThread.recipientName!,
              ...(verifiedThread.recipientTitle ? { recipientTitle: verifiedThread.recipientTitle } : {})
            }
          })
          if (!response.ok || !response.resumeReceipt) throw new TypeError('BOSS resume receipt unavailable')
          return response.resumeReceipt
        }
      })
      const acknowledgement = await ensureBossResumeReceiptReplyDraft({
        store: current.store,
        threadId: sentThread.id,
        now: new Date().toISOString()
      })
      if (current.preferences.autonomy === 'autopilot') {
        await tryAutopilotMessage(acknowledgement.message)
      }
      current.setNotice(t('jobAgent.resumeSent', { format: 'PDF' }))
      await current.reload()
    } catch {
      current.setError(t('jobAgent.resumeSendFailed'))
    } finally {
      setBusyResumeThreadId('')
    }
  }, [tryAutopilotMessage])

  const collectKnownThreadSignals = useCallback(async () => {
    const current = inputRef.current
    const collected = new Map<string, BrowserBossConversationSignal>()
    let blocked = false
    const currentResponse = await collectBossConversationSignals({ window })
    for (const signal of currentResponse.conversationSignals ?? []) collected.set(signal.signalId, signal)

    const eligibleThreads = current.threads.filter((thread) => (
      thread.status !== 'closed'
      && Boolean(thread.recipientFingerprint)
      && Boolean(thread.platformRecipientId)
      && Boolean(thread.conversationId)
      && Boolean(thread.recipientName)
    )).sort((left, right) => left.id.localeCompare(right.id))
    const start = eligibleThreads.length > 0
      ? signalThreadCursorRef.current % eligibleThreads.length
      : 0
    const knownThreads = Array.from(
      { length: Math.min(5, eligibleThreads.length) },
      (_, index) => eligibleThreads[(start + index) % eligibleThreads.length]
    )
    let advanced = 0
    for (const thread of knownThreads) {
      if (!inputRef.current.preferences.enabled) break
      const application = await current.store.get('applicationRecords', thread.applicationId)
      const posting = application
        ? await current.store.get('jobPostings', application.postingId)
        : undefined
      if (!posting) {
        advanced += 1
        continue
      }
      const opened = await openBossBrowserConversation({
        window,
        url: posting.canonicalUrl,
        title: posting.title,
        company: posting.company,
        openingBody: BOSS_DEFAULT_GREETING,
        timeoutMs: 20_000
      })
      if (opened.attention) {
        current.setNotice(translationsRef.current(`jobAgent.userAttention.${opened.attention}`))
        advanced += 1
        blocked = true
        break
      }
      advanced += 1
      if (!opened.ok || !opened.recipient) continue
      try {
        verifyBossConversationRecipient({
          thread,
          ...opened.recipient,
          now: new Date().toISOString()
        })
      } catch {
        continue
      }
      const response = await collectBossConversationSignals({ window })
      for (const signal of response.conversationSignals ?? []) {
        if (signal.conversationId === thread.conversationId) collected.set(signal.signalId, signal)
      }
    }
    if (eligibleThreads.length > 0 && advanced > 0) {
      signalThreadCursorRef.current = (start + advanced) % eligibleThreads.length
    }
    return { signals: [...collected.values()], blocked }
  }, [])

  const syncSignals = useCallback(async () => {
    const current = inputRef.current
    const now = new Date().toISOString()
    const { signals, blocked } = await collectKnownThreadSignals()
    if (blocked) return 'blocked' as const
    const updated = signals.length > 0
      ? await syncBossConversationSignals({ store: current.store, signals, now })
      : []
    const signalDrafts = signals.length > 0
      ? await ensureBossSignalReplyDrafts({ store: current.store, signals, now })
      : []
    const followUps = await ensureBossFollowUpDrafts({ store: current.store, now })
    const dueResumeRetries = (await current.store.list('bossConversationThreads'))
      .filter((thread) => isBossResumeRetryDue({ thread, now }))
    const resumeThreads = [...new Map([
      ...updated.filter((thread) => thread.recruitmentStage === 'resume-requested'),
      ...dueResumeRetries
    ].map((thread) => [thread.id, thread])).values()]
    if (
      updated.length === 0
      && signalDrafts.length === 0
      && followUps.length === 0
      && resumeThreads.length === 0
    ) return 'completed' as const
    await current.reload()
    if (current.preferences.autonomy !== 'autopilot') return 'completed' as const
    for (const thread of resumeThreads) {
      if (current.preferences.autoSendResume && await hasAutomaticContactCapacity()) {
        await sendRequestedResume(thread)
      }
    }
    for (const message of [...signalDrafts, ...followUps]) await tryAutopilotMessage(message)
    return 'completed' as const
  }, [collectKnownThreadSignals, hasAutomaticContactCapacity, sendRequestedResume, tryAutopilotMessage])

  const revise = useCallback(async (messageId: string, body: string) => {
    const current = inputRef.current
    const t = translationsRef.current
    const message = current.messages.find((item) => item.id === messageId)
    if (!message || message.body === body.trim()) return
    try {
      await current.store.put('bossConversationMessages', reviseBossMessageDraft({
        message,
        body,
        now: new Date().toISOString()
      }))
      current.setNotice(t('jobAgent.messageRevised'))
      await current.reload()
    } catch {
      current.setError(t('errors.applicationSave'))
    }
  }, [])

  const verifyAndApprove = useCallback(async (messageId: string) => {
    const current = inputRef.current
    const t = translationsRef.current
    const message = current.messages.find((item) => item.id === messageId)
    const thread = message
      ? current.threads.find((item) => item.id === message.threadId)
      : undefined
    if (!message || !thread) return
    setBusyMessageId(messageId)
    current.setError('')
    try {
      const response = await inspectBossBrowserConversation({ window, timeoutMs: 3_000 })
      if (!response.ok || !response.recipient) throw new TypeError('BOSS recipient unavailable')
      const verified = verifyBossConversationRecipient({
        thread,
        ...response.recipient,
        now: new Date().toISOString()
      })
      await current.store.put('bossConversationThreads', verified)
      const approved = await approveBossConversationMessage({
        store: current.store,
        threadId: verified.id,
        messageId,
        now: new Date().toISOString()
      })
      if (current.preferences.autonomy === 'autopilot') {
        await sendApproved(messageId, approved, verified)
      } else {
        current.setNotice(t('jobAgent.messageApproved', { name: response.recipient.recipientName }))
        await current.reload()
      }
    } catch {
      current.setError(t('jobAgent.messageVerificationFailed'))
    } finally {
      setBusyMessageId('')
    }
  }, [sendApproved])

  return {
    busyMessageId,
    busyResumeThreadId,
    revise,
    verifyAndApprove,
    sendApproved,
    sendRequestedResume,
    syncSignals,
    drainAutopilotQueue
  }
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return window.btoa(binary)
}
