if (typeof importScripts === 'function') importScripts('job-agent-runtime.js')

const PLATFORM_HOSTS = {
  boss: ['zhipin.com']
}

const bossFrameIds = new Map()
const AGENT_ALARM = 'job-seeker-agent-job-agent'
const AGENT_CONFIG_KEY = 'jobAgentSchedule'
const AGENT_RUNTIME_KEY = 'jobAgentRuntimeV1'
const AGENT_PAGE_KEY = 'jobAgentPageV1'
const INTERVIEW_SIGNALS_KEY = 'seenInterviewSignals'
const BRIDGE_PROTOCOL_VERSION = 11
const NOTIFICATION_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5WQAAAABJRU5ErkJggg=='
const preparedChatTabIds = new Set()

chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name !== AGENT_ALARM) return
  Promise.all([queueScheduledCycle('scheduled'), notifyNewInterviewInvitations()]).catch(() => undefined)
})

chrome.runtime.onStartup?.addListener(() => {
  restoreJobAgentOnStartup().catch(() => undefined)
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action === 'boss-frame-ready' && sender.tab?.id !== undefined && sender.frameId !== undefined) {
    const frames = bossFrameIds.get(sender.tab.id) ?? new Set()
    frames.add(sender.frameId)
    bossFrameIds.set(sender.tab.id, frames)
    return false
  }
  if (message?.action === 'job-agent-page-ready') {
    const pageUrl = safeJobAgentPageUrl(sender.tab?.url)
    if (pageUrl) chrome.storage.local.set({ [AGENT_PAGE_KEY]: pageUrl }).catch(() => undefined)
    dispatchPendingCycle(sender.tab?.id).catch(() => undefined)
    return false
  }
  if (typeof message?.requestId !== 'string') return false
  if (message.action === 'detect-platforms') {
    detectSessions().then((sessions) => sendResponse({
      requestId: message.requestId,
      ok: true,
      extensionVersion: chrome.runtime.getManifest().version,
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      sessions
    })).catch(() => sendResponse({ requestId: message.requestId, ok: false, error: 'PROBE_FAILED' }))
    return true
  }
  if (message.action === 'collect-boss-jobs') {
    collectBossJobs().then((jobs) => sendResponse({
      requestId: message.requestId,
      ok: true,
      extensionVersion: chrome.runtime.getManifest().version,
      jobs
    })).catch(() => sendResponse({ requestId: message.requestId, ok: false, error: 'PROBE_FAILED' }))
    return true
  }
  if (message.action === 'collect-boss-job-detail') {
    const url = validBossJobDetailUrl(message.payload?.url)
    if (!url) {
      sendResponse({ requestId: message.requestId, ok: false, error: 'INVALID_REQUEST' })
      return false
    }
    collectBossJobDetail(url).then((jobDetail) => sendResponse({
      requestId: message.requestId,
      ok: Boolean(jobDetail),
      extensionVersion: chrome.runtime.getManifest().version,
      ...(jobDetail ? { jobDetail } : { error: 'PROBE_FAILED' })
    })).catch(() => sendResponse({ requestId: message.requestId, ok: false, error: 'PROBE_FAILED' }))
    return true
  }
  if (message.action === 'collect-boss-resume') {
    collectBossResume().then((resumeSnapshot) => sendResponse({
      requestId: message.requestId,
      ok: Boolean(resumeSnapshot),
      extensionVersion: chrome.runtime.getManifest().version,
      ...(resumeSnapshot ? { resumeSnapshot } : { error: 'PROBE_FAILED' })
    })).catch(() => sendResponse({ requestId: message.requestId, ok: false, error: 'PROBE_FAILED' }))
    return true
  }
  if (message.action === 'search-boss-jobs') {
    const query = typeof message.payload?.query === 'string' ? message.payload.query.normalize('NFKC').trim() : ''
    if (!query || query.length > 120) {
      sendResponse({ requestId: message.requestId, ok: false, error: 'INVALID_REQUEST' })
      return false
    }
    searchBossJobs(query).then((jobs) => sendResponse({
      requestId: message.requestId,
      ok: true,
      extensionVersion: chrome.runtime.getManifest().version,
      jobs
    })).catch(() => sendResponse({ requestId: message.requestId, ok: false, error: 'PROBE_FAILED' }))
    return true
  }
  if (message.action === 'open-boss-conversation') {
    const target = validBossConversationTarget(message.payload)
    if (!target) {
      sendResponse({ requestId: message.requestId, ok: false, error: 'INVALID_REQUEST' })
      return false
    }
    openBossConversation(target).then((result) => sendResponse({
      requestId: message.requestId,
      ok: Boolean(result.recipient),
      extensionVersion: chrome.runtime.getManifest().version,
      ...(result.recipient ? { recipient: result.recipient } : {}),
      ...(result.sendReceipt ? { sendReceipt: result.sendReceipt } : {}),
      ...(result.attention ? { attention: result.attention } : {}),
      ...(!result.recipient && !result.attention ? { error: 'PROBE_FAILED' } : {})
    })).catch(() => sendResponse({ requestId: message.requestId, ok: false, error: 'PROBE_FAILED' }))
    return true
  }
  if (message.action === 'configure-job-agent') {
    const enabled = message.payload?.enabled === true
    const intervalMinutes = Number(message.payload?.intervalMinutes)
    if (enabled && (!Number.isFinite(intervalMinutes) || intervalMinutes < 5 || intervalMinutes > 1_440)) {
      sendResponse({ requestId: message.requestId, ok: false, error: 'INVALID_REQUEST' })
      return false
    }
    configureJobAgent({ enabled, intervalMinutes: enabled ? intervalMinutes : 15 })
      .then((runtime) => sendResponse({
        requestId: message.requestId,
        ok: true,
        extensionVersion: chrome.runtime.getManifest().version,
        jobAgentRuntime: ResumeOsJobRuntime.publicStatus(runtime, new Date().toISOString())
      }))
      .catch(() => sendResponse({ requestId: message.requestId, ok: false, error: 'PROBE_FAILED' }))
    return true
  }
  if (message.action === 'get-job-agent-runtime') {
    readJobAgentRuntime().then((runtime) => sendResponse({
      requestId: message.requestId,
      ok: true,
      extensionVersion: chrome.runtime.getManifest().version,
      jobAgentRuntime: ResumeOsJobRuntime.publicStatus(runtime, new Date().toISOString())
    })).catch(() => sendResponse({ requestId: message.requestId, ok: false, error: 'PROBE_FAILED' }))
    return true
  }
  if (message.action === 'report-job-agent-cycle') {
    const cycleId = typeof message.payload?.cycleId === 'string' ? message.payload.cycleId.trim() : ''
    const status = message.payload?.status
    if (!cycleId || cycleId.length > 160 || !['completed', 'failed', 'skipped'].includes(status)) {
      sendResponse({ requestId: message.requestId, ok: false, error: 'INVALID_REQUEST' })
      return false
    }
    acknowledgeJobAgentCycle(cycleId, status).then((runtime) => sendResponse({
      requestId: message.requestId,
      ok: true,
      extensionVersion: chrome.runtime.getManifest().version,
      jobAgentRuntime: ResumeOsJobRuntime.publicStatus(runtime, new Date().toISOString())
    })).catch(() => sendResponse({ requestId: message.requestId, ok: false, error: 'PROBE_FAILED' }))
    return true
  }
  if (message.action === 'inspect-boss-conversation') {
    inspectBossConversation().then((recipient) => sendResponse({
      requestId: message.requestId,
      ok: Boolean(recipient),
      extensionVersion: chrome.runtime.getManifest().version,
      ...(recipient ? { recipient } : { error: 'PROBE_FAILED' })
    })).catch(() => sendResponse({ requestId: message.requestId, ok: false, error: 'PROBE_FAILED' }))
    return true
  }
  if (message.action === 'collect-boss-conversation-signals') {
    collectBossConversationSignals().then((conversationSignals) => sendResponse({
      requestId: message.requestId,
      ok: true,
      extensionVersion: chrome.runtime.getManifest().version,
      conversationSignals
    })).catch(() => sendResponse({ requestId: message.requestId, ok: false, error: 'PROBE_FAILED' }))
    return true
  }
  if (message.action === 'summarize-boss-history') {
    summarizeBossHistory().then((historySummary) => sendResponse({
      requestId: message.requestId,
      ok: Boolean(historySummary),
      extensionVersion: chrome.runtime.getManifest().version,
      ...(historySummary ? { historySummary } : { error: 'PROBE_FAILED' })
    })).catch(() => sendResponse({ requestId: message.requestId, ok: false, error: 'PROBE_FAILED' }))
    return true
  }
  if (message.action === 'diagnose-boss-adapter') {
    diagnoseBossAdapter().then((diagnostics) => sendResponse({
      requestId: message.requestId,
      ok: true,
      extensionVersion: chrome.runtime.getManifest().version,
      diagnostics
    })).catch(() => sendResponse({ requestId: message.requestId, ok: false, error: 'PROBE_FAILED' }))
    return true
  }
  if (message.action === 'send-boss-message') {
    if (!validBossSendPayload(message.payload)) {
      sendResponse({ requestId: message.requestId, ok: false, error: 'INVALID_REQUEST' })
      return false
    }
    sendBossMessage(message.payload).then((sendReceipt) => sendResponse({
      requestId: message.requestId,
      ok: Boolean(sendReceipt),
      extensionVersion: chrome.runtime.getManifest().version,
      ...(sendReceipt ? { sendReceipt } : { error: 'PROBE_FAILED' })
    })).catch(() => sendResponse({ requestId: message.requestId, ok: false, error: 'PROBE_FAILED' }))
    return true
  }
  if (message.action === 'send-boss-resume-attachment') {
    if (!validBossResumePayload(message.payload)) {
      sendResponse({ requestId: message.requestId, ok: false, error: 'INVALID_REQUEST' })
      return false
    }
    sendBossResumeAttachment(message.payload).then((resumeReceipt) => sendResponse({
      requestId: message.requestId,
      ok: Boolean(resumeReceipt),
      extensionVersion: chrome.runtime.getManifest().version,
      ...(resumeReceipt ? { resumeReceipt } : { error: 'PROBE_FAILED' })
    })).catch(() => sendResponse({ requestId: message.requestId, ok: false, error: 'PROBE_FAILED' }))
    return true
  }
  return false
})

async function configureJobAgent(config) {
  await chrome.storage.local.set({ [AGENT_CONFIG_KEY]: config })
  await chrome.alarms.clear(AGENT_ALARM)
  const now = new Date().toISOString()
  const runtime = await readJobAgentRuntime()
  const next = ResumeOsJobRuntime.configure(runtime, config, now, createCycleId(now))
  await writeJobAgentRuntime(next)
  if (config.enabled) {
    await chrome.alarms.create(AGENT_ALARM, { delayInMinutes: 1, periodInMinutes: config.intervalMinutes })
    await dispatchPendingCycle()
  }
  return readJobAgentRuntime()
}

async function restoreJobAgentOnStartup() {
  const stored = await chrome.storage.local.get(AGENT_CONFIG_KEY)
  const config = stored?.[AGENT_CONFIG_KEY]
  if (!config?.enabled) return
  const intervalMinutes = Number.isFinite(config.intervalMinutes) ? config.intervalMinutes : 15
  await chrome.alarms.create(AGENT_ALARM, { delayInMinutes: 1, periodInMinutes: intervalMinutes })
  await queueScheduledCycle('browser-restarted')
}

async function queueScheduledCycle(reason) {
  const runtime = await readJobAgentRuntime()
  if (!runtime.enabled) return runtime
  const now = new Date().toISOString()
  const next = ResumeOsJobRuntime.schedule(runtime, now, createCycleId(now), reason)
  await writeJobAgentRuntime(next)
  await dispatchPendingCycle()
  return next
}

async function dispatchPendingCycle(preferredTabId) {
  let runtime = await readJobAgentRuntime()
  if (!runtime.enabled) return runtime
  const now = new Date().toISOString()
  const cycle = ResumeOsJobRuntime.nextDispatchable(runtime, now)
  if (!cycle) return runtime
  const tabs = await chrome.tabs.query({
    url: [
      'http://127.0.0.1/*',
      'http://localhost/*',
      'https://resume-os-phi.vercel.app/*',
      'https://job-seeker-agent-phi.vercel.app/*'
    ]
  })
  const jobAgentTabs = tabs.filter((candidate) => candidate.id && isJobAgentTabUrl(candidate.url))
  const tab = jobAgentTabs.find((candidate) => candidate.id === preferredTabId) ?? jobAgentTabs[0]
  if (!tab?.id) {
    const stored = await chrome.storage.local.get(AGENT_PAGE_KEY)
    const pageUrl = safeJobAgentPageUrl(stored?.[AGENT_PAGE_KEY])
    if (pageUrl) {
      try {
        const created = await chrome.tabs.create({ url: pageUrl, active: false })
        if (created.id) {
          await waitForTabComplete(created.id, 12_000)
          return runtime
        }
      } catch {
        // Fall through to the explicit page-closed runtime state.
      }
    }
    runtime = ResumeOsJobRuntime.markUnavailable(runtime, 'page-closed', now)
    await writeJobAgentRuntime(runtime)
    return runtime
  }
  runtime = ResumeOsJobRuntime.markDispatched(runtime, cycle.id, now)
  await writeJobAgentRuntime(runtime)
  try {
    await chrome.tabs.sendMessage(tab.id, {
      action: 'job-agent-wakeup',
      cycle: {
        id: cycle.id,
        scheduledAt: cycle.scheduledAt,
        reason: cycle.reason,
        missedIntervals: cycle.missedIntervals,
        attempt: cycle.attempts + 1
      }
    })
    return runtime
  } catch {
    runtime = ResumeOsJobRuntime.markUnavailable(runtime, 'dispatch-failed', new Date().toISOString())
    await writeJobAgentRuntime(runtime)
    return runtime
  }
}

function isJobAgentTabUrl(value) {
  return Boolean(safeJobAgentPageUrl(value))
}

function safeJobAgentPageUrl(value) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    const local = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)
    const production = url.protocol === 'https:' && [
      'resume-os-phi.vercel.app',
      'job-seeker-agent-phi.vercel.app'
    ].includes(url.hostname)
    const locale = /^\/(zh|en)\/jobs(?:\/|$)/u.exec(url.pathname)?.[1]
    if ((!local && !production) || !locale) return null
    return `${url.origin}/${locale}/jobs`
  } catch {
    return null
  }
}

async function acknowledgeJobAgentCycle(cycleId, status) {
  const now = new Date().toISOString()
  const runtime = await readJobAgentRuntime()
  const next = ResumeOsJobRuntime.acknowledge(runtime, cycleId, status, now)
  await writeJobAgentRuntime(next)
  setTimeout(() => dispatchPendingCycle().catch(() => undefined), 2_000)
  return next
}

async function readJobAgentRuntime() {
  const stored = await chrome.storage.local.get([AGENT_RUNTIME_KEY, AGENT_CONFIG_KEY])
  const now = new Date().toISOString()
  const runtime = ResumeOsJobRuntime.normalizeRuntime(stored?.[AGENT_RUNTIME_KEY], now)
  const config = stored?.[AGENT_CONFIG_KEY]
  if (config?.enabled === true && !runtime.enabled) {
    return ResumeOsJobRuntime.configure(runtime, config, now, createCycleId(now))
  }
  return runtime
}

async function writeJobAgentRuntime(runtime) {
  await chrome.storage.local.set({ [AGENT_RUNTIME_KEY]: runtime })
}

function createCycleId(now) {
  return `cycle-${Date.parse(now).toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

async function notifyNewInterviewInvitations() {
  const tabs = await chrome.tabs.query({ url: ['https://www.zhipin.com/web/geek/chat*'] })
  const signals = []
  for (const tab of tabs) {
    if (!tab.id) continue
    const frameIds = [...new Set([0, ...(bossFrameIds.get(tab.id) ?? [])])]
    for (const frameId of frameIds) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'collect-boss-conversation-signals' }, { frameId })
        if (Array.isArray(response?.signals)) signals.push(...response.signals.slice(0, 10))
      } catch {
        // Unknown frames fail closed and produce no invitation signal.
      }
    }
  }
  const stored = await chrome.storage.local.get(INTERVIEW_SIGNALS_KEY)
  const seen = new Set(Array.isArray(stored?.[INTERVIEW_SIGNALS_KEY]) ? stored[INTERVIEW_SIGNALS_KEY] : [])
  const fresh = signals.filter((signal) => (
    typeof signal?.signalId === 'string'
    && ['interview-invite', 'interview-schedule'].includes(signal.kind)
    && !seen.has(signal.signalId)
  ))
  if (fresh.length === 0) return
  fresh.forEach((signal) => seen.add(signal.signalId))
  await chrome.storage.local.set({ [INTERVIEW_SIGNALS_KEY]: [...seen].slice(-100) })
  await chrome.notifications.create(`job-seeker-agent-interview-${Date.now()}`, {
    type: 'basic',
    iconUrl: NOTIFICATION_ICON,
    title: 'JobSeeker Agent：发现约面消息',
    message: fresh.length === 1 ? 'BOSS 直聘出现一条可能的面试邀请，请打开沟通页面确认。' : `BOSS 直聘出现 ${fresh.length} 条可能的面试邀请，请打开沟通页面确认。`,
    priority: 2
  })
}

async function collectBossJobs() {
  const tabs = await chrome.tabs.query({ url: ['https://www.zhipin.com/*'] })
  const tab = tabs.find((candidate) => candidate.id && /\/web\/geek\/job|\/job_detail\//u.test(candidate.url ?? ''))
  if (!tab?.id) return []
  return collectJobsFromTab(tab.id)
}

async function searchBossJobs(query) {
  const jobs = new Map()
  for (let page = 1; page <= 3 && jobs.size < 50; page += 1) {
    const url = new URL('/web/geek/jobs', 'https://www.zhipin.com')
    url.searchParams.set('query', query)
    if (page > 1) url.searchParams.set('page', String(page))
    const tab = await chrome.tabs.create({ url: url.toString(), active: false })
    if (!tab.id) break
    let pageJobs = []
    try {
      await waitForTabComplete(tab.id, 12_000)
      await new Promise((resolve) => setTimeout(resolve, 800))
      pageJobs = await collectJobsFromTab(tab.id)
      for (const job of pageJobs) {
        if (job?.externalId) jobs.set(job.externalId, job)
      }
    } finally {
      bossFrameIds.delete(tab.id)
      await chrome.tabs.remove(tab.id).catch(() => undefined)
    }
    if (pageJobs.length === 0) break
  }
  return [...jobs.values()].slice(0, 50)
}

function validBossJobDetailUrl(value) {
  if (typeof value !== 'string' || value.length > 2_000) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname !== 'www.zhipin.com' || !/^\/job_detail\/[^/]+\.html$/u.test(url.pathname)) return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function validBossConversationTarget(payload) {
  const url = validBossJobDetailUrl(payload?.url)
  const title = typeof payload?.title === 'string' ? payload.title.normalize('NFKC').trim() : ''
  const company = typeof payload?.company === 'string' ? payload.company.normalize('NFKC').trim() : ''
  const openingBody = typeof payload?.openingBody === 'string' ? payload.openingBody.normalize('NFKC').trim() : ''
  return url
    && title && title.length <= 300
    && company && company.length <= 300
    && openingBody && openingBody.length <= 5_000
    ? { url, title, company, openingBody }
    : null
}

async function openBossConversation(target) {
  const existingChatTabs = await chrome.tabs.query({
    url: ['https://www.zhipin.com/web/geek/chat*']
  })
  const existingChatTabIds = new Set(existingChatTabs.flatMap((tab) => tab.id ? [tab.id] : []))
  for (const chatTab of existingChatTabs
    .filter((candidate) => candidate.id)
    .sort((left, right) => (right.lastAccessed ?? 0) - (left.lastAccessed ?? 0))
    .slice(0, 1)) {
    try {
      await prepareBossChatTab(chatTab.id)
    } catch {
      continue
    }
    const selection = await selectBossConversationInTab(chatTab.id, target)
    if (selection?.recipient) {
      return {
        recipient: selection.recipient,
        ...(selection.sendReceipt ? { sendReceipt: selection.sendReceipt } : {})
      }
    }
  }
  const existingJobTabs = await chrome.tabs.query({ url: ['https://www.zhipin.com/job_detail/*'] })
  const targetExternalId = bossJobExternalId(target.url)
  const existingJobTab = existingJobTabs
    .filter((candidate) => candidate.id && bossJobExternalId(candidate.url) === targetExternalId)
    .sort((left, right) => (right.lastAccessed ?? 0) - (left.lastAccessed ?? 0))[0]
  const tab = existingJobTab ?? await chrome.tabs.create({ url: target.url, active: false })
  if (!tab.id) return {}
  let keepTargetTab = Boolean(existingJobTab)
  try {
    await waitForTabComplete(tab.id, 12_000)
    await new Promise((resolve) => setTimeout(resolve, 800))
    let opened = false
    let recruiterHint = null
    const frameIds = [...new Set([0, ...(bossFrameIds.get(tab.id) ?? [])])]
    for (const frameId of frameIds) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, {
          action: 'open-boss-conversation',
          payload: target
        }, { frameId })
        if (response?.attention) {
          if (['captcha-required', 'access-restricted'].includes(response.attention) || frameId === 0) {
            keepTargetTab = true
            if (chrome.tabs.update) {
              await chrome.tabs.update(tab.id, { active: true }).catch(() => undefined)
            }
            return { attention: response.attention }
          }
          continue
        }
        if (response?.opened) {
          opened = true
          if (response.recruiterHint) recruiterHint = response.recruiterHint
          break
        }
      } catch {
        // Continue to another registered frame without relaxing target checks.
      }
    }
    if (!opened) return {}
    // Keep the exact posting-bound conversation surface open even when a new
    // BOSS DOM revision prevents recipient inspection. Sending still fails
    // closed, but the visible page remains available for adapter recovery.
    keepTargetTab = true
    if (chrome.tabs.update) {
      await loadBossChatSurface(tab.id)
    }
    await new Promise((resolve) => setTimeout(resolve, 1_200))
    const selectionTarget = recruiterHint ? { ...target, ...recruiterHint } : target
    const selection = await selectBossConversationInTab(tab.id, selectionTarget)
    if (selection?.recipient) {
      return {
        recipient: selection.recipient,
        ...(selection.sendReceipt ? { sendReceipt: selection.sendReceipt } : {})
      }
    }
    const sameTabRecipient = await inspectBossConversationInTab(tab.id)
    if (sameTabRecipient) {
      keepTargetTab = true
      return { recipient: sameTabRecipient }
    }
    const newChatTabs = (await chrome.tabs.query({ url: ['https://www.zhipin.com/web/geek/chat*'] }))
      .filter((candidate) => candidate.id && !existingChatTabIds.has(candidate.id))
    const recipients = []
    for (const chatTab of newChatTabs) {
      const recipient = await inspectBossConversationInTab(chatTab.id)
      if (recipient) recipients.push({ tabId: chatTab.id, recipient })
    }
    const unique = [...new Map(recipients.map((item) => [
      `${item.recipient.platformRecipientId}:${item.recipient.conversationId}`,
      item
    ])).values()]
    return unique.length === 1 ? { recipient: unique[0].recipient } : {}
  } finally {
    if (!keepTargetTab) {
      bossFrameIds.delete(tab.id)
      await chrome.tabs.remove(tab.id).catch(() => undefined)
    }
  }
}

async function prepareBossChatTab(tabId) {
  if (preparedChatTabIds.has(tabId)) return
  if (chrome.scripting?.executeScript) {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['platform-probe.js']
    })
    await new Promise((resolve) => setTimeout(resolve, 250))
    preparedChatTabIds.add(tabId)
    return
  }
  if (!chrome.tabs.reload) return
  await waitForNextTabComplete(tabId, 12_000, async () => {
    await chrome.tabs.reload(tabId)
  })
  await new Promise((resolve) => setTimeout(resolve, 800))
  preparedChatTabIds.add(tabId)
}

function bossJobExternalId(value) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.hostname === 'www.zhipin.com'
      ? /\/job_detail\/([^/.?]+)/u.exec(url.pathname)?.[1] ?? null
      : null
  } catch {
    return null
  }
}

async function collectBossJobDetail(url) {
  const tab = await chrome.tabs.create({ url, active: false })
  if (!tab.id) return null
  try {
    await waitForTabComplete(tab.id, 12_000)
    await new Promise((resolve) => setTimeout(resolve, 800))
    const candidates = new Map()
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const frameIds = [...new Set([0, ...(bossFrameIds.get(tab.id) ?? [])])]
      for (const frameId of frameIds) {
        try {
          const response = await chrome.tabs.sendMessage(tab.id, { action: 'collect-boss-job-detail', payload: { url } }, { frameId })
          if (response?.jobDetail) candidates.set(response.jobDetail.description, response.jobDetail)
        } catch {
          // Continue to the next registered frame.
        }
      }
      const structured = [...candidates.values()]
        .sort((left, right) => bossJobDetailScore(right) - bossJobDetailScore(left))[0]
      if (structured && bossJobDetailScore(structured) >= 100_000) return structured
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 700))
    }
    return [...candidates.values()]
      .sort((left, right) => bossJobDetailScore(right) - bossJobDetailScore(left))[0] ?? null
  } finally {
    bossFrameIds.delete(tab.id)
    await chrome.tabs.remove(tab.id).catch(() => undefined)
  }
}

function bossJobDetailScore(detail) {
  const description = typeof detail?.description === 'string' ? detail.description : ''
  const structuralSignals = [/(岗位职责|工作职责)/u, /(任职要求|职位要求)/u, /(希望你|我们希望)/u, /加分项/u]
    .filter((pattern) => pattern.test(description)).length
  return structuralSignals * 100_000 + Math.min(description.length, 50_000)
}

async function collectBossResume() {
  const tab = await chrome.tabs.create({
    url: 'https://www.zhipin.com/web/geek/resume',
    active: false
  })
  if (!tab.id) return null
  try {
    await waitForTabComplete(tab.id, 12_000)
    await new Promise((resolve) => setTimeout(resolve, 800))
    const frameIds = [...new Set([0, ...(bossFrameIds.get(tab.id) ?? [])])]
    for (const frameId of frameIds) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'collect-boss-resume' }, { frameId })
        if (response?.resumeSnapshot) return response.resumeSnapshot
      } catch {
        // Continue to the next registered frame.
      }
    }
    return null
  } finally {
    bossFrameIds.delete(tab.id)
    await chrome.tabs.remove(tab.id).catch(() => undefined)
  }
}

async function collectJobsFromTab(tabId) {
  const frameIds = [...new Set([0, ...(bossFrameIds.get(tabId) ?? [])])]
  for (const frameId of frameIds) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { action: 'collect-boss-jobs' }, { frameId })
      if (Array.isArray(response?.jobs) && response.jobs.length > 0) return response.jobs.slice(0, 50)
    } catch {
      // Continue to the next registered frame.
    }
  }
  return []
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      reject(new Error('BOSS search tab timed out'))
    }, timeoutMs)
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return
      clearTimeout(timeout)
      chrome.tabs.onUpdated.removeListener(listener)
      resolve()
    }
    chrome.tabs.onUpdated.addListener(listener)
    chrome.tabs.get(tabId).then((current) => {
      if (current.status === 'complete') {
        clearTimeout(timeout)
        chrome.tabs.onUpdated.removeListener(listener)
        resolve()
      }
    }).catch(() => undefined)
  })
}

async function loadBossChatSurface(tabId) {
  const currentTab = await chrome.tabs.get(tabId).catch(() => null)
  await waitForNextTabComplete(tabId, 12_000, async () => {
    // BOSS can change the address to /web/geek/chat while leaving the job-detail
    // document mounted. A real reload is required before any recipient or receipt
    // inspection; trusting the URL alone can bind the wrong DOM surface.
    if (currentTab?.url?.includes('/web/geek/chat') && chrome.tabs.reload) {
      await chrome.tabs.reload(tabId)
      return
    }
    await chrome.tabs.update(tabId, { url: 'https://www.zhipin.com/web/geek/chat', active: false })
  })
}

function waitForNextTabComplete(tabId, timeoutMs, navigate) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout)
      chrome.tabs.onUpdated.removeListener(listener)
    }
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('BOSS chat tab timed out'))
    }, timeoutMs)
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return
      cleanup()
      resolve()
    }
    chrome.tabs.onUpdated.addListener(listener)
    Promise.resolve().then(navigate).catch((error) => {
      cleanup()
      reject(error)
    })
  })
}

async function inspectBossConversation() {
  const tabs = await chrome.tabs.query({ url: ['https://www.zhipin.com/web/geek/chat*'] })
  for (const tab of tabs) {
    if (!tab.id) continue
    const recipient = await inspectBossConversationInTab(tab.id)
    if (recipient) return recipient
  }
  return null
}

async function inspectBossConversationInTab(tabId) {
  const frameIds = [...new Set([0, ...(bossFrameIds.get(tabId) ?? [])])]
  for (const frameId of frameIds) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { action: 'inspect-boss-conversation' }, { frameId })
      if (response?.recipient) return response.recipient
    } catch {
      // A missing or navigated frame is not a verified conversation.
    }
  }
  return null
}

async function selectBossConversationInTab(tabId, target) {
  const frameIds = [...new Set([0, ...(bossFrameIds.get(tabId) ?? [])])]
  const matches = []
  for (const frameId of frameIds) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        action: 'select-boss-conversation',
        payload: target
      }, { frameId })
      if (response?.recipient) matches.push(response)
    } catch {
      // Unknown frames cannot authorize recipient selection.
    }
  }
  const unique = [...new Map(matches.map((response) => [
    `${response.recipient.platformRecipientId}:${response.recipient.conversationId}`,
    response
  ])).values()]
  return unique.length === 1 ? unique[0] : null
}

async function collectBossConversationSignals() {
  const tabs = await chrome.tabs.query({ url: ['https://www.zhipin.com/web/geek/chat*'] })
  const signals = []
  for (const tab of tabs) {
    if (!tab.id) continue
    const frameIds = [...new Set([0, ...(bossFrameIds.get(tab.id) ?? [])])]
    for (const frameId of frameIds) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'collect-boss-conversation-signals' }, { frameId })
        if (Array.isArray(response?.signals)) signals.push(...response.signals.slice(0, 100))
      } catch {
        // Unknown or navigated frames fail closed.
      }
    }
  }
  return [...new Map(signals.flatMap((signal) => (
    validConversationSignal(signal) ? [[signal.signalId, signal]] : []
  ))).values()].slice(0, 100)
}

async function summarizeBossHistory() {
  const tabs = await chrome.tabs.query({ url: ['https://www.zhipin.com/web/geek/chat*'] })
  for (const tab of tabs) {
    if (!tab.id) continue
    const frameIds = [...new Set([0, ...(bossFrameIds.get(tab.id) ?? [])])]
    for (const frameId of frameIds) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'summarize-boss-history' }, { frameId })
        if (response?.historySummary) return response.historySummary
      } catch {
        // Continue to the next registered frame or chat tab.
      }
    }
  }
  return null
}

async function diagnoseBossAdapter() {
  const tabs = await chrome.tabs.query({ url: ['https://www.zhipin.com/*'] })
  const diagnostics = []
  for (const tab of tabs) {
    if (!tab.id) continue
    const frameIds = [...new Set([0, ...(bossFrameIds.get(tab.id) ?? [])])]
    for (const frameId of frameIds) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'diagnose-boss-adapter' }, { frameId })
        if (response?.diagnostic) diagnostics.push({ ...response.diagnostic, frameId })
      } catch {
        // Missing frames are omitted rather than reported as ready.
      }
    }
  }
  return diagnostics.slice(0, 50)
}

function validConversationSignal(signal) {
  return signal
    && typeof signal.signalId === 'string' && signal.signalId.length <= 256
    && typeof signal.conversationId === 'string' && signal.conversationId.length <= 500
    && ['recruiter-reply', 'resume-request', 'interview-invite', 'interview-schedule', 'offer', 'rejection'].includes(signal.kind)
    && typeof signal.observedAt === 'string'
}

async function sendBossMessage(payload) {
  const tabs = await chrome.tabs.query({ url: ['https://www.zhipin.com/web/geek/chat*'] })
  for (const tab of tabs) {
    if (!tab.id) continue
    const frameIds = [...new Set([0, ...(bossFrameIds.get(tab.id) ?? [])])]
    for (const frameId of frameIds) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'send-boss-message', payload }, { frameId })
        if (response?.sendReceipt) return response.sendReceipt
      } catch {
        // Continue only to another registered frame; never relax validation.
      }
    }
  }
  return null
}

async function sendBossResumeAttachment(payload) {
  const tabs = await chrome.tabs.query({ url: ['https://www.zhipin.com/web/geek/chat*'] })
  for (const tab of tabs) {
    if (!tab.id) continue
    const frameIds = [...new Set([0, ...(bossFrameIds.get(tab.id) ?? [])])]
    for (const frameId of frameIds) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'send-boss-resume-attachment', payload }, { frameId })
        if (response?.resumeReceipt) return response.resumeReceipt
      } catch {
        // Continue only to another registered frame; never relax validation.
      }
    }
  }
  return null
}

function validBossSendPayload(payload) {
  return payload
    && typeof payload.messageId === 'string' && payload.messageId.length > 0 && payload.messageId.length <= 160
    && typeof payload.body === 'string' && payload.body.trim().length > 0 && payload.body.length <= 5_000
    && typeof payload.bodyFingerprint === 'string' && payload.bodyFingerprint.length <= 256
    && typeof payload.recipient?.platformRecipientId === 'string'
    && typeof payload.recipient?.conversationId === 'string'
    && typeof payload.recipient?.recipientName === 'string'
}

function validBossResumePayload(payload) {
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
    && typeof payload.contentFingerprint === 'string' && payload.contentFingerprint.length <= 256
    && typeof payload.recipient?.platformRecipientId === 'string'
    && typeof payload.recipient?.conversationId === 'string'
    && typeof payload.recipient?.recipientName === 'string'
}

async function detectSessions() {
  const tabs = await chrome.tabs.query({})
  const sessions = []
  for (const [platform, hosts] of Object.entries(PLATFORM_HOSTS)) {
    const candidates = tabs.filter((candidate) => {
      if (!candidate.url) return false
      try {
        const hostname = new URL(candidate.url).hostname
        return hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))
      } catch {
        return false
      }
    }).filter((candidate) => candidate.id)
      .sort((left, right) => (right.lastAccessed ?? 0) - (left.lastAccessed ?? 0))
    if (candidates.length === 0) {
      sessions.push({ platform, state: 'unknown' })
      continue
    }
    const observed = []
    for (const tab of candidates) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'probe-session' })
        const state = ['available', 'login-required', 'access-restricted'].includes(response?.state)
          ? response.state
          : 'unknown'
        observed.push({ platform, state, tabId: tab.id })
      } catch {
        observed.push({ platform, state: 'unknown', tabId: tab.id })
      }
    }
    sessions.push(
      observed.find((session) => session.state === 'available')
      ?? observed.find((session) => session.state === 'access-restricted')
      ?? observed.find((session) => session.state === 'login-required')
      ?? observed[0]
    )
  }
  return sessions
}
