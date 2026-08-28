chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action === 'probe-session') {
    sendResponse({ state: detectSessionState() })
    return false
  }
  if (message?.action === 'collect-boss-jobs') {
    sendResponse({ jobs: collectBossJobs() })
    return false
  }
  if (message?.action === 'collect-boss-job-detail') {
    sendResponse({ jobDetail: collectBossJobDetail() })
    return false
  }
  if (message?.action === 'inspect-boss-conversation') {
    sendResponse({ recipient: inspectBossConversation() })
    return false
  }
  if (message?.action === 'collect-boss-conversation-signals') {
    sendResponse({ signals: collectBossConversationSignals() })
    return false
  }
  if (message?.action === 'summarize-boss-history') {
    sendResponse({ historySummary: summarizeBossHistory() })
    return false
  }
  if (message?.action === 'diagnose-boss-adapter') {
    sendResponse({ diagnostic: diagnoseBossAdapter() })
    return false
  }
  if (message?.action === 'send-boss-message') {
    sendBossMessage(message.payload).then((sendReceipt) => sendResponse({ sendReceipt }))
      .catch(() => sendResponse({ sendReceipt: null }))
    return true
  }
  if (message?.action === 'send-boss-resume-attachment') {
    sendBossResumeAttachment(message.payload).then((resumeReceipt) => sendResponse({ resumeReceipt }))
      .catch(() => sendResponse({ resumeReceipt: null }))
    return true
  }
  return false
})

chrome.runtime.sendMessage({ action: 'boss-frame-ready' }).catch(() => undefined)

function inspectBossConversation() {
  return conversationContext()?.recipient ?? null
}

function diagnoseBossAdapter() {
  const pageKind = /\/web\/geek\/chat/u.test(location.pathname)
    ? 'chat'
    : /\/web\/geek\/job|\/job_detail\//u.test(location.pathname)
      ? 'search'
      : 'other'
  const visibleIdentity = visibleConversationIdentity()
  const explicitRecipientIdentities = visibleMatches('[data-boss-id], [data-uid], [data-recruiter-id], [data-geek-id]').length
  const explicitConversationIdentities = visibleMatches('[data-conversation-id], [data-lid], [data-chat-id]').length
  const explicitRecipientNames = visibleMatches('[class*="chat-name"], [class*="boss-name"], [class*="recipient-name"]').length
  const counts = {
    jobLinks: document.querySelectorAll('a[href*="/job_detail/"]').length,
    editors: visibleMatches('[contenteditable="true"], textarea[placeholder*="消息"], textarea[placeholder*="沟通"]').length,
    sendControls: visibleMatches('button, [role="button"]', (element) => element.textContent?.trim() === '发送').length,
    recipientIdentities: explicitRecipientIdentities || (visibleIdentity ? 1 : 0),
    conversationIdentities: explicitConversationIdentities || (visibleIdentity ? 1 : 0),
    recipientNames: explicitRecipientNames || (visibleIdentity ? 1 : 0),
    docxInputs: [...document.querySelectorAll('input[type="file"]')].filter((input) => {
      const accept = input.getAttribute('accept')?.toLocaleLowerCase() ?? ''
      return accept.includes('docx') || accept.includes('wordprocessingml')
    }).length,
    pdfInputs: [...document.querySelectorAll('input[type="file"]')].filter((input) => {
      const accept = input.getAttribute('accept')?.toLocaleLowerCase() ?? ''
      return accept.includes('.pdf') || accept.includes('application/pdf')
    }).length,
    messageReceipts: document.querySelectorAll('[data-message-id], [data-msg-id]').length,
    attachmentReceipts: document.querySelectorAll('[data-attachment-id], [data-file-id]').length,
    incomingMessages: document.querySelectorAll('[data-direction="incoming"], [class*="message-left"], [class*="item-friend"], [class*="message-other"]').length
  }
  const conversation = counts.editors === 1
    && counts.sendControls === 1
    && explicitRecipientIdentities === 1
    && explicitConversationIdentities === 1
    && explicitRecipientNames === 1
  const context = conversation ? conversationContext() : null
  return {
    pageKind,
    ...(context ? { conversationFingerprint: fingerprint(context.recipient.conversationId) } : {}),
    sessionState: detectSessionState(),
    counts,
    ready: {
      discovery: pageKind === 'search' && counts.jobLinks > 0,
      conversation,
      messageSend: conversation,
      resumeUpload: conversation && counts.pdfInputs === 1
    }
  }
}

function collectBossConversationSignals() {
  const context = conversationContext()
  if (!context) return []
  const nodes = [...document.querySelectorAll('[data-direction="incoming"], [class*="message-left"], [class*="item-friend"], [class*="message-other"]')]
    .filter((element) => {
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    })
  return nodes.flatMap((node) => {
    const text = node.textContent?.replace(/\s+/gu, ' ').trim().slice(0, 5_000) ?? ''
    const platformMessageId = node.getAttribute('data-message-id') || node.getAttribute('data-msg-id')
    if (!platformMessageId) return []
    const kind = classifyConversationSignal(text)
    return [{
      signalId: fingerprint(`${context.recipient.conversationId}:${platformMessageId}`),
      conversationId: context.recipient.conversationId,
      kind,
      observedAt: new Date().toISOString()
    }]
  }).slice(-100)
}

function summarizeBossHistory() {
  if (!location.hostname.endsWith('zhipin.com') || !/\/web\/geek\/chat/u.test(location.pathname)) return null
  const conversationNodes = visibleMatches([
    '[class*="chat-list"] > *', '[class*="conversation-list"] > *',
    '[class*="contact-list"] > *', '[class*="user-list"] > *'
  ].join(','))
  const incomingNodes = visibleMatches('[data-direction="incoming"], [class*="message-left"], [class*="item-friend"], [class*="message-other"]')
  const outgoingNodes = visibleMatches('[data-direction="outgoing"], [class*="message-right"], [class*="item-my"], [class*="message-self"]')
  const historyNodes = [...new Set([...conversationNodes, ...incomingNodes])]
  const texts = historyNodes.map((element) => element.textContent?.replace(/\s+/gu, ' ').trim().slice(0, 5_000) ?? '').filter(Boolean)
  const count = (pattern) => texts.filter((text) => pattern.test(text)).length
  const uniqueConversations = new Set(conversationNodes.map((element) => fingerprint(
    element.textContent?.replace(/\s+/gu, ' ').trim().slice(0, 500) ?? ''
  )))
  return {
    conversationCount: Math.min(10_000, uniqueConversations.size),
    outgoingMessageCount: Math.min(10_000, outgoingNodes.length),
    incomingMessageCount: Math.min(10_000, incomingNodes.length),
    recruiterReplyCount: Math.min(10_000, incomingNodes.length),
    resumeRequestCount: count(/(?:(简历|附件).{0,20}(发送|发一份|提供|麻烦|可以发)|(发送|发一份|提供|麻烦|可以发).{0,20}(简历|附件))/u),
    interviewInviteCount: count(/(面试|面谈|约面).{0,30}(方便|邀请|参加|时间|几点|日期|日程|安排)/u),
    offerCount: count(/(录用|offer|发放意向|通过终面)/iu),
    rejectionCount: count(/(不合适|未通过|不匹配|遗憾|暂不考虑)/u),
    observedAt: new Date().toISOString()
  }
}

function classifyConversationSignal(text) {
  if (/(不合适|未通过|不匹配|遗憾|暂不考虑)/u.test(text)) return 'rejection'
  if (/(录用|offer|发放意向|通过终面)/iu.test(text)) return 'offer'
  if (/(面试|面谈|约面)/u.test(text) && /(时间|几点|日期|日程|安排在|会议链接)/u.test(text)) return 'interview-schedule'
  if (/(面试|面谈|约面)/u.test(text) && /(方便|邀请|参加|沟通一下)/u.test(text)) return 'interview-invite'
  if (/(简历|附件)/u.test(text) && /(发送|发一份|提供|麻烦|可以发)/u.test(text)) return 'resume-request'
  return 'recruiter-reply'
}

function conversationContext() {
  const editor = uniqueVisible('[contenteditable="true"], textarea[placeholder*="消息"], textarea[placeholder*="沟通"]')
  const sendButton = uniqueVisible('button, [role="button"]', (element) => element.textContent?.trim() === '发送')
  if (!editor || !sendButton) return null
  const identityNode = uniqueVisible('[data-boss-id], [data-uid], [data-recruiter-id], [data-geek-id]')
  const conversationNode = uniqueVisible('[data-conversation-id], [data-lid], [data-chat-id]')
  const nameNode = uniqueVisible('[class*="chat-name"], [class*="boss-name"], [class*="recipient-name"]')
  const platformRecipientId = identityNode?.getAttribute('data-boss-id')
    || identityNode?.getAttribute('data-uid')
    || identityNode?.getAttribute('data-recruiter-id')
    || identityNode?.getAttribute('data-geek-id')
  const conversationId = conversationNode?.getAttribute('data-conversation-id')
    || conversationNode?.getAttribute('data-lid')
    || conversationNode?.getAttribute('data-chat-id')
  const recipientName = nameNode?.textContent?.trim()
  if (!platformRecipientId || !conversationId || !recipientName) return null
  const titleNode = uniqueVisible('[class*="boss-title"], [class*="recipient-title"], [class*="chat-position"]')
  return {
    editor,
    sendButton,
    recipient: {
      platformRecipientId: platformRecipientId.slice(0, 500),
      conversationId: conversationId.slice(0, 500),
      recipientName: recipientName.slice(0, 300),
      ...(titleNode?.textContent?.trim()
        ? { recipientTitle: titleNode.textContent.trim().slice(0, 300) }
        : {})
    }
  }
}

function visibleConversationIdentity() {
  const root = uniqueVisible('.chat-conversation')
  if (!root) return null
  const controls = root.querySelector('.message-controls, [class*="message-controls"], [class*="chat-editor"]')
  const header = [...root.children].find((element) => {
    if (controls && (element === controls || element.contains(controls))) return false
    const text = element.textContent?.replace(/\s+/gu, ' ').trim() ?? ''
    return text.length >= 2 && text.length <= 160 && !/按Enter键发送|发简历|换电话|换微信/u.test(text)
  })
  if (!header) return null
  const labels = [...header.querySelectorAll('*')].flatMap((element) => {
    if (element.children.length > 0) return []
    const text = element.textContent?.replace(/\s+/gu, ' ').trim() ?? ''
    return text.length >= 2 && text.length <= 80 ? [text] : []
  }).filter((value, index, values) => values.indexOf(value) === index)
  const recipientName = labels[0] || header.textContent?.replace(/\s+/gu, ' ').trim()
  if (!recipientName || recipientName.length > 300) return null
  const recipientTitle = labels[1]
  const jobNode = root.querySelector('[class*="job"], [class*="position"]')
  const jobContext = jobNode?.textContent?.replace(/\s+/gu, ' ').trim().slice(0, 500) ?? ''
  return {
    platformRecipientId: `visible:${fingerprint({ recipientName })}`,
    conversationId: `visible:${fingerprint({ recipientName, recipientTitle, jobContext })}`,
    recipientName,
    ...(recipientTitle ? { recipientTitle } : {})
  }
}

async function sendBossMessage(payload) {
  const context = conversationContext()
  if (!context || !validSendPayload(payload)) throw new Error('BOSS send context is not verified')
  const observedRecipient = context.recipient
  if (
    observedRecipient.platformRecipientId !== payload.recipient.platformRecipientId
    || observedRecipient.conversationId !== payload.recipient.conversationId
    || observedRecipient.recipientName !== payload.recipient.recipientName
    || fingerprint(payload.body.trim()) !== payload.bodyFingerprint
  ) throw new Error('BOSS recipient or body approval is stale')

  writeEditor(context.editor, payload.body.trim())
  const observedEditorBody = editorValue(context.editor).trim()
  if (observedEditorBody !== payload.body.trim()) throw new Error('BOSS editor body verification failed')
  const previousReceiptIds = messageReceiptIds()
  context.sendButton.click()

  const receipt = await waitForReceipt(payload.body.trim(), observedRecipient, previousReceiptIds, 6_000)
  if (!receipt) throw new Error('BOSS platform receipt was not observed')
  return receipt
}

async function sendBossResumeAttachment(payload) {
  const context = conversationContext()
  if (!context || !validResumePayload(payload)) throw new Error('BOSS resume context is not verified')
  if (
    context.recipient.platformRecipientId !== payload.recipient.platformRecipientId
    || context.recipient.conversationId !== payload.recipient.conversationId
    || context.recipient.recipientName !== payload.recipient.recipientName
    || fingerprint(payload.bytesBase64) !== payload.contentFingerprint
  ) throw new Error('BOSS resume recipient or content approval is stale')
  const binary = atob(payload.bytesBase64)
  if (binary.length !== payload.byteLength) throw new Error('BOSS resume byte length does not match')
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  const fileInput = uniqueResumeFileInput(payload.mimeType)
  if (!fileInput) throw new Error('BOSS resume input is not uniquely verified')
  const file = new File([bytes], payload.fileName, { type: payload.mimeType })
  const transfer = new DataTransfer()
  transfer.items.add(file)
  fileInput.files = transfer.files
  if (fileInput.files?.length !== 1 || fileInput.files[0]?.name !== payload.fileName) {
    throw new Error('BOSS resume input did not retain the approved file')
  }
  const previousReceiptIds = attachmentReceiptIds()
  fileInput.dispatchEvent(new Event('change', { bubbles: true }))
  return waitForResumeReceipt(payload, context.recipient, previousReceiptIds, 8_000)
}

function uniqueResumeFileInput(mimeType) {
  const inputs = [...document.querySelectorAll('input[type="file"]')].filter((input) => {
    const accept = input.getAttribute('accept')?.toLocaleLowerCase() ?? ''
    return mimeType === 'application/pdf'
      ? accept.includes('.pdf') || accept.includes('application/pdf')
      : accept.includes('docx') || accept.includes('wordprocessingml')
  })
  return inputs.length === 1 ? inputs[0] : null
}

async function waitForResumeReceipt(payload, recipient, previousReceiptIds, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const receipts = attachmentReceiptCandidates(payload.fileName)
      .filter(({ id }) => !previousReceiptIds.has(id))
    if (receipts.length === 1) {
      const platformAttachmentId = receipts[0].id
      if (platformAttachmentId) {
        return {
          platformAttachmentId: platformAttachmentId.slice(0, 500),
          conversationId: recipient.conversationId,
          observedFileName: payload.fileName,
          observedMimeType: payload.mimeType,
          observedByteLength: payload.byteLength,
          contentFingerprint: payload.contentFingerprint,
          observedRecipient: recipient,
          observedAt: new Date().toISOString()
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error('BOSS resume platform receipt was not observed')
}

function attachmentReceiptIds() {
  return new Set(attachmentReceiptCandidates().map(({ id }) => id))
}

function attachmentReceiptCandidates(fileName) {
  return [...document.querySelectorAll('[data-attachment-id], [data-file-id], [class*="file-message"], [class*="attachment"]')].flatMap((element) => {
    if (fileName && !element.textContent?.includes(fileName)) return []
    const id = element.getAttribute('data-attachment-id') || element.getAttribute('data-file-id')
    return id ? [{ id: id.slice(0, 500) }] : []
  })
}

function validSendPayload(payload) {
  return payload
    && typeof payload.body === 'string' && payload.body.trim().length > 0 && payload.body.length <= 5_000
    && typeof payload.bodyFingerprint === 'string'
    && typeof payload.recipient?.platformRecipientId === 'string'
    && typeof payload.recipient?.conversationId === 'string'
    && typeof payload.recipient?.recipientName === 'string'
}

function validResumePayload(payload) {
  const expectedExtension = payload?.mimeType === 'application/pdf'
    ? '.pdf'
    : payload?.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ? '.docx'
      : ''
  return payload
    && expectedExtension
    && typeof payload.fileName === 'string' && payload.fileName.toLocaleLowerCase().endsWith(expectedExtension) && payload.fileName.length <= 200
    && typeof payload.bytesBase64 === 'string' && payload.bytesBase64.length > 0 && payload.bytesBase64.length <= 1_400_000
    && Number.isInteger(payload.byteLength) && payload.byteLength > 0 && payload.byteLength <= 1_000_000
    && typeof payload.contentFingerprint === 'string'
    && typeof payload.recipient?.platformRecipientId === 'string'
    && typeof payload.recipient?.conversationId === 'string'
    && typeof payload.recipient?.recipientName === 'string'
}

function writeEditor(editor, body) {
  editor.focus()
  if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
    const prototype = editor instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    if (!setter) throw new Error('BOSS editor setter is unavailable')
    setter.call(editor, body)
  } else {
    editor.textContent = body
  }
  editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: body }))
  editor.dispatchEvent(new Event('change', { bubbles: true }))
}

function editorValue(editor) {
  return editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement
    ? editor.value
    : editor.innerText || editor.textContent || ''
}

async function waitForReceipt(body, recipient, previousReceiptIds, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const receipts = messageReceiptCandidates(body)
      .filter(({ id }) => !previousReceiptIds.has(id))
    if (receipts.length === 1) {
      const { id: platformMessageId, node: messageNode } = receipts[0]
      const statusText = messageNode?.textContent ?? ''
      const observedStatus = /已读/u.test(statusText) ? 'read' : /送达/u.test(statusText) ? 'delivered' : /发送|已发/u.test(statusText) ? 'sent' : null
      if (platformMessageId && observedStatus) {
        return {
          platformMessageId: platformMessageId.slice(0, 500),
          conversationId: recipient.conversationId,
          observedBody: body,
          observedStatus,
          observedRecipient: recipient,
          observedAt: new Date().toISOString()
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  return null
}

function messageReceiptIds() {
  return new Set(messageReceiptCandidates().map(({ id }) => id))
}

function messageReceiptCandidates(body) {
  return [...document.querySelectorAll('[class*="message-content"], [class*="chat-text"], [class*="message-text"]')].flatMap((element) => {
    if (body && element.textContent?.trim() !== body) return []
    const node = element.closest('[data-message-id], [data-msg-id], [class*="message-item"], [class*="chat-record"]')
    const id = node?.getAttribute('data-message-id') || node?.getAttribute('data-msg-id')
    return id && node ? [{ id: id.slice(0, 500), node }] : []
  })
}

function fingerprint(value) {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  for (const byte of new TextEncoder().encode(JSON.stringify(value))) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * prime)
  }
  return `fnv1a64:${hash.toString(36)}`
}

function uniqueVisible(selector, predicate = () => true) {
  const matches = visibleMatches(selector, predicate)
  return matches.length === 1 ? matches[0] : null
}

function visibleMatches(selector, predicate = () => true) {
  return [...document.querySelectorAll(selector)].filter((element) => {
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 && predicate(element)
  })
}

function collectBossJobs() {
  if (!location.hostname.endsWith('zhipin.com')) return []
  const seen = new Set()
  return [...document.querySelectorAll('a[href*="/job_detail/"]')].flatMap((anchor) => {
    const url = new URL(anchor.getAttribute('href') ?? '', location.origin)
    const externalId = /\/job_detail\/([^/.?]+)/u.exec(url.pathname)?.[1]
    if (!externalId || seen.has(externalId)) return []
    const card = anchor.closest('li, article, [class*="job-card"], [class*="job-list"]') ?? anchor.parentElement
    const title = (anchor.getAttribute('title') || anchor.textContent || '').trim()
    const company = card?.querySelector('[class*="company-name"], [class*="company"]')?.textContent?.trim() ?? ''
    const locationText = card?.querySelector('[class*="job-area"], [class*="location"]')?.textContent?.trim()
    const summary = card?.textContent?.replace(/\s+/gu, ' ').trim().slice(0, 20_000) ?? ''
    const salary = /(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)K/iu.exec(summary)
    if (!title || !company || !summary) return []
    seen.add(externalId)
    return [{ externalId, url: url.toString(), title: title.slice(0, 300), company: company.slice(0, 300), summary, ...(locationText ? { location: locationText.slice(0, 500) } : {}), ...(salary ? { minimumMonthlySalary: Math.round(Number(salary[1]) * 1_000), maximumMonthlySalary: Math.round(Number(salary[2]) * 1_000) } : {}) }]
  }).slice(0, 50)
}

function collectBossJobDetail() {
  if (!location.hostname.endsWith('zhipin.com')) return null
  const externalId = /\/job_detail\/([^/.?]+)/u.exec(location.pathname)?.[1]
  if (!externalId) return null
  const direct = [...document.querySelectorAll([
    '.job-sec-text',
    '[class*="job-sec-text"]',
    '[class*="job-detail-content"]',
    '[class*="job-description"]'
  ].join(','))].map((element) => element.textContent?.replace(/\s+/gu, ' ').trim() ?? '')
    .filter((value) => value.length >= 40)
    .sort((left, right) => right.length - left.length)[0]
  const heading = [...document.querySelectorAll('h1, h2, h3, h4, strong, span')]
    .find((element) => element.textContent?.trim() === '职位描述')
  const section = heading?.closest('section, article, [class*="job-sec"], [class*="job-detail"]')
  const fallback = section?.textContent?.replace(/\s+/gu, ' ').trim().replace(/^职位描述\s*/u, '') ?? ''
  const description = (direct || fallback).slice(0, 50_000)
  if (description.length < 40) return null
  return { externalId, url: location.href, description }
}

function detectSessionState() {
  const host = location.hostname
  if (host === 'www.zhipin.com' || host.endsWith('.zhipin.com')) {
    if (document.querySelector('a[href*="/web/geek/resume"], a[href*="/web/geek/recommend"]')) return 'available'
    if (visibleTextIncludes(['登录', '扫码登录'])) return 'login-required'
    return 'unknown'
  }
  return 'unknown'
}

function visibleTextIncludes(signals) {
  const text = document.body?.innerText?.slice(0, 30_000).toLocaleLowerCase() ?? ''
  return signals.some((signal) => text.includes(signal))
}
