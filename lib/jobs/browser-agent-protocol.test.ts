import { describe, expect, it, vi } from 'vitest'
import {
  BROWSER_AGENT_REQUEST_EVENT,
  BROWSER_AGENT_RESPONSE_EVENT,
  LEGACY_BROWSER_AGENT_REQUEST_EVENT,
  LEGACY_BROWSER_AGENT_RESPONSE_EVENT,
  detectBrowserAgentSessions
} from './browser-agent-protocol'

describe('browser agent protocol', () => {
  it('accepts a bounded response from the local extension bridge', async () => {
    const target = new EventTarget()
    target.addEventListener(BROWSER_AGENT_REQUEST_EVENT, (event) => {
      const request = (event as CustomEvent<{ requestId: string }>).detail
      target.dispatchEvent(new CustomEvent(BROWSER_AGENT_RESPONSE_EVENT, { detail: {
        requestId: request.requestId,
        ok: true,
        extensionVersion: '0.1.0',
        sessions: [{ platform: 'boss', state: 'available', tabId: 12 }]
      } }))
    })

    await expect(detectBrowserAgentSessions({ window: target as Window, timeoutMs: 50 })).resolves.toMatchObject({
      ok: true,
      sessions: [{ platform: 'boss', state: 'available' }]
    })
  })

  it('remains compatible with the legacy Resume OS bridge during extension rollout', async () => {
    const target = new EventTarget()
    target.addEventListener(LEGACY_BROWSER_AGENT_REQUEST_EVENT, (event) => {
      const request = (event as CustomEvent<{ requestId: string }>).detail
      target.dispatchEvent(new CustomEvent(LEGACY_BROWSER_AGENT_RESPONSE_EVENT, { detail: {
        requestId: request.requestId,
        ok: true,
        extensionVersion: '0.1.0',
        sessions: [{ platform: 'boss', state: 'available' }]
      } }))
    })
    await expect(detectBrowserAgentSessions({ window: target as Window, timeoutMs: 50 }))
      .resolves.toMatchObject({ ok: true, sessions: [{ platform: 'boss', state: 'available' }] })
  })

  it('validates bounded BOSS job cards returned by the extension', async () => {
    const target = new EventTarget()
    target.addEventListener(BROWSER_AGENT_REQUEST_EVENT, (event) => {
      const request = (event as CustomEvent<{ requestId: string; action: string }>).detail
      if (request.action !== 'collect-boss-jobs') return
      target.dispatchEvent(new CustomEvent(BROWSER_AGENT_RESPONSE_EVENT, { detail: {
        requestId: request.requestId,
        ok: true,
        jobs: [{
          externalId: 'abc', url: 'https://www.zhipin.com/job_detail/abc.html',
          title: '平台工程师', company: '示例公司', summary: '负责 TypeScript 平台研发。'
        }]
      } }))
    })
    const { collectBossBrowserJobs } = await import('./browser-agent-protocol')
    await expect(collectBossBrowserJobs({ window: target as Window, timeoutMs: 50 })).resolves.toMatchObject({
      ok: true,
      jobs: [{ externalId: 'abc', title: '平台工程师' }]
    })
  })

  it('requests a full BOSS detail using only an allowlisted canonical URL', async () => {
    const target = new EventTarget()
    target.addEventListener(BROWSER_AGENT_REQUEST_EVENT, (event) => {
      const request = (event as CustomEvent<{ requestId: string; action: string; payload: { url: string } }>).detail
      if (request.action !== 'collect-boss-job-detail') return
      expect(request.payload.url).toBe('https://www.zhipin.com/job_detail/abc.html')
      target.dispatchEvent(new CustomEvent(BROWSER_AGENT_RESPONSE_EVENT, { detail: {
        requestId: request.requestId,
        ok: true,
        jobDetail: {
          externalId: 'abc',
          url: request.payload.url,
          description: '负责 TypeScript AI Agent 平台研发、质量验证和线上稳定性建设。'
        }
      } }))
    })
    const { collectBossJobDetail } = await import('./browser-agent-protocol')
    await expect(collectBossJobDetail({
      window: target as Window,
      url: 'https://www.zhipin.com/job_detail/abc.html#detail',
      timeoutMs: 50
    })).resolves.toMatchObject({ jobDetail: { externalId: 'abc' } })
    await expect(collectBossJobDetail({
      window: target as Window,
      url: 'https://www.zhipin.com.evil.example/job_detail/abc.html'
    })).rejects.toThrow()
  })

  it('validates a bounded resume snapshot from the fixed BOSS profile page', async () => {
    const target = new EventTarget()
    target.addEventListener(BROWSER_AGENT_REQUEST_EVENT, (event) => {
      const request = (event as CustomEvent<{ requestId: string; action: string }>).detail
      if (request.action !== 'collect-boss-resume') return
      target.dispatchEvent(new CustomEvent(BROWSER_AGENT_RESPONSE_EVENT, { detail: {
        requestId: request.requestId,
        ok: true,
        resumeSnapshot: {
          sourceUrl: 'https://www.zhipin.com/web/geek/resume',
          text: '个人优势 TypeScript AI Agent 产品研发。工作经历 示例公司 AI 全栈工程师。',
          collectedAt: '2026-08-29T08:00:00.000Z'
        }
      } }))
    })
    const { collectBossResumeSnapshot } = await import('./browser-agent-protocol')
    await expect(collectBossResumeSnapshot({ window: target as Window, timeoutMs: 50 })).resolves.toMatchObject({
      ok: true,
      resumeSnapshot: { sourceUrl: 'https://www.zhipin.com/web/geek/resume' }
    })
  })

  it('rejects a resume snapshot attributed to a non-BOSS or non-resume URL', async () => {
    const target = new EventTarget()
    target.addEventListener(BROWSER_AGENT_REQUEST_EVENT, (event) => {
      const request = (event as CustomEvent<{ requestId: string; action: string }>).detail
      if (request.action !== 'collect-boss-resume') return
      target.dispatchEvent(new CustomEvent(BROWSER_AGENT_RESPONSE_EVENT, { detail: {
        requestId: request.requestId,
        ok: true,
        resumeSnapshot: {
          sourceUrl: 'https://attacker.example/web/geek/resume',
          text: '个人优势 TypeScript AI Agent 产品研发。工作经历 示例公司 AI 全栈工程师。',
          collectedAt: '2026-08-29T08:00:00.000Z'
        }
      } }))
    })
    const { collectBossResumeSnapshot } = await import('./browser-agent-protocol')
    await expect(collectBossResumeSnapshot({ window: target as Window, timeoutMs: 50 })).resolves.toMatchObject({
      ok: false,
      error: 'EXTENSION_UNAVAILABLE'
    })
  })

  it('validates a BOSS recipient only when all platform identities are present', async () => {
    const target = new EventTarget()
    target.addEventListener(BROWSER_AGENT_REQUEST_EVENT, (event) => {
      const request = (event as CustomEvent<{ requestId: string; action: string }>).detail
      if (request.action !== 'inspect-boss-conversation') return
      target.dispatchEvent(new CustomEvent(BROWSER_AGENT_RESPONSE_EVENT, { detail: {
        requestId: request.requestId,
        ok: true,
        recipient: {
          platformRecipientId: 'boss-user-1', conversationId: 'conversation-1',
          recipientName: '招聘经理', recipientTitle: 'HR'
        }
      } }))
    })
    const { inspectBossBrowserConversation } = await import('./browser-agent-protocol')
    await expect(inspectBossBrowserConversation({ window: target as Window, timeoutMs: 50 })).resolves.toMatchObject({
      recipient: { platformRecipientId: 'boss-user-1', conversationId: 'conversation-1' }
    })
  })

  it('opens only an allowlisted BOSS job conversation with a bounded target identity', async () => {
    const target = new EventTarget()
    target.addEventListener(BROWSER_AGENT_REQUEST_EVENT, (event) => {
      const request = (event as CustomEvent<{ requestId: string; action: string; payload: { url: string; title: string; company: string } }>).detail
      if (request.action !== 'open-boss-conversation') return
      expect(request.payload).toEqual({
        url: 'https://www.zhipin.com/job_detail/abc.html',
        title: '平台工程师',
        company: '示例公司'
      })
      target.dispatchEvent(new CustomEvent(BROWSER_AGENT_RESPONSE_EVENT, { detail: {
        requestId: request.requestId,
        ok: true,
        recipient: {
          platformRecipientId: 'boss-user-1', conversationId: 'conversation-1',
          recipientName: '招聘经理', recipientTitle: '平台工程师'
        }
      } }))
    })
    const { openBossBrowserConversation } = await import('./browser-agent-protocol')
    await expect(openBossBrowserConversation({
      window: target as Window,
      url: 'https://www.zhipin.com/job_detail/abc.html#detail',
      title: '平台工程师',
      company: '示例公司',
      timeoutMs: 50
    })).resolves.toMatchObject({ ok: true, recipient: { conversationId: 'conversation-1' } })
    await expect(openBossBrowserConversation({
      window: target as Window,
      url: 'https://evil.example/job_detail/abc.html',
      title: '平台工程师',
      company: '示例公司'
    })).rejects.toThrow()
  })

  it('accepts only bounded de-identified conversation signals', async () => {
    const target = new EventTarget()
    target.addEventListener(BROWSER_AGENT_REQUEST_EVENT, (event) => {
      const request = (event as CustomEvent<{ requestId: string; action: string }>).detail
      if (request.action !== 'collect-boss-conversation-signals') return
      target.dispatchEvent(new CustomEvent(BROWSER_AGENT_RESPONSE_EVENT, { detail: {
        requestId: request.requestId,
        ok: true,
        conversationSignals: [{
          signalId: 'fnv1a64:signal-1', conversationId: 'conversation-1',
          kind: 'resume-request', observedAt: '2026-08-19T08:00:00.000Z'
        }]
      } }))
    })
    const { collectBossConversationSignals } = await import('./browser-agent-protocol')
    await expect(collectBossConversationSignals({ window: target as Window, timeoutMs: 50 }))
      .resolves.toMatchObject({ conversationSignals: [{ kind: 'resume-request' }] })
  })

  it('accepts only aggregate BOSS history statistics', async () => {
    const target = new EventTarget()
    target.addEventListener(BROWSER_AGENT_REQUEST_EVENT, (event) => {
      const request = (event as CustomEvent<{ requestId: string; action: string }>).detail
      if (request.action !== 'summarize-boss-history') return
      target.dispatchEvent(new CustomEvent(BROWSER_AGENT_RESPONSE_EVENT, { detail: {
        requestId: request.requestId,
        ok: true,
        historySummary: {
          conversationCount: 20, outgoingMessageCount: 18, incomingMessageCount: 5,
          recruiterReplyCount: 5, resumeRequestCount: 2, interviewInviteCount: 1,
          offerCount: 0, rejectionCount: 2, observedAt: '2026-08-20T08:00:00.000Z'
        }
      } }))
    })
    const { summarizeBossHistory } = await import('./browser-agent-protocol')
    await expect(summarizeBossHistory({ window: target as Window, timeoutMs: 50 }))
      .resolves.toMatchObject({ historySummary: { conversationCount: 20, recruiterReplyCount: 5 } })
  })

  it('reads runtime state and reports a completed persisted cycle', async () => {
    const target = new EventTarget()
    target.addEventListener(BROWSER_AGENT_REQUEST_EVENT, (event) => {
      const request = (event as CustomEvent<{ requestId: string; action: string; payload?: { cycleId: string; status: string } }>).detail
      if (request.action === 'report-job-agent-cycle') {
        expect(request.payload).toEqual({ cycleId: 'cycle-1', status: 'completed' })
      }
      if (!['get-job-agent-runtime', 'report-job-agent-cycle'].includes(request.action)) return
      target.dispatchEvent(new CustomEvent(BROWSER_AGENT_RESPONSE_EVENT, { detail: {
        requestId: request.requestId,
        ok: true,
        jobAgentRuntime: {
          enabled: true, intervalMinutes: 15, pendingCount: request.action === 'get-job-agent-runtime' ? 1 : 0,
          missedRunCount: 0, offlineReason: 'none', nextRunAt: '2026-08-20T09:15:00.000Z'
        }
      } }))
    })
    const { getBrowserJobAgentRuntime, reportBrowserJobAgentCycle } = await import('./browser-agent-protocol')
    await expect(getBrowserJobAgentRuntime({ window: target as Window, timeoutMs: 50 }))
      .resolves.toMatchObject({ jobAgentRuntime: { pendingCount: 1 } })
    await expect(reportBrowserJobAgentCycle({ window: target as Window, cycleId: 'cycle-1', status: 'completed', timeoutMs: 50 }))
      .resolves.toMatchObject({ jobAgentRuntime: { pendingCount: 0 } })
  })

  it('validates wake event details before running a cycle', async () => {
    const { readBrowserJobAgentCycle } = await import('./browser-agent-protocol')
    expect(readBrowserJobAgentCycle(new CustomEvent('wake', { detail: {
      id: 'cycle-1', scheduledAt: '2026-08-20T09:00:00.000Z', reason: 'catch-up', missedIntervals: 2, attempt: 1
    } })).success).toBe(true)
    expect(readBrowserJobAgentCycle(new CustomEvent('wake', { detail: { id: 'bad' } })).success).toBe(false)
  })

  it('validates content-free adapter diagnostics', async () => {
    const target = new EventTarget()
    target.addEventListener(BROWSER_AGENT_REQUEST_EVENT, (event) => {
      const request = (event as CustomEvent<{ requestId: string; action: string }>).detail
      if (request.action !== 'diagnose-boss-adapter') return
      target.dispatchEvent(new CustomEvent(BROWSER_AGENT_RESPONSE_EVENT, { detail: {
        requestId: request.requestId,
        ok: true,
        diagnostics: [{
          pageKind: 'chat', frameId: 0, sessionState: 'available',
          counts: { jobLinks: 0, editors: 1, sendControls: 1, recipientIdentities: 1, conversationIdentities: 1, recipientNames: 1, docxInputs: 1, pdfInputs: 1, messageReceipts: 3, attachmentReceipts: 1, incomingMessages: 2 },
          ready: { discovery: false, conversation: true, messageSend: true, resumeUpload: true }
        }]
      } }))
    })
    const { diagnoseBossBrowserAdapter } = await import('./browser-agent-protocol')
    await expect(diagnoseBossBrowserAdapter({ window: target as Window, timeoutMs: 50 }))
      .resolves.toMatchObject({ diagnostics: [{ ready: { resumeUpload: true } }] })
  })

  it('normalizes and bounds automatic BOSS search queries', async () => {
    const target = new EventTarget()
    target.addEventListener(BROWSER_AGENT_REQUEST_EVENT, (event) => {
      const request = (event as CustomEvent<{ requestId: string; action: string; payload: { query: string } }>).detail
      if (request.action !== 'search-boss-jobs') return
      expect(request.payload).toEqual({ query: '平台工程师' })
      target.dispatchEvent(new CustomEvent(BROWSER_AGENT_RESPONSE_EVENT, { detail: {
        requestId: request.requestId, ok: true, jobs: []
      } }))
    })
    const { searchBossBrowserJobs } = await import('./browser-agent-protocol')
    await expect(searchBossBrowserJobs({ window: target as Window, query: '  平台工程师  ', timeoutMs: 50 }))
      .resolves.toMatchObject({ ok: true, jobs: [] })
    await expect(searchBossBrowserJobs({ window: target as Window, query: '' })).rejects.toThrow()
  })

  it('validates a complete BOSS send receipt', async () => {
    const target = new EventTarget()
    target.addEventListener(BROWSER_AGENT_REQUEST_EVENT, (event) => {
      const request = (event as CustomEvent<{ requestId: string; action: string; payload: { body: string } }>).detail
      if (request.action !== 'send-boss-message') return
      target.dispatchEvent(new CustomEvent(BROWSER_AGENT_RESPONSE_EVENT, { detail: {
        requestId: request.requestId,
        ok: true,
        sendReceipt: {
          platformMessageId: 'message-1', conversationId: 'conversation-1',
          observedBody: request.payload.body, observedStatus: 'delivered',
          observedRecipient: {
            platformRecipientId: 'boss-user-1', conversationId: 'conversation-1', recipientName: '招聘经理'
          },
          observedAt: '2026-08-19T08:00:00.000Z'
        }
      } }))
    })
    const { sendBossBrowserMessage } = await import('./browser-agent-protocol')
    await expect(sendBossBrowserMessage({
      window: target as Window,
      messageId: 'local-message-1',
      body: '您好',
      bodyFingerprint: 'fnv1a64:body',
      recipient: { platformRecipientId: 'boss-user-1', conversationId: 'conversation-1', recipientName: '招聘经理' },
      timeoutMs: 50
    })).resolves.toMatchObject({ sendReceipt: { observedStatus: 'delivered', observedBody: '您好' } })
  })

  it('validates a complete BOSS resume attachment receipt', async () => {
    const target = new EventTarget()
    target.addEventListener(BROWSER_AGENT_REQUEST_EVENT, (event) => {
      const request = (event as CustomEvent<{ requestId: string; action: string; payload: { fileName: string; byteLength: number; contentFingerprint: string } }>).detail
      if (request.action !== 'send-boss-resume-attachment') return
      target.dispatchEvent(new CustomEvent(BROWSER_AGENT_RESPONSE_EVENT, { detail: {
        requestId: request.requestId,
        ok: true,
        resumeReceipt: {
          platformAttachmentId: 'attachment-1', conversationId: 'conversation-1',
          observedFileName: request.payload.fileName,
          observedMimeType: 'application/pdf',
          observedByteLength: request.payload.byteLength,
          contentFingerprint: request.payload.contentFingerprint,
          observedRecipient: {
            platformRecipientId: 'boss-user-1', conversationId: 'conversation-1', recipientName: '招聘经理'
          },
          observedAt: '2026-08-19T08:00:00.000Z'
        }
      } }))
    })
    const { sendBossResumeAttachment } = await import('./browser-agent-protocol')
    await expect(sendBossResumeAttachment({
      window: target as Window,
      fileName: 'target-role.pdf',
      bytesBase64: btoa('%PDF'),
      byteLength: 4,
      mimeType: 'application/pdf',
      contentFingerprint: 'fnv1a64:pdf',
      recipient: { platformRecipientId: 'boss-user-1', conversationId: 'conversation-1', recipientName: '招聘经理' },
      timeoutMs: 50
    })).resolves.toMatchObject({ resumeReceipt: { platformAttachmentId: 'attachment-1' } })
    await expect(sendBossResumeAttachment({
      window: target as Window,
      fileName: 'target-role.docx',
      bytesBase64: btoa('%PDF'),
      byteLength: 4,
      mimeType: 'application/pdf',
      contentFingerprint: 'fnv1a64:pdf',
      recipient: { platformRecipientId: 'boss-user-1', conversationId: 'conversation-1', recipientName: '招聘经理' }
    })).rejects.toThrow()
  })

  it('fails closed when no extension responds', async () => {
    vi.useFakeTimers()
    const target = new EventTarget()
    const pending = detectBrowserAgentSessions({ window: target as Window, timeoutMs: 20 })
    await vi.advanceTimersByTimeAsync(20)
    await expect(pending).resolves.toMatchObject({ ok: false, error: 'EXTENSION_UNAVAILABLE' })
    vi.useRealTimers()
  })
})
