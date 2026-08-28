'use client'

import { useCallback, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { IndexedDbDomainStore } from '@/lib/agent/domain-store'
import type { ResumeDraft } from '@/lib/resume-model'
import type { ApplicationRecord } from '@/lib/jobs/job-domain'
import {
  ApplicationRecordError,
  markApplicationApplied,
  prepareApplicationPacket
} from '@/lib/jobs/application-record'
import { ensureBossOpeningDraft } from '@/lib/jobs/boss-conversation'

export function useApplicationController(input: {
  store: IndexedDbDomainStore
  activeDraft: ResumeDraft | null
  enabled: boolean
  applications: ApplicationRecord[]
  reload: () => Promise<void>
  setError: (message: string) => void
  setNotice: (message: string) => void
}) {
  const t = useTranslations('jobRadar')
  const [busyApplicationId, setBusyApplicationId] = useState('')

  const prepare = useCallback(async (recordId: string) => {
    if (!input.activeDraft || !input.enabled) return
    setBusyApplicationId(recordId)
    input.setError('')
    try {
      const now = new Date().toISOString()
      await prepareApplicationPacket({
        store: input.store,
        recordId,
        resume: input.activeDraft.data,
        now
      })
      await ensureBossOpeningDraft({ store: input.store, applicationId: recordId, now })
    } catch (caught) {
      input.setError(caught instanceof ApplicationRecordError && caught.code === 'PACKET_NOT_READY'
        ? t('errors.packet')
        : t('errors.applicationSave'))
    } finally {
      setBusyApplicationId('')
      await input.reload()
    }
  }, [input, t])

  const confirmApplied = useCallback(async (recordId: string) => {
    if (!input.activeDraft || !input.enabled) return
    setBusyApplicationId(recordId)
    input.setError('')
    try {
      await markApplicationApplied({
        store: input.store,
        recordId,
        resume: input.activeDraft.data,
        now: new Date().toISOString()
      })
      input.setNotice(t('applicationConfirmed'))
    } catch {
      input.setError(t('errors.packet'))
    } finally {
      setBusyApplicationId('')
      await input.reload()
    }
  }, [input, t])

  const saveNotes = useCallback(async (recordId: string, notes: string) => {
    const record = input.applications.find((item) => item.id === recordId)
    if (!record || record.notes === notes.trim()) return
    try {
      await input.store.put('applicationRecords', {
        ...record,
        notes: notes.trim(),
        updatedAt: new Date().toISOString()
      })
      await input.reload()
    } catch {
      input.setError(t('errors.applicationSave'))
    }
  }, [input, t])

  return { busyApplicationId, prepare, confirmApplied, saveNotes }
}
