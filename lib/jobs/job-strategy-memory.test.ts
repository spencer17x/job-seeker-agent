import { describe, expect, it } from 'vitest'
import type { JobHistorySimulation } from './job-history-learning'
import {
  DEFAULT_JOB_STRATEGY_MEMORY,
  MAX_JOB_STRATEGY_MEMORY_ENTRIES,
  clearJobStrategyMemory,
  exportJobStrategyMemory,
  parseJobStrategyMemory,
  recordJobStrategyMemory,
  serializeJobStrategyMemory,
  setJobStrategyMemoryEnabled
} from './job-strategy-memory'

const simulation: JobHistorySimulation = {
  version: 1,
  sampleSize: 20,
  recommendedMinimumMatchScore: 70,
  recommendedDailyContactLimit: 5,
  recommendedAutonomy: 'autopilot',
  recommendedAutoSendResume: true,
  signals: { conversations: 20, recruiterReplies: 5, resumeRequests: 2, interviewInvites: 1, offers: 0, rejections: 1, localApplications: 2 },
  reasonCodes: ['reply-observed'],
  simulatedAt: '2026-08-20T08:00:00.000Z'
}
const settings = {
  minimumMatchScore: 70,
  dailyContactLimit: 5,
  autonomy: 'autopilot' as const,
  autoSendResume: true
}

describe('job strategy memory', () => {
  it('fails closed to an empty default for missing or invalid storage', () => {
    expect(parseJobStrategyMemory(null)).toEqual(DEFAULT_JOB_STRATEGY_MEMORY)
    expect(parseJobStrategyMemory('{"enabled":"yes"}')).toEqual(DEFAULT_JOB_STRATEGY_MEMORY)
  })

  it('keeps a bounded, versioned history of explicitly applied simulations', () => {
    let memory = DEFAULT_JOB_STRATEGY_MEMORY
    for (let index = 0; index < MAX_JOB_STRATEGY_MEMORY_ENTRIES + 2; index += 1) {
      memory = recordJobStrategyMemory({
        memory,
        simulation,
        settings,
        appliedAt: new Date(Date.parse('2026-08-20T09:00:00.000Z') + index * 1_000).toISOString()
      })
    }
    expect(memory.entries).toHaveLength(MAX_JOB_STRATEGY_MEMORY_ENTRIES)
    expect(parseJobStrategyMemory(serializeJobStrategyMemory(memory))).toEqual(memory)
    expect(JSON.parse(exportJobStrategyMemory(memory))).toEqual(memory)
  })

  it('disables and clears strategy memory without changing the stored preference snapshot', () => {
    const recorded = recordJobStrategyMemory({
      memory: DEFAULT_JOB_STRATEGY_MEMORY,
      simulation,
      settings,
      appliedAt: '2026-08-20T09:00:00.000Z'
    })
    const disabled = setJobStrategyMemoryEnabled(recorded, false)
    expect(disabled).toMatchObject({ enabled: false, entries: [{ settings }] })
    expect(clearJobStrategyMemory(disabled)).toEqual({ version: 1, enabled: false, entries: [] })
  })
})
