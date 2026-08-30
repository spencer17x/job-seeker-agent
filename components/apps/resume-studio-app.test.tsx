import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/messages/en.json'
import zh from '@/messages/zh.json'
import { ResumeDraftProviderCore } from '@/components/resume-draft-provider'
import {
  buildCareerEvidenceImport,
  type CareerEvidenceService,
  type DraftCareerEvidence
} from '@/lib/agent/career-evidence'
import {
  clearBrowserAiConfig,
  saveBrowserAiConfig
} from '@/lib/agent/browser-config'
import {
  AI_API_KEY_HEADER,
  AI_BASE_URL_HEADER,
  AI_MODEL_HEADER
} from '@/lib/agent/provider-headers'
import { DomainStoreError, type CareerFact } from '@/lib/agent/domain-store'
import {
  AI_PROVIDER_PREFERENCE_STORAGE_KEY,
  clearAiProviderPreference,
  saveAiProviderPreference
} from '@/lib/agent/provider-preference'
import type { ResumeData } from '@/lib/resume-model'
import { BROWSER_AGENT_REQUEST_EVENT, BROWSER_AGENT_RESPONSE_EVENT } from '@/lib/jobs/browser-agent-protocol'
import { ResumeStudioApp } from './resume-studio-app'

const fetchMock = vi.fn<typeof fetch>()

function resume(name: string, title: string, source: ResumeData['metadata']['source']): ResumeData {
  return {
    profile: {
      name,
      title,
      summary: [`${name} builds reliable products.`],
      tags: ['Product'],
      links: []
    },
    targetRole: title,
    skills: [{ group: 'Core', items: ['TypeScript', 'AI'] }],
    experiences: [{ company: 'Example Co', role: title, period: '2024 - Present', tags: [], bullets: ['Owned delivery'] }],
    projects: [{ id: `${name}-project`, name: 'JobSeeker Agent', type: 'Product', tags: ['AI'], summary: 'A resume workspace', highlights: ['Structured data'] }],
    education: [],
    certifications: [],
    awards: [],
    languages: ['English'],
    openSource: [],
    metadata: { source, locale: 'en', updatedAt: '2026-07-13T00:00:00.000Z' }
  }
}

function modelResume(data: ResumeData) {
  const { metadata: _metadata, ...output } = data
  return output
}

function stubLocalModel(output: unknown, availability: unknown = 'available') {
  const prompt = vi.fn().mockResolvedValue(JSON.stringify(output))
  const destroy = vi.fn()
  const create = vi.fn().mockResolvedValue({
    contextUsage: 0,
    contextWindow: 32_000,
    measureContextUsage: vi.fn().mockResolvedValue(500),
    prompt,
    destroy
  })
  const languageModel = {
    availability: vi.fn().mockResolvedValue(availability),
    create
  }
  vi.stubGlobal('LanguageModel', languageModel)
  return { ...languageModel, prompt, destroy }
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body
  } as Response
}

function renderStudio(
  locale: 'en' | 'zh' = 'en',
  evidenceService: CareerEvidenceService = memoryEvidenceService()
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <ResumeDraftProviderCore locale={locale} storage={null}>
        <ResumeStudioApp evidenceService={evidenceService} />
      </ResumeDraftProviderCore>
    </NextIntlClientProvider>
  )
}

function memoryEvidenceService(
  overrides: Partial<CareerEvidenceService> = {}
): CareerEvidenceService {
  const byDraft = new Map<string, DraftCareerEvidence>()
  const facts = new Map<string, CareerFact>()
  const service: CareerEvidenceService = {
    async importResume(input) {
      const imported = buildCareerEvidenceImport(input.data, {
        draftId: input.draftId,
        label: input.label,
        now: '2026-07-16T08:00:00.000Z'
      })
      byDraft.set(input.draftId, imported)
      imported.facts.forEach((fact) => facts.set(fact.id, fact))
      return imported
    },
    async listForDraft(draftId) {
      return byDraft.get(draftId) ?? { source: null, facts: [] }
    },
    async confirmFact(factId) {
      const fact = facts.get(factId)
      if (!fact) throw new Error('Missing fact')
      const confirmed: CareerFact = { ...fact, verification: 'user-confirmed' }
      facts.set(factId, confirmed)
      for (const [draftId, evidence] of byDraft) {
        if (evidence.facts.some(({ id }) => id === factId)) {
          byDraft.set(draftId, {
            ...evidence,
            facts: evidence.facts.map((item) => item.id === factId ? confirmed : item)
          })
        }
      }
      return confirmed
    },
    async updateFact(factId, text) {
      const fact = facts.get(factId)
      if (!fact) throw new Error('Missing fact')
      const updated: CareerFact = { ...fact, text, verification: 'user-confirmed' }
      facts.set(factId, updated)
      for (const [draftId, evidence] of byDraft) {
        if (evidence.facts.some(({ id }) => id === factId)) {
          byDraft.set(draftId, {
            ...evidence,
            facts: evidence.facts.map((item) => item.id === factId ? updated : item)
          })
        }
      }
      return updated
    },
    async deleteFact(factId) {
      facts.delete(factId)
      for (const [draftId, evidence] of byDraft) {
        byDraft.set(draftId, {
          ...evidence,
          facts: evidence.facts.filter(({ id }) => id !== factId)
        })
      }
    },
    async assertSourceDraftCanBeDeleted() {}
  }
  return { ...service, ...overrides }
}

async function createPastedDraft(user: ReturnType<typeof userEvent.setup>, data: ResumeData, text: string) {
  fetchMock.mockResolvedValueOnce(jsonResponse({ data, model: 'test-model' }))
  const input = screen.getByRole('textbox', { name: 'Resume text' })
  await user.clear(input)
  await user.type(input, text)
  await user.click(screen.getByRole('button', { name: 'Create draft' }))
  await screen.findByRole('heading', { name: data.profile.name })
}

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  clearBrowserAiConfig()
  clearAiProviderPreference()
  saveAiProviderPreference({ mode: 'openai-compatible', allowCloudFallback: false })
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('ResumeStudioApp', () => {
  it.each([
    { locale: 'en' as const, title: 'No resume loaded', sample: 'Demo Candidate' },
    { locale: 'zh' as const, title: '尚未加载简历', sample: '演示候选人' }
  ])('starts with a private empty preview in $locale', ({ locale, title, sample }) => {
    renderStudio(locale)

    expect(screen.getByRole('heading', { name: title })).toBeVisible()
    expect(screen.queryByText(sample)).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('loads the fictional sample only after an explicit local action', async () => {
    const user = userEvent.setup()
    renderStudio()

    await user.click(screen.getByRole('tab', { name: 'Demo / Sandbox' }))
    expect(screen.queryByText('Demo Candidate')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Load anonymous sample' }))

    expect(await screen.findByRole('heading', { name: 'Demo Candidate' })).toBeVisible()
    expect(screen.getByText('Anonymous demo data — fictional')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Open Anonymous demo resume' })).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('parses pasted resumes with the initialized saved local preference and never calls a cloud route', async () => {
    const user = userEvent.setup()
    clearAiProviderPreference()
    const parsed = resume('Local Ada', 'AI Engineer', 'paste')
    const local = stubLocalModel(modelResume(parsed))
    renderStudio()

    await user.type(screen.getByRole('textbox', { name: 'Resume text' }), 'Private resume source')
    await user.click(screen.getByRole('button', { name: 'Create draft' }))

    expect(await screen.findByRole('heading', { name: 'Local Ada' })).toBeVisible()
    expect(screen.getByText('browser-managed')).toBeVisible()
    expect(local.prompt).toHaveBeenCalledWith(
      expect.stringContaining('Private resume source'),
      expect.objectContaining({ responseConstraint: expect.objectContaining({ type: 'object' }) })
    )
    expect(JSON.parse(window.localStorage.getItem(AI_PROVIDER_PREFERENCE_STORAGE_KEY) ?? '')).toEqual({
      version: 1,
      mode: 'chrome-built-in',
      allowCloudFallback: false
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not silently call the cloud when automatic mode cannot use the local model', async () => {
    const user = userEvent.setup()
    saveAiProviderPreference({ mode: 'automatic', allowCloudFallback: false })
    stubLocalModel({}, 'unavailable')
    renderStudio()

    await user.click(screen.getByRole('tab', { name: 'Demo / Sandbox' }))
    await user.type(screen.getByRole('textbox', { name: 'Target role' }), 'Agent Engineer')
    await user.click(screen.getByRole('button', { name: 'Generate demo resume' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The local model cannot run this task and cloud fallback is disabled.'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('creates a draft from pasted text and renders a structured preview', async () => {
    const user = userEvent.setup()
    const ada = resume('Ada Lovelace', 'AI Engineer', 'paste')
    renderStudio()

    await createPastedDraft(user, ada, 'Ada resume source')

    expect(fetchMock).toHaveBeenCalledWith('/api/resume/parse', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      text: 'Ada resume source',
      locale: 'en',
      source: 'paste'
    })
    const preview = screen.getByRole('region', { name: 'Resume preview' })
    expect(within(preview).getByRole('heading', { name: 'Skills' })).toBeVisible()
    expect(within(preview).getByText(/TypeScript/)).toBeVisible()
    expect(within(preview).getByRole('heading', { name: 'Experience' })).toBeVisible()
    expect(within(preview).getByText(/Example Co/)).toBeVisible()
    expect(within(preview).getByRole('heading', { name: 'Projects' })).toBeVisible()
    expect(preview.querySelector('pre')).not.toBeInTheDocument()
  })

  it('reviews and imports a bounded BOSS resume into local Career Evidence', async () => {
    const user = userEvent.setup()
    const imported = resume('Boss Ada', 'AI Agent Engineer', 'boss')
    const evidenceService = memoryEvidenceService()
    const importSpy = vi.spyOn(evidenceService, 'importResume')
    const respond = (event: Event) => {
      const request = (event as CustomEvent<{ requestId: string; action: string }>).detail
      if (request.action !== 'collect-boss-resume') return
      window.dispatchEvent(new CustomEvent(BROWSER_AGENT_RESPONSE_EVENT, { detail: {
        requestId: request.requestId,
        ok: true,
        resumeSnapshot: {
          sourceUrl: 'https://www.zhipin.com/web/geek/resume',
          text: '个人优势 TypeScript AI Agent 产品研发。工作经历 Example Co AI Agent Engineer。',
          collectedAt: '2026-08-29T08:00:00.000Z'
        }
      } }))
    }
    window.addEventListener(BROWSER_AGENT_REQUEST_EVENT, respond)
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: imported, model: 'test-model' }))
    try {
      renderStudio('en', evidenceService)
      await user.click(screen.getByRole('tab', { name: 'Import from BOSS' }))
      await user.click(screen.getByRole('button', { name: 'Read from BOSS' }))
      expect(await screen.findByRole('textbox', { name: 'BOSS resume preview' })).toHaveValue('个人优势 TypeScript AI Agent 产品研发。工作经历 Example Co AI Agent Engineer。')
      await user.click(screen.getByRole('button', { name: 'Confirm and import' }))
      expect(await screen.findByRole('heading', { name: 'Boss Ada' })).toBeVisible()
      expect(importSpy).toHaveBeenCalledWith(expect.objectContaining({
        label: 'BOSS online resume',
        data: expect.objectContaining({ metadata: expect.objectContaining({ source: 'boss' }) })
      }))
    } finally {
      window.removeEventListener(BROWSER_AGENT_REQUEST_EVENT, respond)
    }
  })

  it('imports real resume facts into the local review panel and supports confirm and delete', async () => {
    const user = userEvent.setup()
    renderStudio()

    await createPastedDraft(user, resume('Ada Lovelace', 'AI Engineer', 'paste'), 'Ada source')

    const evidence = screen.getByRole('region', { name: 'Career evidence' })
    expect((await within(evidence).findAllByText('Imported · review needed')).length).toBeGreaterThan(0)
    expect(within(evidence).getByText('Ada Lovelace builds reliable products.')).toBeVisible()

    await user.click(within(evidence).getByRole('button', {
      name: 'Confirm fact: Ada Lovelace builds reliable products.'
    }))
    expect(await within(evidence).findByText('User confirmed')).toBeVisible()

    await user.click(within(evidence).getByRole('button', {
      name: 'Delete fact: Ada Lovelace builds reliable products.'
    }))
    await waitFor(() => {
      expect(within(evidence).queryByText('Ada Lovelace builds reliable products.')).not.toBeInTheDocument()
    })
  })

  it('lets the user correct an imported fact and promotes the correction to confirmed evidence', async () => {
    const user = userEvent.setup()
    renderStudio()
    await createPastedDraft(user, resume('Ada Lovelace', 'AI Engineer', 'paste'), 'Ada source')
    const evidence = screen.getByRole('region', { name: 'Career evidence' })

    await user.click(within(evidence).getByRole('button', {
      name: 'Edit fact: Ada Lovelace builds reliable products.'
    }))
    const editor = within(evidence).getByRole('textbox', { name: 'Corrected career fact' })
    await user.clear(editor)
    await user.type(editor, 'Ada Lovelace builds reliable AI products.')
    await user.click(within(evidence).getByRole('button', {
      name: 'Save corrected fact: Ada Lovelace builds reliable products.'
    }))

    expect(await within(evidence).findByText('Ada Lovelace builds reliable AI products.')).toBeVisible()
    expect(within(evidence).getByText('User confirmed')).toBeVisible()
  })

  it('keeps a created draft but explicitly reports when its Career Evidence was not saved', async () => {
    const user = userEvent.setup()
    const evidenceService = memoryEvidenceService({
      importResume: vi.fn().mockRejectedValue(new DomainStoreError(
        'INDEXEDDB_UNAVAILABLE',
        'IndexedDB unavailable'
      ))
    })
    renderStudio('en', evidenceService)

    await createPastedDraft(user, resume('Ada', 'AI Engineer', 'paste'), 'Ada source')

    expect(screen.getByRole('button', { name: 'Open Ada - AI Engineer' })).toBeVisible()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The draft was created, but its Career Evidence was not saved locally.'
    )
  })

  it('keeps a referenced fact and explains why it cannot be deleted', async () => {
    const user = userEvent.setup()
    const evidenceService = memoryEvidenceService({
      deleteFact: vi.fn().mockRejectedValue(new DomainStoreError(
        'DELETE_RESTRICTED',
        'Fact is referenced'
      ))
    })
    renderStudio('en', evidenceService)
    await createPastedDraft(user, resume('Ada', 'AI Engineer', 'paste'), 'Ada source')

    const evidence = screen.getByRole('region', { name: 'Career evidence' })
    await user.click(await within(evidence).findByRole('button', {
      name: 'Delete fact: Ada builds reliable products.'
    }))

    expect(await within(evidence).findByRole('alert')).toHaveTextContent(
      'This fact is used by a requirement match or agent run and cannot be deleted.'
    )
    expect(within(evidence).getByText('Ada builds reliable products.')).toBeVisible()
  })

  it('creates an AI-generated draft from role, seniority, and background', async () => {
    const user = userEvent.setup()
    const generated = resume('Lin Chen', 'Agent Engineer', 'ai-generated')
    const evidenceService = memoryEvidenceService()
    const importSpy = vi.spyOn(evidenceService, 'importResume')
    saveBrowserAiConfig({
      baseURL: 'https://saved-provider.example/v1',
      model: 'saved-cloud-model',
      apiKey: 'synthetic-test-key',
      rememberApiKey: false
    })
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: generated, model: 'saved-cloud-model' }))
    renderStudio('en', evidenceService)

    await user.click(screen.getByRole('tab', { name: 'Demo / Sandbox' }))
    await user.type(screen.getByRole('textbox', { name: 'Target role' }), 'Agent Engineer')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Seniority' }), 'senior')
    await user.type(screen.getByRole('textbox', { name: 'Background' }), 'Frontend platform owner')
    await user.click(screen.getByRole('button', { name: 'Generate demo resume' }))

    await screen.findByRole('heading', { name: 'Lin Chen' })
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      locale: 'en',
      targetRole: 'Agent Engineer',
      seniority: 'senior',
      background: 'Frontend platform owner'
    })
    const requestHeaders = new Headers(fetchMock.mock.calls[0][1]?.headers)
    expect(requestHeaders.get(AI_BASE_URL_HEADER)).toBe('https://saved-provider.example/v1')
    expect(requestHeaders.get(AI_MODEL_HEADER)).toBe('saved-cloud-model')
    expect(requestHeaders.get(AI_API_KEY_HEADER)).toBe('synthetic-test-key')
    expect(screen.getByText('saved-cloud-model')).toBeVisible()
    expect(importSpy).not.toHaveBeenCalled()
    expect(screen.getByText('Demo, sample, and AI-created drafts are excluded from Career Evidence.')).toBeVisible()
  })

  it('generates a demo resume with the initialized saved local preference', async () => {
    const user = userEvent.setup()
    clearAiProviderPreference()
    const generated = resume('Local Lin', 'Agent Engineer', 'ai-generated')
    const local = stubLocalModel(modelResume(generated))
    renderStudio()

    await user.click(screen.getByRole('tab', { name: 'Demo / Sandbox' }))
    await user.type(screen.getByRole('textbox', { name: 'Target role' }), 'Agent Engineer')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Seniority' }), 'senior')
    await user.click(screen.getByRole('button', { name: 'Generate demo resume' }))

    expect(await screen.findByRole('heading', { name: 'Local Lin' })).toBeVisible()
    expect(screen.getByText('browser-managed')).toBeVisible()
    expect(local.prompt).toHaveBeenCalledWith(
      expect.stringContaining('Agent Engineer'),
      expect.objectContaining({ responseConstraint: expect.objectContaining({ type: 'object' }) })
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('previews streamed resume fields before saving the completed draft', async () => {
    const user = userEvent.setup()
    const partial = resume('Live Lin', 'Agent Engineer', 'ai-generated')
    const completed = resume('Lin Chen', 'Agent Engineer', 'ai-generated')
    const encoder = new TextEncoder()
    let finishStream!: () => void
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'start', model: 'grok-test' })}\n`))
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'partial', data: partial })}\n`))
        finishStream = () => {
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'result', data: completed, model: 'grok-test' })}\n`))
          controller.close()
        }
      }
    })
    fetchMock.mockResolvedValueOnce(new Response(body, {
      headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' }
    }))
    renderStudio()

    await user.click(screen.getByRole('tab', { name: 'Demo / Sandbox' }))
    await user.type(screen.getByRole('textbox', { name: 'Target role' }), 'Agent Engineer')
    await user.click(screen.getByRole('button', { name: 'Generate demo resume' }))

    await screen.findByRole('heading', { name: 'Live Lin' })
    expect(screen.getByText('Drafting live')).toBeVisible()
    expect(screen.getByText('No drafts yet')).toBeVisible()
    expect(screen.getByText('grok-test')).toBeVisible()
    const requestHeaders = new Headers(fetchMock.mock.calls[0][1]?.headers)
    expect(requestHeaders.get('Accept')).toBe('application/x-ndjson')
    expect(requestHeaders.get('Content-Type')).toBe('application/json')

    await act(async () => finishStream())

    await screen.findByRole('heading', { name: 'Lin Chen' })
    expect(screen.getByRole('button', { name: 'Open Lin Chen - Agent Engineer' })).toBeVisible()
    expect(screen.queryByText('Drafting live')).not.toBeInTheDocument()
  })

  it('uploads a file by extracting text before parsing it', async () => {
    const user = userEvent.setup()
    const uploaded = resume('Grace Hopper', 'Platform Engineer', 'upload')
    const evidenceService = memoryEvidenceService()
    const importSpy = vi.spyOn(evidenceService, 'importResume')
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ text: 'Extracted resume', fileName: 'grace.pdf', mimeType: 'application/pdf' }))
      .mockResolvedValueOnce(jsonResponse({ data: uploaded, model: 'test-model' }))
    renderStudio('en', evidenceService)

    await user.click(screen.getByRole('tab', { name: 'Upload' }))
    await user.upload(screen.getByLabelText('Upload resume file'), new File(['pdf'], 'grace.pdf', { type: 'application/pdf' }))

    await screen.findByRole('heading', { name: 'Grace Hopper' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/resume/extract-text')
    expect(fetchMock.mock.calls[1][0]).toBe('/api/resume/parse')
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      text: 'Extracted resume',
      locale: 'en',
      source: 'upload'
    })
    expect(screen.getByRole('textbox', { name: 'Extracted resume text' })).toHaveValue('Extracted resume')
    expect(importSpy).toHaveBeenCalledWith(expect.objectContaining({
      label: 'grace.pdf',
      data: expect.objectContaining({ metadata: expect.objectContaining({ source: 'upload' }) })
    }))
  })

  it('switches, renames, and deletes drafts', async () => {
    const user = userEvent.setup()
    renderStudio()
    await createPastedDraft(user, resume('Ada', 'AI Engineer', 'paste'), 'Ada source')
    await createPastedDraft(user, resume('Grace', 'Platform Engineer', 'paste'), 'Grace source')

    await user.click(screen.getByRole('button', { name: 'Open Ada - AI Engineer' }))
    expect(screen.getByRole('heading', { name: 'Ada' })).toBeVisible()

    const nameInput = screen.getByRole('textbox', { name: 'Draft name' })
    await user.clear(nameInput)
    await user.type(nameInput, 'Ada Agent Resume')
    await user.click(screen.getByRole('button', { name: 'Save draft name' }))
    expect(screen.getByRole('button', { name: 'Open Ada Agent Resume' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Delete active draft' }))
    expect(screen.getByRole('button', { name: 'Open Ada Agent Resume' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Confirm delete' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Cancel delete' }))
    expect(screen.getByRole('button', { name: 'Open Ada Agent Resume' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Delete active draft' }))
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))
    expect(screen.queryByRole('button', { name: 'Open Ada Agent Resume' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Grace' })).toBeVisible()
  })

  it('blocks deletion when a saved variant or agent run references the draft', async () => {
    const user = userEvent.setup()
    const evidenceService = memoryEvidenceService({
      assertSourceDraftCanBeDeleted: vi.fn().mockRejectedValue(new DomainStoreError(
        'DELETE_RESTRICTED',
        'Draft is referenced'
      ))
    })
    renderStudio('en', evidenceService)
    await createPastedDraft(user, resume('Ada', 'AI Engineer', 'paste'), 'Ada source')

    await user.click(screen.getByRole('button', { name: 'Delete active draft' }))
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This draft is used by a saved resume variant or agent run and cannot be deleted.'
    )
    expect(screen.getByRole('button', { name: 'Open Ada - AI Engineer' })).toBeVisible()
    expect(evidenceService.assertSourceDraftCanBeDeleted).toHaveBeenCalled()
  })

  it('disables creation controls while a parse request is loading', async () => {
    const user = userEvent.setup()
    let resolveRequest!: (value: Response) => void
    fetchMock.mockReturnValueOnce(new Promise((resolve) => { resolveRequest = resolve }))
    renderStudio()

    await user.type(screen.getByRole('textbox', { name: 'Resume text' }), 'Pending resume')
    await user.click(screen.getByRole('button', { name: 'Create draft' }))

    expect(screen.getByRole('button', { name: 'Creating draft' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'Resume text' })).toBeDisabled()
    resolveRequest(jsonResponse({ data: resume('Pending', 'Engineer', 'paste'), model: 'test-model' }))
    await screen.findByRole('heading', { name: 'Pending' })
  })

  it('preserves pasted source and the current draft when parsing fails', async () => {
    const user = userEvent.setup()
    renderStudio()
    await createPastedDraft(user, resume('Ada', 'AI Engineer', 'paste'), 'Original source')
    fetchMock.mockResolvedValueOnce(jsonResponse({
      error: { code: 'AI_OUTPUT_INVALID', message: 'raw provider body secret' }
    }, 502))

    const input = screen.getByRole('textbox', { name: 'Resume text' })
    await user.clear(input)
    await user.type(input, 'Keep this failed source')
    await user.click(screen.getByRole('button', { name: 'Create draft' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('AI returned invalid resume data.')
    expect(screen.getByRole('alert')).not.toHaveTextContent('raw provider body secret')
    expect(input).toHaveValue('Keep this failed source')
    expect(screen.getByRole('heading', { name: 'Ada' })).toBeVisible()
    expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(1)
  })

  it('preserves generation input and the current draft when generation fails', async () => {
    const user = userEvent.setup()
    renderStudio()
    await createPastedDraft(user, resume('Ada', 'AI Engineer', 'paste'), 'Original source')
    fetchMock.mockResolvedValueOnce(jsonResponse({
      error: { code: 'RATE_LIMITED', message: 'arbitrary server prose' }
    }, 429))

    await user.click(screen.getByRole('tab', { name: 'Demo / Sandbox' }))
    await user.type(screen.getByRole('textbox', { name: 'Target role' }), 'Platform Engineer')
    await user.type(screen.getByRole('textbox', { name: 'Background' }), 'Keep this background')
    await user.click(screen.getByRole('button', { name: 'Generate demo resume' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests. Try again shortly.')
    expect(screen.getByRole('alert')).not.toHaveTextContent('arbitrary server prose')
    expect(screen.getByRole('textbox', { name: 'Background' })).toHaveValue('Keep this background')
    expect(screen.getByRole('heading', { name: 'Ada' })).toBeVisible()
  })

  it('applies Retry-After only to the throttled operation and re-enables it after cooldown', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      error: 'Too many requests. Try again later.',
      code: 'RATE_LIMITED'
    }, 429, { 'Retry-After': '1' }))
    renderStudio()

    await user.click(screen.getByRole('tab', { name: 'Demo / Sandbox' }))
    await user.type(screen.getByRole('textbox', { name: 'Target role' }), 'Platform Engineer')
    await user.click(screen.getByRole('button', { name: 'Generate demo resume' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Too many requests. Try again in 1 second.')
    expect(screen.getByRole('button', { name: 'Generate demo resume' })).toBeDisabled()

    await user.click(screen.getByRole('tab', { name: 'Paste' }))
    expect(screen.getByRole('button', { name: 'Create draft' })).toBeEnabled()
    await user.click(screen.getByRole('tab', { name: 'Upload' }))
    expect(screen.getByLabelText('Upload resume file')).toBeEnabled()
    await user.click(screen.getByRole('tab', { name: 'Demo / Sandbox' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Generate demo resume' })).toBeEnabled()
    }, { timeout: 2_000 })
  })

  it('preserves extracted text when upload parsing fails', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ text: 'Keep extracted text', fileName: 'resume.txt', mimeType: 'text/plain' }))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'AI_UNAVAILABLE', message: 'raw provider text' } }, 502))
    renderStudio()

    await user.click(screen.getByRole('tab', { name: 'Upload' }))
    await user.upload(screen.getByLabelText('Upload resume file'), new File(['resume'], 'resume.txt', { type: 'text/plain' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('AI service is temporarily unavailable.')
    const extracted = screen.getByRole('textbox', { name: 'Extracted resume text' })
    expect(extracted).toHaveValue('Keep extracted text')
    expect(screen.getByText('No drafts yet')).toBeVisible()

    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: resume('Retried', 'Engineer', 'upload'),
      model: 'retry-model'
    }))
    await user.clear(extracted)
    await user.type(extracted, 'Edited extracted text')
    await user.click(screen.getByRole('button', { name: 'Parse extracted text' }))

    await screen.findByRole('heading', { name: 'Retried' })
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({
      text: 'Edited extracted text',
      locale: 'en',
      source: 'upload'
    })
    expect(screen.getByRole('button', { name: 'Open resume.txt' })).toBeVisible()
  })

  it('invalidates old upload text when a new extraction fails without borrowing pasted text', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ text: 'Old extracted text', fileName: 'old.txt', mimeType: 'text/plain' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'AI unavailable', code: 'AI_UNAVAILABLE' }, 502))
      .mockResolvedValueOnce(jsonResponse({ error: 'Extraction failed', code: 'EXTRACTION_FAILED' }, 422))
    renderStudio()

    await user.type(screen.getByRole('textbox', { name: 'Resume text' }), 'Pasted text must stay paste-only')
    await user.click(screen.getByRole('tab', { name: 'Upload' }))
    expect(screen.getByRole('textbox', { name: 'Extracted resume text' })).toHaveValue('')

    await user.upload(screen.getByLabelText('Upload resume file'), new File(['old'], 'old.txt', { type: 'text/plain' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('AI service is temporarily unavailable.')
    expect(screen.getByRole('textbox', { name: 'Extracted resume text' })).toHaveValue('Old extracted text')
    expect(screen.getByRole('button', { name: 'Parse extracted text' })).toBeEnabled()

    await user.upload(screen.getByLabelText('Upload resume file'), new File(['new'], 'new.txt', { type: 'text/plain' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The resume text could not be extracted.')
    expect(screen.getByRole('textbox', { name: 'Extracted resume text' })).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Parse extracted text' })).toBeDisabled()
    expect(fetchMock).toHaveBeenCalledTimes(3)

    await user.click(screen.getByRole('tab', { name: 'Paste' }))
    expect(screen.getByRole('textbox', { name: 'Resume text' })).toHaveValue('Pasted text must stay paste-only')
  })

  it('aborts an active request when unmounted', async () => {
    const user = userEvent.setup()
    fetchMock.mockReturnValueOnce(new Promise(() => {}))
    const view = renderStudio()

    await user.type(screen.getByRole('textbox', { name: 'Resume text' }), 'Pending resume')
    await user.click(screen.getByRole('button', { name: 'Create draft' }))
    const signal = fetchMock.mock.calls[0][1]?.signal
    expect(signal?.aborted).toBe(false)

    view.unmount()
    expect(signal?.aborted).toBe(true)
  })

  it('aborts on mode switch and ignores a stale response after a newer request', async () => {
    const user = userEvent.setup()
    let resolveOld!: (value: Response) => void
    fetchMock
      .mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve }))
      .mockResolvedValueOnce(jsonResponse({
        data: resume('Newest', 'Agent Engineer', 'ai-generated'),
        model: 'new-model'
      }))
    renderStudio()

    await user.type(screen.getByRole('textbox', { name: 'Resume text' }), 'Old source')
    await user.click(screen.getByRole('button', { name: 'Create draft' }))
    const oldSignal = fetchMock.mock.calls[0][1]?.signal
    await user.click(screen.getByRole('tab', { name: 'Demo / Sandbox' }))
    expect(oldSignal?.aborted).toBe(true)

    await user.type(screen.getByRole('textbox', { name: 'Target role' }), 'Agent Engineer')
    await user.click(screen.getByRole('button', { name: 'Generate demo resume' }))
    await screen.findByRole('heading', { name: 'Newest' })

    await act(async () => {
      resolveOld(jsonResponse({ data: resume('Stale', 'Engineer', 'paste'), model: 'old-model' }))
    })
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Stale' })).not.toBeInTheDocument())
    expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(1)
  })

  it('implements linked ARIA tab panels and roving keyboard navigation', async () => {
    const user = userEvent.setup()
    renderStudio()

    const boss = screen.getByRole('tab', { name: 'Import from BOSS' })
    const paste = screen.getByRole('tab', { name: 'Paste' })
    const upload = screen.getByRole('tab', { name: 'Upload' })
    const generate = screen.getByRole('tab', { name: 'Demo / Sandbox' })
    expect(paste).toHaveAttribute('tabindex', '0')
    expect(upload).toHaveAttribute('tabindex', '-1')
    expect(paste).toHaveAttribute('aria-controls')
    expect(screen.getAllByRole('tabpanel', { hidden: true })).toHaveLength(4)
    for (const tab of [boss, paste, upload, generate]) {
      expect(document.getElementById(tab.getAttribute('aria-controls') ?? '')).toHaveAttribute('role', 'tabpanel')
    }
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', paste.id)

    paste.focus()
    await user.keyboard('{ArrowRight}')
    expect(upload).toHaveFocus()
    expect(upload).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', upload.id)

    await user.keyboard('{End}')
    expect(generate).toHaveFocus()
    await user.keyboard('{Home}')
    expect(boss).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(generate).toHaveFocus()
  })

  it('uses Chinese Studio labels under the zh locale', () => {
    renderStudio('zh')
    expect(screen.getByRole('region', { name: '简历工作室' })).toBeVisible()
    expect(screen.getByRole('tab', { name: '粘贴文本' })).toBeVisible()
  })

  it('keeps desktop controls dense and gives every mobile Studio control a touch target', () => {
    const css = readFileSync('app/globals.css', 'utf8')
    const mobile = css.match(/@media \(max-width: 767px\) \{([\s\S]*?)\n\}\n\n@media \(min-width: 768px\)/)?.[1] ?? ''

    expect(css).toMatch(/\.resume-studio__draft-actions input\s*\{[^}]*height:\s*30px/)
    expect(css).toMatch(/\.resume-studio__editor input,\s*\.resume-studio__editor select\s*\{[^}]*min-height:\s*34px/)
    expect(css).toMatch(/\.resume-studio__editor input\.sr-only\s*\{[^}]*width:\s*1px[^}]*min-height:\s*1px/)
    expect(mobile).toMatch(/\.resume-studio button,\s*\.resume-studio__draft-actions input,\s*\.resume-studio__editor input,\s*\.resume-studio__editor select\s*\{[^}]*min-height:\s*44px/)
    expect(mobile).toMatch(/\.resume-studio__toolbar \[role='tab'\]\s*\{[^}]*min-height:\s*44px/)
    expect(mobile).toMatch(/\.resume-studio__editor textarea\s*\{[^}]*min-height:\s*150px/)
    expect(mobile).toMatch(/\.resume-studio__file-picker\s*\{[^}]*min-height:\s*84px/)
  })
})
