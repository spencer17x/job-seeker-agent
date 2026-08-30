import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

describe('JobSeeker Agent BOSS extension background', () => {
  it('reports access restrictions but prefers another available BOSS tab', async () => {
    let listener: ((message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean) | undefined
    const chrome = {
      runtime: {
        getManifest: () => ({ version: '0.1.0' }),
        onMessage: { addListener: (value: typeof listener) => { listener = value } }
      },
      tabs: {
        query: vi.fn(async () => [
          { id: 60, url: 'https://www.zhipin.com/web/passport/zp/403.html?code=32', lastAccessed: 200 },
          { id: 61, url: 'https://www.zhipin.com/web/geek/chat', lastAccessed: 100 }
        ]),
        sendMessage: vi.fn(async (tabId: number) => ({
          state: tabId === 60 ? 'access-restricted' : 'available'
        }))
      },
      alarms: { onAlarm: { addListener: vi.fn() }, clear: vi.fn(), create: vi.fn() },
      storage: { local: { set: vi.fn(), get: vi.fn(async () => ({})) } },
      notifications: { create: vi.fn(async () => 'notification-1') }
    }
    runInNewContext(readFileSync('browser-extension/background.js', 'utf8'), {
      chrome, URL, Map, Set, Promise, setTimeout, clearTimeout, queueMicrotask
    })
    const response = new Promise<Record<string, unknown>>((resolve) => {
      expect(listener?.({ action: 'detect-platforms', requestId: 'request-detect' }, {}, (value) => resolve(value as Record<string, unknown>))).toBe(true)
    })
    await expect(response).resolves.toMatchObject({
      ok: true,
      protocolVersion: 11,
      sessions: [{ platform: 'boss', state: 'available', tabId: 61 }]
    })
  })

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
    expect(opened.pathname).toBe('/web/geek/jobs')
    expect(opened.searchParams.get('query')).toBe('平台工程师')
    expect(create).toHaveBeenCalledTimes(3)
    expect(new URL(create.mock.calls[1][0].url).searchParams.get('page')).toBe('2')
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
    listener?.({ action: 'boss-frame-ready' }, { tab: { id: 45 }, frameId: 3 }, vi.fn())
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
    const updatedListeners = new Set<(tabId: number, changeInfo: { status?: string }) => void>()
    const create = vi.fn(async ({ url }: { url: string }) => ({ id: 45, url }))
    const remove = vi.fn(async () => undefined)
    const reload = vi.fn(async (tabId: number) => {
      queueMicrotask(() => {
        for (const updatedListener of updatedListeners) updatedListener(tabId, { status: 'complete' })
      })
    })
    const recipient = {
      platformRecipientId: 'boss-user-1', conversationId: 'conversation-1',
      recipientName: '招聘经理', recipientTitle: '平台工程师'
    }
    const sendMessage = vi.fn(async (_tabId: number, message: { action: string; payload?: Record<string, unknown> }) => (
      message.action === 'open-boss-conversation'
        ? { opened: true, recruiterHint: { recruiterName: '招聘经理', recruiterCompany: '示例公司招聘团队' } }
        : message.action === 'select-boss-conversation'
          ? { recipient, sendReceipt: {
              platformMessageId: 'message-1', conversationId: recipient.conversationId,
              observedBody: '刚刚看了您发布的这个职位，我特别喜欢，可否聊聊呢？',
              observedStatus: 'delivered', observedRecipient: recipient,
              observedAt: '2026-08-30T08:00:00.000Z'
            } }
        : message.action === 'inspect-boss-conversation'
          ? { recipient }
          : {}
    ))
    const chrome = {
      runtime: { getManifest: () => ({ version: '0.1.0' }), onMessage: { addListener: (value: typeof listener) => { listener = value } } },
      tabs: {
        create, remove, reload, sendMessage, update: vi.fn(async () => undefined),
        get: async () => ({ id: 45, status: 'complete', url: 'https://www.zhipin.com/web/geek/chat' }), query: async () => [],
        onUpdated: {
          addListener: (updatedListener: (tabId: number, changeInfo: { status?: string }) => void) => { updatedListeners.add(updatedListener) },
          removeListener: (updatedListener: (tabId: number, changeInfo: { status?: string }) => void) => { updatedListeners.delete(updatedListener) }
        }
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
          title: '平台工程师', company: '示例公司',
          openingBody: '刚刚看了您发布的这个职位，我特别喜欢，可否聊聊呢？'
        }
      }, {}, (value) => resolve(value as Record<string, unknown>))).toBe(true)
    })
    await expect(response).resolves.toMatchObject({
      ok: true,
      recipient: { platformRecipientId: 'boss-user-1', conversationId: 'conversation-1' },
      sendReceipt: { platformMessageId: 'message-1', observedStatus: 'delivered' }
    })
    expect(create).toHaveBeenCalledWith({ url: 'https://www.zhipin.com/job_detail/job-45.html', active: false })
    expect(sendMessage.mock.calls.filter(([, message]) => message.action === 'open-boss-conversation')).toHaveLength(1)
    expect(sendMessage.mock.calls.find(([, message]) => message.action === 'select-boss-conversation')?.[1].payload)
      .toMatchObject({ recruiterName: '招聘经理', recruiterCompany: '示例公司招聘团队' })
    expect(reload).toHaveBeenCalledWith(45)
    expect(remove).not.toHaveBeenCalledWith(45)
  })

  it('ignores a child-frame login prompt when the main job frame is merely unmatched', async () => {
    let listener: ((message: any, sender: any, respond: (value: unknown) => void) => boolean) | undefined
    const remove = vi.fn(async () => undefined)
    const sendMessage = vi.fn(async (_tabId: number, message: { action: string }, options: { frameId: number }) => (
      message.action === 'open-boss-conversation' && options.frameId === 3
        ? { opened: false, attention: 'login-required' }
        : { opened: false }
    ))
    const chrome = {
      runtime: { getManifest: () => ({ version: '0.1.0' }), onMessage: { addListener: (value: typeof listener) => { listener = value } } },
      tabs: {
        create: vi.fn(async ({ url }: { url: string }) => ({ id: 46, url })),
        remove,
        sendMessage,
        update: vi.fn(async () => undefined),
        get: async () => ({ id: 46, status: 'complete' }),
        query: async () => [],
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
    listener?.({ action: 'boss-frame-ready' }, { tab: { id: 46 }, frameId: 3 }, vi.fn())
    const response = new Promise<Record<string, unknown>>((resolve) => {
      listener?.({ action: 'open-boss-conversation', requestId: 'request-child-login', payload: {
        url: 'https://www.zhipin.com/job_detail/job-46.html',
        title: '平台工程师', company: '示例公司',
        openingBody: '刚刚看了您发布的这个职位，我特别喜欢，可否聊聊呢？'
      } }, {}, (value) => resolve(value as Record<string, unknown>))
    })
    await expect(response).resolves.toMatchObject({ ok: false, error: 'PROBE_FAILED' })
    expect(remove).toHaveBeenCalledWith(46)
  })

  it('reuses an existing exact job tab instead of creating another authenticated surface', async () => {
    let listener: ((message: any, sender: any, respond: (value: unknown) => void) => boolean) | undefined
    const create = vi.fn()
    const remove = vi.fn(async () => undefined)
    const jobUrl = 'https://www.zhipin.com/job_detail/job-47.html'
    const chrome = {
      runtime: { getManifest: () => ({ version: '0.1.0' }), onMessage: { addListener: (value: typeof listener) => { listener = value } } },
      tabs: {
        create,
        remove,
        sendMessage: vi.fn(async () => ({ opened: false, attention: 'captcha-required' })),
        update: vi.fn(async () => undefined),
        get: async () => ({ id: 47, status: 'complete', url: jobUrl }),
        query: vi.fn(async ({ url }: { url: string[] }) => (
          url[0].includes('/job_detail/') ? [{ id: 47, url: jobUrl, lastAccessed: 100 }] : []
        )),
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
      listener?.({ action: 'open-boss-conversation', requestId: 'request-existing-job', payload: {
        url: jobUrl, title: '平台工程师', company: '示例公司',
        openingBody: '刚刚看了您发布的这个职位，我特别喜欢，可否聊聊呢？'
      } }, {}, (value) => resolve(value as Record<string, unknown>))
    })
    await expect(response).resolves.toMatchObject({ ok: false, attention: 'captcha-required' })
    expect(create).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it('reconciles an existing chat before opening any job-detail surface', async () => {
    let listener: ((message: any, sender: any, respond: (value: unknown) => void) => boolean) | undefined
    const updatedListeners = new Set<(tabId: number, changeInfo: { status?: string }) => void>()
    const create = vi.fn()
    const executeScript = vi.fn(async () => undefined)
    const reload = vi.fn(async (tabId: number) => {
      queueMicrotask(() => {
        for (const updatedListener of updatedListeners) updatedListener(tabId, { status: 'complete' })
      })
    })
    const recipient = {
      platformRecipientId: 'boss-chat', conversationId: 'conversation-chat',
      recipientName: '招聘经理'
    }
    const sendMessage = vi.fn(async (_tabId: number, message: { action: string }) => (
      message.action === 'select-boss-conversation'
        ? { recipient, sendReceipt: {
            platformMessageId: 'opening-chat', conversationId: recipient.conversationId,
            observedBody: '刚刚看了您发布的这个职位，我特别喜欢，可否聊聊呢？',
            observedStatus: 'delivered', observedRecipient: recipient,
            observedAt: '2026-08-30T08:00:00.000Z'
          } }
        : {}
    ))
    const chrome = {
      runtime: { getManifest: () => ({ version: '0.1.0' }), onMessage: { addListener: (value: typeof listener) => { listener = value } } },
      tabs: {
        create,
        reload,
        remove: vi.fn(async () => undefined),
        sendMessage,
        update: vi.fn(async () => undefined),
        get: vi.fn(),
        query: vi.fn(async ({ url }: { url: string[] }) => (
          url[0].includes('/web/geek/chat')
            ? [{ id: 48, url: 'https://www.zhipin.com/web/geek/chat', lastAccessed: 100 }]
            : []
        )),
        onUpdated: {
          addListener: (updatedListener: (tabId: number, changeInfo: { status?: string }) => void) => { updatedListeners.add(updatedListener) },
          removeListener: (updatedListener: (tabId: number, changeInfo: { status?: string }) => void) => { updatedListeners.delete(updatedListener) }
        }
      },
      scripting: { executeScript },
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
      listener?.({ action: 'open-boss-conversation', requestId: 'request-chat-first', payload: {
        url: 'https://www.zhipin.com/job_detail/job-48.html', title: '平台工程师', company: '杭州',
        openingBody: '刚刚看了您发布的这个职位，我特别喜欢，可否聊聊呢？'
      } }, {}, (value) => resolve(value as Record<string, unknown>))
    })
    await expect(response).resolves.toMatchObject({
      ok: true,
      recipient,
      sendReceipt: { platformMessageId: 'opening-chat', observedStatus: 'delivered' }
    })
    expect(create).not.toHaveBeenCalled()
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 48, allFrames: true },
      files: ['platform-probe.js']
    })
    expect(reload).not.toHaveBeenCalled()
    expect(sendMessage.mock.calls.some(([, message]) => message.action === 'open-boss-conversation')).toBe(false)
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

  it('reopens only the last allowlisted Job Agent page for a pending managed cycle', async () => {
    let listener: ((message: unknown, sender: { tab?: { id?: number; url?: string } }, respond: (value: unknown) => void) => boolean) | undefined
    const runtime = {
      enabled: true,
      pendingCycles: [{ id: 'cycle-1', scheduledAt: '2026-08-01T08:00:00.000Z', reason: 'scheduled', missedIntervals: 0, state: 'pending', attempts: 0 }]
    }
    const create = vi.fn(async ({ url }: { url: string }) => ({ id: 3, url, status: 'complete' }))
    const markUnavailable = vi.fn((value: typeof runtime) => value)
    const storageSet = vi.fn(async () => undefined)
    const chrome = {
      runtime: {
        getManifest: () => ({ version: '0.1.0' }),
        onMessage: { addListener: (value: typeof listener) => { listener = value } },
        onStartup: { addListener: vi.fn() }
      },
      tabs: {
        query: async () => [], create,
        get: async () => ({ id: 3, status: 'complete' }), sendMessage: vi.fn(), remove: vi.fn(),
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() }
      },
      alarms: { onAlarm: { addListener: vi.fn() }, clear: vi.fn(), create: vi.fn() },
      storage: { local: {
        set: storageSet,
        get: vi.fn(async () => ({
          jobAgentRuntimeV1: runtime,
          jobAgentSchedule: { enabled: true, intervalMinutes: 15 },
          jobAgentPageV1: 'http://127.0.0.1:3001/zh/jobs/conversations?unsafe=ignored'
        }))
      } },
      notifications: { create: vi.fn(async () => 'notification-1') }
    }
    const ResumeOsJobRuntime = {
      normalizeRuntime: (value: unknown) => value as typeof runtime,
      nextDispatchable: (value: typeof runtime) => value.pendingCycles[0],
      markDispatched: (value: typeof runtime) => value,
      markUnavailable,
      publicStatus: (value: typeof runtime) => value,
      configure: (value: typeof runtime) => value,
      schedule: (value: typeof runtime) => value,
      acknowledge: (value: typeof runtime) => value
    }
    runInNewContext(readFileSync('browser-extension/background.js', 'utf8'), {
      chrome, ResumeOsJobRuntime, URL, Map, Set, Promise, Date, Math,
      setTimeout: (callback: () => void, milliseconds: number) => {
        if (milliseconds < 2_000) queueMicrotask(callback)
        return 1
      },
      clearTimeout: vi.fn(), queueMicrotask
    })
    expect(listener?.({ action: 'job-agent-page-ready' }, { tab: { id: 9, url: 'https://evil.example/zh/jobs' } }, vi.fn())).toBe(false)
    await vi.waitFor(() => expect(create).toHaveBeenCalledWith({
      url: 'http://127.0.0.1:3001/zh/jobs', active: false
    }))
    expect(markUnavailable).not.toHaveBeenCalled()
    expect(storageSet).not.toHaveBeenCalledWith(expect.objectContaining({
      jobAgentPageV1: expect.anything()
    }))
  })
})
