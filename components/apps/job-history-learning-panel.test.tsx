import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '@/messages/en.json'
import { JobHistoryLearningPanel } from './job-history-learning-panel'

const simulation = {
  version: 1 as const, sampleSize: 20, recommendedMinimumMatchScore: 70,
  recommendedDailyContactLimit: 5, recommendedAutonomy: 'autopilot' as const,
  recommendedAutoSendResume: true,
  signals: { conversations: 20, recruiterReplies: 5, resumeRequests: 2, interviewInvites: 1, offers: 0, rejections: 1, localApplications: 2 },
  reasonCodes: ['reply-observed' as const], simulatedAt: '2026-08-20T08:00:00.000Z'
}
const memory = {
  version: 1 as const,
  enabled: true,
  entries: [{
    id: 'strategy-1',
    appliedAt: '2026-08-20T09:00:00.000Z',
    simulation,
    settings: { minimumMatchScore: 70, dailyContactLimit: 5, autonomy: 'autopilot' as const, autoSendResume: true }
  }]
}

afterEach(cleanup)

describe('JobHistoryLearningPanel', () => {
  it('shows a simulation and applies it only after the user chooses apply', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<NextIntlClientProvider locale="en" messages={en}><JobHistoryLearningPanel
      busy={false}
      simulation={simulation}
      memory={memory}
      exportText={JSON.stringify(memory)}
      onSimulate={vi.fn()} onApply={onApply} onDismiss={vi.fn()}
      onSetEnabled={vi.fn()} onClear={vi.fn()}
    /></NextIntlClientProvider>)
    expect(screen.getByText('History policy simulation')).toBeVisible()
    expect(onApply).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Apply history policy' }))
    expect(onApply).toHaveBeenCalledOnce()
  })

  it('inspects, disables, exports, and confirms clearing strategy memory independently', async () => {
    const user = userEvent.setup()
    const onSetEnabled = vi.fn()
    const onClear = vi.fn()
    render(<NextIntlClientProvider locale="en" messages={en}><JobHistoryLearningPanel
      busy={false} simulation={null} memory={memory} exportText={JSON.stringify(memory)}
      onSimulate={vi.fn()} onApply={vi.fn()} onDismiss={vi.fn()}
      onSetEnabled={onSetEnabled} onClear={onClear}
    /></NextIntlClientProvider>)

    expect(screen.getByText('1 applied versions')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Export memory' })).toHaveAttribute('download', 'job-seeker-agent-strategy-memory.json')
    await user.click(screen.getByRole('button', { name: 'Disable learning' }))
    expect(onSetEnabled).toHaveBeenCalledWith(false)
    await user.click(screen.getByRole('button', { name: 'Clear memory' }))
    expect(onClear).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Clear strategy memory' }))
    expect(onClear).toHaveBeenCalledOnce()
  })
})
