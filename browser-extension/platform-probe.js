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
    sendResponse({ jobDetail: collectBossJobDetail(message.payload?.url) })
    return false
  }
  if (message?.action === 'collect-boss-resume') {
    sendResponse({ resumeSnapshot: collectBossResumeSnapshot() })
    return false
  }
  if (message?.action === 'open-boss-conversation') {
    sendResponse(openBossConversation(message.payload))
    return false
  }
  if (message?.action === 'select-boss-conversation') {
    selectBossConversation(message.payload).then((result) => sendResponse(result))
      .catch(() => sendResponse({ recipient: null, sendReceipt: null }))
    return true
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
    const diagnostic = diagnoseBossAdapter()
    console.debug('[JobSeeker Agent] BOSS adapter diagnostic', JSON.stringify({
      pageKind: diagnostic.pageKind,
      sessionState: diagnostic.sessionState,
      defaultGreetingRows: diagnostic.counts.defaultGreetingRows,
      defaultGreetingRowsWithMessageIds: diagnostic.counts.defaultGreetingRowsWithMessageIds,
      editors: diagnostic.counts.editors,
      sendControls: diagnostic.counts.sendControls,
      pdfInputs: diagnostic.counts.pdfInputs
    }))
    sendResponse({ diagnostic })
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

const BOSS_DEFAULT_GREETING = '刚刚看了您发布的这个职位，我特别喜欢，可否聊聊呢？'
let selectedConversationTarget = null

function inspectBossConversation() {
  return conversationContext()?.recipient ?? null
}

function openBossConversation(payload) {
  const title = typeof payload?.title === 'string' ? payload.title.normalize('NFKC').trim() : ''
  const company = typeof payload?.company === 'string' ? payload.company.normalize('NFKC').trim() : ''
  if (!title || title.length > 300 || !company || company.length > 300) return { opened: false }
  const attention = detectUserAttention()
  if (attention) return { opened: false, attention }
  const page = bossJobDetailPage(payload?.url)
  if (!page) return { opened: false }
  const bodyText = document.body?.innerText?.normalize('NFKC').slice(0, 100_000) ?? ''
  const comparable = (value) => value.toLocaleLowerCase().replace(/[\s·•|｜,，。:：()（）\[\]【】_-]+/gu, '')
  const visibleIdentity = comparable(bodyText)
  // The canonical job-detail URL plus exact visible title identify the target.
  // BOSS may redact or abbreviate the company label on the detail page, so the
  // stored company remains bounded audit context but is not used as a click gate.
  if (!visibleIdentity.includes(comparable(title))) {
    return { opened: false }
  }
  const controls = visibleMatches('button, a, [role="button"]', (element) => (
    ['立即沟通', '继续沟通', '打招呼'].includes(element.textContent?.replace(/\s+/gu, '').trim() ?? '')
  ))
  if (controls.length !== 1) return { opened: false }
  const recruiterHint = jobDetailRecruiterHint()
  controls[0].click()
  return { opened: true, ...(recruiterHint ? { recruiterHint } : {}) }
}

function jobDetailRecruiterHint() {
  const headings = visibleMatches('h2, h3, h4, strong', (element) => (
    /^[\p{Script=Han}A-Za-z·]{1,20}(?:先生|女士)$/u.test(normalizeVisibleText(element.textContent ?? ''))
  ))
  if (headings.length !== 1) return null
  const recruiterName = normalizeVisibleText(headings[0].textContent ?? '')
  let current = headings[0].parentElement
  for (let depth = 0; current && depth < 4; depth += 1, current = current.parentElement) {
    const text = normalizeVisibleText(current.textContent ?? '')
    if (text.length > 300) break
    const labels = [...current.querySelectorAll('*')].flatMap((element) => {
      if (element.children.length > 0) return []
      const value = normalizeVisibleText(element.textContent ?? '')
      return value && value !== recruiterName && value !== '·' ? [value] : []
    }).filter((value, index, values) => values.indexOf(value) === index)
    if (labels.length > 0) {
      return {
        recruiterName: recruiterName.slice(0, 300),
        recruiterCompany: labels[0].slice(0, 300)
      }
    }
  }
  return { recruiterName: recruiterName.slice(0, 300) }
}

async function selectBossConversation(payload) {
  const target = parseConversationTarget(payload)
  if (!target) {
    return { recipient: null, sendReceipt: null }
  }
  const activeContext = conversationContext()
  if (activeContext && activeConversationMatchesTarget(activeContext, target)) {
    const sendReceipt = openingReceiptFromActiveConversation(target.openingBody, activeContext.recipient, activeContext.root)
    if (sendReceipt) return { recipient: activeContext.recipient, sendReceipt }
  }
  const previewNodes = [...document.querySelectorAll('body *')].filter((element) => {
    if (element.children.length > 0 || !isVisible(element)) return false
    return normalizeVisibleText(element.textContent ?? '') === normalizeVisibleText(target.openingBody)
  })
  const candidates = [...new Set(previewNodes.flatMap((preview) => {
    const row = conversationRowForPreview(preview)
    return row ? [row] : []
  }))].filter(isVisible).sort((left, right) => (
    left.getBoundingClientRect().top - right.getBoundingClientRect().top
  ))
  const comparable = (value) => normalizeVisibleText(value)
    .toLocaleLowerCase()
    .replace(/[\s·•|｜,，。:：()（）\[\]【】_-]+/gu, '')
  const titleMatches = candidates.filter((row) => (
    comparable(row.textContent ?? '').includes(comparable(target.title))
  ))
  const companyMatches = candidates.filter((row) => (
    comparable(row.textContent ?? '').includes(comparable(target.company))
  ))
  const companyNodes = [...document.querySelectorAll('body *')].filter((element) => (
    element.children.length === 0
    && isVisible(element)
    && comparable(element.textContent ?? '').includes(comparable(target.company))
  ))
  const companyRows = [...new Set(companyNodes.flatMap((element) => {
    const row = conversationRowForElement(element)
    return row ? [row] : []
  }))].filter(isVisible)
  const rowsForIdentity = (value) => {
    if (!value) return []
    const nodes = [...document.querySelectorAll('body *')].filter((element) => (
      element.children.length === 0
      && isVisible(element)
      && comparable(element.textContent ?? '').includes(comparable(value))
    ))
    return [...new Set(nodes.flatMap((element) => {
      const row = conversationRowForElement(element)
      return row ? [row] : []
    }))].filter(isVisible)
  }
  const recruiterRows = rowsForIdentity(target.recruiterName)
  const recruiterCompanyRows = rowsForIdentity(target.recruiterCompany)
  const eligible = recruiterRows.length === 1
    ? recruiterRows
    : recruiterCompanyRows.length === 1
      ? recruiterCompanyRows
      : companyMatches.length === 1
        ? companyMatches
        : companyRows.length === 1
          ? companyRows
          : titleMatches.length === 1
            ? titleMatches
            : candidates
  // A shared default greeting is not a target identity. When BOSS exposes
  // multiple indistinguishable rows, fail closed instead of binding the newest
  // unrelated recruiter to the current posting.
  if (eligible.length !== 1) {
    const inspected = []
    for (const row of candidates.slice(0, 20)) {
      if (!row.isConnected) continue
      const recipient = recipientFromConversationRow(row, target)
      if (!recipient) continue
      selectedConversationTarget = { target, recipient }
      row.click()
      await new Promise((resolve) => setTimeout(resolve, 300))
      const context = conversationContext()
      if (!context || !activeConversationMatchesTarget(context, target)) continue
      const provisionalRowIdentity = recipient.platformRecipientId.startsWith('target:')
        && recipient.conversationId.startsWith('target:')
      const stableIdentityMatches = context.recipient.platformRecipientId === recipient.platformRecipientId
        && context.recipient.conversationId === recipient.conversationId
      if (
        (!provisionalRowIdentity && !stableIdentityMatches)
        || !recipientNamesMatch({
          rowName: recipient.recipientName,
          contextName: context.recipient.recipientName,
          company: target.recruiterCompany ?? target.company,
          allowUnknownCompanySuffix: true
        })
      ) continue
      const sendReceipt = openingReceiptFromConversationRow(row, target.openingBody, context.recipient)
        ?? openingReceiptFromActiveConversation(target.openingBody, context.recipient, context.root)
      inspected.push({ recipient: context.recipient, sendReceipt })
    }
    return inspected.length === 1 ? inspected[0] : { recipient: null, sendReceipt: null }
  }

  const row = eligible[0]
  const recipient = recipientFromConversationRow(row, target)
  if (!recipient) return { recipient: null, sendReceipt: null }
  selectedConversationTarget = { target, recipient }
  row.click()
  await new Promise((resolve) => setTimeout(resolve, 500))

  const context = conversationContext()
  let verifiedRecipient = recipient
  if (context?.recipient) {
    const provisionalRowIdentity = recipient.platformRecipientId.startsWith('target:')
      && recipient.conversationId.startsWith('target:')
    const stableIdentityMatches = context.recipient.platformRecipientId === recipient.platformRecipientId
      && context.recipient.conversationId === recipient.conversationId
    if (
      (!provisionalRowIdentity && !stableIdentityMatches)
      || !recipientNamesMatch({
        rowName: recipient.recipientName,
        contextName: context.recipient.recipientName,
        company: target.recruiterCompany ?? target.company
      })
    ) return { recipient: null, sendReceipt: null }
    verifiedRecipient = context.recipient
  }

  const sendReceipt = openingReceiptFromConversationRow(row, target.openingBody, verifiedRecipient)
    ?? openingReceiptFromActiveConversation(target.openingBody, verifiedRecipient, context?.root)
  return { recipient: verifiedRecipient, sendReceipt }
}

function activeConversationMatchesTarget(context, target) {
  const comparable = (value) => normalizeVisibleText(value)
    .toLocaleLowerCase()
    .replace(/[\s·•|｜,，。:：()（）\[\]【】_-]+/gu, '')
  return comparable(context.root.textContent ?? '').includes(comparable(target.title))
}

function recipientNamesMatch({ rowName, contextName, company, allowUnknownCompanySuffix = false }) {
  const comparable = (value) => normalizeVisibleText(value)
    .toLocaleLowerCase()
    .replace(/[\s·•|｜,，。:：()（）\[\]【】_-]+/gu, '')
  const row = comparable(rowName)
  const context = comparable(contextName)
  const targetCompany = comparable(company)
  if (!row || !context) return false
  if (row === context) return true
  if (row === `${context}${targetCompany}` || context === `${row}${targetCompany}`) return true
  return allowUnknownCompanySuffix && (row.startsWith(context) || context.startsWith(row))
}

function parseConversationTarget(payload) {
  const page = bossJobDetailPage(payload?.url)
  const title = typeof payload?.title === 'string' ? payload.title.normalize('NFKC').trim() : ''
  const company = typeof payload?.company === 'string' ? payload.company.normalize('NFKC').trim() : ''
  const openingBody = typeof payload?.openingBody === 'string' ? payload.openingBody.trim() : ''
  const recruiterName = typeof payload?.recruiterName === 'string' ? payload.recruiterName.normalize('NFKC').trim() : ''
  const recruiterCompany = typeof payload?.recruiterCompany === 'string' ? payload.recruiterCompany.normalize('NFKC').trim() : ''
  if (
    !page
    || !title || title.length > 300
    || !company || company.length > 300
    || normalizeVisibleText(openingBody) !== normalizeVisibleText(BOSS_DEFAULT_GREETING)
  ) return null
  return {
    ...page, title, company, openingBody,
    ...(recruiterName && recruiterName.length <= 300 ? { recruiterName } : {}),
    ...(recruiterCompany && recruiterCompany.length <= 300 ? { recruiterCompany } : {})
  }
}

function conversationRowForPreview(preview) {
  return conversationRowForElement(preview, true)
}

function conversationRowForElement(element, requireDefaultGreeting = false) {
  let current = element
  for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
    if (!isVisible(current)) continue
    const text = normalizeVisibleText(current.textContent ?? '')
    if (
      (!requireDefaultGreeting || text.includes(normalizeVisibleText(BOSS_DEFAULT_GREETING)))
      && text.length > 0
      && text.length <= 1_200
      && (
        current.matches('li, [role="option"], [role="listitem"]')
        || /(?:chat|conversation|contact|friend|user).*(?:item|row)|(?:item|row).*(?:chat|conversation|contact|friend|user)/iu.test(String(current.className))
      )
    ) return current
  }
  return null
}

function recipientFromConversationRow(row, target) {
  const labels = [...row.querySelectorAll('*')].flatMap((element) => {
    if (element.children.length > 0) return []
    const text = normalizeVisibleText(element.textContent ?? '')
    if (
      !text
      || text === normalizeVisibleText(target.openingBody)
      || /^\d{1,2}:\d{2}$/u.test(text)
      || /^(?:今天|昨天|前天|刚刚|星期[一二三四五六日天]|周[一二三四五六日天]|\d{1,2}月\d{1,2}日|\d+\s*(?:分钟前|小时前|天前))$/u.test(text)
      || /^\[(?:送达|已读|发送)\]$/u.test(text)
    ) return []
    return [text]
  }).filter((value, index, values) => values.indexOf(value) === index)
  const recipientName = labels[0]?.slice(0, 300)
  if (!recipientName) return null
  const recipientTitle = labels[1]?.slice(0, 300)
  const platformRecipientId = firstBoundedAttribute(row, [
    'data-boss-id', 'data-uid', 'data-recruiter-id', 'data-geek-id'
  ]) ?? `target:${fingerprint({ externalId: target.externalId, recipientName })}`
  const conversationId = firstBoundedAttribute(row, [
    'data-conversation-id', 'data-lid', 'data-chat-id', 'data-id'
  ]) ?? `target:${fingerprint({ externalId: target.externalId, recipientName, recipientTitle })}`
  return {
    platformRecipientId,
    conversationId,
    recipientName,
    ...(recipientTitle ? { recipientTitle } : {})
  }
}

function openingReceiptFromConversationRow(row, body, recipient) {
  const statusText = normalizeVisibleText(row.textContent ?? '')
  const observedStatus = /已读/u.test(statusText)
    ? 'read'
    : /送达/u.test(statusText)
      ? 'delivered'
      : /发送|已发/u.test(statusText)
        ? 'sent'
        : null
  const platformMessageId = firstBoundedAttribute(row, [
    'data-message-id', 'data-msg-id', 'data-last-message-id', 'data-id'
  ])
  if (!observedStatus || !platformMessageId) return null
  return {
    platformMessageId,
    conversationId: recipient.conversationId,
    observedBody: body,
    observedStatus,
    observedRecipient: recipient,
    observedAt: new Date().toISOString()
  }
}

function openingReceiptFromActiveConversation(body, recipient, root = document.body) {
  const receipts = messageReceiptCandidates(body)
    .filter(({ node }) => root === node || root.contains(node))
  if (receipts.length === 1) {
    const { id: platformMessageId, node } = receipts[0]
    const statusText = normalizeVisibleText(node.textContent ?? '')
    const observedStatus = observedMessageStatus(statusText)
    if (observedStatus) {
      return {
        platformMessageId,
        conversationId: recipient.conversationId,
        observedBody: body,
        observedStatus,
        observedRecipient: recipient,
        observedAt: new Date().toISOString()
      }
    }
  }
  const visibleReceipts = visibleMessageReceiptCandidates(body, recipient, root)
  return visibleReceipts.length === 1 ? visibleReceipts[0] : null
}

function visibleMessageReceiptCandidates(body, recipient, root) {
  const exactBody = normalizeVisibleText(body)
  const leaves = [root, ...root.querySelectorAll('*')].filter((element) => (
    element.children.length === 0
    && isVisible(element)
    && normalizeVisibleText(element.textContent ?? '') === exactBody
  ))
  const receipts = leaves.flatMap((leaf) => {
    let current = leaf.parentElement
    for (let depth = 0; current && root.contains(current) && depth < 7; depth += 1, current = current.parentElement) {
      const statusText = normalizeVisibleText(current.textContent ?? '')
      if (statusText.length > 5_000) break
      const observedStatus = observedMessageStatus(statusText)
      if (!observedStatus) continue
      return [{
        platformMessageId: `visible:${fingerprint({
          conversationId: recipient.conversationId,
          body: exactBody,
          observedStatus,
          statusText: statusText.slice(0, 500)
        })}`,
        conversationId: recipient.conversationId,
        observedBody: body,
        observedStatus,
        observedRecipient: recipient,
        observedAt: new Date().toISOString()
      }]
    }
    return []
  })
  return [...new Map(receipts.map((receipt) => [receipt.platformMessageId, receipt])).values()]
}

function observedMessageStatus(statusText) {
  const observedStatus = /已读/u.test(statusText)
    ? 'read'
    : /送达/u.test(statusText)
      ? 'delivered'
      : /发送|已发/u.test(statusText)
        ? 'sent'
        : null
  return observedStatus
}

function firstBoundedAttribute(root, names) {
  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const name of names) {
      const value = element.getAttribute(name)?.trim()
      if (value && value.length <= 500) return value
    }
  }
  return null
}

function normalizeVisibleText(value) {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
}

function isVisible(element) {
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
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
  const defaultGreetingRows = defaultGreetingConversationRows()
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
    incomingMessages: document.querySelectorAll('[data-direction="incoming"], [class*="message-left"], [class*="item-friend"], [class*="message-other"]').length,
    defaultGreetingRows: defaultGreetingRows.length,
    defaultGreetingRowsWithMessageIds: defaultGreetingRows.filter((row) => Boolean(firstBoundedAttribute(row, [
      'data-message-id', 'data-msg-id', 'data-last-message-id', 'data-id'
    ]))).length
  }
  const context = counts.editors === 1 && counts.sendControls === 1
    ? conversationContext()
    : null
  const conversation = Boolean(context)
  return {
    pageKind,
    ...(context ? { conversationFingerprint: fingerprint(context.recipient.conversationId) } : {}),
    sessionState: detectSessionState(),
    counts,
    ready: {
      discovery: pageKind === 'search' && counts.jobLinks > 0,
      conversation,
      messageSend: conversation,
      resumeUpload: conversation && Boolean(uniqueResumeFileInput('application/pdf'))
    }
  }
}

function defaultGreetingConversationRows() {
  const previews = [...document.querySelectorAll('body *')].filter((element) => (
    element.children.length === 0
    && isVisible(element)
    && normalizeVisibleText(element.textContent ?? '') === normalizeVisibleText(BOSS_DEFAULT_GREETING)
  ))
  return [...new Set(previews.flatMap((preview) => {
    const row = conversationRowForPreview(preview)
    return row ? [row] : []
  }))]
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
    const messageNode = node.closest('[data-message-id], [data-msg-id]')
      || node.querySelector('[data-message-id], [data-msg-id]')
    const platformMessageId = messageNode?.getAttribute('data-message-id')
      || messageNode?.getAttribute('data-msg-id')
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
  const editor = uniqueVisible([
    '[contenteditable="true"]',
    'textarea[placeholder*="消息"]', 'textarea[placeholder*="沟通"]', 'textarea[placeholder*="回复"]',
    '[class*="chat-input"] textarea', '[class*="chat-input"] [contenteditable]',
    '[class*="message-input"] textarea', '[class*="message-input"] [contenteditable]'
  ].join(','))
  const sendButton = uniqueVisible('button, [role="button"], a', (element) => (
    element.textContent?.replace(/\s+/gu, '').trim() === '发送'
    || /(?:^|[-_])send(?:[-_]|$)/iu.test(String(element.className))
  ))
  if (!editor || !sendButton) return null
  const root = currentConversationRoot(editor, sendButton)
  const identityNode = uniqueVisibleIn(root, '[data-boss-id], [data-uid], [data-recruiter-id], [data-geek-id]')
  const conversationNode = uniqueVisibleIn(root, '[data-conversation-id], [data-lid], [data-chat-id]')
  const nameNode = uniqueVisibleIn(root, '[class*="chat-name"], [class*="boss-name"], [class*="recipient-name"]')
  const platformRecipientId = identityNode?.getAttribute('data-boss-id')
    || identityNode?.getAttribute('data-uid')
    || identityNode?.getAttribute('data-recruiter-id')
    || identityNode?.getAttribute('data-geek-id')
  const conversationId = conversationNode?.getAttribute('data-conversation-id')
    || conversationNode?.getAttribute('data-lid')
    || conversationNode?.getAttribute('data-chat-id')
  const recipientName = nameNode?.textContent?.trim()
  if ((!platformRecipientId || !conversationId || !recipientName) && selectedConversationTarget) {
    const visible = visibleConversationIdentity()
    if (!visible || !recipientNamesMatch({
      rowName: selectedConversationTarget.recipient.recipientName,
      contextName: visible.recipientName,
      company: selectedConversationTarget.target.company
    })) return null
    return {
      root,
      editor,
      sendButton,
      recipient: selectedConversationTarget.recipient
    }
  }
  if (!platformRecipientId || !conversationId || !recipientName) return null
  const titleNode = uniqueVisibleIn(root, '[class*="boss-title"], [class*="recipient-title"], [class*="chat-position"]')
  return {
    root,
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

function currentConversationRoot(editor, sendButton) {
  const preferred = editor.closest([
    '.chat-conversation', '[class*="chat-conversation"]',
    '[class*="conversation-detail"]', '[class*="chat-panel"]'
  ].join(','))
  if (preferred?.contains(sendButton)) return preferred
  let current = editor.parentElement
  let fallback = document.body
  while (current && current !== document.body) {
    if (current.contains(sendButton)) {
      fallback = current
      if (
        uniqueVisibleIn(current, '[data-boss-id], [data-uid], [data-recruiter-id], [data-geek-id]')
        && uniqueVisibleIn(current, '[data-conversation-id], [data-lid], [data-chat-id]')
        && uniqueVisibleIn(current, '[class*="chat-name"], [class*="boss-name"], [class*="recipient-name"]')
      ) return current
    }
    current = current.parentElement
  }
  return fallback
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
    const accepted = mimeType === 'application/pdf'
      ? accept.includes('.pdf') || accept.includes('application/pdf')
      : accept.includes('docx') || accept.includes('wordprocessingml')
    if (!accepted) return false
    const control = input.closest('label, button, [role="button"], .btn, [class*="upload"], [class*="file"]')
    if (!control || control.closest('[hidden], [aria-hidden="true"]') || !isVisible(control)) return false
    const label = normalizeVisibleText(control.textContent ?? '')
    return /(简历|附件|resume)/iu.test(label) && !/(图片|image)/iu.test(label)
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
  const candidates = [...document.querySelectorAll([
    '[data-attachment-id]', '[data-file-id]', '[data-message-id]', '[data-msg-id]',
    '[class*="file-message"]', '[class*="attachment"]'
  ].join(','))]
  const receiptNodes = [...new Set(candidates.flatMap((element) => {
    const node = element.closest('[data-attachment-id], [data-file-id], [data-message-id], [data-msg-id]')
      || element.querySelector('[data-attachment-id], [data-file-id], [data-message-id], [data-msg-id]')
    return node ? [node] : []
  }))]
  return receiptNodes.flatMap((node) => {
    if (fileName && !node.textContent?.includes(fileName)) return []
    const id = node.getAttribute('data-attachment-id')
      || node.getAttribute('data-file-id')
      || node.getAttribute('data-message-id')
      || node.getAttribute('data-msg-id')
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
  const idNodes = [...document.querySelectorAll('[data-message-id], [data-msg-id], [data-last-message-id]')]
  const contentNodes = [...document.querySelectorAll('[class*="message-content"], [class*="chat-text"], [class*="message-text"]')]
    .flatMap((element) => {
      const node = element.closest('[data-message-id], [data-msg-id], [data-last-message-id], [class*="message-item"], [class*="chat-record"]')
      return node ? [node] : []
    })
  const receipts = [...new Set([...idNodes, ...contentNodes])].flatMap((node) => {
    if (body) {
      const exactBody = normalizeVisibleText(body)
      const leaves = [node, ...node.querySelectorAll('*')].filter((element) => element.children.length === 0)
      if (!leaves.some((element) => normalizeVisibleText(element.textContent ?? '') === exactBody)) return []
    }
    const id = node?.getAttribute('data-message-id')
      || node?.getAttribute('data-msg-id')
      || node?.getAttribute('data-last-message-id')
    return id && node ? [{ id: id.slice(0, 500), node }] : []
  })
  return [...new Map(receipts.map((receipt) => [receipt.id, receipt])).values()]
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

function uniqueVisibleIn(root, selector, predicate = () => true) {
  const matches = [
    ...(root.matches?.(selector) ? [root] : []),
    ...root.querySelectorAll(selector)
  ].filter((element) => (
    isVisible(element) && predicate(element)
  ))
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

function collectBossJobDetail(explicitUrl) {
  const page = bossJobDetailPage(explicitUrl)
  if (!page) return null
  const direct = deepQuerySelectorAll([
    '.job-sec-text',
    '[class*="job-sec-text"]',
    '[class*="job-detail-content"]',
    '[class*="job-description"]'
  ].join(',')).map((element) => element.textContent?.replace(/\s+/gu, ' ').trim() ?? '')
    .filter((value) => value.length >= 40)
    .sort((left, right) => right.length - left.length)[0]
  const heading = deepQuerySelectorAll('h1, h2, h3, h4, strong, span')
    .find((element) => element.textContent?.replace(/\s+/gu, '') === '职位描述')
  const fallback = heading ? textUntilNextHeading(heading, 50_000) : ''
  const visibleSection = jobDescriptionFromVisibleText(document.body?.innerText ?? '')
  const description = (fallback || visibleSection || direct).slice(0, 50_000)
  if (description.length < 40) return null
  return { externalId: page.externalId, url: page.url, description }
}

function jobDescriptionFromVisibleText(value) {
  const text = value.normalize('NFKC').replace(/\r/gu, '')
  const startMatch = /职位\s*描\s*述/u.exec(text)
  if (!startMatch) return ''
  const remainder = text.slice(startMatch.index + startMatch[0].length)
  const boundaries = [
    /\n\s*竞争力分析/u,
    /\n\s*BOSS\s*安全提示/iu,
    /\n\s*公司介绍/u,
    /\n\s*工商信息/u,
    /\n\s*工作地址/u
  ].flatMap((pattern) => {
    const match = pattern.exec(remainder)
    return match ? [match.index] : []
  })
  const end = boundaries.length > 0 ? Math.min(...boundaries) : remainder.length
  return remainder.slice(0, end)
    .replace(/[ \t]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
    .slice(0, 50_000)
}

function bossJobDetailPage(explicitUrl) {
  const candidates = [explicitUrl, location.href]
  try {
    if (typeof window !== 'undefined' && window.top?.location?.href) {
      candidates.push(window.top.location.href)
    }
  } catch {
    // Cross-origin parents are never used as trusted page identity.
  }
  for (const value of candidates) {
    if (typeof value !== 'string') continue
    try {
      const url = new URL(value)
      const externalId = url.hostname === 'www.zhipin.com'
        ? /\/job_detail\/([^/.?]+)/u.exec(url.pathname)?.[1]
        : undefined
      if (!externalId) continue
      url.hash = ''
      return { externalId, url: url.toString() }
    } catch {
      // Continue to another same-origin candidate.
    }
  }
  return null
}

function textUntilNextHeading(heading, maximum) {
  const root = heading.getRootNode()
  const nextHeading = deepQuerySelectorAll('h1, h2, h3', root)
    .find((candidate) => candidate !== heading && Boolean(heading.compareDocumentPosition(candidate) & 4))
  const range = document.createRange()
  range.setStartAfter(heading)
  if (nextHeading) range.setEndBefore(nextHeading)
  else if (root.lastChild) range.setEndAfter(root.lastChild)
  else range.setEndAfter(heading)
  return visibleBoundedText(range.cloneContents(), maximum).replace(/^职位描述\s*/u, '')
}

function deepQuerySelectorAll(selector, root = document) {
  const matches = [...root.querySelectorAll(selector)]
  for (const element of root.querySelectorAll('*')) {
    if (element.shadowRoot) matches.push(...deepQuerySelectorAll(selector, element.shadowRoot))
  }
  return matches
}

function collectBossResumeSnapshot() {
  if (
    location.hostname !== 'www.zhipin.com'
    || !/^\/web\/geek\/resume(?:\/|$)/u.test(location.pathname)
  ) return null
  const candidates = [...document.querySelectorAll([
    '[class*="resume-content"]',
    '[class*="resume-detail"]',
    '[class*="resume-preview"]',
    'main'
  ].join(','))].flatMap((element) => {
    const text = visibleBoundedText(element, 40_000)
    return text.length >= 40 ? [text] : []
  }).sort((left, right) => right.length - left.length)
  const text = candidates[0] ?? ''
  if (text.length < 40 || !/(工作经历|项目经历|教育经历|个人优势|求职期望|技能)/u.test(text)) return null
  const url = new URL(location.href)
  url.search = ''
  url.hash = ''
  return {
    sourceUrl: url.toString(),
    text,
    collectedAt: new Date().toISOString()
  }
}

function visibleBoundedText(root, maximum) {
  const clone = root.cloneNode(true)
  clone.querySelectorAll('script, style, noscript, svg, [hidden], [aria-hidden="true"]').forEach((node) => node.remove())
  return (clone.innerText || clone.textContent || '')
    .normalize('NFKC')
    .replace(/[ \t]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
    .slice(0, maximum)
}

function detectSessionState() {
  const host = location.hostname
  if (host === 'www.zhipin.com' || host.endsWith('.zhipin.com')) {
    if (detectAccessRestriction()) return 'access-restricted'
    if (document.querySelector('a[href*="/web/geek/resume"], a[href*="/web/geek/recommend"]')) return 'available'
    if (visibleTextIncludes(['登录', '扫码登录'])) return 'login-required'
    return 'unknown'
  }
  return 'unknown'
}

function detectUserAttention() {
  if (detectAccessRestriction()) return 'access-restricted'
  if (visibleTextIncludes(['安全验证', '验证码', '完成验证', '滑块验证', '请先验证'])) return 'captcha-required'
  if (detectSessionState() === 'login-required') return 'login-required'
  return null
}

function detectAccessRestriction() {
  return /\/web\/passport\/zp\/403\.html$/u.test(location.pathname)
    || visibleTextIncludes([
      '访问受限',
      '暂时无法访问此页面',
      'ip 存在异常行为',
      '请勿频繁提交刷新请求',
      '已暂时被禁止访问'
    ])
}

function visibleTextIncludes(signals) {
  const text = document.body?.innerText?.slice(0, 30_000).toLocaleLowerCase() ?? ''
  return signals.some((signal) => text.includes(signal))
}
