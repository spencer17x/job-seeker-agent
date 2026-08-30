import { z } from 'zod'
import {
  AgentOutputError,
  MAX_NORMALIZED_RESUME_BYTES
} from './json'
import {
  normalizeResumeData,
  resumeDataSchema,
  type ResumeData,
  type ResumeLocale,
  type ResumeSource
} from '@/lib/resume-model'

export const resumeTaskOutputSchema = resumeDataSchema.omit({ metadata: true })

/**
 * Chrome's response constraint only needs the structural JSON Schema. Zod's
 * generated defaults and draft declaration are validation annotations rather
 * than model-output requirements, so omit them from the browser prompt API.
 */
export const RESUME_TASK_JSON_SCHEMA = stripJsonSchemaAnnotations(
  z.toJSONSchema(resumeTaskOutputSchema)
) as Record<string, unknown>

export type DemoResumeTaskInput = {
  locale: ResumeLocale
  targetRole: string
  seniority: 'junior' | 'mid' | 'senior' | 'lead'
  background?: string
}

export function validateParsedResumeTaskOutput(
  input: unknown,
  options: {
    locale: ResumeLocale
    source: Extract<ResumeSource, 'paste' | 'upload' | 'boss'>
  }
): ResumeData {
  return normalizeTaskResume(input, options)
}

export function validateDemoResumeTaskOutput(
  input: unknown,
  options: Pick<DemoResumeTaskInput, 'locale' | 'targetRole'>
): ResumeData {
  let parsed: z.infer<typeof resumeTaskOutputSchema>
  try {
    parsed = resumeTaskOutputSchema.parse(input)
  } catch {
    throw new AgentOutputError('AI_OUTPUT_INVALID')
  }

  return normalizeTaskResume({ ...parsed, targetRole: options.targetRole }, {
    locale: options.locale,
    source: 'ai-generated'
  })
}

function normalizeTaskResume(
  input: unknown,
  options: { locale: ResumeLocale; source: ResumeSource }
) {
  try {
    const parsed = resumeTaskOutputSchema.parse(input)
    const normalized = normalizeResumeData(parsed, options)
    const serializedBytes = new TextEncoder().encode(JSON.stringify(normalized)).byteLength
    if (serializedBytes > MAX_NORMALIZED_RESUME_BYTES) {
      throw new AgentOutputError('AI_OUTPUT_TOO_LARGE')
    }
    return normalized
  } catch (error) {
    if (error instanceof AgentOutputError) throw error
    throw new AgentOutputError('AI_OUTPUT_INVALID')
  }
}

function stripJsonSchemaAnnotations(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripJsonSchemaAnnotations)
  if (typeof value !== 'object' || value === null) return value

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== '$schema' && key !== 'default')
      .map(([key, nested]) => [key, stripJsonSchemaAnnotations(nested)])
  )
}
