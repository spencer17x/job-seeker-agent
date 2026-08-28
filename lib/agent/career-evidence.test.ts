import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import {
  CAREER_EVIDENCE_CHANGED_EVENT,
  CareerEvidenceImportError,
  buildCareerEvidenceImport,
  careerEvidenceSourceId,
  createCareerEvidenceService
} from './career-evidence'
import { DomainStoreError, createDomainStore } from './domain-store'
import { scoreRequirementMatrix } from './requirement-matrix'
import { ACTIVE_WORKFLOW_CHANGED_EVENT } from './workflow-persistence'
import { normalizeResumeData, type ResumeData } from '@/lib/resume-model'

const now = '2026-07-16T08:00:00.000Z'

function resume(source: ResumeData['metadata']['source'] = 'upload') {
  return normalizeResumeData({
    profile: {
      name: 'Ada Lovelace',
      title: 'Staff Engineer',
      summary: ['  Builds reliable platforms.  '],
      tags: ['Leadership']
    },
    skills: [
      { group: 'Core', items: ['TypeScript', ' TypeScript '] },
      { group: 'AI', items: ['Retrieval'] }
    ],
    experiences: [{
      company: 'Example Co',
      role: 'Staff Engineer',
      period: '2022 – Present',
      tags: ['Platform'],
      bullets: ['Led a platform migration used by five teams.']
    }],
    projects: [{
      id: 'job-seeker-agent',
      name: 'JobSeeker Agent',
      type: 'Product',
      tags: ['AI'],
      summary: 'Built an evidence-grounded resume workspace.',
      highlights: ['Added deterministic requirement scoring.']
    }],
    education: [{
      school: 'University of London',
      degree: 'BSc',
      major: 'Mathematics',
      period: '1832–1835',
      details: ['Studied analytical engines.']
    }],
    certifications: ['Cloud Architecture'],
    awards: ['Engineering Excellence'],
    languages: ['English'],
    openSource: ['Maintains an agent toolkit.'],
    metadata: { source, locale: 'en', updatedAt: now }
  }, { source, locale: 'en', now })
}

function testStore() {
  return createDomainStore({
    databaseName: `career-evidence-${crypto.randomUUID()}`,
    indexedDB: new IDBFactory()
  })
}

async function seedRunReferencingFact(
  store: ReturnType<typeof testStore>,
  factId: string
) {
  const targetJob = {
    id: 'job-career-evidence', title: 'Platform Lead',
    description: 'Lead reliable platforms.', locale: 'en' as const,
    createdAt: now, updatedAt: now
  }
  const requirement = {
    id: 'requirement-career-evidence', jobId: targetJob.id,
    text: 'Lead reliable platforms.', category: 'experience' as const,
    priority: 'must' as const, weight: 5, keywords: ['platform'], userConfirmed: true
  }
  const match = {
    requirementId: requirement.id, factIds: [factId], status: 'direct' as const,
    rationale: 'The career fact supports this requirement.'
  }
  const matrix = {
    version: 1 as const, targetJobId: targetJob.id, inputFingerprint: 'career-evidence-input-v1',
    requirements: [requirement], matches: [match]
  }
  await store.put('targetJobs', targetJob)
  await store.put('jobRequirements', requirement)
  await store.put('requirementMatches', match)
  await store.put('optimizationRuns', {
    version: 1,
    id: 'run-career-evidence', sourceDraftId: 'draft-1', targetJobId: targetJob.id,
    stage: 'evidence-mapped', inputFingerprint: matrix.inputFingerprint,
    requirementMatches: matrix.matches, questions: [],
    scoreBefore: scoreRequirementMatrix(matrix), createdAt: now, updatedAt: now
  })
}

describe('career evidence import', () => {
  it('deterministically decomposes a real resume into stable, deduplicated imported facts', () => {
    const input = resume()
    const first = buildCareerEvidenceImport(input, {
      draftId: 'draft-1',
      label: 'Ada resume.pdf',
      now
    })
    const second = buildCareerEvidenceImport(input, {
      draftId: 'draft-1',
      label: 'Ada resume.pdf',
      now
    })

    expect(second).toEqual(first)
    expect(first.source).toMatchObject({
      id: careerEvidenceSourceId('draft-1'),
      type: 'resume-import',
      label: 'Ada resume.pdf'
    })
    expect(first.source.contentHash).toMatch(/^fnv1a64:[a-f0-9]{16}$/)
    expect(new Set(first.facts.map((fact) => fact.id)).size).toBe(first.facts.length)
    expect(first.facts.every((fact) => fact.verification === 'imported')).toBe(true)
    expect(first.facts.every((fact) => fact.evidenceRefs[0] === first.source.id)).toBe(true)
    expect(first.facts.filter((fact) => fact.text === 'TypeScript')).toHaveLength(1)
    expect(first.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'experience', text: 'Builds reliable platforms.' }),
      expect.objectContaining({
        kind: 'experience',
        text: 'Led a platform migration used by five teams.',
        context: { company: 'Example Co', role: 'Staff Engineer' }
      }),
      expect.objectContaining({
        kind: 'project',
        text: 'Added deterministic requirement scoring.',
        context: { project: 'JobSeeker Agent' }
      }),
      expect.objectContaining({ kind: 'achievement', text: 'University of London · BSc · Mathematics · 1832–1835' }),
      expect.objectContaining({ kind: 'skill', text: 'English', tags: ['language'] }),
      expect.objectContaining({ kind: 'project', text: 'Maintains an agent toolkit.', tags: ['open-source'] })
    ]))
  })

  it.each(['sample', 'ai-generated', 'ai-chat'] as const)(
    'refuses to promote %s data into Career Evidence',
    (source) => {
      expect(() => buildCareerEvidenceImport(resume(source), {
        draftId: 'draft-demo',
        label: 'Demo resume',
        now
      })).toThrowError(expect.objectContaining<Partial<CareerEvidenceImportError>>({
        code: 'UNTRUSTED_RESUME_SOURCE'
      }))
    }
  )

  it('atomically imports, lists, confirms, and deletes unreferenced facts', async () => {
    const store = testStore()
    const service = createCareerEvidenceService({ store, now: () => now })

    const imported = await service.importResume({
      draftId: 'draft-1',
      label: 'Ada resume',
      data: resume('paste')
    })
    await expect(service.listForDraft('draft-1')).resolves.toEqual(imported)

    const confirmedAt = '2026-07-16T09:00:00.000Z'
    const reviewService = createCareerEvidenceService({ store, now: () => confirmedAt })
    const confirmed = await reviewService.confirmFact(imported.facts[0].id)
    expect(confirmed).toMatchObject({ verification: 'user-confirmed', updatedAt: confirmedAt })

    await reviewService.deleteFact(imported.facts[1].id)
    const afterDelete = await reviewService.listForDraft('draft-1')
    expect(afterDelete.facts).toHaveLength(imported.facts.length - 1)
    expect(afterDelete.facts).toContainEqual(confirmed)
    await store.close()
  })

  it('announces a successful evidence import so open workspaces can re-check readiness', async () => {
    const store = testStore()
    const listener = vi.fn()
    window.addEventListener(CAREER_EVIDENCE_CHANGED_EVENT, listener)

    await createCareerEvidenceService({ store, now: () => now }).importResume({
      draftId: 'draft-1', label: 'Ada', data: resume('paste')
    })

    expect(listener).toHaveBeenCalledOnce()
    window.removeEventListener(CAREER_EVIDENCE_CHANGED_EVENT, listener)
    await store.close()
  })

  it('preserves a user confirmation when the same draft is imported again', async () => {
    const store = testStore()
    const service = createCareerEvidenceService({ store, now: () => now })
    const imported = await service.importResume({ draftId: 'draft-1', label: 'Ada', data: resume() })
    const fact = imported.facts[0]
    await service.confirmFact(fact.id)
    await service.importResume({ draftId: 'draft-1', label: 'Ada', data: resume() })

    expect((await service.listForDraft('draft-1')).facts.find(({ id }) => id === fact.id))
      .toMatchObject({ verification: 'user-confirmed' })
    await store.close()
  })

  it('persists a user correction and does not restore the imported assumption on reimport', async () => {
    const store = testStore()
    const firstService = createCareerEvidenceService({ store, now: () => now })
    const imported = await firstService.importResume({ draftId: 'draft-1', label: 'Ada', data: resume() })
    const original = imported.facts.find((fact) => fact.text === 'Builds reliable platforms.')!
    const correctedAt = '2026-07-16T09:00:00.000Z'
    const reviewService = createCareerEvidenceService({ store, now: () => correctedAt })

    await reviewService.updateFact(original.id, 'Builds reliable data platforms.')
    await reviewService.importResume({ draftId: 'draft-1', label: 'Ada', data: resume() })

    expect((await reviewService.listForDraft('draft-1')).facts.find(({ id }) => id === original.id))
      .toMatchObject({
        text: 'Builds reliable data platforms.',
        verification: 'user-confirmed',
        updatedAt: correctedAt
      })
    await store.close()
  })

  it('marks a referencing active run stale and announces when a fact is confirmed', async () => {
    const store = testStore()
    const firstService = createCareerEvidenceService({ store, now: () => now })
    const imported = await firstService.importResume({
      draftId: 'draft-1', label: 'Ada', data: resume('paste')
    })
    const fact = imported.facts[0]
    await seedRunReferencingFact(store, fact.id)
    const listener = vi.fn()
    window.addEventListener(ACTIVE_WORKFLOW_CHANGED_EVENT, listener)

    const confirmed = await createCareerEvidenceService({
      store, now: () => '2026-07-16T09:00:00.000Z'
    }).confirmFact(fact.id)

    expect(confirmed.verification).toBe('user-confirmed')
    expect(await store.get('optimizationRuns', 'run-career-evidence')).toMatchObject({
      stage: 'stale',
      staleBecauseFingerprint: expect.stringContaining('career-fact:')
    })
    expect(listener).toHaveBeenCalledOnce()
    window.removeEventListener(ACTIVE_WORKFLOW_CHANGED_EVENT, listener)
    await store.close()
  })

  it('marks a referencing active run stale when a fact is corrected', async () => {
    const store = testStore()
    const firstService = createCareerEvidenceService({ store, now: () => now })
    const imported = await firstService.importResume({
      draftId: 'draft-1', label: 'Ada', data: resume('paste')
    })
    const fact = imported.facts[0]
    await seedRunReferencingFact(store, fact.id)

    await createCareerEvidenceService({
      store, now: () => '2026-07-16T09:00:00.000Z'
    }).updateFact(fact.id, 'Corrected verified platform fact.')

    expect(await store.get('careerFacts', fact.id)).toMatchObject({
      text: 'Corrected verified platform fact.', verification: 'user-confirmed'
    })
    expect(await store.get('optimizationRuns', 'run-career-evidence')).toMatchObject({
      stage: 'stale'
    })
    await store.close()
  })

  it('stales a referencing active run before preserving the delete restriction', async () => {
    const store = testStore()
    const service = createCareerEvidenceService({ store, now: () => now })
    const imported = await service.importResume({
      draftId: 'draft-1', label: 'Ada', data: resume('paste')
    })
    const fact = imported.facts[0]
    await seedRunReferencingFact(store, fact.id)

    await expect(service.deleteFact(fact.id)).rejects.toEqual(
      expect.objectContaining<Partial<DomainStoreError>>({ code: 'DELETE_RESTRICTED' })
    )
    expect(await store.get('optimizationRuns', 'run-career-evidence')).toMatchObject({
      stage: 'stale'
    })
    expect(await store.get('careerFacts', fact.id)).toBeDefined()
    await store.close()
  })

  it('deduplicates the same career facts across resume drafts and retains both sources', async () => {
    const store = testStore()
    const service = createCareerEvidenceService({ store, now: () => now })
    const first = await service.importResume({ draftId: 'draft-1', label: 'Ada v1', data: resume() })
    const second = await service.importResume({ draftId: 'draft-2', label: 'Ada v2', data: resume() })

    expect(second.facts.map(({ id }) => id)).toEqual(first.facts.map(({ id }) => id))
    const expectedSources = [
      careerEvidenceSourceId('draft-1'),
      careerEvidenceSourceId('draft-2')
    ].sort()
    const [firstDraft, secondDraft, storedFacts] = await Promise.all([
      service.listForDraft('draft-1'),
      service.listForDraft('draft-2'),
      store.list('careerFacts')
    ])
    expect(storedFacts).toHaveLength(first.facts.length)
    expect(firstDraft.facts).toHaveLength(first.facts.length)
    expect(secondDraft.facts).toHaveLength(first.facts.length)
    expect(storedFacts.every((fact) => (
      [...fact.evidenceRefs].sort().join(',') === expectedSources.join(',')
    ))).toBe(true)
    await store.close()
  })

  it('surfaces IndexedDB unavailability instead of returning an empty saved profile', async () => {
    const service = createCareerEvidenceService({
      store: createDomainStore({ indexedDB: null }),
      now: () => now
    })

    await expect(service.importResume({
      draftId: 'draft-1',
      label: 'Ada',
      data: resume()
    })).rejects.toEqual(expect.objectContaining<Partial<DomainStoreError>>({
      code: 'INDEXEDDB_UNAVAILABLE'
    }))
  })
})
