import { act, renderHook } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import en from '@/messages/en.json'
import { createDomainStore } from '@/lib/agent/domain-store'
import { BOSS_DEFAULT_GREETING, approveBossMessage, createBossConversationThread, createBossMessageDraft, verifyBossConversationRecipient, type BossConversationMessage, type BossConversationThread } from '@/lib/jobs/boss-conversation'
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
    const thread = verifyBossConversationRecipient({
      thread: createBossConversationThread({ applicationId: application.id, now }),
      platformRecipientId: 'target:bad-recipient', conversationId: 'target:bad-conversation',
      recipientName: '昨天', now
    })
    const message = approveBossMessage({
      message: createBossMessageDraft({
      threadId: thread.id, kind: 'opener', body: 'Hello about the Platform Engineer role.', evidenceFactIds: [], now
      }),
      recipientFingerprint: thread.recipientFingerprint!,
      now
    })
    await store.put('bossConversationThreads', thread)
    await store.put('bossConversationMessages', message)
    const recipient = {
      platformRecipientId: 'boss-user-1', conversationId: 'conversation-1',
      recipientName: 'Recruiter', recipientTitle: 'Platform Engineer'
    }
    const actions: string[] = []
    const respond = (event: Event) => {
      const request = (event as CustomEvent<{ requestId: string; action: string; payload?: { body?: string } }>).detail
      actions.push(request.action)
      window.dispatchEvent(new CustomEvent(BROWSER_AGENT_RESPONSE_EVENT, { detail: {
        requestId: request.requestId,
        ok: true,
        ...(request.action === 'open-boss-conversation'
          ? { recipient, sendReceipt: {
              platformMessageId: 'platform-message-1',
              conversationId: recipient.conversationId,
              observedBody: BOSS_DEFAULT_GREETING,
              observedStatus: 'delivered',
              observedRecipient: recipient,
              observedAt: new Date().toISOString()
            } }
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
        status: 'delivered',
        body: BOSS_DEFAULT_GREETING,
        receipt: { messageId: 'platform-message-1' }
      })
      expect(actions).toContain('open-boss-conversation')
      expect(actions).not.toContain('send-boss-message')
      expect(await store.get('bossConversationThreads', thread.id)).toMatchObject({
        platformRecipientId: recipient.platformRecipientId,
        conversationId: recipient.conversationId
      })
    } finally {
      window.removeEventListener(BROWSER_AGENT_REQUEST_EVENT, respond)
      await store.close()
    }
  })

  it('rotates past CAPTCHA attention and later skips an unverifiable queue head', async () => {
    const store = createDomainStore({
      databaseName: `conversation-queue-progress-${crypto.randomUUID()}`,
      indexedDB: new IDBFactory()
    })
    const source: JobSource = { id: 'source-1', kind: 'manual', label: 'BOSS', enabled: true, createdAt: now, updatedAt: now }
    await store.put('jobSources', source)
    const threads: BossConversationThread[] = []
    const messages: BossConversationMessage[] = []
    for (let index = 1; index <= 2; index += 1) {
      const posting: JobPosting = {
        id: `posting-${index}`, sourceId: source.id, externalId: `external-${index}`,
        canonicalUrl: `https://www.zhipin.com/job_detail/${index}.html`,
        applyUrl: `https://www.zhipin.com/job_detail/${index}.html`,
        title: `Engineer ${index}`, company: 'Example', description: 'Build systems.', locale: 'en',
        firstSeenAt: now, lastCheckedAt: now, status: 'open', contentHash: `hash:${index}`
      }
      const application: ApplicationRecord = {
        id: `application-${index}`, postingId: posting.id, sourceDraftId: 'draft-1',
        status: 'ready-to-apply', notes: '', createdAt: now, updatedAt: now
      }
      const thread = createBossConversationThread({ applicationId: application.id, now })
      const message = createBossMessageDraft({
        threadId: thread.id,
        kind: 'opener',
        body: BOSS_DEFAULT_GREETING,
        evidenceFactIds: [],
        now: new Date(Date.parse(now) + index * 1_000).toISOString()
      })
      await store.put('jobPostings', posting)
      await store.put('applicationRecords', application)
      await store.put('bossConversationThreads', thread)
      await store.put('bossConversationMessages', message)
      threads.push(thread)
      messages.push(message)
    }
    const recipient = {
      platformRecipientId: 'boss-user-2', conversationId: 'conversation-2',
      recipientName: 'Recruiter 2', recipientTitle: 'Engineer 2'
    }
    const openedUrls: string[] = []
    let captchaPending = true
    const respond = (event: Event) => {
      const request = (event as CustomEvent<{
        requestId: string
        action: string
        payload?: { url?: string }
      }>).detail
      const url = request.payload?.url
      if (request.action === 'open-boss-conversation' && url) openedUrls.push(url)
      const detail = request.action === 'open-boss-conversation' && url?.endsWith('/1.html') && captchaPending
        ? (() => {
            captchaPending = false
            return { requestId: request.requestId, ok: false, attention: 'captcha-required' }
          })()
        : request.action === 'open-boss-conversation' && url?.endsWith('/2.html')
          ? {
            requestId: request.requestId,
            ok: true,
            recipient,
            sendReceipt: {
              platformMessageId: 'platform-message-2',
              conversationId: recipient.conversationId,
              observedBody: BOSS_DEFAULT_GREETING,
              observedStatus: 'delivered',
              observedRecipient: recipient,
              observedAt: new Date().toISOString()
            }
          }
          : { requestId: request.requestId, ok: false, error: 'PROBE_FAILED' }
      window.dispatchEvent(new CustomEvent(BROWSER_AGENT_RESPONSE_EVENT, { detail }))
    }
    window.addEventListener(BROWSER_AGENT_REQUEST_EVENT, respond)
    const wrapper = ({ children }: { children: ReactNode }) => (
      <NextIntlClientProvider locale="en" messages={en}>{children}</NextIntlClientProvider>
    )
    const { result } = renderHook(() => useBossConversationController({
      store,
      preferences: { ...DEFAULT_JOB_AGENT_PREFERENCES, enabled: true },
      threads,
      messages,
      reload: vi.fn(async () => undefined),
      setError: vi.fn(),
      setNotice: vi.fn()
    }), { wrapper })
    try {
      await act(() => result.current.drainAutopilotQueue())
      expect(openedUrls).toEqual(['https://www.zhipin.com/job_detail/1.html'])
      await act(() => result.current.drainAutopilotQueue())
      expect(openedUrls).toEqual([
        'https://www.zhipin.com/job_detail/1.html',
        'https://www.zhipin.com/job_detail/2.html',
        'https://www.zhipin.com/job_detail/1.html'
      ])
      expect(await store.get('bossConversationMessages', messages[0].id)).toMatchObject({ status: 'awaiting-approval' })
      expect(await store.get('bossConversationMessages', messages[1].id)).toMatchObject({
        status: 'delivered',
        receipt: { messageId: 'platform-message-2' }
      })
    } finally {
      window.removeEventListener(BROWSER_AGENT_REQUEST_EVENT, respond)
      await store.close()
    }
  })

  it('reselects a verified thread and synchronizes a de-identified interview signal', async () => {
    const store = createDomainStore({
      databaseName: `conversation-signal-sync-${crypto.randomUUID()}`,
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
    const recipient = {
      platformRecipientId: 'boss-user-1', conversationId: 'conversation-1',
      recipientName: 'Recruiter', recipientTitle: 'Platform Engineer'
    }
    const thread = verifyBossConversationRecipient({
      thread: { ...createBossConversationThread({ applicationId: application.id, now }), status: 'active', recruitmentStage: 'awaiting-reply' },
      ...recipient,
      now
    })
    await store.put('jobSources', source)
    await store.put('jobPostings', posting)
    await store.put('applicationRecords', application)
    await store.put('bossConversationThreads', thread)
    const respond = (event: Event) => {
      const request = (event as CustomEvent<{ requestId: string; action: string }>).detail
      window.dispatchEvent(new CustomEvent(BROWSER_AGENT_RESPONSE_EVENT, { detail: {
        requestId: request.requestId,
        ok: true,
        ...(request.action === 'open-boss-conversation'
          ? { recipient }
          : request.action === 'collect-boss-conversation-signals'
            ? { conversationSignals: [{
                signalId: 'fnv1a64:interview-1', conversationId: recipient.conversationId,
                kind: 'interview-invite', observedAt: '2026-08-01T08:05:00.000Z'
              }] }
            : {})
      } }))
    }
    window.addEventListener(BROWSER_AGENT_REQUEST_EVENT, respond)
    const wrapper = ({ children }: { children: ReactNode }) => (
      <NextIntlClientProvider locale="en" messages={en}>{children}</NextIntlClientProvider>
    )
    const { result } = renderHook(() => useBossConversationController({
      store,
      preferences: { ...DEFAULT_JOB_AGENT_PREFERENCES, enabled: true, autonomy: 'approval' },
      threads: [thread], messages: [], reload: vi.fn(async () => undefined),
      setError: vi.fn(), setNotice: vi.fn()
    }), { wrapper })
    try {
      await act(() => result.current.syncSignals())
      expect(await store.get('bossConversationThreads', thread.id)).toMatchObject({
        recruitmentStage: 'interview-invited',
        lastPlatformSignalId: 'fnv1a64:interview-1'
      })
      expect(await store.list('bossConversationMessages')).toMatchObject([{
        kind: 'reply', status: 'awaiting-approval', sourcePlatformSignalId: 'fnv1a64:interview-1'
      }])
    } finally {
      window.removeEventListener(BROWSER_AGENT_REQUEST_EVENT, respond)
      await store.close()
    }
  })

  it('propagates CAPTCHA attention so startup does not drain the queue again', async () => {
    const store = createDomainStore({
      databaseName: `conversation-signal-captcha-${crypto.randomUUID()}`,
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
    const thread = verifyBossConversationRecipient({
      thread: createBossConversationThread({ applicationId: application.id, now }),
      platformRecipientId: 'boss-user-1', conversationId: 'conversation-1',
      recipientName: 'Recruiter', now
    })
    await store.put('jobSources', source)
    await store.put('jobPostings', posting)
    await store.put('applicationRecords', application)
    await store.put('bossConversationThreads', thread)
    const respond = (event: Event) => {
      const request = (event as CustomEvent<{ requestId: string; action: string }>).detail
      window.dispatchEvent(new CustomEvent(BROWSER_AGENT_RESPONSE_EVENT, { detail: request.action === 'open-boss-conversation'
        ? { requestId: request.requestId, ok: false, attention: 'captcha-required' }
        : { requestId: request.requestId, ok: true, conversationSignals: [] }
      }))
    }
    window.addEventListener(BROWSER_AGENT_REQUEST_EVENT, respond)
    const setNotice = vi.fn()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <NextIntlClientProvider locale="en" messages={en}>{children}</NextIntlClientProvider>
    )
    const { result } = renderHook(() => useBossConversationController({
      store,
      preferences: { ...DEFAULT_JOB_AGENT_PREFERENCES, enabled: true, autonomy: 'autopilot' },
      threads: [thread], messages: [], reload: vi.fn(async () => undefined),
      setError: vi.fn(), setNotice
    }), { wrapper })
    try {
      let status: Awaited<ReturnType<typeof result.current.syncSignals>>
      await act(async () => { status = await result.current.syncSignals() })
      expect(status!).toBe('blocked')
      expect(setNotice).toHaveBeenCalledWith('BOSS requires a security check. Complete the CAPTCHA and the Agent will continue automatically.')
    } finally {
      window.removeEventListener(BROWSER_AGENT_REQUEST_EVENT, respond)
      await store.close()
    }
  })

  it('rotates bounded signal synchronization across every verified conversation', async () => {
    const store = createDomainStore({
      databaseName: `conversation-signal-rotation-${crypto.randomUUID()}`,
      indexedDB: new IDBFactory()
    })
    const source: JobSource = { id: 'source-1', kind: 'manual', label: 'BOSS', enabled: true, createdAt: now, updatedAt: now }
    await store.put('jobSources', source)
    const threads: BossConversationThread[] = []
    const recipientByUrl = new Map<string, {
      platformRecipientId: string
      conversationId: string
      recipientName: string
      recipientTitle: string
    }>()
    for (let index = 1; index <= 6; index += 1) {
      const posting: JobPosting = {
        id: `posting-${index}`, sourceId: source.id, externalId: `external-${index}`,
        canonicalUrl: `https://www.zhipin.com/job_detail/${index}.html`,
        applyUrl: `https://www.zhipin.com/job_detail/${index}.html`,
        title: `Engineer ${index}`, company: 'Example', description: 'Build systems.', locale: 'en',
        firstSeenAt: now, lastCheckedAt: now, status: 'open', contentHash: `hash:${index}`
      }
      const application: ApplicationRecord = {
        id: `application-${index}`, postingId: posting.id, sourceDraftId: 'draft-1',
        status: 'saved', notes: '', createdAt: now, updatedAt: now
      }
      const recipient = {
        platformRecipientId: `boss-user-${index}`, conversationId: `conversation-${index}`,
        recipientName: `Recruiter ${index}`, recipientTitle: posting.title
      }
      const thread = verifyBossConversationRecipient({
        thread: { ...createBossConversationThread({ applicationId: application.id, now }), status: 'active', recruitmentStage: 'awaiting-reply' },
        ...recipient,
        now
      })
      await store.put('jobPostings', posting)
      await store.put('applicationRecords', application)
      await store.put('bossConversationThreads', thread)
      threads.push(thread)
      recipientByUrl.set(posting.canonicalUrl, recipient)
    }
    const openedUrls: string[] = []
    const respond = (event: Event) => {
      const request = (event as CustomEvent<{
        requestId: string
        action: string
        payload?: { url?: string }
      }>).detail
      const url = request.payload?.url
      if (request.action === 'open-boss-conversation' && url) openedUrls.push(url)
      window.dispatchEvent(new CustomEvent(BROWSER_AGENT_RESPONSE_EVENT, { detail: {
        requestId: request.requestId,
        ok: true,
        ...(request.action === 'open-boss-conversation' && url
          ? { recipient: recipientByUrl.get(url) }
          : request.action === 'collect-boss-conversation-signals'
            ? { conversationSignals: [] }
            : {})
      } }))
    }
    window.addEventListener(BROWSER_AGENT_REQUEST_EVENT, respond)
    const wrapper = ({ children }: { children: ReactNode }) => (
      <NextIntlClientProvider locale="en" messages={en}>{children}</NextIntlClientProvider>
    )
    const { result } = renderHook(() => useBossConversationController({
      store,
      preferences: { ...DEFAULT_JOB_AGENT_PREFERENCES, enabled: true, autonomy: 'approval' },
      threads,
      messages: [],
      reload: vi.fn(async () => undefined),
      setError: vi.fn(),
      setNotice: vi.fn()
    }), { wrapper })
    try {
      await act(() => result.current.syncSignals())
      expect(openedUrls).toHaveLength(5)
      await act(() => result.current.syncSignals())
      expect(new Set(openedUrls)).toEqual(new Set(recipientByUrl.keys()))
    } finally {
      window.removeEventListener(BROWSER_AGENT_REQUEST_EVENT, respond)
      await store.close()
    }
  })

  it('wakes a due failed resume attachment even without a new platform signal', async () => {
    const store = createDomainStore({
      databaseName: `conversation-resume-retry-${crypto.randomUUID()}`,
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
      status: 'ready-to-apply', notes: '', createdAt: now, updatedAt: now
    }
    const recipient = {
      platformRecipientId: 'boss-user-1', conversationId: 'conversation-1',
      recipientName: 'Recruiter', recipientTitle: posting.title
    }
    const thread = verifyBossConversationRecipient({
      thread: {
        ...createBossConversationThread({ applicationId: application.id, now }),
        status: 'active', recruitmentStage: 'resume-requested',
        resumeSendAttemptCount: 1,
        resumeSendFailureCode: 'BOSS_RESUME_SEND_NOT_VERIFIED',
        nextResumeRetryAt: '2000-01-01T00:00:00.000Z'
      },
      ...recipient,
      now
    })
    await store.put('jobSources', source)
    await store.put('jobPostings', posting)
    await store.put('applicationRecords', application)
    await store.put('bossConversationThreads', thread)
    const respond = (event: Event) => {
      const request = (event as CustomEvent<{ requestId: string; action: string }>).detail
      window.dispatchEvent(new CustomEvent(BROWSER_AGENT_RESPONSE_EVENT, { detail: {
        requestId: request.requestId,
        ok: true,
        ...(request.action === 'open-boss-conversation'
          ? { recipient }
          : request.action === 'collect-boss-conversation-signals'
            ? { conversationSignals: [] }
            : {})
      } }))
    }
    window.addEventListener(BROWSER_AGENT_REQUEST_EVENT, respond)
    const setError = vi.fn()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <NextIntlClientProvider locale="en" messages={en}>{children}</NextIntlClientProvider>
    )
    const { result } = renderHook(() => useBossConversationController({
      store,
      preferences: {
        ...DEFAULT_JOB_AGENT_PREFERENCES,
        enabled: true,
        autonomy: 'autopilot',
        autoSendResume: true
      },
      threads: [thread],
      messages: [],
      reload: vi.fn(async () => undefined),
      setError,
      setNotice: vi.fn()
    }), { wrapper })
    try {
      await act(() => result.current.syncSignals())
      expect(setError).toHaveBeenCalledWith('No BOSS attachment receipt matched the resume, recipient, and conversation; it was not marked sent.')
    } finally {
      window.removeEventListener(BROWSER_AGENT_REQUEST_EVENT, respond)
      await store.close()
    }
  })
})
