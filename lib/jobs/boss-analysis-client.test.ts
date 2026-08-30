import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveAiProviderPreference } from '@/lib/agent/provider-preference'
import { normalizeResumeData } from '@/lib/resume-model'
import type { JobPosting } from './job-domain'
import { requestBossCandidateAnalysis } from './boss-analysis-client'

const now = '2026-08-29T08:00:00.000Z'
const posting: JobPosting = {
  id: 'posting-local-analysis', sourceId: 'source-boss', externalId: 'boss-local',
  canonicalUrl: 'https://www.zhipin.com/job_detail/boss-local.html',
  applyUrl: 'https://www.zhipin.com/job_detail/boss-local.html',
  title: 'AI Agent工程师', company: '示例公司',
  description: '负责 TypeScript、React 和 RAG Agent 平台开发，要求三年以上全栈经验。',
  locale: 'zh', firstSeenAt: now, lastCheckedAt: now, status: 'open', contentHash: 'hash:boss-local'
}
const resume = normalizeResumeData({
  profile: { name: '测试候选人', title: 'AI 全栈工程师', summary: [], tags: [], links: [] },
  metadata: { source: 'paste', locale: 'zh', updatedAt: now }
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('requestBossCandidateAnalysis', () => {
  it('uses the saved Chrome local provider without calling the cloud route', async () => {
    saveAiProviderPreference({ mode: 'chrome-built-in', allowCloudFallback: false })
    const prompt = vi.fn().mockResolvedValue(JSON.stringify({
      jobTitle: posting.title,
      company: posting.company,
      requirements: [{
        text: '三年以上全栈经验', category: 'experience', priority: 'must', weight: 5,
        keywords: ['全栈']
      }],
      resumeEmphasis: [],
      interviewPrep: []
    }))
    vi.stubGlobal('LanguageModel', {
      availability: vi.fn().mockResolvedValue('available'),
      create: vi.fn().mockResolvedValue({
        contextUsage: 0,
        contextWindow: 32_000,
        measureContextUsage: vi.fn().mockResolvedValue(500),
        prompt,
        destroy: vi.fn()
      })
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(requestBossCandidateAnalysis({ posting, resume, locale: 'zh' })).resolves.toMatchObject({
      targetJob: { title: posting.title, company: posting.company },
      matrix: { requirements: [expect.objectContaining({ text: '三年以上全栈经验' })] }
    })
    expect(prompt).toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
