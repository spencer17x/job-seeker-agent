import {
  createDomainStore,
  type CareerFact,
  type DomainStoreTransaction,
  type EvidenceSource,
  type IndexedDbDomainStore
} from './domain-store'
import { transitionOptimizationRun, type OptimizationRun } from './optimization-run'
import { ACTIVE_WORKFLOW_CHANGED_EVENT } from './workflow-persistence'
import { isTrustedResumeSource, type ResumeData, type ResumeSource } from '@/lib/resume-model'

export type CareerEvidenceImport = {
  source: EvidenceSource
  facts: CareerFact[]
}

export const CAREER_EVIDENCE_CHANGED_EVENT = 'job-seeker-agent-career-evidence-changed'

export type DraftCareerEvidence = {
  source: EvidenceSource | null
  facts: CareerFact[]
}

export interface CareerEvidenceService {
  importResume(input: {
    draftId: string
    label: string
    data: ResumeData
  }): Promise<CareerEvidenceImport>
  listForDraft(draftId: string): Promise<DraftCareerEvidence>
  confirmFact(factId: string): Promise<CareerFact>
  updateFact(factId: string, text: string): Promise<CareerFact>
  deleteFact(factId: string): Promise<void>
  assertSourceDraftCanBeDeleted(draftId: string): Promise<void>
}

type CareerEvidenceStore = Pick<
  IndexedDbDomainStore,
  'assertSourceDraftCanBeDeleted' | 'delete' | 'get' | 'list' | 'put' | 'transaction'
>

type FactCandidate = Pick<CareerFact, 'context' | 'kind' | 'tags' | 'text'>

const MAX_LABEL_LENGTH = 500
const MAX_TEXT_LENGTH = 20_000
const MAX_TAG_LENGTH = 120

export class CareerEvidenceImportError extends Error {
  constructor(
    readonly code: 'UNTRUSTED_RESUME_SOURCE' | 'FACT_NOT_FOUND',
    message: string
  ) {
    super(message)
    this.name = 'CareerEvidenceImportError'
  }
}

export function buildCareerEvidenceImport(
  data: ResumeData,
  options: { draftId: string; label: string; now: string }
): CareerEvidenceImport {
  assertTrustedSource(data.metadata.source)

  const draftKey = normalizeRequired(options.draftId, 'Draft ID')
  const now = normalizeRequired(options.now, 'Timestamp')
  const sourceId = careerEvidenceSourceId(draftKey)
  const candidates = collectFactCandidates(data)
  const facts = deduplicateCandidates(candidates).map((candidate) => ({
    id: `fact:career:${stableHash(factKey(candidate))}`,
    kind: candidate.kind,
    text: candidate.text,
    ...(candidate.context ? { context: candidate.context } : {}),
    evidenceRefs: [sourceId],
    verification: 'imported' as const,
    tags: candidate.tags,
    createdAt: now,
    updatedAt: now
  })).sort(compareById)

  const canonicalContent = facts.map(({ kind, text, context, tags }) => ({
    kind,
    text,
    ...(context ? { context } : {}),
    tags
  }))
  const excerpt = facts[0]?.text
  const source: EvidenceSource = {
    id: sourceId,
    type: 'resume-import',
    label: clip(normalizeRequired(options.label, 'Source label'), MAX_LABEL_LENGTH),
    ...(excerpt ? { excerpt } : {}),
    contentHash: `fnv1a64:${stableHash(JSON.stringify(canonicalContent))}`,
    createdAt: now
  }

  return { source, facts }
}

export function careerEvidenceSourceId(draftId: string) {
  return `evidence:resume:${stableHash(normalizeRequired(draftId, 'Draft ID'))}`
}

export function createCareerEvidenceService(options: {
  store?: CareerEvidenceStore
  now?: () => string
} = {}): CareerEvidenceService {
  let store = options.store
  const getStore = () => {
    store ??= createDomainStore()
    return store
  }
  const now = options.now ?? (() => new Date().toISOString())

  return {
    async importResume(input) {
      const mutationTime = now()
      const imported = buildCareerEvidenceImport(input.data, {
        draftId: input.draftId,
        label: input.label,
        now: mutationTime
      })

      const invalidatedRuns = await getStore().transaction(
        ['evidenceSources', 'careerFacts', 'optimizationRuns'],
        'readwrite',
        async (transaction) => {
          const changedFactIds: string[] = []
          await transaction.put('evidenceSources', imported.source)
          for (const fact of imported.facts) {
            const existing = await transaction.get('careerFacts', fact.id)
            const next = existing ? preserveReview(existing, fact) : fact
            await transaction.put('careerFacts', next)
            if (existing && JSON.stringify(existing) !== JSON.stringify(next)) {
              changedFactIds.push(fact.id)
            }
          }
          return invalidateRunsReferencingFacts(transaction, changedFactIds, mutationTime)
        }
      )
      if (invalidatedRuns > 0) announceWorkflowInputChange()
      announceCareerEvidenceChange()
      return imported
    },

    async listForDraft(draftId) {
      const sourceId = careerEvidenceSourceId(draftId)
      const [source, allFacts] = await Promise.all([
        getStore().get('evidenceSources', sourceId),
        getStore().list('careerFacts')
      ])
      return {
        source: source ?? null,
        facts: allFacts
          .filter((fact) => fact.evidenceRefs.includes(sourceId))
          .sort(compareById)
      }
    },

    async confirmFact(factId) {
      const mutationTime = now()
      const result = await getStore().transaction(
        ['careerFacts', 'optimizationRuns'],
        'readwrite',
        async (transaction) => {
          const current = await transaction.get('careerFacts', factId)
          if (!current) {
            throw new CareerEvidenceImportError('FACT_NOT_FOUND', `Career fact ${factId} was not found`)
          }
          if (current.verification === 'user-confirmed') {
            return { fact: current, invalidatedRuns: 0 }
          }
          const fact = await transaction.put('careerFacts', {
            ...current,
            verification: 'user-confirmed',
            updatedAt: mutationTime
          })
          return {
            fact,
            invalidatedRuns: await invalidateRunsReferencingFacts(
              transaction,
              [factId],
              mutationTime
            )
          }
        }
      )
      if (result.invalidatedRuns > 0) announceWorkflowInputChange()
      announceCareerEvidenceChange()
      return result.fact
    },

    async updateFact(factId, text) {
      const correctedText = clip(normalizeRequired(text, 'Career fact'), MAX_TEXT_LENGTH)
      const mutationTime = now()
      const result = await getStore().transaction(
        ['careerFacts', 'optimizationRuns'],
        'readwrite',
        async (transaction) => {
          const current = await transaction.get('careerFacts', factId)
          if (!current) {
            throw new CareerEvidenceImportError('FACT_NOT_FOUND', `Career fact ${factId} was not found`)
          }
          const fact = await transaction.put('careerFacts', {
            ...current,
            text: correctedText,
            verification: 'user-confirmed',
            updatedAt: mutationTime
          })
          return {
            fact,
            invalidatedRuns: await invalidateRunsReferencingFacts(
              transaction,
              [factId],
              mutationTime
            )
          }
        }
      )
      if (result.invalidatedRuns > 0) announceWorkflowInputChange()
      announceCareerEvidenceChange()
      return result.fact
    },

    async deleteFact(factId) {
      const mutationTime = now()
      const invalidatedRuns = await getStore().transaction(
        ['optimizationRuns'],
        'readwrite',
        (transaction) => invalidateRunsReferencingFacts(transaction, [factId], mutationTime)
      )
      if (invalidatedRuns > 0) announceWorkflowInputChange()
      await getStore().delete('careerFacts', factId)
      announceCareerEvidenceChange()
    },

    assertSourceDraftCanBeDeleted(draftId) {
      return getStore().assertSourceDraftCanBeDeleted(draftId)
    }
  }
}

const TERMINAL_RUN_STAGES = new Set(['applied', 'stale', 'failed', 'abandoned'])

async function invalidateRunsReferencingFacts(
  transaction: DomainStoreTransaction<'optimizationRuns'>,
  factIds: readonly string[],
  now: string
) {
  if (factIds.length === 0) return 0
  const changedIds = new Set(factIds)
  const runs = await transaction.list('optimizationRuns')
  let invalidated = 0
  for (const run of runs) {
    if (TERMINAL_RUN_STAGES.has(run.stage) || !runReferencesAnyFact(run, changedIds)) continue
    const stale = transitionOptimizationRun(run, {
      type: 'observe-input',
      currentFingerprint: `career-fact:${stableHash(JSON.stringify([...changedIds].sort()))}:${now}`
    }, now)
    await transaction.put('optimizationRuns', stale)
    invalidated += 1
  }
  return invalidated
}

function runReferencesAnyFact(run: OptimizationRun, factIds: ReadonlySet<string>) {
  const referencedIds = [
    ...run.requirementMatches.flatMap((match) => match.factIds),
    ...run.questions.flatMap((question) => question.factIds),
    ...(run.plan?.items.flatMap((item) => item.factIds) ?? []),
    ...(run.changeSet?.changes.flatMap((change) => change.evidence.factIds) ?? []),
    ...(run.scoreBefore?.contributions.flatMap((contribution) => contribution.evidenceRefs) ?? []),
    ...(run.scoreAfter?.contributions.flatMap((contribution) => contribution.evidenceRefs) ?? [])
  ]
  return referencedIds.some((id) => factIds.has(id))
}

function announceWorkflowInputChange() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ACTIVE_WORKFLOW_CHANGED_EVENT))
  }
}

function announceCareerEvidenceChange() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CAREER_EVIDENCE_CHANGED_EVENT))
}

function collectFactCandidates(data: ResumeData) {
  const candidates: FactCandidate[] = []
  const add = (candidate: Omit<FactCandidate, 'tags'> & { tags?: string[] }) => {
    const text = normalizeOptional(candidate.text)
    if (!text) return
    const context = normalizeContext(candidate.context)
    const tags = uniqueSorted((candidate.tags ?? [])
      .map((tag) => clip(normalizeOptional(tag), MAX_TAG_LENGTH))
      .filter(Boolean))
    candidates.push({
      kind: candidate.kind,
      text: clip(text, MAX_TEXT_LENGTH),
      ...(context ? { context } : {}),
      tags
    })
  }

  data.profile.summary.forEach((text) => add({ kind: 'experience', text, tags: ['summary'] }))
  data.profile.tags.forEach((text) => add({ kind: 'skill', text, tags: ['profile'] }))

  data.skills.forEach((group) => {
    group.items.forEach((text) => add({
      kind: 'skill',
      text,
      tags: group.group ? [group.group] : []
    }))
  })

  data.experiences.forEach((experience) => {
    const context = {
      company: experience.company,
      role: experience.role
    }
    if (experience.bullets.length === 0) {
      add({
        kind: 'experience',
        text: [experience.role, experience.company, experience.period].filter(Boolean).join(' · '),
        context,
        tags: experience.tags
      })
    }
    experience.bullets.forEach((text) => add({
      kind: 'experience',
      text,
      context,
      tags: experience.tags
    }))
  })

  data.projects.forEach((project) => {
    const context = { project: project.name }
    add({ kind: 'project', text: project.summary, context, tags: [project.type, ...project.tags] })
    project.highlights.forEach((text) => add({
      kind: 'project',
      text,
      context,
      tags: [project.type, ...project.tags]
    }))
  })

  data.education.forEach((education) => {
    add({
      kind: 'achievement',
      text: [education.school, education.degree, education.major, education.period]
        .filter(Boolean)
        .join(' · '),
      tags: ['education']
    })
    education.details.forEach((text) => add({ kind: 'achievement', text, tags: ['education'] }))
  })

  data.certifications.forEach((text) => add({ kind: 'achievement', text, tags: ['certification'] }))
  data.awards.forEach((text) => add({ kind: 'achievement', text, tags: ['award'] }))
  data.languages.forEach((text) => add({ kind: 'skill', text, tags: ['language'] }))
  data.openSource.forEach((text) => add({ kind: 'project', text, tags: ['open-source'] }))

  return candidates
}

function deduplicateCandidates(candidates: FactCandidate[]) {
  const byKey = new Map<string, FactCandidate>()
  for (const candidate of candidates) {
    const key = factKey(candidate)
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, candidate)
      continue
    }
    byKey.set(key, { ...existing, tags: uniqueSorted([...existing.tags, ...candidate.tags]) })
  }
  return [...byKey.values()]
}

function preserveReview(existing: CareerFact, imported: CareerFact): CareerFact {
  return {
    ...imported,
    text: existing.text,
    ...(existing.context ? { context: existing.context } : {}),
    evidenceRefs: uniqueSorted([...existing.evidenceRefs, ...imported.evidenceRefs]),
    tags: uniqueSorted([...existing.tags, ...imported.tags]),
    verification: existing.verification,
    createdAt: existing.createdAt,
    updatedAt: existing.updatedAt
  }
}

function factKey(candidate: FactCandidate) {
  return JSON.stringify({
    kind: candidate.kind,
    text: candidate.text.toLocaleLowerCase('en-US'),
    context: candidate.context
      ? Object.fromEntries(Object.entries(candidate.context).map(([key, value]) => (
          [key, value.toLocaleLowerCase('en-US')]
        )))
      : null
  })
}

function normalizeContext(context: FactCandidate['context']) {
  if (!context) return undefined
  const normalized = {
    company: clip(normalizeOptional(context.company), MAX_LABEL_LENGTH),
    role: clip(normalizeOptional(context.role), MAX_LABEL_LENGTH),
    project: clip(normalizeOptional(context.project), MAX_LABEL_LENGTH)
  }
  const present = Object.fromEntries(
    Object.entries(normalized).filter(([, value]) => Boolean(value))
  ) as NonNullable<CareerFact['context']>
  return Object.keys(present).length ? present : undefined
}

function assertTrustedSource(source: ResumeSource) {
  if (!isTrustedResumeSource(source)) {
    throw new CareerEvidenceImportError(
      'UNTRUSTED_RESUME_SOURCE',
      `Resume source ${source} cannot create career evidence`
    )
  }
}

function normalizeRequired(value: string, label: string) {
  const normalized = normalizeOptional(value)
  if (!normalized) throw new TypeError(`${label} is required`)
  return normalized
}

function normalizeOptional(value: string | undefined) {
  return (value ?? '').trim().replace(/\s+/g, ' ')
}

function clip(value: string, limit: number) {
  return value.length > limit ? value.slice(0, limit).trimEnd() : value
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort(compareStrings)
}

function compareById(left: { id: string }, right: { id: string }) {
  return compareStrings(left.id, right.id)
}

function compareStrings(left: string, right: string) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function stableHash(value: string) {
  const first = fnv1a32(value, 0x811c9dc5)
  const second = fnv1a32(value, 0x9e3779b9)
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`
}

function fnv1a32(value: string, seed: number) {
  let hash = seed >>> 0
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export type { CareerEvidenceStore }
