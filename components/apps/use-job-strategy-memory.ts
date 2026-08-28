'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_JOB_STRATEGY_MEMORY,
  JOB_STRATEGY_MEMORY_KEY,
  clearJobStrategyMemory,
  exportJobStrategyMemory,
  parseJobStrategyMemory,
  recordJobStrategyMemory,
  serializeJobStrategyMemory,
  setJobStrategyMemoryEnabled,
  type JobStrategySettings
} from '@/lib/jobs/job-strategy-memory'
import type { JobHistorySimulation } from '@/lib/jobs/job-history-learning'

type StrategyStorage = Pick<Storage, 'getItem' | 'setItem'>

export function useJobStrategyMemory(storageOverride?: StrategyStorage | null) {
  const [memory, setMemory] = useState(DEFAULT_JOB_STRATEGY_MEMORY)

  useEffect(() => {
    const storage = storageOverride === undefined ? browserStorage() : storageOverride
    setMemory(parseJobStrategyMemory(readStorage(storage)))
    if (!storage || typeof window === 'undefined') return
    const onStorage = (event: StorageEvent) => {
      if (event.key === JOB_STRATEGY_MEMORY_KEY) setMemory(parseJobStrategyMemory(event.newValue))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [storageOverride])

  const commit = useCallback((update: (current: typeof memory) => typeof memory) => {
    setMemory((current) => {
      const next = update(current)
      writeStorage(storageOverride === undefined ? browserStorage() : storageOverride, next)
      return next
    })
  }, [storageOverride])

  const record = useCallback((simulation: JobHistorySimulation, settings: JobStrategySettings) => {
    commit((current) => recordJobStrategyMemory({
      memory: current,
      simulation,
      settings,
      appliedAt: new Date().toISOString()
    }))
  }, [commit])

  const setEnabled = useCallback((enabled: boolean) => {
    commit((current) => setJobStrategyMemoryEnabled(current, enabled))
  }, [commit])

  const clear = useCallback(() => {
    commit(clearJobStrategyMemory)
  }, [commit])

  const exportText = useMemo(() => exportJobStrategyMemory(memory), [memory])
  return { memory, record, setEnabled, clear, exportText }
}

function browserStorage(): StrategyStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function readStorage(storage: StrategyStorage | null) {
  try {
    return storage?.getItem(JOB_STRATEGY_MEMORY_KEY) ?? null
  } catch {
    return null
  }
}

function writeStorage(storage: StrategyStorage | null, memory: typeof DEFAULT_JOB_STRATEGY_MEMORY) {
  try {
    storage?.setItem(JOB_STRATEGY_MEMORY_KEY, serializeJobStrategyMemory(memory))
  } catch {
    // Strategy memory remains usable in this tab when persistent storage is unavailable.
  }
}
