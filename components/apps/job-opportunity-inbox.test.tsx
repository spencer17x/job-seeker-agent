import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { useState, type ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JobPosting, JobRecommendation } from '@/lib/jobs/job-domain'
import en from '@/messages/en.json'
import { JobOpportunityInbox } from './job-opportunity-inbox'

const posting: JobPosting = {
  id: 'job-1', externalId: '1', sourceId: 'source-1',
  canonicalUrl: 'https://www.zhipin.com/job_detail/example.html',
  applyUrl: 'https://www.zhipin.com/job_detail/example.html',
  title: 'Platform Engineer', company: 'Example Systems', location: 'Shanghai',
  description: `${'Build reliable TypeScript platforms.\n'.repeat(30)}Full description ends here.`,
  locale: 'en', workplaceType: 'remote', employmentType: 'full-time',
  status: 'open', contentHash: 'hash:example',
  firstSeenAt: '2026-08-01T08:00:00.000Z', lastCheckedAt: '2026-08-01T08:00:00.000Z'
}
const recommendation: JobRecommendation = {
  id: 'recommendation-1', postingId: posting.id, searchProfileId: 'profile-1', sourceDraftId: 'draft-1',
  decision: 'new', eligibility: 'eligible', preliminaryScore: 80, reasons: [],
  rubricVersion: 'test-v1', inputFingerprint: 'hash:input',
  createdAt: posting.firstSeenAt, updatedAt: posting.lastCheckedAt
}

beforeEach(() => { HTMLElement.prototype.scrollIntoView = vi.fn() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

function renderInbox(overrides: Partial<ComponentProps<typeof JobOpportunityInbox>> = {}) {
  const props: ComponentProps<typeof JobOpportunityInbox> = {
    postings: [posting], recommendationByPosting: new Map([[posting.id, recommendation]]), applicationByPosting: new Map(),
    selectedPostingId: '', onSelect: vi.fn(), filter: 'all', onFilter: vi.fn(),
    ready: true, emptyState: <p>Import trusted evidence first.</p>, canSearch: true, searching: false,
    onSearch: vi.fn(), onCancel: vi.fn(), onAnalyze: vi.fn(async () => undefined), onDecide: vi.fn(async () => undefined),
    managed: false, importAction: <a href="/en/jobs/preferences">Bring back a job</a>, ...overrides
  }
  function Harness() {
    const [selectedPostingId, setSelectedPostingId] = useState(props.selectedPostingId)
    return <JobOpportunityInbox {...props} selectedPostingId={selectedPostingId} onSelect={setSelectedPostingId} />
  }
  return { ...render(<NextIntlClientProvider locale="en" messages={en}><Harness /></NextIntlClientProvider>), props }
}

describe('JobOpportunityInbox', () => {
  it('bounds a large inbox and searches across every page, resetting pagination when cleared', async () => {
    const user = userEvent.setup()
    renderInbox({ postings: Array.from({ length: 45 }, (_, index) => ({ ...posting, id: `job-${index}`, title: `Platform Engineer ${index}` })) })
    const list = screen.getByRole('list', { name: 'Matching opportunities' })
    expect(within(list).getAllByRole('button')).toHaveLength(20)
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByRole('status')).toHaveTextContent('Page 2 of 3')
    expect(screen.getByRole('heading', { name: 'Platform Engineer 20' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(within(list).getAllByRole('button')).toHaveLength(5)
    await user.type(screen.getByRole('searchbox'), 'Engineer 2 Shanghai')
    expect(within(list).getAllByRole('button')).toHaveLength(14)
    expect(screen.getByRole('status')).toHaveTextContent('Page 1 of 1')
    await user.clear(screen.getByRole('searchbox'))
    expect(screen.getByRole('heading', { name: 'Platform Engineer 0' })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Page 1 of 3')
  })

  it('offers a way out of empty search results', async () => {
    const user = userEvent.setup()
    renderInbox()
    await user.type(screen.getByRole('searchbox'), 'no-such-company')
    expect(screen.getByText('No roles match these filters.')).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Platform Engineer' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByRole('heading', { name: 'Platform Engineer' })).toBeVisible()
  })

  it('reveals the complete description and resets expansion when selecting a different role', async () => {
    const user = userEvent.setup()
    renderInbox({ postings: [posting, { ...posting, id: 'job-2', title: 'Backend Engineer' }] })
    expect(screen.queryByText(/Full description ends here/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Read full description' }))
    expect(screen.getByText(/Full description ends here/)).toHaveTextContent('Full description ends here.')
    expect(screen.getByText('Shanghai · Remote · Full-time')).toBeVisible()
    await user.click(within(screen.getByRole('list', { name: 'Matching opportunities' })).getByRole('button', { name: /Backend Engineer/ }))
    expect(screen.getByRole('heading', { name: 'Backend Engineer' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Read full description' })).toHaveAttribute('aria-expanded', 'false')
    await user.click(screen.getByRole('button', { name: 'Back to opportunities' }))
    expect(within(screen.getByRole('list', { name: 'Matching opportunities' })).getByRole('button', { name: /Backend Engineer/ })).toHaveFocus()
  })

  it('keeps details and actions behind trusted evidence readiness', () => {
    renderInbox({ ready: false, canSearch: false })
    expect(screen.getByText('Import trusted evidence first.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Platform Engineer' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Agent now' })).toBeDisabled()
  })

  it('prevents duplicate actions and reports failure while allowing a retry', async () => {
    const user = userEvent.setup()
    let rejectAction: (reason: Error) => void = () => {}
    const onDecide = vi.fn(() => new Promise<void>((_, reject) => { rejectAction = reject }))
    renderInbox({ onDecide })
    await user.dblClick(screen.getByRole('button', { name: 'Save' }))
    expect(onDecide).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await act(async () => rejectAction(new Error('Storage unavailable')))
    expect(screen.getByRole('alert')).toHaveTextContent('This action could not be completed. Please try again.')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('exposes ignored and closed filters, and a cancel action during discovery', async () => {
    const user = userEvent.setup()
    const { props } = renderInbox({ searching: true, postings: [{ ...posting, status: 'closed' }] })
    await user.click(screen.getByRole('button', { name: 'Ignored' }))
    expect(props.onFilter).toHaveBeenCalledWith('ignored')
    await user.click(screen.getByRole('button', { name: 'Closed' }))
    expect(props.onFilter).toHaveBeenCalledWith('closed')
    expect(screen.getByRole('button', { name: 'Confirm interest and prepare application' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Cancel search' }))
    expect(props.onCancel).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Canceling…' })).toBeDisabled()
    expect(screen.getByText('Stopping after the current browser step. Completed local results are kept.')).toBeVisible()
  })
})
