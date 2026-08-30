import { z } from 'zod'
import { createAgentErrorResponse, generateAgentText } from '@/lib/agent/openai'
import { AgentOutputError, parseResumeJson } from '@/lib/agent/json'
import { buildParseResumePrompt } from '@/lib/agent/resume-prompts'
import { resumeLocaleSchema } from '@/lib/resume-model'
import { apiErrorResponse, guardAiRequest, type AiRequestGuard } from '@/lib/server/request-guard'
import { readLimitedJson, requestJsonErrorResponse } from '@/lib/server/request-json'

export const MAX_PARSE_TEXT_CHARS = 40_000
const MAX_PARSE_BODY_BYTES = 128_000

const parseResumeRequestSchema = z.object({
  text: z.string().trim().min(1).max(MAX_PARSE_TEXT_CHARS),
  locale: resumeLocaleSchema,
  source: z.enum(['upload', 'paste', 'boss']).default('paste')
}).strict()

export function createResumeParseRoute(dependencies: {
  guard?: AiRequestGuard
  rateLimit?: { limit: number; windowMs: number }
} = {}) {
  const guardRequest = dependencies.guard ?? guardAiRequest
  const rateLimit = dependencies.rateLimit ?? { limit: 12, windowMs: 60_000 }

  return async function resumeParseRoute(request: Request) {
    const guard = guardRequest(request, {
      bucket: 'resume-parse',
      ...rateLimit,
      maxBodyBytes: MAX_PARSE_BODY_BYTES
    })
    if (guard) return guard

    let rawInput: unknown
    try {
      rawInput = await readLimitedJson(request, MAX_PARSE_BODY_BYTES)
    } catch (error) {
      return requestJsonErrorResponse(error) ?? apiErrorResponse('INVALID_REQUEST', 400)
    }

    const input = parseResumeRequestSchema.safeParse(rawInput)
    if (!input.success) return apiErrorResponse('INVALID_REQUEST', 400)

    try {
      const prompt = buildParseResumePrompt(input.data.text, input.data.locale)
      const result = await generateAgentText(prompt.user, {
        system: prompt.system,
        request,
        abortSignal: request.signal,
        maxOutputTokens: 5_000
      })
      const data = parseResumeJson(result.text, {
        locale: input.data.locale,
        source: input.data.source
      })

      return Response.json({ data, model: result.model })
    } catch (error) {
      if (error instanceof AgentOutputError) return apiErrorResponse(error.code, 502)
      return createAgentErrorResponse(error)
    }
  }
}

export const POST = createResumeParseRoute()
