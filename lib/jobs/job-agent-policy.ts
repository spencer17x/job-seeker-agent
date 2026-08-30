import { z } from 'zod'

export const JOB_AGENT_PLATFORM_IDS = [
  'boss'
] as const

const legacyJobAgentPlatformIdSchema = z.enum([
  'greenhouse', 'lever', 'boss', '51job', 'lagou', 'liepin', 'linkedin', 'indeed', '58'
])

export const jobAgentPlatformIdSchema = z.enum(JOB_AGENT_PLATFORM_IDS)
export type JobAgentPlatformId = z.infer<typeof jobAgentPlatformIdSchema>

export const jobAgentAutonomySchema = z.enum(['copilot', 'approval', 'autopilot'])
export type JobAgentAutonomy = z.infer<typeof jobAgentAutonomySchema>

export type JobAgentPlatformDefinition = {
  id: JobAgentPlatformId
  discovery: 'built-in' | 'official-search' | 'connector-required'
  communication: 'connector-required' | 'partner-required'
}

export const jobAgentPlatformRegistry = {
  boss: { id: 'boss', discovery: 'official-search', communication: 'partner-required' }
} as const satisfies Record<JobAgentPlatformId, JobAgentPlatformDefinition>

export const jobAgentPreferencesSchema = z.object({
  version: z.literal(2),
  enabled: z.boolean(),
  autonomy: jobAgentAutonomySchema,
  platforms: z.array(jobAgentPlatformIdSchema).max(JOB_AGENT_PLATFORM_IDS.length),
  learnFromReplies: z.boolean(),
  learnFromOutcomes: z.boolean(),
  minimumMatchScore: z.number().int().min(0).max(100),
  dailyContactLimit: z.number().int().min(1).max(100),
  autoSendResume: z.boolean()
})

const persistedJobAgentPreferencesSchema = jobAgentPreferencesSchema.extend({
  version: z.union([z.literal(1), z.literal(2)]),
  platforms: z.array(legacyJobAgentPlatformIdSchema).max(9),
  minimumMatchScore: jobAgentPreferencesSchema.shape.minimumMatchScore.optional(),
  dailyContactLimit: jobAgentPreferencesSchema.shape.dailyContactLimit.optional(),
  autoSendResume: jobAgentPreferencesSchema.shape.autoSendResume.optional()
})

export type JobAgentPreferences = z.infer<typeof jobAgentPreferencesSchema>

export const DEFAULT_JOB_AGENT_PREFERENCES: JobAgentPreferences = {
  version: 2,
  enabled: false,
  autonomy: 'autopilot',
  platforms: [...JOB_AGENT_PLATFORM_IDS],
  learnFromReplies: true,
  learnFromOutcomes: true,
  minimumMatchScore: 70,
  dailyContactLimit: 20,
  autoSendResume: true
}

export const JOB_AGENT_PREFERENCES_KEY = 'job-seeker-agent:job-agent-preferences:v1'
export const LEGACY_JOB_AGENT_PREFERENCES_KEY = 'resume-os:job-agent-preferences:v1'

export function parseJobAgentPreferences(value: string | null): JobAgentPreferences {
  if (!value) return DEFAULT_JOB_AGENT_PREFERENCES
  try {
    const parsed = persistedJobAgentPreferencesSchema.safeParse(JSON.parse(value))
    if (!parsed.success) return DEFAULT_JOB_AGENT_PREFERENCES
    const platforms = [...new Set(parsed.data.platforms)]
      .filter((platform): platform is JobAgentPlatformId => (
        JOB_AGENT_PLATFORM_IDS.includes(platform as JobAgentPlatformId)
      ))
    return {
      ...parsed.data,
      version: 2,
      autonomy: 'autopilot',
      platforms: platforms.length ? platforms : [...JOB_AGENT_PLATFORM_IDS],
      minimumMatchScore: parsed.data.minimumMatchScore ?? DEFAULT_JOB_AGENT_PREFERENCES.minimumMatchScore,
      dailyContactLimit: parsed.data.dailyContactLimit ?? DEFAULT_JOB_AGENT_PREFERENCES.dailyContactLimit,
      autoSendResume: true
    }
  } catch {
    return DEFAULT_JOB_AGENT_PREFERENCES
  }
}

export function serializeJobAgentPreferences(preferences: JobAgentPreferences) {
  return JSON.stringify(jobAgentPreferencesSchema.parse(preferences))
}

export function canExecuteJobAgentAction(input: {
  action: 'discover' | 'draft-message' | 'send-message' | 'submit-application'
  preferences: JobAgentPreferences
  connectorAuthorized?: boolean
}) {
  if (!input.preferences.enabled || input.preferences.platforms.length === 0) return false
  if (input.action === 'discover') return true
  if (input.action === 'draft-message') return input.preferences.autonomy !== 'copilot'
  if (input.action === 'submit-application') return false
  return input.preferences.autonomy === 'autopilot' && input.connectorAuthorized === true
}
