import { beforeEach, describe, expect, it, vi } from 'vitest'

const agentMocks = vi.hoisted(() => ({ generateAgentText: vi.fn() }))

vi.mock('@/lib/agent/openai', () => ({
  generateAgentText: agentMocks.generateAgentText,
  createAgentErrorResponse: () => Response.json({
    error: 'AI service is temporarily unavailable.',
    code: 'AI_UNAVAILABLE'
  }, { status: 502 })
}))

import { FixedWindowRateLimiter, createAiRequestGuard } from '@/lib/server/request-guard'
import { MAX_PARSE_TEXT_CHARS, createResumeParseRoute } from './route'

const aiResume = JSON.stringify({
  profile: {
    name: 'Ada Lovelace',
    title: 'AI Engineer',
    summary: ['Builds agent systems'],
    tags: ['AI']
  },
  skills: [{ group: 'AI', items: ['RAG'] }],
  experiences: [],
  projects: []
})

function request(body: unknown) {
  return new Request('http://localhost/api/resume/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

function oversizedChunkedRequest() {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('{"text":"'))
      controller.enqueue(encoder.encode('x'.repeat(128_001)))
      controller.enqueue(encoder.encode('","locale":"en"}'))
      controller.close()
    }
  })
  return new Request('http://localhost/api/resume/parse', {
    method: 'POST',
    body,
    duplex: 'half'
  } as RequestInit)
}

describe('POST /api/resume/parse', () => {
  let post: ReturnType<typeof createResumeParseRoute>

  beforeEach(() => {
    post = createResumeParseRoute({
      guard: createAiRequestGuard({ localOnly: true, limiter: new FixedWindowRateLimiter() })
    })
    agentMocks.generateAgentText.mockReset().mockResolvedValue({
      text: `\`\`\`json\n${aiResume}\n\`\`\``,
      model: 'test-model'
    })
  })

  it.each(['paste', 'upload'] as const)('parses resume text with the explicit %s source', async (source) => {
    const apiRequest = request({ text: 'Ada\nAI Engineer', locale: 'en', source })
    const response = await post(apiRequest)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.model).toBe('test-model')
    expect(body.data.profile.name).toBe('Ada Lovelace')
    expect(body.data.education).toEqual([])
    expect(body.data.metadata).toMatchObject({ locale: 'en', source })
    expect(JSON.parse(agentMocks.generateAgentText.mock.calls[0][0])).toEqual({
      locale: 'en',
      resumeSource: 'Ada\nAI Engineer'
    })
    expect(agentMocks.generateAgentText.mock.calls[0][1]).toEqual(expect.objectContaining({
      system: expect.stringContaining('Return exactly one JSON object'),
      abortSignal: apiRequest.signal,
      maxOutputTokens: 5_000
    }))
  })

  it('defaults the documented two-field request to the paste source', async () => {
    const response = await post(request({ text: 'Ada\nAI Engineer', locale: 'en' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.metadata).toMatchObject({ locale: 'en', source: 'paste' })
  })

  it('accepts the bounded BOSS resume source without weakening invalid-source rejection', async () => {
    const response = await post(request({ text: 'Ada\nAI Engineer', locale: 'en', source: 'boss' }))
    expect(response.status).toBe(200)
    expect((await response.json()).data.metadata).toMatchObject({ locale: 'en', source: 'boss' })
  })

  it('rejects a source outside the trusted resume contract', async () => {
    const response = await post(request({ text: 'resume', locale: 'en', source: 'ai-generated' }))

    expect(response.status).toBe(400)
    expect(agentMocks.generateAgentText).not.toHaveBeenCalled()
  })

  it('rejects cross-origin requests before calling the provider', async () => {
    const response = await post(new Request('http://localhost/api/resume/parse', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://attacker.example',
        'Sec-Fetch-Site': 'cross-site'
      },
      body: JSON.stringify({ text: 'resume', locale: 'en' })
    }))

    expect(response.status).toBe(403)
    expect((await response.json()).code).toBe('AI_PUBLIC_ACCESS_DISABLED')
    expect(agentMocks.generateAgentText).not.toHaveBeenCalled()
  })

  it.each([
    { text: '', locale: 'en', source: 'paste' },
    { text: 'resume', locale: 'fr', source: 'paste' },
    { text: 'x'.repeat(MAX_PARSE_TEXT_CHARS + 1), locale: 'en', source: 'paste' }
  ])('rejects invalid request input', async (body) => {
    const response = await post(request(body))
    expect(response.status).toBe(400)
    expect(agentMocks.generateAgentText).not.toHaveBeenCalled()
  })

  it('returns a sanitized provider error', async () => {
    agentMocks.generateAgentText.mockRejectedValueOnce(new Error('provider secret stack'))

    const response = await post(request({ text: 'Ada resume', locale: 'zh', source: 'paste' }))
    const body = await response.json()

    expect(response.status).toBe(502)
    expect(body.code).toBe('AI_UNAVAILABLE')
    expect(JSON.stringify(body)).not.toContain('provider secret')
  })

  it('returns a stable invalid-output code for malformed AI JSON', async () => {
    agentMocks.generateAgentText.mockResolvedValueOnce({ text: `${aiResume}\ntrailing`, model: 'test-model' })

    const response = await post(request({ text: 'Ada resume', locale: 'zh', source: 'paste' }))

    expect(response.status).toBe(502)
    expect((await response.json()).code).toBe('AI_OUTPUT_INVALID')
  })

  it('rejects an omitted-length chunked JSON body after crossing the byte budget', async () => {
    const response = await post(oversizedChunkedRequest())

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({
      error: 'Request payload is too large.',
      code: 'PAYLOAD_TOO_LARGE'
    })
    expect(agentMocks.generateAgentText).not.toHaveBeenCalled()
  })

  it('enforces its route bucket with deterministic Retry-After', async () => {
    const limitedPost = createResumeParseRoute({
      guard: createAiRequestGuard({
        localOnly: true,
        limiter: new FixedWindowRateLimiter(),
        now: () => 1_000
      }),
      rateLimit: { limit: 1, windowMs: 9_000 }
    })

    expect((await limitedPost(request({ text: 'resume', locale: 'en' }))).status).toBe(200)
    const response = await limitedPost(request({ text: 'resume', locale: 'en' }))

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('9')
    expect((await response.json()).code).toBe('RATE_LIMITED')
  })
})
