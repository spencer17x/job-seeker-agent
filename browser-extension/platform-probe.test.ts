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
    document.body.innerHTML = '<section><h2>周女士</h2><span>云扬</span><span>猎头顾问</span></section><button type="button">立即沟通</button>'
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
        payload: { url: 'https://www.zhipin.com/job_detail/job-1.html', title: '平台工程师', company: '示例公司', openingBody: '刚刚看了您发布的这个职位，我特别喜欢，可否聊聊呢？' }
      }, {}, (value) => resolve(value as { opened: boolean }))
    })
    expect(accepted).toEqual({
      opened: true,
      recruiterHint: { recruiterName: '周女士', recruiterCompany: '云扬' }
    })
    expect(click).toHaveBeenCalledOnce()
    const redactedCompany = await new Promise<{ opened: boolean }>((resolve) => {
      listener?.({
        action: 'open-boss-conversation',
        payload: { url: 'https://www.zhipin.com/job_detail/job-1.html', title: '平台工程师', company: '某大型互联网公司', openingBody: '刚刚看了您发布的这个职位，我特别喜欢，可否聊聊呢？' }
      }, {}, (value) => resolve(value as { opened: boolean }))
    })
    expect(redactedCompany).toEqual({
      opened: true,
      recruiterHint: { recruiterName: '周女士', recruiterCompany: '云扬' }
    })
    expect(click).toHaveBeenCalledTimes(2)
    const rejected = await new Promise<{ opened: boolean }>((resolve) => {
      listener?.({
        action: 'open-boss-conversation',
        payload: { url: 'https://www.zhipin.com/job_detail/job-1.html', title: '数据分析师', company: '示例公司', openingBody: '刚刚看了您发布的这个职位，我特别喜欢，可否聊聊呢？' }
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
        payload: { url: 'https://www.zhipin.com/job_detail/job-1.html', title: '平台工程师', company: '示例公司', openingBody: '刚刚看了您发布的这个职位，我特别喜欢，可否聊聊呢？' }
      }, {}, (value) => resolve(value as { opened: boolean; attention?: string }))
    })
    expect(response).toEqual({ opened: false, attention: 'captcha-required' })
    expect(click).not.toHaveBeenCalled()
  })

  it('reports a BOSS 403 restriction before attempting any conversation action', async () => {
    document.body.innerHTML = '<h2>访问受限</h2><p>您的 IP 存在异常行为，请勿频繁提交刷新请求</p><button type="button">立即沟通</button>'
    Object.defineProperty(document.body, 'innerText', {
      configurable: true,
      value: '访问受限 抱歉，您暂时无法访问此页面 您的 IP 存在异常行为，请勿频繁提交刷新请求'
    })
    const click = vi.spyOn(document.querySelector('button')!, 'click')
    let listener: ((message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean) | undefined
    const chrome = { runtime: { onMessage: { addListener: (value: typeof listener) => { listener = value } }, sendMessage: async () => undefined } }
    runInNewContext(readFileSync('browser-extension/platform-probe.js', 'utf8'), {
      chrome, document, location: new URL('https://www.zhipin.com/web/passport/zp/403.html?code=32'), URL,
      Element, HTMLTextAreaElement, HTMLInputElement, InputEvent, Event, TextEncoder, BigInt, Date, Promise,
      setTimeout, clearTimeout
    })
    const session = await new Promise<{ state: string }>((resolve) => {
      listener?.({ action: 'probe-session' }, {}, (value) => resolve(value as { state: string }))
    })
    expect(session).toEqual({ state: 'access-restricted' })
    const response = await new Promise<{ opened: boolean; attention?: string }>((resolve) => {
      listener?.({
        action: 'open-boss-conversation',
        payload: { url: 'https://www.zhipin.com/job_detail/job-1.html', title: '平台工程师', company: '示例公司', openingBody: '刚刚看了您发布的这个职位，我特别喜欢，可否聊聊呢？' }
      }, {}, (value) => resolve(value as { opened: boolean; attention?: string }))
    })
    expect(response).toEqual({ opened: false, attention: 'access-restricted' })
    expect(click).not.toHaveBeenCalled()
  })

  it('binds the newest exact default greeting to one verified recruiter and platform receipt', async () => {
    const greeting = '刚刚看了您发布的这个职位，我特别喜欢，可否聊聊呢？'
    document.body.innerHTML = `
      <ul class="chat-list">
        <li class="chat-item" data-boss-id="boss-new" data-conversation-id="conversation-new" data-message-id="message-new">
          <span>昨天</span><span>招聘经理示例公司</span><span>HR</span><span>[送达]</span><span>${greeting}</span>
        </li>
      </ul>
      <section class="chat-conversation" data-boss-id="boss-new" data-conversation-id="conversation-new">
        <span class="chat-name">招聘经理示例公司</span><span class="recipient-title">HR</span>
        <div contenteditable="true"></div><button type="button">发送</button>
      </section>`
    let listener: ((message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean) | undefined
    const chrome = { runtime: { onMessage: { addListener: (value: typeof listener) => { listener = value } }, sendMessage: async () => undefined } }
    runInNewContext(readFileSync('browser-extension/platform-probe.js', 'utf8'), {
      chrome, document, location: new URL('about:blank'), URL,
      Element, HTMLTextAreaElement, HTMLInputElement, InputEvent, Event, TextEncoder, BigInt, Date, Promise,
      setTimeout: (callback: () => void) => { queueMicrotask(callback); return 1 }, clearTimeout, queueMicrotask
    })
    const response = await new Promise<Record<string, any>>((resolve) => {
      expect(listener?.({ action: 'select-boss-conversation', payload: {
        url: 'https://www.zhipin.com/job_detail/job-1.html',
        title: '平台工程师',
        company: '示例公司',
        openingBody: greeting
      } }, {}, (value) => resolve(value as Record<string, any>))).toBe(true)
    })
    expect(response).toMatchObject({
      recipient: {
        platformRecipientId: 'boss-new',
        conversationId: 'conversation-new',
        recipientName: '招聘经理示例公司'
      },
      sendReceipt: {
        platformMessageId: 'message-new',
        conversationId: 'conversation-new',
        observedBody: greeting,
        observedStatus: 'delivered'
      }
    })
  })

  it('reconciles the already active exact-title conversation after its list preview changed', async () => {
    const greeting = '刚刚看了您发布的这个职位，我特别喜欢，可否聊聊呢？'
    document.body.innerHTML = `
      <section class="chat-conversation" data-boss-id="boss-active" data-conversation-id="conversation-active">
        <span class="chat-name">周女士</span><span class="recipient-title">猎头顾问</span>
        <span class="job-position">AI全栈工程师（猎头职位）</span>
        <div class="message-item"><span>${greeting}</span><span>已读</span></div>
        <div contenteditable="true"></div><button type="button">发送</button>
      </section>`
    let listener: ((message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean) | undefined
    const chrome = { runtime: { onMessage: { addListener: (value: typeof listener) => { listener = value } }, sendMessage: async () => undefined } }
    runInNewContext(readFileSync('browser-extension/platform-probe.js', 'utf8'), {
      chrome, document, location: new URL('about:blank'), URL,
      Element, HTMLTextAreaElement, HTMLInputElement, InputEvent, Event, TextEncoder, BigInt, Date, Promise,
      setTimeout, clearTimeout
    })
    const response = await new Promise<Record<string, any>>((resolve) => {
      listener?.({ action: 'select-boss-conversation', payload: {
        url: 'https://www.zhipin.com/job_detail/job-active.html', title: 'AI全栈工程师',
        company: '杭州', openingBody: greeting
      } }, {}, (value) => resolve(value as Record<string, any>))
    })
    expect(response).toMatchObject({
      recipient: {
        platformRecipientId: 'boss-active', conversationId: 'conversation-active', recipientName: '周女士'
      },
      sendReceipt: { platformMessageId: expect.stringMatching(/^visible:fnv1a64:/u), observedStatus: 'read' }
    })
  })

  it('refuses ambiguous identical greeting rows without a unique target title', async () => {
    const greeting = '刚刚看了您发布的这个职位，我特别喜欢，可否聊聊呢？'
    document.body.innerHTML = `
      <ul class="chat-list">
        <li class="chat-item" data-boss-id="boss-one" data-conversation-id="conversation-one" data-message-id="message-one">
          <span>招聘经理一</span><span>HR</span><span>[送达]</span><span>${greeting}</span>
        </li>
        <li class="chat-item" data-boss-id="boss-two" data-conversation-id="conversation-two" data-message-id="message-two">
          <span>招聘经理二</span><span>HR</span><span>[送达]</span><span>${greeting}</span>
        </li>
      </ul>`
    const clicks = [...document.querySelectorAll<HTMLElement>('.chat-item')].map((row) => vi.spyOn(row, 'click'))
    let listener: ((message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean) | undefined
    const chrome = { runtime: { onMessage: { addListener: (value: typeof listener) => { listener = value } }, sendMessage: async () => undefined } }
    runInNewContext(readFileSync('browser-extension/platform-probe.js', 'utf8'), {
      chrome, document, location: new URL('about:blank'), URL,
      Element, HTMLTextAreaElement, HTMLInputElement, InputEvent, Event, TextEncoder, BigInt, Date, Promise,
      setTimeout: (callback: () => void) => { queueMicrotask(callback); return 1 }, clearTimeout, queueMicrotask
    })
    const response = await new Promise<Record<string, unknown>>((resolve) => {
      listener?.({ action: 'select-boss-conversation', payload: {
        url: 'https://www.zhipin.com/job_detail/job-1.html', title: '平台工程师',
        company: '示例公司', openingBody: greeting
      } }, {}, (value) => resolve(value as Record<string, unknown>))
    })
    expect(response).toEqual({ recipient: null, sendReceipt: null })
    expect(clicks.every((click) => click.mock.calls.length === 1)).toBe(true)
  })

  it('disambiguates identical greeting rows by the active conversation job title', async () => {
    const greeting = '刚刚看了您发布的这个职位，我特别喜欢，可否聊聊呢？'
    document.body.innerHTML = `
      <ul class="chat-list">
        <li id="row-one" class="chat-item"><span>张女士公司甲</span><span>HR</span><span>[送达]</span><span>${greeting}</span></li>
        <li id="row-two" class="chat-item"><span>杨女士公司乙</span><span>HR</span><span>[送达]</span><span>${greeting}</span></li>
      </ul>
      <section class="chat-conversation" data-boss-id="boss-one" data-conversation-id="conversation-one">
        <span class="chat-name">张女士</span><span class="recipient-title">HR</span>
        <span class="job-position">其他岗位</span>
        <div class="message-item" data-message-id="opening-one"><span>${greeting}</span><span>[送达]</span></div>
        <div contenteditable="true"></div><button type="button">发送</button>
      </section>`
    const conversation = document.querySelector<HTMLElement>('.chat-conversation')!
    const activate = (bossId: string, conversationId: string, name: string, title: string, messageId: string) => {
      conversation.dataset.bossId = bossId
      conversation.dataset.conversationId = conversationId
      conversation.querySelector('.chat-name')!.textContent = name
      conversation.querySelector('.job-position')!.textContent = title
      const message = conversation.querySelector<HTMLElement>('.message-item')!
      message.dataset.messageId = messageId
    }
    document.querySelector('#row-one')!.addEventListener('click', () => activate('boss-one', 'conversation-one', '张女士', '其他岗位', 'opening-one'))
    document.querySelector('#row-two')!.addEventListener('click', () => activate('boss-two', 'conversation-two', '杨女士', '平台工程师', 'opening-two'))
    let listener: ((message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean) | undefined
    const chrome = { runtime: { onMessage: { addListener: (value: typeof listener) => { listener = value } }, sendMessage: async () => undefined } }
    runInNewContext(readFileSync('browser-extension/platform-probe.js', 'utf8'), {
      chrome, document, location: new URL('about:blank'), URL,
      Element, HTMLTextAreaElement, HTMLInputElement, InputEvent, Event, TextEncoder, BigInt, Date, Promise,
      setTimeout: (callback: () => void) => { queueMicrotask(callback); return 1 }, clearTimeout, queueMicrotask
    })
    const response = await new Promise<Record<string, any>>((resolve) => {
      listener?.({ action: 'select-boss-conversation', payload: {
        url: 'https://www.zhipin.com/job_detail/job-2.html', title: '平台工程师',
        company: '杭州', openingBody: greeting
      } }, {}, (value) => resolve(value as Record<string, any>))
    })
    expect(response).toMatchObject({
      recipient: {
        platformRecipientId: 'boss-two', conversationId: 'conversation-two', recipientName: '杨女士'
      },
      sendReceipt: { platformMessageId: 'opening-two', observedStatus: 'delivered' }
    })
  })

  it('uses the uniquely visible target company to disambiguate identical greetings', async () => {
    const greeting = '刚刚看了您发布的这个职位，我特别喜欢，可否聊聊呢？'
    document.body.innerHTML = `
      <ul class="chat-list">
        <li class="chat-item">
          <span>杨女士同花顺</span><span>HR</span><span>感谢回复</span>
        </li>
        <li class="chat-item" data-boss-id="boss-other" data-conversation-id="conversation-other">
          <span>招聘经理其他公司</span><span>HR</span><span>[送达]</span><span>${greeting}</span>
        </li>
      </ul>
      <section class="chat-conversation" data-boss-id="boss-target" data-conversation-id="conversation-target">
        <span class="chat-name">杨女士</span><span class="recipient-title">HR</span>
        <div class="message-item" data-message-id="message-target">
          <span class="message-content">${greeting}</span><span>[送达]</span>
        </div>
        <div contenteditable="true"></div><button type="button">发送</button>
      </section>`
    let listener: ((message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean) | undefined
    const chrome = { runtime: { onMessage: { addListener: (value: typeof listener) => { listener = value } }, sendMessage: async () => undefined } }
    runInNewContext(readFileSync('browser-extension/platform-probe.js', 'utf8'), {
      chrome, document, location: new URL('about:blank'), URL,
      Element, HTMLTextAreaElement, HTMLInputElement, InputEvent, Event, TextEncoder, BigInt, Date, Promise,
      setTimeout: (callback: () => void) => { queueMicrotask(callback); return 1 }, clearTimeout, queueMicrotask
    })
    const response = await new Promise<Record<string, any>>((resolve) => {
      listener?.({ action: 'select-boss-conversation', payload: {
        url: 'https://www.zhipin.com/job_detail/job-1.html', title: 'AI Agent工程师',
        company: '杭州', recruiterName: '杨女士', recruiterCompany: '同花顺', openingBody: greeting
      } }, {}, (value) => resolve(value as Record<string, any>))
    })
    expect(response).toMatchObject({
      recipient: {
        platformRecipientId: 'boss-target',
        conversationId: 'conversation-target',
        recipientName: '杨女士'
      },
      sendReceipt: {
        platformMessageId: 'message-target',
        observedStatus: 'delivered'
      }
    })
  })

  it('reselects a posting-bound conversation before sending a custom exact-body reply', async () => {
    const greeting = '刚刚看了您发布的这个职位，我特别喜欢，可否聊聊呢？'
    const customBody = '感谢回复，我对平台工程师岗位仍然感兴趣。'
    document.body.innerHTML = `
      <ul class="chat-list"><li class="chat-item" data-message-id="opening-1">
        <span>招聘经理示例公司</span><span>HR</span><span>[送达]</span><span>${greeting}</span>
      </li></ul>
      <section class="chat-conversation">
        <header><span>招聘经理示例公司</span><span>HR</span></header>
        <div contenteditable="true"></div><button type="button">发送</button>
      </section>`
    const send = document.querySelector('button')!
    send.addEventListener('click', () => {
      const node = document.createElement('div')
      node.className = 'message-item'
      node.dataset.messageId = 'custom-1'
      const content = document.createElement('span')
      content.className = 'message-content'
      content.textContent = customBody
      const status = document.createElement('span')
      status.textContent = '[送达]'
      node.append(content, status)
      document.body.append(node)
    })
    let listener: ((message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean) | undefined
    const chrome = { runtime: { onMessage: { addListener: (value: typeof listener) => { listener = value } }, sendMessage: async () => undefined } }
    runInNewContext(readFileSync('browser-extension/platform-probe.js', 'utf8'), {
      chrome, document, location: new URL('https://www.zhipin.com/web/geek/chat'), URL,
      Element, HTMLTextAreaElement, HTMLInputElement, InputEvent, Event, TextEncoder, BigInt, Date, Promise,
      setTimeout: (callback: () => void) => { queueMicrotask(callback); return 1 }, clearTimeout, queueMicrotask
    })
    const selected = await new Promise<Record<string, any>>((resolve) => {
      listener?.({ action: 'select-boss-conversation', payload: {
        url: 'https://www.zhipin.com/job_detail/job-1.html', title: '平台工程师',
        company: '示例公司', openingBody: greeting
      } }, {}, (value) => resolve(value as Record<string, any>))
    })
    expect(selected.recipient).toMatchObject({
      platformRecipientId: expect.stringMatching(/^target:/u),
      conversationId: expect.stringMatching(/^target:/u)
    })
    const receipt = await new Promise<Record<string, any>>((resolve) => {
      listener?.({ action: 'send-boss-message', payload: {
        messageId: 'local-custom-1', body: customBody,
        bodyFingerprint: createJobInputFingerprint(customBody),
        recipient: selected.recipient
      } }, {}, (value) => resolve(value as Record<string, any>))
    })
    expect(receipt.sendReceipt).toMatchObject({
      platformMessageId: 'custom-1',
      observedBody: customBody,
      observedStatus: 'delivered',
      observedRecipient: selected.recipient
    })
    const headerName = document.querySelector('.chat-conversation header span')
    if (headerName) headerName.textContent = '其他招聘方'
    const stale = await new Promise<Record<string, any>>((resolve) => {
      listener?.({ action: 'send-boss-message', payload: {
        messageId: 'local-custom-stale', body: '不应发送',
        bodyFingerprint: createJobInputFingerprint('不应发送'),
        recipient: selected.recipient
      } }, {}, (value) => resolve(value as Record<string, any>))
    })
    expect(stale.sendReceipt).toBeNull()
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
    previous.innerHTML = `<span class="bubble-text"></span><span>已送达</span>`
    previous.querySelector('.bubble-text')!.textContent = body
    document.body.append(previous)
    document.querySelector('button')?.addEventListener('click', () => {
      const message = document.createElement('div')
      message.dataset.messageId = 'platform-message-1'
      message.innerHTML = `<span class="bubble-text"></span><span>已送达</span>`
      const content = message.querySelector('.bubble-text')
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
    const message = document.createElement('article')
    message.dataset.messageId = 'incoming-message-1'
    const incoming = document.createElement('div')
    incoming.dataset.direction = 'incoming'
    incoming.textContent = '想邀请你参加视频面试，请问明天下午几点方便安排？'
    message.append(incoming)
    document.body.append(message)
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
    const control = document.createElement('label')
    control.textContent = '上传附件简历'
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.pdf,application/pdf'
    control.append(input)
    document.body.append(control)
    const hiddenControl = document.createElement('label')
    hiddenControl.hidden = true
    hiddenControl.textContent = '上传附件简历'
    const hiddenInput = document.createElement('input')
    hiddenInput.type = 'file'
    hiddenInput.accept = '.pdf,application/pdf'
    hiddenControl.append(hiddenInput)
    document.body.append(hiddenControl)
    Object.defineProperty(input, 'files', { configurable: true, writable: true, value: null })
    const bytesBase64 = btoa('synthetic-pdf')
    const previous = document.createElement('div')
    previous.dataset.attachmentId = 'attachment-old'
    previous.textContent = '岗位专属简历.pdf'
    document.body.append(previous)
    input.addEventListener('change', () => {
      const receipt = document.createElement('div')
      receipt.className = 'attachment-message'
      receipt.dataset.messageId = 'attachment-message-1'
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
        platformAttachmentId: 'attachment-message-1',
        observedFileName: '岗位专属简历.pdf',
        observedByteLength: 'synthetic-pdf'.length
      }
    })
  })

  it('reports selector counts and readiness without returning page text', async () => {
    const control = document.createElement('label')
    control.textContent = '上传附件简历'
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.pdf,.docx,application/pdf'
    control.append(input)
    document.body.append(control)
    const hiddenControl = document.createElement('label')
    hiddenControl.hidden = true
    hiddenControl.textContent = '上传附件简历'
    const hiddenInput = document.createElement('input')
    hiddenInput.type = 'file'
    hiddenInput.accept = '.pdf,.docx,application/pdf'
    hiddenControl.append(hiddenInput)
    document.body.append(hiddenControl)
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
      counts: { editors: 1, sendControls: 1, recipientIdentities: 1, conversationIdentities: 1, recipientNames: 1, docxInputs: 2, pdfInputs: 2 },
      ready: { conversation: true, messageSend: true, resumeUpload: true }
    })
    expect(JSON.stringify(response)).not.toContain('招聘经理')
  })
})
