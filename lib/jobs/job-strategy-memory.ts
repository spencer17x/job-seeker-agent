import { z } from 'zod'
import { createJobInputFingerprint } from './job-domain'
import { jobHistorySimulationSchema, type JobHistorySimulation } from './job-history-learning'

export const JOB_STRATEGY_MEMORY_KEY = 'job-seeker-agent-job-strategy-memory-v1'
export const MAX_JOB_STRATEGY_MEMORY_ENTRIES = 20

const timestampSchema = z.iso.datetime({ offset: true })
const strategySettingsSchema = z.object({
  minimumMatchScore: z.number().int().min(0).max(100),
  dailyContactLimit: z.number().int().min(1).max(100),
  autonomy: z.enum(['approval', 'autopilot']),
  autoSendResume: z.boolean()
}).strict()

const strategyMemoryEntrySchema = z.object({
  id: z.string().trim().min(1).max(160),
  appliedAt: timestampSchema,
  simulation: jobHistorySimulationSchema,
  settings: strategySettingsSchema
}).strict()

export const jobStrategyMemorySchema = z.object({
  version: z.literal(1),
  enabled: z.boolean(),
  entries: z.array(strategyMemoryEntrySchema).max(MAX_JOB_STRATEGY_MEMORY_ENTRIES)
}).strict()

export type JobStrategySettings = z.infer<typeof strategySettingsSchema>
export type JobStrategyMemoryEntry = z.infer<typeof strategyMemoryEntrySchema>
export type JobStrategyMemory = z.infer<typeof jobStrategyMemorySchema>

export const DEFAULT_JOB_STRATEGY_MEMORY: JobStrategyMemory = {
  version: 1,
  enabled: true,
  entries: []
}

export function parseJobStrategyMemory(serialized: string | null): JobStrategyMemory {
  if (!serialized) return freshDefaultMemory()
  try {
    const parsed = jobStrategyMemorySchema.safeParse(JSON.parse(serialized))
    return parsed.success ? parsed.data : freshDefaultMemory()
  } catch {
    return freshDefaultMemory()
  }
}

export function recordJobStrategyMemory(input: {
  memory: JobStrategyMemory
  simulation: JobHistorySimulation
  settings: JobStrategySettings
  appliedAt: string
}): JobStrategyMemory {
  const memory = jobStrategyMemorySchema.parse(input.memory)
  const simulation = jobHistorySimulationSchema.parse(input.simulation)
  const settings = strategySettingsSchema.parse(input.settings)
  const appliedAt = timestampSchema.parse(input.appliedAt)
  const id = `strategy:${createJobInputFingerprint({ simulation, settings, appliedAt })}`
  const entry = strategyMemoryEntrySchema.parse({ id, appliedAt, simulation, settings })
  return jobStrategyMemorySchema.parse({
    ...memory,
    enabled: true,
    entries: [...memory.entries.filter((item) => item.id !== id), entry]
      .slice(-MAX_JOB_STRATEGY_MEMORY_ENTRIES)
  })
}

export function setJobStrategyMemoryEnabled(memory: JobStrategyMemory, enabled: boolean) {
  return jobStrategyMemorySchema.parse({ ...memory, enabled })
}

export function clearJobStrategyMemory(memory: JobStrategyMemory) {
  return jobStrategyMemorySchema.parse({ ...memory, entries: [] })
}

export function serializeJobStrategyMemory(memory: JobStrategyMemory) {
  return JSON.stringify(jobStrategyMemorySchema.parse(memory))
}

export function exportJobStrategyMemory(memory: JobStrategyMemory) {
  return JSON.stringify(jobStrategyMemorySchema.parse(memory), null, 2)
}

function freshDefaultMemory(): JobStrategyMemory {
  return { ...DEFAULT_JOB_STRATEGY_MEMORY, entries: [] }
}
