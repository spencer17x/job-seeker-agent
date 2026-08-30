import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createJobInputFingerprint } from '@/lib/jobs/job-domain'

describe('BOSS page send adapter', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <section data-boss-id="boss-user-1">
        <div data-conversation-id="conversation-1">
          <span class="chat-name">招聘经理</span>
          <span class="recipient-title">HR</span>
          <div contenteditable="true"></div>
          <button type="button">发送</button>
        </div>
      </section>`
    Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ x: 0, y: 0, width: 100, height: 30, top: 0, right: 100, bottom: 30, left: 0, toJSON() {} })
    })
  })

  it('collects structured salary boundaries from a visible BOSS job card', async () => {
    document.body.innerHTML = `<article class="job-card"><a href="/job_detail/job-1.html" title="平台工程师">平台工程师</a><span class="company-name">示例公司</span><span class="job-area">上海</span><span>25-45K·14薪 3-5年 本科</span></article>`
    let listener: ((message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean) | undefined
    const chrome = {
      runtime: {
        onMessage: { addListener: (value: typeof listener) => { listener = value } },
        sendMessage: async () => undefined
      }
    }
    runInNewContext(readFileSync('browser-extension/platform-probe.js', 'utf8'), {
      chrome, document, location: new URL('https://www.zhipin.com/web/geek/job'), URL,
      Element, HTMLTextAreaElement, HTMLInputElement, InputEvent, Event, TextEncoder, BigInt, Date, Promise,
      setTimeout, clearTimeout
    })
    const response = await new Promise<{ jobs: Array<Record<string, unknown>> }>((resolve) => {
      listener?.({ action: 'collect-boss-jobs' }, {}, (value) => resolve(value as { jobs: Array<Record<string, unknown>> }))
    })
    expect(response.jobs).toEqual([expect.objectContaining({
      externalId: 'job-1',
      minimumMonthlySalary: 25_000,
      maximumMonthlySalary: 45_000
    })])
  })

  it('collects a bounded full description only from a BOSS detail page', async () => {
    document.body.innerHTML = `<section class="job-sec"><h3>职位描述</h3><div class="job-sec-text">负责 AI Agent 产品的 TypeScript 全栈研发、工具调用编排、质量验证和线上稳定性建设。</div></section>`
    let listener: ((message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean) | undefined
    const chrome = {
      runtime: {
        onMessage: { addListener: (value: typeof listener) => { listener = value } },
        sendMessage: async () => undefined
      }
    }
    runInNewContext(readFileSync('browser-extension/platform-probe.js', 'utf8'), {
      chrome, document, location: new URL('https://www.zhipin.com/job_detail/job-1.html'), URL,
      Element, HTMLTextAreaElement, HTMLInputElement, InputEvent, Event, TextEncoder, BigInt, Date, Promise,
      setTimeout, clearTimeout
    })
    const response = await new Promise<{ jobDetail: Record<string, unknown> | null }>((resolve) => {
      listener?.({ action: 'collect-boss-job-detail' }, {}, (value) => resolve(value as { jobDetail: Record<string, unknown> | null }))
    })
    expect(response.jobDetail).toEqual(expect.objectContaining({
      externalId: 'job-1',
      description: expect.stringContaining('TypeScript 全栈研发')
    }))
  })

  it('opens a unique recruiter conversation only after the BOSS job identity matches', async () => {
    document.body.innerHTML = '<button type="button">立即沟通</button>'
    Object.defineProperty(document.body, 'innerText', {
      configurable: true,
      value: '平台工程师 示例公司 职位描述 负责 TypeScript 平台研发'
    })
    const click = vi.spyOn(document.querySelector('button')!, 'click')
    let listener: ((message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean) | undefined
    const chrome = { runtime: { onMessage: { addListener: (value: typeof listener) => { listener = value } }, sendMessage: async () => undefined } }
    runInNewContext(readFileSync('browser-extension/platform-probe.js', 'utf8'), {
      chrome, document, location: new URL('https://www.zhipin.com/job_detail/job-1.html'), URL,
      Element, HTMLTextAreaElement, HTMLInputElement, InputEvent, Event, TextEncoder, BigInt, Date, Promise,
      setTimeout, clearTimeout
    })
    const accepted = await new Promise<{ opened: boolean }>((resolve) => {
      listener?.({
        action: 'open-boss-conversation',
        payload: { url: 'https://www.zhipin.com/job_detail/job-1.html', title: '平台工程师', company: '示例公司' }
      }, {}, (value) => resolve(value as { opened: boolean }))
    })
    expect(accepted).toEqual({ opened: true })
    expect(click).toHaveBeenCalledOnce()
    const redactedCompany = await new Promise<{ opened: boolean }>((resolve) => {
      listener?.({
        action: 'open-boss-conversation',
        payload: { url: 'https://www.zhipin.com/job_detail/job-1.html', title: '平台工程师', company: '某大型互联网公司' }
      }, {}, (value) => resolve(value as { opened: boolean }))
    })
    expect(redactedCompany).toEqual({ opened: true })
    expect(click).toHaveBeenCalledTimes(2)
    const rejected = await new Promise<{ opened: boolean }>((resolve) => {
      listener?.({
        action: 'open-boss-conversation',
        payload: { url: 'https://www.zhipin.com/job_detail/job-1.html', title: '数据分析师', company: '示例公司' }
      }, {}, (value) => resolve(value as { opened: boolean }))
    })
    expect(rejected).toEqual({ opened: false })
    expect(click).toHaveBeenCalledTimes(2)
  })

  it('returns user attention instead of clicking through a BOSS CAPTCHA', async () => {
    document.body.innerHTML = '<button type="button">立即沟通</button>'
    Object.defineProperty(document.body, 'innerText', {
      configurable: true,
      value: '平台工程师 示例公司 请完成滑块验证'
    })
    const click = vi.spyOn(document.querySelector('button')!, 'click')
    let listener: ((message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean) | undefined
    const chrome = { runtime: { onMessage: { addListener: (value: typeof listener) => { listener = value } }, sendMessage: async () => undefined } }
    runInNewContext(readFileSync('browser-extension/platform-probe.js', 'utf8'), {
      chrome, document, location: new URL('https://www.zhipin.com/job_detail/job-1.html'), URL,
      Element, HTMLTextAreaElement, HTMLInputElement, InputEvent, Event, TextEncoder, BigInt, Date, Promise,
      setTimeout, clearTimeout
    })
    const response = await new Promise<{ opened: boolean; attention?: string }>((resolve) => {
      listener?.({
        action: 'open-boss-conversation',
        payload: { url: 'https://www.zhipin.com/job_detail/job-1.html', title: '平台工程师', company: '示例公司' }
      }, {}, (value) => resolve(value as { opened: boolean; attention?: string }))
    })
    expect(response).toEqual({ opened: false, attention: 'captcha-required' })
    expect(click).not.toHaveBeenCalled()
  })

  it('prefers the explicit job-description section over a longer company introduction', async () => {
    document.body.innerHTML = `<section class="job-sec"><h3>职位描 述</h3><div class="job-sec-text">负责 TypeScript、React 与 RAG Agent 平台开发，并承担工具调用、质量验证和稳定性建设。</div></section><section class="job-sec"><h3>公司介绍</h3><div class="job-sec-text">这是一段明显更长的公司介绍，包含大量业务、品牌、城市、用户和行业背景，但不应被当成岗位职责。${'公司背景'.repeat(30)}</div></section>`
    let listener: ((message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean) | undefined
    const chrome = { runtime: { onMessage: { addListener: (value: typeof listener) => { listener = value } }, sendMessage: async () => undefined } }
    runInNewContext(readFileSync('browser-extension/platform-probe.js', 'utf8'), {
      chrome, document, location: new URL('https://www.zhipin.com/job_detail/job-2.html'), URL,
      Element, HTMLTextAreaElement, HTMLInputElement, InputEvent, Event, TextEncoder, BigInt, Date, Promise,
      setTimeout, clearTimeout
    })
    const response = await new Promise<{ jobDetail: { description: string } | null }>((resolve) => {
      listener?.({ action: 'collect-boss-job-detail' }, {}, (value) => resolve((value as { jobDetail: { description: string } | null })))
    })
    expect(response.jobDetail?.description).toContain('TypeScript、React 与 RAG')
    expect(response.jobDetail?.description).not.toContain('大量业务')
  })

  it('extracts a job description rendered inside an open shadow root', async () => {
    document.body.innerHTML = `<section class="job-sec-text">公司介绍：${'企业背景'.repeat(40)}</section><div id="job-shell"></div>`
    const shadow = document.querySelector('#job-shell')!.attachShadow({ mode: 'open' })
    shadow.innerHTML = `<h3>职位描 述</h3><div>岗位职责：开发 Agent Workflow。任职要求：熟悉 TypeScript 与 Kubernetes。</div><h3>招聘者</h3>`
    let listener: ((message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean) | undefined
    const chrome = { runtime: { onMessage: { addListener: (value: typeof listener) => { listener = value } }, sendMessage: async () => undefined } }
    runInNewContext(readFileSync('browser-extension/platform-probe.js', 'utf8'), {
      chrome, document, location: new URL('https://www.zhipin.com/job_detail/job-shadow.html'), URL,
      Element, HTMLTextAreaElement, HTMLInputElement, InputEvent, Event, TextEncoder, BigInt, Date, Promise,
      setTimeout, clearTimeout
    })
    const response = await new Promise<{ jobDetail: { description: string } | null }>((resolve) => {
      listener?.({ action: 'collect-boss-job-detail' }, {}, (value) => resolve(value as { jobDetail: { description: string } | null }))
    })
    expect(response.jobDetail?.description).toContain('Agent Workflow')
    expect(response.jobDetail?.description).not.toContain('企业背景')
  })

  it('uses only a validated background-supplied job URL inside an about:blank child frame', async () => {
    document.body.innerHTML = `<div id="child-job"></div>`
    const shadow = document.querySelector('#child-job')!.attachShadow({ mode: 'open' })
    shadow.innerHTML = `<h3>职位描述</h3><div>岗位职责：维护 Agent Workflow。任职要求：熟悉 TypeScript。</div><h2>招聘者</h2>`
    let listener: ((message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean) | undefined
    const chrome = { runtime: { onMessage: { addListener: (value: typeof listener) => { listener = value } }, sendMessage: async () => undefined } }
    runInNewContext(readFileSync('browser-extension/platform-probe.js', 'utf8'), {
      chrome, document, location: new URL('about:blank'), URL,
      Element, HTMLTextAreaElement, HTMLInputElement, InputEvent, Event, TextEncoder, BigInt, Date, Promise,
      setTimeout, clearTimeout
    })
    const response = await new Promise<{ jobDetail: { description: string } | null }>((resolve) => {
      listener?.({ action: 'collect-boss-job-detail', payload: { url: 'https://www.zhipin.com/job_detail/job-child.html' } }, {}, (value) => resolve(value as { jobDetail: { description: string } | null }))
    })
    expect(response.jobDetail?.description).toContain('Agent Workflow')
    const rejected = await new Promise<{ jobDetail: unknown }>((resolve) => {
      listener?.({ action: 'collect-boss-job-detail', payload: { url: 'https://evil.example/job_detail/job-child.html' } }, {}, (value) => resolve(value as { jobDetail: unknown }))
    })
    expect(rejected.jobDetail).toBeNull()
  })

  it('extracts the rendered text boundary when BOSS hides detail inside a closed tree', async () => {
    document.body.innerHTML = `<section class="job-sec-text">公司介绍：错误候选</section>`
    Object.defineProperty(document.body, 'innerText', {
      configurable: true,
      value: `AI Agent工程师\n职位描 述\n岗位职责\n1. 开发 Agent Workflow\n任职要求\n1. 熟悉 TypeScript\nBOSS 安全提示\n请注意招聘安全\n公司介绍\n大量企业背景`
    })
    let listener: ((message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean) | undefined
    const chrome = { runtime: { onMessage: { addListener: (value: typeof listener) => { listener = value } }, sendMessage: async () => undefined } }
    runInNewContext(readFileSync('browser-extension/platform-probe.js', 'utf8'), {
      chrome, document, location: new URL('https://www.zhipin.com/job_detail/job-rendered.html'), URL,
      Element, HTMLTextAreaElement, HTMLInputElement, InputEvent, Event, TextEncoder, BigInt, Date, Promise,
      setTimeout, clearTimeout
    })
    const response = await new Promise<{ jobDetail: { description: string } | null }>((resolve) => {
      listener?.({ action: 'collect-boss-job-detail' }, {}, (value) => resolve(value as { jobDetail: { description: string } | null }))
    })
    expect(response.jobDetail?.description).toContain('开发 Agent Workflow')
    expect(response.jobDetail?.description).toContain('熟悉 TypeScript')
    expect(response.jobDetail?.description).not.toContain('大量企业背景')
  })

  it('collects bounded visible resume text only from the fixed BOSS resume page', async () => {
    document.body.innerHTML = `<main class="resume-content"><h2>个人优势</h2><p>负责 TypeScript AI Agent 产品开发。</p><h2>工作经历</h2><p>示例公司 · AI 全栈工程师 · 2023-至今</p><h2>项目经历</h2><p>构建 RAG 质量评估平台。</p></main>`
    let listener: ((message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean) | undefined
    const chrome = {
      runtime: {
        onMessage: { addListener: (value: typeof listener) => { listener = value } },
        sendMessage: async () => undefined
      }
    }
    runInNewContext(readFileSync('browser-extension/platform-probe.js', 'utf8'), {
      chrome, document, location: new URL('https://www.zhipin.com/web/geek/resume'), URL,
      Element, HTMLTextAreaElement, HTMLInputElement, InputEvent, Event, TextEncoder, BigInt, Date, Promise,
      setTimeout, clearTimeout
    })
    const response = await new Promise<{ resumeSnapshot: Record<string, unknown> | null }>((resolve) => {
      listener?.({ action: 'collect-boss-resume' }, {}, (value) => resolve(value as { resumeSnapshot: Record<string, unknown> | null }))
    })
    expect(response.resumeSnapshot).toEqual(expect.objectContaining({
      sourceUrl: 'https://www.zhipin.com/web/geek/resume',
      text: expect.stringContaining('RAG 质量评估平台')
    }))
  })

  it('refuses resume extraction outside the fixed BOSS resume path', async () => {
    document.body.innerHTML = `<main class="resume-content"><h2>工作经历</h2><p>不应从岗位页面读取为用户简历的内容。</p></main>`
    let listener: ((message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean) | undefined
    const chrome = { runtime: { onMessage: { addListener: (value: typeof listener) => { listener = value } }, sendMessage: async () => undefined } }
    runInNewContext(readFileSync('browser-extension/platform-probe.js', 'utf8'), {
      chrome, document, location: new URL('https://www.zhipin.com/web/geek/job'), URL,
      Element, HTMLTextAreaElement, HTMLInputElement, InputEvent, Event, TextEncoder, BigInt, Date, Promise,
      setTimeout, clearTimeout
    })
    const response = await new Promise<{ resumeSnapshot: Record<string, unknown> | null }>((resolve) => {
      listener?.({ action: 'collect-boss-resume' }, {}, (value) => resolve(value as { resumeSnapshot: Record<string, unknown> | null }))
    })
    expect(response.resumeSnapshot).toBeNull()
  })

  it('refuses to verify a conversation when BOSS exposes only display text', async () => {
    document.body.innerHTML = `
      <section class="chat-conversation">
        <header><span>招聘经理</span><span>HR</span></header>
        <div class="job-card">平台工程师 25-40K 上海</div>
        <div class="message-controls"><div id="chat-input" contenteditable="true"></div><button>发送</button></div>
      </section>`
    let listener: ((message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean) | undefined
    const chrome = {
      runtime: {
        onMessage: { addListener: (value: typeof listener) => { listener = value } },
        sendMessage: async () => undefined
      }
    }
    runInNewContext(readFileSync('browser-extension/platform-probe.js', 'utf8'), {
      chrome, document, location: new URL('https://www.zhipin.com/web/geek/chat'), URL,
      Element, HTMLTextAreaElement, HTMLInputElement, InputEvent, Event, TextEncoder, BigInt, Date, Promise,
      setTimeout, clearTimeout
    })
    const recipient = await new Promise<Record<string, string> | null>((resolve) => {
      listener?.({ action: 'inspect-boss-conversation' }, {}, (value) => resolve((value as { recipient: Record<string, string> | null }).recipient))
    })
    expect(recipient).toBeNull()
    const diagnostic = await new Promise<Record<string, unknown>>((resolve) => {
      listener?.({ action: 'diagnose-boss-adapter' }, {}, (value) => resolve((value as { diagnostic: Record<string, unknown> }).diagnostic))
    })
    expect(diagnostic).toMatchObject({ ready: { conversation: false, messageSend: false, resumeUpload: false } })
  })

  it('summarizes visible BOSS history without returning private message bodies', async () => {
    document.body.innerHTML = `
      <div class="chat-list"><div>招聘经理 A 面试邀请 时间明天下午</div><div>招聘经理 B 请发一份简历</div></div>
      <div class="message-left">可以安排面试，时间是明天下午</div>
      <div class="message-right">好的，谢谢</div>`
    let listener: ((message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean) | undefined
    const chrome = { runtime: { onMessage: { addListener: (value: typeof listener) => { listener = value } }, sendMessage: async () => undefined } }
    runInNewContext(readFileSync('browser-extension/platform-probe.js', 'utf8'), {
      chrome, document, location: new URL('https://www.zhipin.com/web/geek/chat'), URL,
      Element, HTMLTextAreaElement, HTMLInputElement, InputEvent, Event, TextEncoder, BigInt, Date, Promise,
      setTimeout, clearTimeout
    })
    const response = await new Promise<{ historySummary: Record<string, unknown> | null }>((resolve) => {
      listener?.({ action: 'summarize-boss-history' }, {}, (value) => resolve(value as { historySummary: Record<string, unknown> | null }))
    })
    expect(response.historySummary).toMatchObject({
      conversationCount: 2,
      outgoingMessageCount: 1,
      incomingMessageCount: 1,
      interviewInviteCount: 2,
      resumeRequestCount: 1
    })
    expect(JSON.stringify(response.historySummary)).not.toContain('明天下午')
  })

  it('sends only the exact approved body to the exact verified recipient and returns a receipt', async () => {
    let listener: ((message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean) | undefined
    const chrome = {
      runtime: {
        onMessage: { addListener: (value: typeof listener) => { listener = value } },
        sendMessage: async () => undefined
      }
    }
    runInNewContext(readFileSync('browser-extension/platform-probe.js', 'utf8'), {
      chrome,
      document,
      location: new URL('https://www.zhipin.com/web/geek/chat'),
      URL,
      Element,
      HTMLTextAreaElement,
      HTMLInputElement,
      InputEvent,
      Event,
      TextEncoder,
      BigInt,
      Date,
      Promise,
      setTimeout,
      clearTimeout
    })
    const body = '您好，我对平台工程师岗位很感兴趣。'
    const previous = document.createElement('div')
    previous.dataset.messageId = 'platform-message-old'
    previous.innerHTML = `<span class="message-content"></span><span>已送达</span>`
    previous.querySelector('.message-content')!.textContent = body
    document.body.append(previous)
    document.querySelector('button')?.addEventListener('click', () => {
      const message = document.createElement('div')
      message.dataset.messageId = 'platform-message-1'
      message.innerHTML = `<span class="message-content"></span><span>已送达</span>`
      const content = message.querySelector('.message-content')
      if (content) content.textContent = body
      document.body.append(message)
    })

    const response = new Promise<{ sendReceipt: Record<string, unknown> | null }>((resolve) => {
      expect(listener?.({
        action: 'send-boss-message',
        payload: {
          messageId: 'local-message-1',
          body,
          bodyFingerprint: createJobInputFingerprint(body),
          recipient: {
            platformRecipientId: 'boss-user-1', conversationId: 'conversation-1', recipientName: '招聘经理'
          }
        }
      }, {}, (value) => resolve(value as { sendReceipt: Record<string, unknown> | null }))).toBe(true)
    })
    await expect(response).resolves.toMatchObject({
      sendReceipt: {
        platformMessageId: 'platform-message-1',
        conversationId: 'conversation-1',
        observedBody: body,
        observedStatus: 'delivered'
      }
    })
  })

  it('rejects a stale recipient before touching the editor', async () => {
    let listener: ((message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean) | undefined
    const chrome = {
      runtime: {
        onMessage: { addListener: (value: typeof listener) => { listener = value } },
        sendMessage: async () => undefined
      }
    }
    runInNewContext(readFileSync('browser-extension/platform-probe.js', 'utf8'), {
      chrome, document, location: new URL('https://www.zhipin.com/web/geek/chat'), URL,
      Element, HTMLTextAreaElement, HTMLInputElement, InputEvent, Event, TextEncoder, BigInt, Date, Promise,
      setTimeout, clearTimeout
    })
    const body = 'Approved body'
    const response = new Promise<{ sendReceipt: unknown }>((resolve) => {
      listener?.({
        action: 'send-boss-message',
        payload: {
          messageId: 'local-message-1', body, bodyFingerprint: createJobInputFingerprint(body),
          recipient: { platformRecipientId: 'different-user', conversationId: 'conversation-1', recipientName: '招聘经理' }
        }
      }, {}, (value) => resolve(value as { sendReceipt: unknown }))
    })
    await expect(response).resolves.toEqual({ sendReceipt: null })
    expect(document.querySelector('[contenteditable="true"]')?.textContent).toBe('')
  })

  it('returns only a de-identified signal for a verified incoming interview invitation', async () => {
    const incoming = document.createElement('div')
    incoming.dataset.direction = 'incoming'
    incoming.dataset.messageId = 'incoming-message-1'
    incoming.textContent = '想邀请你参加视频面试，请问明天下午几点方便安排？'
    document.body.append(incoming)
    let listener: ((message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean) | undefined
    const chrome = {
      runtime: {
        onMessage: { addListener: (value: typeof listener) => { listener = value } },
        sendMessage: async () => undefined
      }
    }
    runInNewContext(readFileSync('browser-extension/platform-probe.js', 'utf8'), {
      chrome, document, location: new URL('https://www.zhipin.com/web/geek/chat'), URL,
      Element, HTMLTextAreaElement, HTMLInputElement, InputEvent, Event, TextEncoder, BigInt, Date, Promise,
      setTimeout, clearTimeout
    })
    const response = await new Promise<{ signals: Array<Record<string, unknown>> }>((resolve) => {
      listener?.({ action: 'collect-boss-conversation-signals' }, {}, (value) => resolve(value as { signals: Array<Record<string, unknown>> }))
    })
    expect(response.signals).toHaveLength(1)
    expect(response.signals[0]).toMatchObject({ signalId: expect.stringMatching(/^fnv1a64:/), conversationId: 'conversation-1', kind: 'interview-schedule' })
    expect(JSON.stringify(response)).not.toContain('视频面试')
  })

  it('uploads only the approved PDF and requires an exact platform attachment receipt', async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.pdf,application/pdf'
    document.body.append(input)
    Object.defineProperty(input, 'files', { configurable: true, writable: true, value: null })
    const bytesBase64 = btoa('synthetic-pdf')
    const previous = document.createElement('div')
    previous.dataset.attachmentId = 'attachment-old'
    previous.textContent = '岗位专属简历.pdf'
    document.body.append(previous)
    input.addEventListener('change', () => {
      const receipt = document.createElement('div')
      receipt.dataset.attachmentId = 'attachment-1'
      receipt.textContent = '岗位专属简历.pdf'
      document.body.append(receipt)
    })
    class MockDataTransfer {
      private filesList: File[] = []
      items = { add: (file: File) => { this.filesList.push(file) } }
      get files() { return this.filesList }
    }
    let listener: ((message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean) | undefined
    const chrome = {
      runtime: {
        onMessage: { addListener: (value: typeof listener) => { listener = value } },
        sendMessage: async () => undefined
      }
    }
    runInNewContext(readFileSync('browser-extension/platform-probe.js', 'utf8'), {
      chrome, document, location: new URL('https://www.zhipin.com/web/geek/chat'), URL,
      Element, HTMLTextAreaElement, HTMLInputElement, InputEvent, Event, TextEncoder, BigInt, Date, Promise,
      File, DataTransfer: MockDataTransfer, Uint8Array, atob, setTimeout, clearTimeout
    })
    const response = new Promise<{ resumeReceipt: Record<string, unknown> | null }>((resolve) => {
      expect(listener?.({
        action: 'send-boss-resume-attachment',
        payload: {
          fileName: '岗位专属简历.pdf',
          mimeType: 'application/pdf',
          bytesBase64,
          byteLength: 'synthetic-pdf'.length,
          contentFingerprint: createJobInputFingerprint(bytesBase64),
          recipient: { platformRecipientId: 'boss-user-1', conversationId: 'conversation-1', recipientName: '招聘经理' }
        }
      }, {}, (value) => resolve(value as { resumeReceipt: Record<string, unknown> | null }))).toBe(true)
    })
    await expect(response).resolves.toMatchObject({
      resumeReceipt: {
        platformAttachmentId: 'attachment-1',
        observedFileName: '岗位专属简历.pdf',
        observedByteLength: 'synthetic-pdf'.length
      }
    })
  })

  it('reports selector counts and readiness without returning page text', async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.pdf,.docx,application/pdf'
    document.body.append(input)
    let listener: ((message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean) | undefined
    const chrome = {
      runtime: {
        onMessage: { addListener: (value: typeof listener) => { listener = value } },
        sendMessage: async () => undefined
      }
    }
    runInNewContext(readFileSync('browser-extension/platform-probe.js', 'utf8'), {
      chrome, document, location: new URL('https://www.zhipin.com/web/geek/chat'), URL,
      Element, HTMLTextAreaElement, HTMLInputElement, InputEvent, Event, TextEncoder, BigInt, Date, Promise,
      Uint8Array, atob, setTimeout, clearTimeout
    })
    const response = await new Promise<{ diagnostic: Record<string, unknown> }>((resolve) => {
      listener?.({ action: 'diagnose-boss-adapter' }, {}, (value) => resolve(value as { diagnostic: Record<string, unknown> }))
    })
    expect(response.diagnostic).toMatchObject({
      pageKind: 'chat',
      counts: { editors: 1, sendControls: 1, recipientIdentities: 1, conversationIdentities: 1, recipientNames: 1, docxInputs: 1, pdfInputs: 1 },
      ready: { conversation: true, messageSend: true, resumeUpload: true }
    })
    expect(JSON.stringify(response)).not.toContain('招聘经理')
  })
})
