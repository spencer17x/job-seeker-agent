import { cleanup, render, screen } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '@/messages/en.json'
import { createDomainStore } from '@/lib/agent/domain-store'
import { InterviewWorkspace } from './interview-workspace'

afterEach(cleanup)

describe('InterviewWorkspace', () => {
  it('links back to application packets when no submitted application is eligible', async () => {
    const store = createDomainStore({
      databaseName: `interview-workspace-${crypto.randomUUID()}`,
      indexedDB: new IDBFactory()
    })
    render(<NextIntlClientProvider locale="en" messages={en}>
      <InterviewWorkspace store={store} applications={[]} postings={[]} locale="en" onChanged={vi.fn(async () => undefined)} />
    </NextIntlClientProvider>)

    expect(await screen.findByRole('link', { name: 'View application packets' }))
      .toHaveAttribute('href', '/en/jobs/applications')
    await store.close()
  })
})
