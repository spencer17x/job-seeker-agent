import { act, renderHook } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import en from '@/messages/en.json'
import { createDomainStore } from '@/lib/agent/domain-store'
import type { ApplicationRecord, JobPosting, JobSource } from '@/lib/jobs/job-domain'
import { useApplicationController } from './use-application-controller'

const now = '2026-08-01T08:00:00.000Z'

describe('useApplicationController', () => {
  it('saves application notes through the scoped application controller', async () => {
    const store = createDomainStore({
      databaseName: `application-controller-${crypto.randomUUID()}`,
      indexedDB: new IDBFactory()
    })
    const source: JobSource = { id: 'source-1', kind: 'manual', label: 'BOSS', enabled: true, createdAt: now, updatedAt: now }
    const posting: JobPosting = {
      id: 'posting-1', sourceId: source.id, externalId: 'one',
      canonicalUrl: 'https://www.zhipin.com/job_detail/one.html',
      applyUrl: 'https://www.zhipin.com/job_detail/one.html',
      title: 'Engineer', company: 'Example', description: 'Build systems.', locale: 'en',
      firstSeenAt: now, lastCheckedAt: now, status: 'open', contentHash: 'hash:one'
    }
    const application: ApplicationRecord = {
      id: 'application-1', postingId: posting.id, sourceDraftId: 'draft-1',
      status: 'saved', notes: '', createdAt: now, updatedAt: now
    }
    await store.put('jobSources', source)
    await store.put('jobPostings', posting)
    await store.put('applicationRecords', application)
    const reload = vi.fn(async () => undefined)
    const wrapper = ({ children }: { children: ReactNode }) => (
      <NextIntlClientProvider locale="en" messages={en}>{children}</NextIntlClientProvider>
    )
    const { result } = renderHook(() => useApplicationController({
      store, activeDraft: null, enabled: false, applications: [application], reload,
      setError: vi.fn(), setNotice: vi.fn()
    }), { wrapper })

    await act(() => result.current.saveNotes(application.id, 'Follow up Friday'))
    expect(await store.get('applicationRecords', application.id)).toMatchObject({ notes: 'Follow up Friday' })
    expect(reload).toHaveBeenCalledOnce()
    await store.close()
  })
})
