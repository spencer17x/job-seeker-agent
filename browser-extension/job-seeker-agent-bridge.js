const REQUEST_EVENT = 'job-seeker-agent:browser-agent:request'
const RESPONSE_EVENT = 'job-seeker-agent:browser-agent:response'
const WAKE_EVENT = 'job-seeker-agent:job-agent:wakeup'
const LEGACY_REQUEST_EVENT = 'resume-os:browser-agent:request'
const LEGACY_RESPONSE_EVENT = 'resume-os:browser-agent:response'
const LEGACY_WAKE_EVENT = 'resume-os:job-agent:wakeup'
const seenRequestIds = new Set()

chrome.runtime.onMessage.addListener((message) => {
  if (message?.action === 'job-agent-wakeup') {
    window.dispatchEvent(new CustomEvent(WAKE_EVENT, { detail: message.cycle }))
    window.dispatchEvent(new CustomEvent(LEGACY_WAKE_EVENT, { detail: message.cycle }))
  }
  return false
})

const reportPageReady = () => chrome.runtime.sendMessage({ action: 'job-agent-page-ready' }).catch(() => undefined)
const isJobAgentPage = /^\/(?:zh|en)\/jobs(?:\/|$)/u.test(location.pathname)
if (isJobAgentPage) {
  if (document.readyState === 'complete') reportPageReady()
  else window.addEventListener('load', reportPageReady, { once: true })
  window.setTimeout(reportPageReady, 2_000)
}

const handleRequest = (event) => {
  const detail = event instanceof CustomEvent ? event.detail : null
  if (!detail || !['detect-platforms', 'collect-boss-jobs', 'collect-boss-job-detail', 'collect-boss-resume', 'search-boss-jobs', 'open-boss-conversation', 'inspect-boss-conversation', 'collect-boss-conversation-signals', 'summarize-boss-history', 'diagnose-boss-adapter', 'send-boss-message', 'send-boss-resume-attachment', 'configure-job-agent', 'get-job-agent-runtime', 'report-job-agent-cycle'].includes(detail.action) || typeof detail.requestId !== 'string') return
  if (seenRequestIds.has(detail.requestId)) return
  seenRequestIds.add(detail.requestId)
  window.setTimeout(() => seenRequestIds.delete(detail.requestId), 30_000)
  chrome.runtime.sendMessage({
    action: detail.action,
    requestId: detail.requestId,
    ...(['collect-boss-job-detail', 'search-boss-jobs', 'open-boss-conversation', 'send-boss-message', 'send-boss-resume-attachment', 'configure-job-agent', 'report-job-agent-cycle'].includes(detail.action) ? { payload: detail.payload } : {})
  }, (response) => {
    const lastError = chrome.runtime.lastError
    const responseDetail = lastError
      ? { requestId: detail.requestId, ok: false, error: 'PROBE_FAILED' }
      : response
    window.dispatchEvent(new CustomEvent(RESPONSE_EVENT, { detail: responseDetail }))
    window.dispatchEvent(new CustomEvent(LEGACY_RESPONSE_EVENT, { detail: responseDetail }))
  })
}

window.addEventListener(REQUEST_EVENT, handleRequest)
window.addEventListener(LEGACY_REQUEST_EVENT, handleRequest)
