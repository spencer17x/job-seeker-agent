import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { careerEvidenceSourceId } from '@/lib/agent/career-evidence'
import { createDomainStore } from '@/lib/agent/domain-store'
import { createResumeDraft, normalizeResumeData } from '@/lib/resume-model'
import { loadJobWorkspaceSnapshot } from './job-workspace'

const now = '2026-08-01T08:00:00.000Z'

describe('job workspace snapshot', () => {
  it('fails closed until the active trusted draft has a persisted evidence source', async () => {
    const store = createDomainStore({
      databaseName: `job-workspace-${crypto.randomUUID()}`,
      indexedDB: new IDBFactory()
    })
    const activeDraft = createResumeDraft(normalizeResumeData({
      profile: { name: 'Ada', title: 'Engineer', summary: ['Builds systems.'], tags: [], links: [] },
      metadata: { source: 'paste', locale: 'en', updatedAt: now }
    }), { id: 'draft-1', source: 'paste', now })

    await expect(loadJobWorkspaceSnapshot({ store, activeDraft })).resolves.toMatchObject({
      evidenceReady: false,
      applications: [],
      packets: [],
      conversationThreads: [],
      conversationMessages: []
    })

    await store.put('evidenceSources', {
      id: careerEvidenceSourceId(activeDraft.id),
      type: 'resume-import',
      label: activeDraft.name,
      createdAt: now
    })
    await expect(loadJobWorkspaceSnapshot({ store, activeDraft, now: () => now })).resolves.toMatchObject({
      evidenceReady: true,
      applications: [],
      packets: []
    })
    await store.close()
  })
})
