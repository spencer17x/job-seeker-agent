import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { JOB_STRATEGY_MEMORY_KEY, parseJobStrategyMemory } from '@/lib/jobs/job-strategy-memory'
import { useJobStrategyMemory } from './use-job-strategy-memory'

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

describe('useJobStrategyMemory', () => {
  it('persists applied versions and keeps disable and clear operations independent', async () => {
    const storage = new MemoryStorage()
    const { result } = renderHook(() => useJobStrategyMemory(storage))
    await waitFor(() => expect(result.current.memory.entries).toHaveLength(0))

    act(() => result.current.record({
      version: 1,
      sampleSize: 4,
      recommendedMinimumMatchScore: 70,
      recommendedDailyContactLimit: 5,
      recommendedAutonomy: 'approval',
      recommendedAutoSendResume: false,
      signals: { conversations: 4, recruiterReplies: 1, resumeRequests: 0, interviewInvites: 0, offers: 0, rejections: 0, localApplications: 1 },
      reasonCodes: ['reply-observed'],
      simulatedAt: '2026-08-20T08:00:00.000Z'
    }, {
      minimumMatchScore: 70,
      dailyContactLimit: 5,
      autonomy: 'approval',
      autoSendResume: false
    }))
    expect(parseJobStrategyMemory(storage.getItem(JOB_STRATEGY_MEMORY_KEY)).entries).toHaveLength(1)

    act(() => result.current.setEnabled(false))
    expect(parseJobStrategyMemory(storage.getItem(JOB_STRATEGY_MEMORY_KEY)).enabled).toBe(false)
    act(() => result.current.clear())
    expect(parseJobStrategyMemory(storage.getItem(JOB_STRATEGY_MEMORY_KEY))).toMatchObject({
      enabled: false,
      entries: []
    })
  })
})
