'use client'

import { useCallback, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { IndexedDbDomainStore } from '@/lib/agent/domain-store'
import { createJobInputFingerprint } from '@/lib/jobs/job-domain'
import type { JobAgentPreferences } from '@/lib/jobs/job-agent-policy'
import {
  approveBossConversationMessage,
  ensureBossFollowUpDrafts,
  ensureBossResumeReceiptReplyDraft,
  ensureBossSignalReplyDrafts,
  executeApprovedBossMessage,
  executeBossResumeAttachment,
  reviseBossMessageDraft,
  syncBossConversationSignals,
  verifyBossConversationRecipient,
  type BossConversationMessage,
  type BossConversationThread
} from '@/lib/jobs/boss-conversation'
import {
  collectBossConversationSignals,
  diagnoseBossBrowserAdapter,
  inspectBossBrowserConversation,
  sendBossBrowserMessage,
  sendBossResumeAttachment
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
      if (!await hasAutomaticContactCapacity()) return
      const thread = await current.store.get('bossConversationThreads', message.threadId)
      if (!thread) return
      const response = await inspectBossBrowserConversation({ window, timeoutMs: 3_000 })
      if (!response.ok || !response.recipient) return
      const verified = verifyBossConversationRecipient({
        thread,
        ...response.recipient,
        now: new Date().toISOString()
      })
      await current.store.put('bossConversationThreads', verified)
      const approved = await approveBossConversationMessage({
        store: current.store,
        threadId: verified.id,
        messageId: message.id,
        now: new Date().toISOString()
      })
      await sendApproved(message.id, approved, verified)
    } catch {
      // The draft remains reviewable when the exact BOSS conversation is not active.
    }
  }, [hasAutomaticContactCapacity, sendApproved])

  const sendRequestedResume = useCallback(async (thread: BossConversationThread) => {
    const current = inputRef.current
    const t = translationsRef.current
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
      const variant = application?.resumeVariantId
        ? await current.store.get('resumeVariants', application.resumeVariantId)
        : undefined
      if (!variant) throw new TypeError('Job-specific resume variant unavailable')
      const diagnosticResponse = await diagnoseBossBrowserAdapter({ window })
      const conversationFingerprint = createJobInputFingerprint(thread.conversationId)
      const chatDiagnostic = diagnosticResponse.diagnostics?.find((item) => (
        item.pageKind === 'chat'
        && item.ready.conversation
        && item.conversationFingerprint === conversationFingerprint
      ))
      if (chatDiagnostic?.counts.pdfInputs !== 1) {
        throw new TypeError('No unique BOSS PDF resume input is available')
      }
      const mimeType = 'application/pdf' as const
      const artifactModule = await import('@/lib/resume-pdf')
      const bytes = artifactModule.renderResumePdf(variant.data)
      const bytesBase64 = bytesToBase64(bytes)
      const fileName = artifactModule.resumePdfFileName(variant.data, variant.name)
      const contentFingerprint = createJobInputFingerprint(bytesBase64)
      const sentThread = await executeBossResumeAttachment({
        store: current.store,
        thread,
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
              platformRecipientId: thread.platformRecipientId!,
              conversationId: thread.conversationId!,
              recipientName: thread.recipientName!,
              ...(thread.recipientTitle ? { recipientTitle: thread.recipientTitle } : {})
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

  const syncSignals = useCallback(async () => {
    const current = inputRef.current
    const response = await collectBossConversationSignals({ window })
    const now = new Date().toISOString()
    const signals = response.ok ? response.conversationSignals ?? [] : []
    const updated = signals.length > 0
      ? await syncBossConversationSignals({ store: current.store, signals, now })
      : []
    const signalDrafts = signals.length > 0
      ? await ensureBossSignalReplyDrafts({ store: current.store, signals, now })
      : []
    const followUps = await ensureBossFollowUpDrafts({ store: current.store, now })
    if (updated.length === 0 && signalDrafts.length === 0 && followUps.length === 0) return
    await current.reload()
    if (current.preferences.autonomy !== 'autopilot') return
    for (const thread of updated.filter((item) => item.recruitmentStage === 'resume-requested')) {
      if (current.preferences.autoSendResume && await hasAutomaticContactCapacity()) {
        await sendRequestedResume(thread)
      }
    }
    for (const message of [...signalDrafts, ...followUps]) await tryAutopilotMessage(message)
  }, [hasAutomaticContactCapacity, sendRequestedResume, tryAutopilotMessage])

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
    syncSignals
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
