import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { beforeEach, describe, expect, it } from 'vitest'
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
