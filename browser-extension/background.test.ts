import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

describe('JobSeeker Agent BOSS extension background', () => {
  it('constructs a fixed-host search tab, collects bounded jobs, and closes the tab', async () => {
    let listener: ((message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean) | undefined
    const create = vi.fn(async ({ url }: { url: string }) => ({ id: 42, url }))
    const remove = vi.fn(async () => undefined)
    const sendMessage = vi.fn(async () => ({ jobs: [{ externalId: 'one' }] }))
    const chrome = {
      runtime: {
        getManifest: () => ({ version: '0.1.0' }),
        onMessage: { addListener: (value: typeof listener) => { listener = value } }
      },
      tabs: {
        create,
        remove,
        sendMessage,
        get: async () => ({ id: 42, status: 'complete' }),
        query: async () => [],
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() }
      },
      alarms: { onAlarm: { addListener: vi.fn() }, clear: vi.fn(), create: vi.fn() },
      storage: { local: { set: vi.fn(), get: vi.fn(async () => ({})) } },
      notifications: { create: vi.fn(async () => 'notification-1') }
    }
    runInNewContext(readFileSync('browser-extension/background.js', 'utf8'), {
      chrome, URL, Map, Set, Promise,
      setTimeout: (callback: () => void, milliseconds: number) => {
        if (milliseconds < 2_000) queueMicrotask(callback)
        return 1
      },
      clearTimeout: vi.fn(),
      queueMicrotask
    })
    expect(listener).toBeTypeOf('function')
    const response = new Promise<Record<string, unknown>>((resolve) => {
      expect(listener?.({
        action: 'search-boss-jobs', requestId: 'request-1', payload: { query: '平台工程师' }
      }, {}, (value) => resolve(value as Record<string, unknown>))).toBe(true)
    })
    await expect(response).resolves.toMatchObject({ ok: true, jobs: [{ externalId: 'one' }] })
    const opened = new URL(create.mock.calls[0][0].url)
    expect(opened.origin).toBe('https://www.zhipin.com')
    expect(opened.pathname).toBe('/web/geek/job')
    expect(opened.searchParams.get('query')).toBe('平台工程师')
    expect(remove).toHaveBeenCalledWith(42)
  })

  it('opens only the fixed BOSS resume page and closes it after a bounded snapshot', async () => {
    let listener: ((message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean) | undefined
    const create = vi.fn(async ({ url }: { url: string }) => ({ id: 43, url }))
    const remove = vi.fn(async () => undefined)
    const sendMessage = vi.fn(async () => ({ resumeSnapshot: {
      sourceUrl: 'https://www.zhipin.com/web/geek/resume',
      text: '个人优势 TypeScript AI Agent。工作经历 示例公司 AI 全栈工程师。',
      collectedAt: '2026-08-29T08:00:00.000Z'
    } }))
    const chrome = {
      runtime: {
        getManifest: () => ({ version: '0.1.0' }),
        onMessage: { addListener: (value: typeof listener) => { listener = value } }
      },
      tabs: {
        create, remove, sendMessage,
        get: async () => ({ id: 43, status: 'complete' }),
        query: async () => [],
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() }
      },
      alarms: { onAlarm: { addListener: vi.fn() }, clear: vi.fn(), create: vi.fn() },
      storage: { local: { set: vi.fn(), get: vi.fn(async () => ({})) } },
      notifications: { create: vi.fn(async () => 'notification-1') }
    }
    runInNewContext(readFileSync('browser-extension/background.js', 'utf8'), {
      chrome, URL, Map, Set, Promise,
      setTimeout: (callback: () => void, milliseconds: number) => {
        if (milliseconds < 2_000) queueMicrotask(callback)
        return 1
      },
      clearTimeout: vi.fn(), queueMicrotask
    })
    const response = new Promise<Record<string, unknown>>((resolve) => {
      expect(listener?.({ action: 'collect-boss-resume', requestId: 'request-resume' }, {}, (value) => resolve(value as Record<string, unknown>))).toBe(true)
    })
    await expect(response).resolves.toMatchObject({ ok: true, resumeSnapshot: { sourceUrl: 'https://www.zhipin.com/web/geek/resume' } })
    expect(create).toHaveBeenCalledWith({ url: 'https://www.zhipin.com/web/geek/resume', active: false })
    expect(remove).toHaveBeenCalledWith(43)
  })

  it('prefers a structured child-frame job description over a longer company introduction', async () => {
    let listener: ((message: any, sender: any, respond: (value: unknown) => void) => boolean) | undefined
    const create = vi.fn(async ({ url }: { url: string }) => ({ id: 44, url }))
    const sendMessage = vi.fn(async (_tabId: number, _message: unknown, options: { frameId: number }) => (
      options.frameId === 3
        ? { jobDetail: { externalId: 'job-44', url: 'https://www.zhipin.com/job_detail/job-44.html', description: '岗位职责：开发 Agent 工作流。任职要求：熟悉 TypeScript。加分项：有 RAG 项目经验。' } }
        : { jobDetail: { externalId: 'job-44', url: 'https://www.zhipin.com/job_detail/job-44.html', description: `公司介绍：${'行业背景与企业文化'.repeat(100)}` } }
    ))
    const chrome = {
      runtime: { getManifest: () => ({ version: '0.1.0' }), onMessage: { addListener: (value: typeof listener) => { listener = value } } },
      tabs: {
        create, remove: vi.fn(async () => undefined), sendMessage,
        get: async () => ({ id: 44, status: 'complete' }), query: async () => [],
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() }
      },
      alarms: { onAlarm: { addListener: vi.fn() }, clear: vi.fn(), create: vi.fn() },
      storage: { local: { set: vi.fn(), get: vi.fn(async () => ({})) } },
      notifications: { create: vi.fn(async () => 'notification-1') }
    }
    runInNewContext(readFileSync('browser-extension/background.js', 'utf8'), {
      chrome, URL, Map, Set, Promise,
      setTimeout: (callback: () => void, milliseconds: number) => { if (milliseconds < 2_000) queueMicrotask(callback); return 1 },
      clearTimeout: vi.fn(), queueMicrotask
    })
    listener?.({ action: 'boss-frame-ready' }, { tab: { id: 44 }, frameId: 3 }, vi.fn())
    const response = new Promise<Record<string, any>>((resolve) => {
      listener?.({ action: 'collect-boss-job-detail', requestId: 'request-detail', payload: { url: 'https://www.zhipin.com/job_detail/job-44.html' } }, {}, (value) => resolve(value as Record<string, any>))
    })
    await expect(response).resolves.toMatchObject({
      ok: true,
      jobDetail: { description: expect.stringContaining('任职要求') }
    })
  })

  it('opens a validated BOSS job conversation and keeps only its verified chat tab', async () => {
    let listener: ((message: any, sender: any, respond: (value: unknown) => void) => boolean) | undefined
    const create = vi.fn(async ({ url }: { url: string }) => ({ id: 45, url }))
    const remove = vi.fn(async () => undefined)
    const sendMessage = vi.fn(async (_tabId: number, message: { action: string }) => (
      message.action === 'open-boss-conversation'
        ? { opened: true }
        : message.action === 'inspect-boss-conversation'
          ? { recipient: {
              platformRecipientId: 'boss-user-1', conversationId: 'conversation-1',
              recipientName: '招聘经理', recipientTitle: '平台工程师'
            } }
          : {}
    ))
    const chrome = {
      runtime: { getManifest: () => ({ version: '0.1.0' }), onMessage: { addListener: (value: typeof listener) => { listener = value } } },
      tabs: {
        create, remove, sendMessage, update: vi.fn(async () => undefined),
        get: async () => ({ id: 45, status: 'complete' }), query: async () => [],
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() }
      },
      alarms: { onAlarm: { addListener: vi.fn() }, clear: vi.fn(), create: vi.fn() },
      storage: { local: { set: vi.fn(), get: vi.fn(async () => ({})) } },
      notifications: { create: vi.fn(async () => 'notification-1') }
    }
    runInNewContext(readFileSync('browser-extension/background.js', 'utf8'), {
      chrome, URL, Map, Set, Promise,
      setTimeout: (callback: () => void, milliseconds: number) => { if (milliseconds < 2_000) queueMicrotask(callback); return 1 },
      clearTimeout: vi.fn(), queueMicrotask
    })
    const response = new Promise<Record<string, unknown>>((resolve) => {
      expect(listener?.({
        action: 'open-boss-conversation', requestId: 'request-open', payload: {
          url: 'https://www.zhipin.com/job_detail/job-45.html',
          title: '平台工程师', company: '示例公司'
        }
      }, {}, (value) => resolve(value as Record<string, unknown>))).toBe(true)
    })
    await expect(response).resolves.toMatchObject({
      ok: true,
      recipient: { platformRecipientId: 'boss-user-1', conversationId: 'conversation-1' }
    })
    expect(create).toHaveBeenCalledWith({ url: 'https://www.zhipin.com/job_detail/job-45.html', active: false })
    expect(remove).not.toHaveBeenCalledWith(45)
  })

  it('dispatches a pending cycle only to the Job Agent tab that reported ready', async () => {
    let listener: ((message: unknown, sender: { tab?: { id?: number } }, respond: (value: unknown) => void) => boolean) | undefined
    const sendMessage = vi.fn(async () => undefined)
    const runtime = {
      enabled: true,
      pendingCycles: [{ id: 'cycle-1', scheduledAt: '2026-08-01T08:00:00.000Z', reason: 'scheduled', missedIntervals: 0, state: 'pending', attempts: 0 }]
    }
    const chrome = {
      runtime: {
        getManifest: () => ({ version: '0.1.0' }),
        onMessage: { addListener: (value: typeof listener) => { listener = value } },
        onStartup: { addListener: vi.fn() }
      },
      tabs: {
        query: async () => [
          { id: 1, url: 'http://127.0.0.1:3001/en/studio' },
          { id: 2, url: 'http://127.0.0.1:3001/en/jobs/opportunities' }
        ],
        sendMessage,
        create: vi.fn(), remove: vi.fn(), get: vi.fn(),
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() }
      },
      alarms: { onAlarm: { addListener: vi.fn() }, clear: vi.fn(), create: vi.fn() },
      storage: {
        local: {
          set: vi.fn(async () => undefined),
          get: vi.fn(async () => ({ jobAgentRuntimeV1: runtime, jobAgentSchedule: { enabled: true, intervalMinutes: 15 } }))
        }
      },
      notifications: { create: vi.fn(async () => 'notification-1') }
    }
    const ResumeOsJobRuntime = {
      normalizeRuntime: (value: unknown) => value as typeof runtime,
      nextDispatchable: (value: typeof runtime) => value.pendingCycles[0],
      markDispatched: (value: typeof runtime) => value,
      markUnavailable: (value: typeof runtime) => value,
      publicStatus: (value: typeof runtime) => value,
      configure: (value: typeof runtime) => value,
      schedule: (value: typeof runtime) => value,
      acknowledge: (value: typeof runtime) => value
    }
    runInNewContext(readFileSync('browser-extension/background.js', 'utf8'), {
      chrome, ResumeOsJobRuntime, URL, Map, Set, Promise, Date, Math,
      setTimeout: vi.fn(), clearTimeout: vi.fn()
    })

    expect(listener?.({ action: 'job-agent-page-ready' }, { tab: { id: 2 } }, vi.fn())).toBe(false)
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(2, expect.objectContaining({
      action: 'job-agent-wakeup',
      cycle: expect.objectContaining({ id: 'cycle-1' })
    })))
    expect(sendMessage).not.toHaveBeenCalledWith(1, expect.anything())
  })
})
