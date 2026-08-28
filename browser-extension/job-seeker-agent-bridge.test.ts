import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

describe('JobSeeker Agent page bridge', () => {
  it('reports scheduler readiness only from the localized Job Agent workspace', () => {
    const jobs = loadBridge('/en/jobs/opportunities')
    expect(jobs.sendMessage).toHaveBeenCalledWith({ action: 'job-agent-page-ready' })

    const studio = loadBridge('/en/studio')
    expect(studio.sendMessage).not.toHaveBeenCalled()
  })
})

function loadBridge(pathname: string) {
  const sendMessage = vi.fn(() => Promise.resolve())
  const windowObject = {
    addEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    setTimeout: vi.fn()
  }
  const chrome = {
    runtime: {
      lastError: undefined,
      onMessage: { addListener: vi.fn() },
      sendMessage
    }
  }
  runInNewContext(readFileSync('browser-extension/job-seeker-agent-bridge.js', 'utf8'), {
    chrome,
    document: { readyState: 'complete' },
    location: { pathname },
    window: windowObject,
    CustomEvent
  })
  return { sendMessage, windowObject }
}
