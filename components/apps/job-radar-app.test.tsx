import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { IDBFactory } from 'fake-indexeddb'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResumeDraftProviderCore } from '@/components/resume-draft-provider'
import { createDomainStore, type IndexedDbDomainStore } from '@/lib/agent/domain-store'
import { careerEvidenceSourceId } from '@/lib/agent/career-evidence'
import type { JobPosting, JobSearchProfile, JobSource } from '@/lib/jobs/job-domain'
import { scoreJobRecommendation } from '@/lib/jobs/job-recommendation'
import type { JobSourceAdapter } from '@/lib/jobs/sources'
import { createResumeDraft, normalizeResumeData } from '@/lib/resume-model'
import { writeDraftState } from '@/lib/resume-store'
import { createBossConversationThread, createBossMessageDraft } from '@/lib/jobs/boss-conversation'
import { BROWSER_AGENT_REQUEST_EVENT, BROWSER_AGENT_RESPONSE_EVENT, JOB_AGENT_WAKE_EVENT } from '@/lib/jobs/browser-agent-protocol'
import en from '@/messages/en.json'
import { BossConversationQueue, JobRadarApp } from './job-radar-app'

let mockPathname = '/jobs'

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
  usePathname: () => mockPathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() })
}))

const now = '2026-08-01T08:00:00.000Z'
const stores: IndexedDbDomainStore[] = []

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

const resume = normalizeResumeData({
  profile: { name: 'Ada Candidate', title: 'Platform Engineer', summary: [], tags: ['TypeScript'], links: [] },
  skills: [{ category: 'Engineering', items: ['TypeScript'] }],
  experiences: [], projects: [], education: [], certifications: [], awards: [], languages: [], openSource: [],
  metadata: { source: 'paste', locale: 'en', updatedAt: now }
})

const source: JobSource = {
  id: 'job-source-example', kind: 'greenhouse', label: 'Example', sourceKey: 'example',
  enabled: true, createdAt: now, updatedAt: now
}

const profile: JobSearchProfile = {
  id: 'job-profile-platform', name: 'Platform roles', titles: ['Platform Engineer'],
  adjacentTitles: [], locations: [], excludedLocations: [], workplaceTypes: [], employmentTypes: [],
  requiredTerms: [], preferredTerms: ['TypeScript'], excludedTerms: [], maximumAgeDays: 30,
  createdAt: now, updatedAt: now
}

const posting: JobPosting = {
  id: 'job-posting-example-1', sourceId: source.id, externalId: '1',
  canonicalUrl: 'https://boards.greenhouse.io/example/jobs/1',
  applyUrl: 'https://boards.greenhouse.io/example/jobs/1',
  title: 'Platform Engineer', company: 'Example Co', description: 'Build TypeScript platforms.',
  locale: 'en', location: 'Remote', workplaceType: 'remote',
  firstSeenAt: now, lastCheckedAt: now, status: 'open', contentHash: 'hash:example-1'
}

function createStore() {
  const store = createDomainStore({
    databaseName: `job-radar-component-${crypto.randomUUID()}`,
    indexedDB: new IDBFactory()
  })
  stores.push(store)
  return store
}

function draftStorage() {
  const storage = new MemoryStorage()
  const draft = createResumeDraft(resume, { id: 'ada-draft', name: 'Ada Resume', source: 'paste' })
  writeDraftState(storage, { activeDraftId: draft.id, drafts: [draft] })
  return storage
}

async function trustedStorage(store: IndexedDbDomainStore) {
  await store.put('evidenceSources', {
    id: careerEvidenceSourceId('ada-draft'),
    type: 'resume-import',
    label: 'Ada Resume',
    createdAt: now
  })
  return draftStorage()
}

function renderRadar(options: {
  store: IndexedDbDomainStore
  storage?: MemoryStorage | null
  createAdapter?: (kind: 'greenhouse' | 'lever') => JobSourceAdapter
}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ResumeDraftProviderCore locale="en" storage={options.storage ?? null}>
        <JobRadarApp store={options.store} createAdapter={options.createAdapter} />
      </ResumeDraftProviderCore>
    </NextIntlClientProvider>
  )
}

afterEach(async () => {
  cleanup()
  mockPathname = '/jobs'
  delete document.documentElement.dataset.theme
  window.localStorage.clear()
  await Promise.all(stores.splice(0).map((store) => store.close()))
})

describe('JobRadarApp', () => {
  it('keeps the workspace on its accessible light theme boundary', async () => {
    document.documentElement.dataset.theme = 'dark'
    const store = createStore()
    const { container } = renderRadar({ store })

    expect(await screen.findByRole('heading', { name: 'Complete job setup first' })).toBeVisible()
    expect(container.querySelector('.job-workspace')).toHaveAttribute('data-ui-theme', 'light')
  })

  it('shows the local-first empty state with only BOSS Zhipin', async () => {
    mockPathname = '/jobs/opportunities'
    const store = createStore()
    renderRadar({ store })

    expect(await screen.findByText('Import or paste a trusted resume before matching jobs.')).toBeVisible()
    expect(screen.getByRole('navigation', { name: 'Job workspace navigation' })).toBeVisible()
    expect(screen.queryByText('Greenhouse')).not.toBeInTheDocument()
    expect(screen.queryByText('Lever')).not.toBeInTheDocument()
  })

  it('blocks matching when a trusted draft has no persisted Career Evidence', async () => {
    mockPathname = '/jobs/opportunities'
    const store = createStore()
    renderRadar({ store, storage: draftStorage() })

    expect(await screen.findByText(/Career Evidence is not saved locally/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Repair Career Evidence' })).toHaveAttribute('href', '/en/jobs/profile')
    expect(screen.getByRole('button', { name: 'Run Agent now' })).toBeDisabled()
  })

  it('offers a route back to opportunities when no application packet exists', async () => {
    mockPathname = '/jobs/applications'
    const store = createStore()
    renderRadar({ store })

    expect(await screen.findByText(/No application packet exists yet/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Browse opportunities' })).toHaveAttribute('href', '/en/jobs/opportunities')
  })

  it('derives the initial BOSS search preferences from the resume', async () => {
    mockPathname = '/jobs/preferences'
    const user = userEvent.setup()
    const store = createStore()
    const createAdapter = (kind: 'greenhouse' | 'lever'): JobSourceAdapter => ({
      kind,
      validateSourceKey: (value) => value,
      recognizeUrl: () => null,
      async refresh({ source }) {
        return {
          sourceId: source.id,
          completeness: 'complete',
          checkedAt: now,
          postings: [{
            ...posting,
            id: `posting-${source.id}`,
            sourceId: source.id,
            externalId: `external-${source.sourceKey}`,
            title: `${source.label} Platform Engineer`,
            company: source.label,
            contentHash: `hash:${source.id}`
          }],
          warnings: []
        }
      }
    })
    renderRadar({ store, storage: await trustedStorage(store), createAdapter })

    expect(await screen.findByDisplayValue('Platform Engineer')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Save profile' }))
    expect(await screen.findByText('Search profile saved and current jobs rescored.')).toBeVisible()
    expect(await store.list('jobSources')).toHaveLength(0)
    expect(await store.list('jobPostings')).toHaveLength(0)
    expect((await store.list('jobSearchProfiles'))[0]).toMatchObject({
      platforms: ['boss'],
      titles: ['Platform Engineer']
    })
  })

  it('requires saved job requirements before the Agent can start', async () => {
    const store = createStore()
    renderRadar({ store, storage: await trustedStorage(store) })

    expect(await screen.findByRole('heading', { name: 'Complete job setup first' })).toBeVisible()
    expect(screen.getByRole('navigation', { name: 'Job workspace navigation' }).querySelectorAll('a')).toHaveLength(7)
    expect(screen.getByRole('link', { name: /Start setup/ })).toHaveAttribute('href', '/en/jobs/setup')
    expect(screen.queryByRole('button', { name: 'Start Agent' })).not.toBeInTheDocument()
  })

  it('shows content-free BOSS adapter diagnostics in preferences', async () => {
    mockPathname = '/jobs/preferences'
    const store = createStore()
    const respond = (event: Event) => {
      const request = (event as CustomEvent<{ requestId: string; action: string }>).detail
      window.dispatchEvent(new CustomEvent(BROWSER_AGENT_RESPONSE_EVENT, { detail: {
        requestId: request.requestId,
        ok: true,
        ...(request.action === 'detect-platforms'
          ? { sessions: [{ platform: 'boss', state: 'available' }] }
          : request.action === 'diagnose-boss-adapter'
            ? { diagnostics: [{
                pageKind: 'chat', frameId: 0, sessionState: 'available',
                counts: { jobLinks: 0, editors: 1, sendControls: 1, recipientIdentities: 1, conversationIdentities: 1, recipientNames: 1, docxInputs: 1, pdfInputs: 1, messageReceipts: 2, attachmentReceipts: 1, incomingMessages: 2 },
                ready: { discovery: false, conversation: true, messageSend: true, resumeUpload: true }
              }] }
            : request.action === 'collect-boss-conversation-signals'
              ? { conversationSignals: [] }
              : { jobs: [] })
      } }))
    }
    window.addEventListener(BROWSER_AGENT_REQUEST_EVENT, respond)
    try {
      renderRadar({ store, storage: await trustedStorage(store) })
      expect(await screen.findByRole('heading', { name: 'BOSS adapter diagnostics' })).toBeVisible()
      expect(await screen.findByText('Conversation page')).toBeVisible()
      expect(screen.getByText('PDF resume upload selectors')).toBeVisible()
      expect(screen.getByText(/PDF inputs 1/)).toBeVisible()
    } finally {
      window.removeEventListener(BROWSER_AGENT_REQUEST_EVENT, respond)
    }
  })

  it('starts only after requirements are saved and the user explicitly starts it', async () => {
    const user = userEvent.setup()
    const store = createStore()
    await store.put('jobSearchProfiles', { ...profile, platforms: ['boss'] })
    renderRadar({ store, storage: await trustedStorage(store) })

    expect(await screen.findByRole('heading', { name: 'Agent is paused' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Start Agent' }))
    expect(await screen.findByRole('heading', { name: 'Agent is ready' })).toBeVisible()
    expect(JSON.parse(window.localStorage.getItem('job-seeker-agent:job-agent-preferences:v1') ?? '{}'))
      .toMatchObject({ enabled: true })
  })

  it('preserves an enabled Agent preference while hydrating after refresh', async () => {
    const store = createStore()
    await store.put('jobSearchProfiles', { ...profile, platforms: ['boss'] })
    window.localStorage.setItem('job-seeker-agent:job-agent-preferences:v1', JSON.stringify({
      version: 1,
      enabled: true,
      autonomy: 'autopilot',
      platforms: ['boss'],
      learnFromReplies: true,
      learnFromOutcomes: true,
      minimumMatchScore: 70,
      dailyContactLimit: 20,
      autoSendResume: true
    }))

    renderRadar({ store, storage: await trustedStorage(store) })

    expect(await screen.findByRole('heading', { name: 'Agent is ready' })).toBeVisible()
    await waitFor(() => expect(JSON.parse(
      window.localStorage.getItem('job-seeker-agent:job-agent-preferences:v1') ?? '{}'
    )).toMatchObject({ enabled: true, autonomy: 'autopilot' }))
  })

  it('migrates the legacy Resume OS Agent preference key', async () => {
    const store = createStore()
    await store.put('jobSearchProfiles', { ...profile, platforms: ['boss'] })
    window.localStorage.setItem('resume-os:job-agent-preferences:v1', JSON.stringify({
      version: 1, enabled: true, autonomy: 'autopilot', platforms: ['boss'],
      learnFromReplies: true, learnFromOutcomes: true
    }))
    renderRadar({ store, storage: await trustedStorage(store) })
    expect(await screen.findByRole('heading', { name: 'Agent is ready' })).toBeVisible()
    expect(window.localStorage.getItem('job-seeker-agent:job-agent-preferences:v1')).not.toBeNull()
  })

  it('automatically searches the first three configured BOSS title types', async () => {
    const store = createStore()
    await store.put('jobSearchProfiles', {
      ...profile,
      platforms: ['boss'],
      titles: ['Platform Engineer', 'Backend Engineer', 'AI Engineer', 'Fourth Role']
    })
    window.localStorage.setItem('job-seeker-agent:job-agent-preferences:v1', JSON.stringify({
      version: 1,
      enabled: true,
      autonomy: 'autopilot',
      platforms: ['boss'],
      learnFromReplies: true,
      learnFromOutcomes: true
    }))
    const queries: string[] = []
    const configured: boolean[] = []
    const respond = (event: Event) => {
      const request = (event as CustomEvent<{ requestId: string; action: string; payload?: { query?: string; enabled?: boolean } }>).detail
      if (request.action === 'search-boss-jobs' && request.payload?.query) queries.push(request.payload.query)
      if (request.action === 'configure-job-agent') configured.push(request.payload?.enabled === true)
      window.dispatchEvent(new CustomEvent(BROWSER_AGENT_RESPONSE_EVENT, { detail: {
        requestId: request.requestId,
        ok: true,
        ...(request.action === 'detect-platforms' ? { sessions: [{ platform: 'boss', state: 'available' }] } : { jobs: [] })
      } }))
    }
    window.addEventListener(BROWSER_AGENT_REQUEST_EVENT, respond)
    try {
      renderRadar({ store, storage: await trustedStorage(store) })
      await waitFor(() => expect(configured).toContain(true), { timeout: 5_000 })
      await waitFor(() => expect(screen.getByText(/Platform Engineer.*Backend Engineer/)).toBeVisible())
      window.dispatchEvent(new CustomEvent(JOB_AGENT_WAKE_EVENT, { detail: {
        id: 'cycle-test', scheduledAt: now, reason: 'scheduled', missedIntervals: 0, attempt: 1
      } }))
      await waitFor(() => expect(queries).toEqual([
        'Platform Engineer', 'Backend Engineer', 'AI Engineer'
      ]), { timeout: 5_000 })
    } finally {
      window.removeEventListener(BROWSER_AGENT_REQUEST_EVENT, respond)
    }
  }, 10_000)

  it('shows scored jobs and preserves a saved application when ignored later', async () => {
    mockPathname = '/jobs/opportunities'
    const user = userEvent.setup()
    const store = createStore()
    await store.put('jobSources', source)
    await store.put('jobSearchProfiles', profile)
    await store.put('jobPostings', posting)
    await store.put('jobRecommendations', scoreJobRecommendation({
      posting,
      profile,
      sourceDraftId: 'ada-draft',
      facts: [],
      now
    }))
    renderRadar({ store, storage: await trustedStorage(store) })

    expect(await screen.findByRole('heading', { name: 'Platform Engineer' })).toBeVisible()
    expect(screen.getAllByText(/\d+%/).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(async () => expect((await store.list('applicationRecords'))[0]?.status).toBe('saved'))
    await user.click(screen.getByRole('button', { name: 'Ignore' }))
    await waitFor(async () => expect((await store.list('jobRecommendations'))[0]?.decision).toBe('ignored'))
    expect(await store.list('applicationRecords')).toHaveLength(1)
  })

})

describe('BossConversationQueue', () => {
  it('renders evidence-linked drafts and surfaces review edits', async () => {
    const user = userEvent.setup()
    const onRevise = vi.fn()
    const onVerify = vi.fn()
    const onSend = vi.fn()
    const thread = createBossConversationThread({ applicationId: 'application-1', now })
    const message = createBossMessageDraft({
      threadId: thread.id, kind: 'opener', body: 'Hello BOSS', evidenceFactIds: ['fact-1'], now
    })
    render(<NextIntlClientProvider locale="en" messages={en}>
      <BossConversationQueue
        threads={[thread]}
        messages={[message]}
        applications={[{
          id: 'application-1', postingId: posting.id, sourceDraftId: 'ada-draft', status: 'ready-to-apply',
          targetJobId: 'target-1', resumeVariantId: 'variant-1', notes: '', createdAt: now, updatedAt: now
        }]}
        postings={[posting]}
        onRevise={onRevise}
        onVerify={onVerify}
        onSend={onSend}
      />
    </NextIntlClientProvider>)
    expect(screen.getByText('Waiting for browser verification of the BOSS recipient')).toBeVisible()
    expect(screen.getByText('Linked career evidence: 1')).toBeVisible()
    const editor = screen.getByRole('textbox', { name: 'Outbound message' })
    await user.clear(editor)
    await user.type(editor, 'Revised opener')
    await user.tab()
    expect(onRevise).toHaveBeenCalledWith(message.id, 'Revised opener')
    await user.click(screen.getByRole('button', { name: 'Verify recipient and approve' }))
    expect(onVerify).toHaveBeenCalledWith(message.id)
  })

  it('shows managed queue progress instead of per-message approval controls', () => {
    const thread = createBossConversationThread({ applicationId: 'application-1', now })
    const message = createBossMessageDraft({
      threadId: thread.id, kind: 'opener', body: 'Hello BOSS', evidenceFactIds: [], now
    })
    render(<NextIntlClientProvider locale="en" messages={en}>
      <BossConversationQueue
        managed
        threads={[thread]}
        messages={[message]}
        applications={[{
          id: 'application-1', postingId: posting.id, sourceDraftId: 'ada-draft', status: 'ready-to-apply',
          targetJobId: 'target-1', resumeVariantId: 'variant-1', notes: '', createdAt: now, updatedAt: now
        }]}
        postings={[posting]}
        onRevise={vi.fn()}
        onVerify={vi.fn()}
        onSend={vi.fn()}
      />
    </NextIntlClientProvider>)
    expect(screen.getByText(/opening the matching job conversation/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Verify recipient and approve' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send approved message' })).not.toBeInTheDocument()
  })
})
