import { describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { createOptimizationRun } from './optimization-run'
import {
  DOMAIN_STORE_NAMES,
  DOMAIN_STORE_SCHEMA_VERSION,
  DomainStoreError,
  createDomainStore,
  type ApplicationRecord,
  type CareerFact,
  type DomainStoreName,
  type DomainStoreTransaction,
  type EvidenceSource,
  type JobPosting,
  type JobRecommendation,
  type JobRequirement,
  type JobSearchProfile,
  type JobSource,
  type RequirementMatch,
  type ResumeVariant,
  type TargetJob
} from './domain-store'
import { resumeDataSchema } from '@/lib/resume-model'
import { createBossConversationThread, createBossMessageDraft } from '@/lib/jobs/boss-conversation'
import {
  createInterviewSession,
  type InterviewQuestion,
  type InterviewReview
} from '@/lib/jobs/interview-domain'

const now = '2026-07-16T08:00:00.000Z'

const source: EvidenceSource = {
  id: 'source-1',
  type: 'resume-import',
  label: 'Imported resume',
  excerpt: 'Built a design system used by five product teams.',
  contentHash: 'sha256:source-1',
  createdAt: now
}

const fact: CareerFact = {
  id: 'fact-1',
  kind: 'achievement',
  text: 'Built a design system used by five product teams.',
  context: { company: 'Example Co', role: 'Staff Engineer' },
  evidenceRefs: [source.id],
  verification: 'imported',
  tags: ['design-systems'],
  createdAt: now,
  updatedAt: now
}

const targetJob: TargetJob = {
  id: 'job-1',
  title: 'Staff Frontend Engineer',
  company: 'Target Co',
  description: 'Lead design system architecture across multiple product teams.',
  locale: 'en',
  createdAt: now,
  updatedAt: now
}

const requirement: JobRequirement = {
  id: 'requirement-1',
  jobId: targetJob.id,
  text: 'Lead design system architecture.',
  category: 'experience',
  priority: 'must',
  weight: 5,
  keywords: ['design system'],
  userConfirmed: true
}

const match: RequirementMatch = {
  requirementId: requirement.id,
  factIds: [fact.id],
  status: 'direct',
  rationale: 'The fact directly demonstrates design system leadership.'
}

const variant: ResumeVariant = {
  id: 'variant-1',
  sourceDraftId: 'draft-1',
  targetJobId: targetJob.id,
  name: 'Target Co variant',
  data: resumeDataSchema.parse({
    profile: { name: 'Candidate', title: 'Staff Engineer' },
    metadata: { source: 'upload', locale: 'en', updatedAt: now }
  }),
  createdAt: now,
  updatedAt: now
}

const jobSource: JobSource = {
  id: 'job-source-1',
  kind: 'greenhouse',
  label: 'Target Co careers',
  sourceKey: 'target-co',
  enabled: true,
  createdAt: now,
  updatedAt: now
}

const searchProfile: JobSearchProfile = {
  id: 'job-search-profile-1',
  name: 'Staff frontend roles',
  titles: ['Staff Frontend Engineer'],
  adjacentTitles: [],
  locations: ['Remote'],
  excludedLocations: [],
  workplaceTypes: ['remote'],
  employmentTypes: ['full-time'],
  requiredTerms: ['TypeScript'],
  preferredTerms: ['design systems'],
  excludedTerms: [],
  maximumAgeDays: 30,
  createdAt: now,
  updatedAt: now
}

const jobPosting: JobPosting = {
  id: 'job-posting-1',
  sourceId: jobSource.id,
  externalId: 'posting-123',
  canonicalUrl: 'https://boards.greenhouse.io/target-co/jobs/posting-123',
  applyUrl: 'https://boards.greenhouse.io/target-co/jobs/posting-123',
  title: targetJob.title,
  company: targetJob.company ?? 'Target Co',
  description: targetJob.description,
  locale: 'en',
  location: 'Remote',
  workplaceType: 'remote',
  employmentType: 'full-time',
  firstSeenAt: now,
  lastCheckedAt: now,
  status: 'open',
  contentHash: 'fnv1a64:job-posting-1'
}

const jobRecommendation: JobRecommendation = {
  id: 'job-recommendation-1',
  postingId: jobPosting.id,
  searchProfileId: searchProfile.id,
  sourceDraftId: variant.sourceDraftId,
  rubricVersion: 'job-seeker-agent-job-relevance-v1',
  inputFingerprint: 'fnv1a64:job-recommendation-1',
  eligibility: 'eligible',
  preliminaryScore: 90,
  reasons: [{ code: 'evidence-overlap', contribution: 30, evidenceRefs: [fact.id] }],
  analyzedTargetJobId: targetJob.id,
  createdAt: now,
  updatedAt: now
}

const applicationRecord: ApplicationRecord = {
  id: 'application-record-1',
  postingId: jobPosting.id,
  sourceDraftId: variant.sourceDraftId,
  targetJobId: targetJob.id,
  resumeVariantId: variant.id,
  status: 'ready-to-apply',
  notes: '',
  createdAt: now,
  updatedAt: now
}

function createTestStore() {
  const factory = new IDBFactory()
  const databaseName = `job-seeker-agent-domain-test-${crypto.randomUUID()}`
  return {
    factory,
    databaseName,
    store: createDomainStore({ databaseName, indexedDB: factory })
  }
}

async function seedRelations(
  store: ReturnType<typeof createDomainStore>,
  options: { includeMatch?: boolean; includeVariant?: boolean; includeRun?: boolean } = {}
) {
  await store.put('evidenceSources', source)
  await store.put('careerFacts', fact)
  await store.put('targetJobs', targetJob)
  await store.put('jobRequirements', requirement)
  if (options.includeMatch) await store.put('requirementMatches', match)
  if (options.includeVariant) await store.put('resumeVariants', variant)
  if (options.includeRun) {
    await store.put('optimizationRuns', createOptimizationRun({
      id: 'run-1',
      sourceDraftId: variant.sourceDraftId,
      targetJobId: targetJob.id,
      inputFingerprint: 'fingerprint-1',
      now
    }))
  }
}

describe('IndexedDbDomainStore', () => {
  it('creates schema v4 with every required object store and relation index', async () => {
    const { factory, databaseName, store } = createTestStore()
    await store.list('evidenceSources')

    const database = await openDatabase(factory, databaseName)
    expect(database.version).toBe(DOMAIN_STORE_SCHEMA_VERSION)
    expect([...database.objectStoreNames]).toEqual([...DOMAIN_STORE_NAMES].sort())

    const transaction = database.transaction(DOMAIN_STORE_NAMES, 'readonly')
    expect([...transaction.objectStore('careerFacts').indexNames]).toContain('byEvidenceRef')
    expect([...transaction.objectStore('jobRequirements').indexNames]).toContain('byJobId')
    expect([...transaction.objectStore('resumeVariants').indexNames]).toEqual(
      expect.arrayContaining(['bySourceDraftId', 'byTargetJobId'])
    )
    expect([...transaction.objectStore('jobPostings').indexNames]).toEqual(
      expect.arrayContaining(['bySourceId', 'bySourceIdentity', 'byStatus'])
    )
    expect([...transaction.objectStore('applicationRecords').indexNames]).toEqual(
      expect.arrayContaining(['byPostingId', 'bySourceDraftId', 'byStatus'])
    )
    expect([...transaction.objectStore('bossConversationThreads').indexNames]).toContain('byApplicationId')
    expect([...transaction.objectStore('bossConversationMessages').indexNames]).toContain('byThreadId')
    expect([...transaction.objectStore('interviewSessions').indexNames]).toEqual(
      expect.arrayContaining(['byApplicationId', 'byTargetJobId', 'byStage'])
    )
    expect([...transaction.objectStore('interviewQuestions').indexNames]).toContain('bySessionId')
    expect([...transaction.objectStore('interviewReviews').indexNames]).toContain('bySessionId')
    database.close()
    await store.close()
  })

  it('supports typed put, get, list, and delete for every domain entity', async () => {
    const { store } = createTestStore()
    const run = createOptimizationRun({
      id: 'run-1',
      sourceDraftId: variant.sourceDraftId,
      targetJobId: targetJob.id,
      inputFingerprint: 'fingerprint-1',
      now
    })

    await store.put('evidenceSources', source)
    await store.put('careerFacts', fact)
    await store.put('targetJobs', targetJob)
    await store.put('jobRequirements', requirement)
    await store.put('requirementMatches', match)
    await store.put('resumeVariants', variant)
    await store.put('optimizationRuns', run)
    await store.put('jobSources', jobSource)
    await store.put('jobSearchProfiles', searchProfile)
    await store.put('jobPostings', jobPosting)
    await store.put('jobRecommendations', jobRecommendation)
    await store.put('applicationRecords', applicationRecord)
    const thread = createBossConversationThread({ applicationId: applicationRecord.id, now })
    const message = createBossMessageDraft({
      threadId: thread.id, kind: 'opener', body: 'Hello', evidenceFactIds: [fact.id], now
    })
    await store.put('bossConversationThreads', thread)
    await store.put('bossConversationMessages', message)
    const session = createInterviewSession({
      applicationId: applicationRecord.id,
      targetJobId: targetJob.id,
      round: 1,
      format: 'video',
      scheduledAt: '2026-07-18T08:00:00.000Z',
      now
    })
    const question: InterviewQuestion = {
      id: 'interview-question-1',
      sessionId: session.id,
      question: 'How did you measure the design system impact?',
      userAnswer: 'We tracked adoption across five product teams.',
      suggestedAnswer: '',
      feedback: '',
      tags: ['system-design'],
      createdAt: now,
      updatedAt: now
    }
    const review: InterviewReview = {
      id: 'interview-review-1',
      sessionId: session.id,
      inputFingerprint: 'fnv1a64:interview-review-1',
      summary: 'The answer used grounded evidence.',
      strengths: ['Specific scope'],
      gaps: ['Explain the baseline'],
      suggestions: ['Add the before-and-after metric'],
      prediction: {
        outcome: 'uncertain',
        passProbability: 0.55,
        confidence: 0.4,
        rationale: ['Only one answer was provided.'],
        disclaimer: 'Advisory estimate only; the employer decides the outcome.'
      },
      model: 'test-model',
      createdAt: now,
      updatedAt: now
    }
    await store.put('interviewSessions', session)
    await store.put('interviewQuestions', question)
    await store.put('interviewReviews', review)

    expect(await store.get('evidenceSources', source.id)).toEqual(source)
    expect(await store.get('careerFacts', fact.id)).toEqual(fact)
    expect(await store.get('targetJobs', targetJob.id)).toEqual(targetJob)
    expect(await store.get('jobRequirements', requirement.id)).toEqual(requirement)
    expect(await store.get('requirementMatches', requirement.id)).toEqual(match)
    expect(await store.get('resumeVariants', variant.id)).toEqual(variant)
    expect(await store.get('optimizationRuns', run.id)).toEqual(run)
    expect(await store.get('jobSources', jobSource.id)).toEqual(jobSource)
    expect(await store.get('jobSearchProfiles', searchProfile.id)).toEqual(searchProfile)
    expect(await store.get('jobPostings', jobPosting.id)).toEqual(jobPosting)
    expect(await store.get('jobRecommendations', jobRecommendation.id)).toEqual(jobRecommendation)
    expect(await store.get('applicationRecords', applicationRecord.id)).toEqual(applicationRecord)
    expect(await store.get('bossConversationThreads', thread.id)).toEqual(thread)
    expect(await store.get('bossConversationMessages', message.id)).toEqual(message)
    expect(await store.get('interviewSessions', session.id)).toEqual(session)
    expect(await store.get('interviewQuestions', question.id)).toEqual(question)
    expect(await store.get('interviewReviews', review.id)).toEqual(review)
    expect(await store.list('careerFacts')).toEqual([fact])

    await store.delete('interviewReviews', review.id)
    await store.delete('interviewQuestions', question.id)
    await store.delete('interviewSessions', session.id)
    await store.delete('bossConversationMessages', message.id)
    await store.delete('bossConversationThreads', thread.id)
    await store.delete('applicationRecords', applicationRecord.id)
    await store.delete('jobRecommendations', jobRecommendation.id)
    await store.delete('jobPostings', jobPosting.id)
    await store.delete('jobSearchProfiles', searchProfile.id)
    await store.delete('jobSources', jobSource.id)
    await store.delete('requirementMatches', requirement.id)
    await store.delete('optimizationRuns', run.id)
    await store.delete('resumeVariants', variant.id)
    await store.delete('jobRequirements', requirement.id)
    await store.delete('targetJobs', targetJob.id)
    await store.delete('careerFacts', fact.id)
    await store.delete('evidenceSources', source.id)

    for (const storeName of DOMAIN_STORE_NAMES) {
      expect(await store.list(storeName)).toEqual([])
    }
    await store.close()
  })

  it('queries source-draft and conversation relations through IndexedDB indexes', async () => {
    const { store } = createTestStore()
    await seedRelations(store, { includeVariant: true })
    await store.put('jobSources', jobSource)
    await store.put('jobSearchProfiles', searchProfile)
    await store.put('jobPostings', jobPosting)
    await store.put('jobRecommendations', jobRecommendation)
    await store.put('jobRecommendations', {
      ...jobRecommendation,
      id: 'job-recommendation-2',
      sourceDraftId: 'draft-2'
    })
    await store.put('applicationRecords', applicationRecord)
    await store.put('applicationRecords', {
      id: 'application-record-2',
      postingId: jobPosting.id,
      sourceDraftId: 'draft-2',
      status: 'saved',
      notes: '',
      createdAt: now,
      updatedAt: now
    })
    const thread = createBossConversationThread({ applicationId: applicationRecord.id, now })
    const message = createBossMessageDraft({
      threadId: thread.id, kind: 'opener', body: 'Hello', evidenceFactIds: [fact.id], now
    })
    await store.put('bossConversationThreads', thread)
    await store.put('bossConversationMessages', message)

    await expect(store.listByIndex('jobRecommendations', 'bySourceDraftId', 'draft-1'))
      .resolves.toEqual([jobRecommendation])
    await expect(store.listByIndex('applicationRecords', 'bySourceDraftId', 'draft-1'))
      .resolves.toEqual([applicationRecord])
    await expect(store.listByIndex('bossConversationThreads', 'byApplicationId', applicationRecord.id))
      .resolves.toEqual([thread])
    await expect(store.listByIndex('bossConversationMessages', 'byThreadId', thread.id))
      .resolves.toEqual([message])
    await store.close()
  })

  it('keeps unrelated stores outside a focused write transaction', async () => {
    const { store } = createTestStore()
    await expectErrorCode(store.transaction(['jobSources'], 'readwrite', (transaction) => (
      (transaction as DomainStoreTransaction<DomainStoreName>).list('interviewReviews')
    )), 'TRANSACTION_FAILED')
    await store.close()
  })

  it('validates records and rejects original document bytes instead of storing them', async () => {
    const { store } = createTestStore()
    const sourceWithBytes = {
      ...source,
      bytes: new Uint8Array([1, 2, 3])
    } as EvidenceSource

    await expectErrorCode(
      store.put('evidenceSources', sourceWithBytes),
      'VALIDATION_FAILED'
    )
    expect(await store.get('evidenceSources', source.id)).toBeUndefined()
    await store.close()
  })

  it('rejects missing evidence and fact references without partial writes', async () => {
    const { store } = createTestStore()

    await expectErrorCode(store.put('careerFacts', fact), 'REFERENTIAL_INTEGRITY')
    expect(await store.get('careerFacts', fact.id)).toBeUndefined()

    await store.put('targetJobs', targetJob)
    await store.put('jobRequirements', requirement)
    await expectErrorCode(store.put('requirementMatches', match), 'REFERENTIAL_INTEGRITY')
    expect(await store.get('requirementMatches', match.requirementId)).toBeUndefined()
    await store.close()
  })

  it('rejects missing job-domain references and unrelated resume variants', async () => {
    const { store } = createTestStore()

    await expectErrorCode(store.put('jobPostings', jobPosting), 'REFERENTIAL_INTEGRITY')
    await store.put('jobSources', jobSource)
    await store.put('jobPostings', jobPosting)
    await expectErrorCode(
      store.put('jobRecommendations', jobRecommendation),
      'REFERENTIAL_INTEGRITY'
    )

    await store.put('targetJobs', targetJob)
    await store.put('jobSearchProfiles', searchProfile)
    await store.put('evidenceSources', source)
    await store.put('careerFacts', fact)
    await store.put('resumeVariants', variant)
    await store.put('jobRecommendations', jobRecommendation)

    await expectErrorCode(
      store.put('applicationRecords', {
        ...applicationRecord,
        sourceDraftId: 'different-draft'
      }),
      'REFERENTIAL_INTEGRITY'
    )
    expect(await store.get('applicationRecords', applicationRecord.id)).toBeUndefined()
    await store.close()
  })

  it('atomically rolls back a multi-store transaction when relation validation fails', async () => {
    const { store } = createTestStore()
    const invalidMatch = { ...match, factIds: ['missing-fact'] }

    await expectErrorCode(
      store.transaction(
        ['targetJobs', 'jobRequirements', 'requirementMatches'],
        'readwrite',
        async (transaction) => {
          await transaction.put('targetJobs', targetJob)
          await transaction.put('jobRequirements', requirement)
          await transaction.put('requirementMatches', invalidMatch)
        }
      ),
      'REFERENTIAL_INTEGRITY'
    )

    expect(await store.get('targetJobs', targetJob.id)).toBeUndefined()
    expect(await store.get('jobRequirements', requirement.id)).toBeUndefined()
    await store.close()
  })

  it('restricts deletes that would orphan evidence, matches, jobs, or variants', async () => {
    const { store } = createTestStore()
    await seedRelations(store, { includeMatch: true, includeVariant: true, includeRun: true })

    await expectErrorCode(store.delete('evidenceSources', source.id), 'DELETE_RESTRICTED')
    await expectErrorCode(store.delete('careerFacts', fact.id), 'DELETE_RESTRICTED')
    await expectErrorCode(store.delete('jobRequirements', requirement.id), 'DELETE_RESTRICTED')
    await expectErrorCode(store.delete('targetJobs', targetJob.id), 'DELETE_RESTRICTED')
    await store.close()
  })

  it('restricts deletes that would orphan job postings and application history', async () => {
    const { store } = createTestStore()
    await seedRelations(store, { includeVariant: true })
    await store.put('jobSources', jobSource)
    await store.put('jobSearchProfiles', searchProfile)
    await store.put('jobPostings', jobPosting)
    await store.put('jobRecommendations', jobRecommendation)
    await store.put('applicationRecords', applicationRecord)

    await expectErrorCode(store.delete('jobSources', jobSource.id), 'DELETE_RESTRICTED')
    await expectErrorCode(store.delete('jobSearchProfiles', searchProfile.id), 'DELETE_RESTRICTED')
    await expectErrorCode(store.delete('jobPostings', jobPosting.id), 'DELETE_RESTRICTED')
    await expectErrorCode(store.delete('careerFacts', fact.id), 'DELETE_RESTRICTED')
    await expectErrorCode(store.delete('resumeVariants', variant.id), 'DELETE_RESTRICTED')
    await store.close()
  })

  it('reports source-draft dependents instead of silently cascading their deletion', async () => {
    const { store } = createTestStore()
    await seedRelations(store, { includeVariant: true, includeRun: true })

    await expect(store.sourceDraftReferences(variant.sourceDraftId)).resolves.toEqual({
      resumeVariantIds: [variant.id],
      optimizationRunIds: ['run-1'],
      jobRecommendationIds: [],
      applicationRecordIds: []
    })
    await expectErrorCode(
      store.assertSourceDraftCanBeDeleted(variant.sourceDraftId),
      'DELETE_RESTRICTED'
    )
    await expect(store.assertSourceDraftCanBeDeleted('unreferenced-draft')).resolves.toBeUndefined()
    await store.close()
  })

  it('rejects writes requested through a readonly transaction', async () => {
    const { store } = createTestStore()
    await expectErrorCode(
      store.transaction(['evidenceSources'], 'readonly', (transaction) => {
        return transaction.put('evidenceSources', source)
      }),
      'READ_ONLY_TRANSACTION'
    )
    await store.close()
  })

  it('returns an explicit error when IndexedDB is unavailable', async () => {
    const store = createDomainStore({ indexedDB: null })
    await expectErrorCode(store.list('careerFacts'), 'INDEXEDDB_UNAVAILABLE')
  })

  it('does not open a database created with an unsupported future schema version', async () => {
    const factory = new IDBFactory()
    const databaseName = `job-seeker-agent-domain-future-${crypto.randomUUID()}`
    const future = await openDatabase(factory, databaseName, DOMAIN_STORE_SCHEMA_VERSION + 1)
    future.close()

    const store = createDomainStore({ databaseName, indexedDB: factory })
    await expectErrorCode(store.list('targetJobs'), 'OPEN_FAILED')
  })

  it('migrates schema v1 records to v4 without clearing existing data', async () => {
    const factory = new IDBFactory()
    const databaseName = `job-seeker-agent-domain-v1-${crypto.randomUUID()}`
    const legacy = await createVersionOneDatabase(factory, databaseName)
    const transaction = legacy.transaction(['evidenceSources', 'targetJobs'], 'readwrite')
    transaction.objectStore('evidenceSources').put(source)
    transaction.objectStore('targetJobs').put(targetJob)
    await waitForNativeTransaction(transaction)
    legacy.close()

    const store = createDomainStore({ databaseName, indexedDB: factory })
    await expect(store.list('evidenceSources')).resolves.toEqual([source])
    await expect(store.list('targetJobs')).resolves.toEqual([targetJob])
    await expect(store.list('jobSources')).resolves.toEqual([])

    const migrated = await openDatabase(factory, databaseName)
    expect(migrated.version).toBe(DOMAIN_STORE_SCHEMA_VERSION)
    expect([...migrated.objectStoreNames]).toEqual([...DOMAIN_STORE_NAMES].sort())
    migrated.close()
    await store.close()
  })

  it('adds BOSS conversation stores to schema v2 without clearing job data', async () => {
    const factory = new IDBFactory()
    const databaseName = `job-seeker-agent-domain-v2-${crypto.randomUUID()}`
    const legacy = await createVersionTwoDatabase(factory, databaseName)
    legacy.close()

    const store = createDomainStore({ databaseName, indexedDB: factory })
    await expect(store.list('bossConversationThreads')).resolves.toEqual([])
    await expect(store.list('bossConversationMessages')).resolves.toEqual([])
    const migrated = await openDatabase(factory, databaseName)
    expect(migrated.version).toBe(DOMAIN_STORE_SCHEMA_VERSION)
    expect([...migrated.objectStoreNames]).toEqual([...DOMAIN_STORE_NAMES].sort())
    migrated.close()
    await store.close()
  })

  it('adds interview stores to schema v3 without clearing conversations', async () => {
    const factory = new IDBFactory()
    const databaseName = `job-seeker-agent-domain-v3-${crypto.randomUUID()}`
    const legacy = await createVersionThreeDatabase(factory, databaseName)
    legacy.close()

    const store = createDomainStore({ databaseName, indexedDB: factory })
    await expect(store.list('interviewSessions')).resolves.toEqual([])
    await expect(store.list('interviewQuestions')).resolves.toEqual([])
    await expect(store.list('interviewReviews')).resolves.toEqual([])
    const migrated = await openDatabase(factory, databaseName)
    expect(migrated.version).toBe(DOMAIN_STORE_SCHEMA_VERSION)
    expect([...migrated.objectStoreNames]).toEqual([...DOMAIN_STORE_NAMES].sort())
    migrated.close()
    await store.close()
  })
})

async function expectErrorCode(
  operation: Promise<unknown>,
  code: DomainStoreError['code']
) {
  try {
    await operation
    throw new Error(`Expected ${code}`)
  } catch (error) {
    expect(error).toBeInstanceOf(DomainStoreError)
    expect((error as DomainStoreError).code).toBe(code)
  }
}

function openDatabase(factory: IDBFactory, name: string, version?: number) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = version === undefined ? factory.open(name) : factory.open(name, version)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function createVersionOneDatabase(factory: IDBFactory, name: string) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, 1)
    request.onupgradeneeded = () => {
      const database = request.result
      database.createObjectStore('evidenceSources', { keyPath: 'id' })
        .createIndex('byCreatedAt', 'createdAt')
      const facts = database.createObjectStore('careerFacts', { keyPath: 'id' })
      facts.createIndex('byEvidenceRef', 'evidenceRefs', { multiEntry: true })
      facts.createIndex('byUpdatedAt', 'updatedAt')
      database.createObjectStore('targetJobs', { keyPath: 'id' })
        .createIndex('byUpdatedAt', 'updatedAt')
      database.createObjectStore('jobRequirements', { keyPath: 'id' })
        .createIndex('byJobId', 'jobId')
      database.createObjectStore('requirementMatches', { keyPath: 'requirementId' })
        .createIndex('byFactId', 'factIds', { multiEntry: true })
      const variants = database.createObjectStore('resumeVariants', { keyPath: 'id' })
      variants.createIndex('bySourceDraftId', 'sourceDraftId')
      variants.createIndex('byTargetJobId', 'targetJobId')
      variants.createIndex('byUpdatedAt', 'updatedAt')
      const runs = database.createObjectStore('optimizationRuns', { keyPath: 'id' })
      runs.createIndex('bySourceDraftId', 'sourceDraftId')
      runs.createIndex('byTargetJobId', 'targetJobId')
      runs.createIndex('byUpdatedAt', 'updatedAt')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function createVersionTwoDatabase(factory: IDBFactory, name: string) {
  const legacyStores = DOMAIN_STORE_NAMES.filter((store) => (
    !store.startsWith('bossConversation') && !store.startsWith('interview')
  ))
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, 2)
    request.onupgradeneeded = () => {
      for (const store of legacyStores) {
        request.result.createObjectStore(store, {
          keyPath: store === 'requirementMatches' ? 'requirementId' : 'id'
        })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function createVersionThreeDatabase(factory: IDBFactory, name: string) {
  const legacyStores = DOMAIN_STORE_NAMES.filter((store) => !store.startsWith('interview'))
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, 3)
    request.onupgradeneeded = () => {
      for (const store of legacyStores) {
        request.result.createObjectStore(store, {
          keyPath: store === 'requirementMatches' ? 'requirementId' : 'id'
        })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function waitForNativeTransaction(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error)
    transaction.onerror = () => reject(transaction.error)
  })
}
