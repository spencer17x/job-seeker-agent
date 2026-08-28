import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '@/messages/en.json'
import type { CareerEvidenceService } from '@/lib/agent/career-evidence'
import { createResumeDraft, normalizeResumeData } from '@/lib/resume-model'
import { CareerEvidencePanel } from './career-evidence-panel'

afterEach(cleanup)

describe('CareerEvidencePanel', () => {
  it('retries a missing local evidence import from the trusted draft', async () => {
    const user = userEvent.setup()
    const draft = createResumeDraft(normalizeResumeData({
      profile: { name: 'Ada Candidate', title: 'Engineer', summary: ['Builds systems.'], tags: [], links: [] },
      metadata: { source: 'paste', locale: 'en', updatedAt: '2026-08-01T08:00:00.000Z' }
    }), { id: 'draft-1', name: 'Ada Resume', source: 'paste', now: '2026-08-01T08:00:00.000Z' })
    const evidence = {
      source: { id: 'evidence-1', type: 'resume-import' as const, label: 'Ada Resume', createdAt: '2026-08-01T08:00:00.000Z' },
      facts: []
    }
    const service: CareerEvidenceService = {
      importResume: vi.fn(async () => evidence),
      listForDraft: vi.fn()
        .mockResolvedValueOnce({ source: null, facts: [] })
        .mockResolvedValueOnce(evidence),
      confirmFact: vi.fn(),
      updateFact: vi.fn(),
      deleteFact: vi.fn(),
      assertSourceDraftCanBeDeleted: vi.fn()
    }

    render(<NextIntlClientProvider locale="en" messages={en}>
      <CareerEvidencePanel draft={draft} service={service} refreshVersion={0} notice="" setNotice={vi.fn()} />
    </NextIntlClientProvider>)

    await user.click(await screen.findByRole('button', { name: 'Retry local evidence import' }))
    expect(service.importResume).toHaveBeenCalledWith({ draftId: draft.id, label: draft.name, data: draft.data })
    expect(await screen.findByText('Ada Resume')).toBeVisible()
  })
})
