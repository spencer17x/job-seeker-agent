import { aiFetch } from '@/lib/agent/browser-config'
import {
  buildJDRequirementAnalysis,
  JD_MATCH_REPORT_JSON_SCHEMA,
  jdMatchReportSchema,
  type JDRequirementAnalysis
} from '@/lib/agent/jd-report'
import { buildJDMatchPrompt } from '@/lib/agent/prompt'
import { readAiProviderPreference } from '@/lib/agent/provider-preference'
import {
  ChromeBuiltInAiProvider,
  localLanguagePolicyForLocale,
  runPreferredProviderTask,
  type StructuredTaskInput
} from '@/lib/agent/providers'
import type { ResumeData } from '@/lib/resume-model'
import type { JobPosting } from './job-domain'

export class BossAnalysisClientError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'BossAnalysisClientError'
  }
}

export async function requestBossCandidateAnalysis(input: {
  posting: JobPosting
  resume: ResumeData
  locale: 'zh' | 'en'
  signal?: AbortSignal
}): Promise<JDRequirementAnalysis> {
  const prompt = buildJDMatchPrompt(input.posting.description, input.locale)
  const buildAnalysis = (sections: unknown) => {
    const report = jdMatchReportSchema.safeParse(sections)
    if (!report.success) throw new BossAnalysisClientError('AI_OUTPUT_INVALID')
    return buildJDRequirementAnalysis({
      report: {
        ...report.data,
        jobTitle: input.posting.title,
        company: input.posting.company
      },
      jobDescription: input.posting.description,
      locale: input.locale,
      resume: input.resume,
      targetIdentity: input.posting.id
    })
  }
  const task: StructuredTaskInput<JDRequirementAnalysis> = {
    task: {
      kind: 'extract-job-requirements',
      expectedInputLanguages: [input.locale],
      expectedOutputLanguages: [input.locale],
      localLanguagePolicy: localLanguagePolicyForLocale(input.locale)
    },
    system: prompt.system,
    prompt: prompt.user,
    jsonSchema: JD_MATCH_REPORT_JSON_SCHEMA,
    validate: buildAnalysis,
    signal: input.signal
  }
  const result = await runPreferredProviderTask({
    preference: readAiProviderPreference(),
    localProvider: new ChromeBuiltInAiProvider(),
    input: task,
    runCloudTask: async () => {
      const cloud = await requestCloudCandidateAnalysis(input, buildAnalysis)
      return { value: cloud.analysis, provider: 'openai-compatible', model: cloud.model }
    }
  })
  return result.value
}

async function requestCloudCandidateAnalysis(
  input: {
    posting: JobPosting
    resume: ResumeData
    locale: 'zh' | 'en'
    signal?: AbortSignal
  },
  buildAnalysis: (sections: unknown) => JDRequirementAnalysis
) {
  const response = await aiFetch('/api/jd-match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jd: input.posting.description,
      locale: input.locale,
      resume: input.resume,
      targetIdentity: input.posting.id
    }),
    signal: input.signal
  })
  const body = await response.json() as { sections?: unknown; code?: unknown; model?: unknown }
  if (!response.ok) {
    throw new BossAnalysisClientError(typeof body.code === 'string' ? body.code : 'BOSS_ANALYSIS_FAILED')
  }
  return {
    analysis: buildAnalysis(body.sections),
    model: typeof body.model === 'string' ? body.model : 'openai-compatible'
  }
}
