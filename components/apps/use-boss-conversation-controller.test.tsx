import { act, renderHook } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import en from '@/messages/en.json'
import { createDomainStore } from '@/lib/agent/domain-store'
import { createBossConversationThread, createBossMessageDraft } from '@/lib/jobs/boss-conversation'
import { DEFAULT_JOB_AGENT_PREFERENCES } from '@/lib/jobs/job-agent-policy'
import type { ApplicationRecord, JobPosting, JobSource } from '@/lib/jobs/job-domain'
import { BROWSER_AGENT_REQUEST_EVENT, BROWSER_AGENT_RESPONSE_EVENT } from '@/lib/jobs/browser-agent-protocol'
import { useBossConversationController } from './use-boss-conversation-controller'

const now = '2026-08-01T08:00:00.000Z'

describe('useBossConversationController', () => {
  it('revises a draft through the conversation controller and reloads the workspace', async () => {
    const store = createDomainStore({
      databaseName: `conversation-controller-${crypto.randomUUID()}`,
      indexedDB: new IDBFactory()
    })
    const source: JobSource = { id: 'source-1', kind: 'manual', label: 'BOSS', enabled: true, createdAt: now, updatedAt: now }
    const posting: JobPosting = {
      id: 'posting-1', sourceId: source.id, externalId: 'one',
      canonicalUrl: 'https://www.zhipin.com/job_detail/one.html',
      applyUrl: 'https://www.zhipin.com/job_detail/one.html',
      title: 'Engineer', company: 'Example', description: 'Build systems.', locale: 'en',
      firstSeenAt: now, lastCheckedAt: now, status: 'open', contentHash: 'hash:one'
    }
    const application: ApplicationRecord = {
      id: 'application-1', postingId: posting.id, sourceDraftId: 'draft-1',
      status: 'saved', notes: '', createdAt: now, updatedAt: now
    }
    await store.put('jobSources', source)
    await store.put('jobPostings', posting)
    await store.put('applicationRecords', application)
    const thread = createBossConversationThread({ applicationId: application.id, now })
    const message = createBossMessageDraft({
      threadId: thread.id, kind: 'opener', body: 'Original body', evidenceFactIds: [], now
    })
    await store.put('bossConversationThreads', thread)
    await store.put('bossConversationMessages', message)
    const reload = vi.fn(async () => undefined)
    const setNotice = vi.fn()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <NextIntlClientProvider locale="en" messages={en}>{children}</NextIntlClientProvider>
    )
    const { result } = renderHook(() => useBossConversationController({
      store,
      preferences: DEFAULT_JOB_AGENT_PREFERENCES,
      threads: [thread],
      messages: [message],
      reload,
      setError: vi.fn(),
      setNotice
    }), { wrapper })

    await act(() => result.current.revise(message.id, 'Revised body'))
    expect(await store.get('bossConversationMessages', message.id)).toMatchObject({
      body: 'Revised body',
      status: 'awaiting-approval'
    })
    expect(setNotice).toHaveBeenCalledWith('Conversation draft saved; recipient and body verification must run again.')
    expect(reload).toHaveBeenCalledOnce()
    await store.close()
  })

  it('opens the matching BOSS conversation and sends a queued message without per-message approval', async () => {
    const store = createDomainStore({
      databaseName: `conversation-autopilot-${crypto.randomUUID()}`,
      indexedDB: new IDBFactory()
    })
    const source: JobSource = { id: 'source-1', kind: 'manual', label: 'BOSS', enabled: true, createdAt: now, updatedAt: now }
    const posting: JobPosting = {
      id: 'posting-1', sourceId: source.id, externalId: 'one',
      canonicalUrl: 'https://www.zhipin.com/job_detail/one.html',
      applyUrl: 'https://www.zhipin.com/job_detail/one.html',
      title: 'Platform Engineer', company: 'Example', description: 'Build systems.', locale: 'en',
      firstSeenAt: now, lastCheckedAt: now, status: 'open', contentHash: 'hash:one'
    }
    const application: ApplicationRecord = {
      id: 'application-1', postingId: posting.id, sourceDraftId: 'draft-1',
      status: 'saved', notes: '', createdAt: now, updatedAt: now
    }
    await store.put('jobSources', source)
    await store.put('jobPostings', posting)
    await store.put('applicationRecords', application)
    const thread = createBossConversationThread({ applicationId: application.id, now })
    const message = createBossMessageDraft({
      threadId: thread.id, kind: 'opener', body: 'Hello about the Platform Engineer role.', evidenceFactIds: [], now
    })
    await store.put('bossConversationThreads', thread)
    await store.put('bossConversationMessages', message)
    const recipient = {
      platformRecipientId: 'boss-user-1', conversationId: 'conversation-1',
      recipientName: 'Recruiter', recipientTitle: 'Platform Engineer'
    }
    const respond = (event: Event) => {
      const request = (event as CustomEvent<{ requestId: string; action: string; payload?: { body?: string } }>).detail
      window.dispatchEvent(new CustomEvent(BROWSER_AGENT_RESPONSE_EVENT, { detail: {
        requestId: request.requestId,
        ok: true,
        ...(request.action === 'open-boss-conversation'
          ? { recipient }
          : request.action === 'send-boss-message'
            ? { sendReceipt: {
                platformMessageId: 'platform-message-1',
                conversationId: recipient.conversationId,
                observedBody: request.payload?.body,
                observedStatus: 'sent',
                observedRecipient: recipient,
                observedAt: new Date().toISOString()
              } }
            : {})
      } }))
    }
    window.addEventListener(BROWSER_AGENT_REQUEST_EVENT, respond)
    const wrapper = ({ children }: { children: ReactNode }) => (
      <NextIntlClientProvider locale="en" messages={en}>{children}</NextIntlClientProvider>
    )
    const { result } = renderHook(() => useBossConversationController({
      store,
      preferences: { ...DEFAULT_JOB_AGENT_PREFERENCES, enabled: true },
      threads: [thread],
      messages: [message],
      reload: vi.fn(async () => undefined),
      setError: vi.fn(),
      setNotice: vi.fn()
    }), { wrapper })
    try {
      await act(() => result.current.drainAutopilotQueue())
      expect(await store.get('bossConversationMessages', message.id)).toMatchObject({
        status: 'sent',
        receipt: { messageId: 'platform-message-1' }
      })
      expect(await store.get('bossConversationThreads', thread.id)).toMatchObject({
        platformRecipientId: recipient.platformRecipientId,
        conversationId: recipient.conversationId
      })
    } finally {
      window.removeEventListener(BROWSER_AGENT_REQUEST_EVENT, respond)
      await store.close()
    }
  })
})
