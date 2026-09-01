import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it } from 'vitest'
import type { ApplicationRecord, JobPosting, JobRecommendation } from '@/lib/jobs/job-domain'
import en from '@/messages/en.json'
import { JobLifecycleCommandCenter } from './job-lifecycle-command-center'

const now = '2026-09-01T08:00:00.000Z'
const posting: JobPosting = {
  id: 'posting-1', sourceId: 'source-1', externalId: 'boss-1',
  canonicalUrl: 'https://www.zhipin.com/job_detail/boss-1.html',
  applyUrl: 'https://www.zhipin.com/job_detail/boss-1.html',
  title: 'AI Platform Engineer', company: 'Example Systems', description: 'Build reliable AI platforms.',
  locale: 'en', location: 'Shanghai', firstSeenAt: now, lastCheckedAt: now,
  status: 'open', contentHash: 'hash:posting-1'
}
const recommendation: JobRecommendation = {
  id: 'recommendation-1', postingId: posting.id, searchProfileId: 'profile-1', sourceDraftId: 'draft-1',
  rubricVersion: 'job-seeker-agent-job-relevance-v1', inputFingerprint: 'fingerprint:recommendation-1',
  eligibility: 'eligible', preliminaryScore: 91, reasons: [], createdAt: now, updatedAt: now
}
const application: ApplicationRecord = {
  id: 'application-1', postingId: posting.id, sourceDraftId: 'draft-1', status: 'ready-to-apply',
  resumeVariantId: 'variant-1', notes: '', createdAt: now, updatedAt: now
}

describe('JobLifecycleCommandCenter', () => {
  it('summarizes the managed lifecycle and reveals a bounded audit detail', async () => {
    const user = userEvent.setup()
    render(<NextIntlClientProvider locale="en" messages={en}>
      <JobLifecycleCommandCenter
        applications={[application]}
        postings={[posting]}
        recommendations={[recommendation]}
        threads={[]}
        messages={[]}
      />
    </NextIntlClientProvider>)

    expect(screen.getByRole('list', { name: 'Managed opportunity lifecycle' })).toHaveTextContent('Discover1Match1Resume1Conversation0Apply0Interview0')
    expect(screen.getByRole('table', { name: 'Managed job-search progress' })).toHaveTextContent('AI Platform Engineer')
    expect(screen.getByText('91% match')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Expand managed details for AI Platform Engineer' }))
    expect(screen.getByText('State and platform receipts are synchronized')).toBeVisible()
    expect(screen.getByText('Recruiter identity will be verified before outreach')).toBeVisible()
  })
})
