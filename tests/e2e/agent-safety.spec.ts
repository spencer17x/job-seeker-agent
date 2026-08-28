import { expect, test, type Page, type Route } from '@playwright/test'
import { buildJDRequirementAnalysis, type JDMatchReport } from '../../lib/agent/jd-report'
import { scoreRequirementMatrix, type RequirementMatrix } from '../../lib/agent/requirement-matrix'
import { fingerprintOptimizationInputs } from '../../lib/agent/workflow-persistence'
import type { CareerFact, EvidenceSource, ResumeVariant } from '../../lib/agent/domain-store'
import type { OptimizationRun } from '../../lib/agent/optimization-run'
import { normalizeResumeData, type ResumeData, type ResumeDraft } from '../../lib/resume-model'

const now = '2026-07-16T08:00:00.000Z'
const later = '2026-07-17T08:00:00.000Z'
const draftId = 'draft-safety'
const targetJob = {
  id: 'job-safety',
  title: 'Staff Platform Engineer',
  company: 'Evidence Labs',
  description: 'Lead reliable platform delivery across product teams.',
  locale: 'en' as const,
  createdAt: now,
  updatedAt: now
}
const requirement = {
  id: 'requirement-safety',
  jobId: targetJob.id,
  text: 'Lead reliable platform delivery across product teams.',
  category: 'experience' as const,
  priority: 'must' as const,
  weight: 5,
  keywords: ['platform', 'leadership'],
  userConfirmed: true
}
const evidenceSource: EvidenceSource = {
  id: 'evidence-safety',
  type: 'user-answer',
  label: 'Confirmed safety-test evidence',
  excerpt: 'Led reliable platform delivery across five product teams.',
  createdAt: now
}
const careerFact: CareerFact = {
  id: 'fact-safety',
  kind: 'experience',
  text: 'Led reliable platform delivery across five product teams.',
  evidenceRefs: [evidenceSource.id],
  verification: 'user-confirmed',
  tags: ['platform'],
  createdAt: now,
  updatedAt: now
}
const supportedMatch = {
  requirementId: requirement.id,
  factIds: [careerFact.id],
  status: 'direct' as const,
  rationale: 'The confirmed fact directly supports this requirement.'
}
const gapMatch = {
  requirementId: requirement.id,
  factIds: [],
  status: 'gap' as const,
  rationale: 'No verified career fact supports this requirement.'
}
const proposedSummary = 'Platform engineer who led reliable delivery across five product teams.'
const boundedProposal = 'Led reliable platform delivery across five product teams.'
const workflowPlanSummary = 'Rewrite one narrative leaf using the confirmed platform fact.'
const workflowChangeSummary = 'One evidence-linked rewrite is ready for review.'
const workflowQuestion = `Do you have a verifiable career fact for this requirement: ${requirement.text}`

const workflowJDReport: JDMatchReport = {
  jobTitle: targetJob.title,
  company: targetJob.company,
  requirements: [{
    text: requirement.text,
    category: requirement.category,
    priority: requirement.priority,
    weight: requirement.weight,
    keywords: requirement.keywords
  }],
  resumeEmphasis: ['Use verified platform delivery evidence.'],
  interviewPrep: ['Prepare a concrete leadership example.']
}

type DomainSeed = {
  evidenceSources: EvidenceSource[]
  careerFacts: CareerFact[]
  targetJobs: typeof targetJob[]
  jobRequirements: typeof requirement[]
  requirementMatches: Array<typeof supportedMatch | typeof gapMatch>
  resumeVariants: unknown[]
  optimizationRuns: OptimizationRun[]
}

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop Evidence Agent safety coverage')
})

test('Studio initializes and uses the saved Chrome preference without an AI route', async ({ page }) => {
  const apiRequests = await blockApiRoutes(page)
  await installChromeLanguageModel(page, {
    profile: {
      name: 'Local Demo Candidate',
      title: 'Agent Engineer',
      summary: ['Builds bounded local-first AI workflows.'],
      tags: ['Agent'],
      links: []
    },
    targetRole: 'Untrusted model role',
    skills: [{ group: 'AI', items: ['Structured output'] }],
    experiences: [],
    projects: [],
    education: [],
    certifications: [],
    awards: [],
    languages: ['English'],
    openSource: []
  })

  await page.goto('/en/studio')
  const studio = page.getByRole('application', { name: 'Resume Studio' })
  await studio.getByRole('tab', { name: 'Demo / Sandbox' }).click()
  await studio.getByRole('textbox', { name: 'Target role' }).fill('Local Agent Engineer')
  await studio.getByRole('button', { name: 'Generate demo resume' }).click()

  await expect(studio.getByRole('heading', { name: 'Local Demo Candidate' })).toBeVisible()
  await expect(studio.getByText('browser-managed')).toBeVisible()
  await expect(studio.getByText('Local Agent Engineer', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => JSON.parse(
    localStorage.getItem('job-seeker-agent-ai-provider-preference-v1') ?? 'null'
  ))).toEqual({
    version: 1,
    mode: 'chrome-built-in',
    allowCloudFallback: false
  })
  expect(apiRequests).toEqual([])
})

test('Chrome local JD extraction never invokes a JobSeeker Agent AI route', async ({ page }) => {
  const draft = resumeDraft()
  const apiRequests = await blockApiRoutes(page)
  await prepareOrigin(page, { draft })
  await installChromeLanguageModel(page, {
    jobTitle: 'Staff Platform Engineer',
    company: 'Evidence Labs',
    requirements: [{
      text: requirement.text,
      category: requirement.category,
      priority: requirement.priority,
      weight: requirement.weight,
      keywords: requirement.keywords
    }],
    resumeEmphasis: ['Use verified platform delivery evidence.'],
    interviewPrep: ['Prepare a concrete leadership example.']
  })
  await setProviderPreference(page, 'chrome-built-in', false)

  await page.goto('/en/jd-match')
  const app = page.getByRole('application', { name: 'Target Job' })
  await app.getByRole('textbox', { name: 'Job description' }).fill(targetJob.description)
  await app.getByRole('button', { name: 'Extract requirements' }).click()

  await expect(app.getByRole('heading', { name: 'Extracted requirement matrix' })).toBeVisible()
  await expect(app.getByRole('heading', { name: requirement.text })).toBeVisible()
  await expect(app.getByText(/Chrome Built-in AI \(Beta\)/)).toBeVisible()
  expect(apiRequests).toEqual([])
  await expect.poll(() => readActiveWorkflowPreference(page)).toBeNull()
  await app.getByRole('button', { name: 'Confirm requirement' }).click()
  await app.getByRole('button', { name: 'Create Agent run' }).click()
  await expect.poll(() => readDomainRecords(page, 'optimizationRuns')).toHaveLength(1)
})

test('mocked Chrome completes the JD-to-bounded-rewrite workflow without any AI API request', async ({ page }) => {
  const draft = resumeDraft()
  const apiRequests = await blockApiRoutes(page)
  await prepareOrigin(page, { draft })
  await installChromeWorkflowLanguageModel(page)
  await setProviderPreference(page, 'chrome-built-in', false)

  await completeCoreWorkflowFromJd(page)

  expect(apiRequests).toEqual([])
  await expectAppliedVariant(page, draft)
})

test('explicit Settings consent enables BYOK cloud fallback when Chrome is unavailable', async ({ page }) => {
  const draft = resumeDraft()
  const cloudRequests = await installCloudWorkflowRoutes(page)
  await prepareOrigin(page, { draft })
  await installUnavailableChromeLanguageModel(page)

  await page.goto('/en/settings')
  const automatic = page.getByRole('radio', { name: /Automatic/ })
  await automatic.check()
  const fallback = page.getByRole('checkbox', { name: /Allow explicit cloud fallback/ })
  await fallback.check()
  await expect(fallback).toBeChecked()
  await page.getByRole('textbox', { name: 'API Base URL' }).fill('https://byok.example/v1')
  await page.getByRole('textbox', { name: 'Model' }).fill('e2e-cloud-model')
  await page.getByRole('textbox', { name: 'API Key', exact: true }).fill('sk-e2e-browser-key')
  await page.getByRole('button', { name: 'Save AI configuration' }).click()
  await expect(page.getByRole('status')).toContainText(
    'Configuration saved. The key stays in this session only.'
  )

  await completeCoreWorkflowFromJd(page)

  expect(cloudRequests).toEqual([
    'POST /api/jd-match',
    'POST /api/resume/plan',
    'POST /api/resume/optimize'
  ])
  await expectAppliedVariant(page, draft)
})

test('local unavailability with fallback disabled keeps manual resume work usable', async ({ page }) => {
  const draft = resumeDraft()
  const apiRequests = await blockApiRoutes(page)
  await prepareOrigin(page, { draft })
  await installUnavailableChromeLanguageModel(page)
  await setProviderPreference(page, 'automatic', false)

  await page.goto('/en/jd-match')
  const matchApp = page.getByRole('application', { name: 'Target Job' })
  await matchApp.getByRole('textbox', { name: 'Job description' }).fill(targetJob.description)
  await matchApp.getByRole('button', { name: 'Extract requirements' }).click()

  await expect(matchApp.getByRole('alert')).toContainText('cloud fallback is disabled')
  expect(apiRequests).toEqual([])

  await page.goto('/en/studio')
  const studio = page.getByRole('application', { name: 'Resume Studio' })
  const name = studio.getByRole('textbox', { name: 'Draft name' })
  await name.fill('Manual Resume')
  await studio.getByRole('button', { name: 'Save draft name' }).click()
  await expect.poll(() => readActiveDraftName(page)).toBe('Manual Resume')
  expect(apiRequests).toEqual([])
})

test('awaiting plan approval survives a reload and resumes from the saved plan', async ({ page }) => {
  const draft = resumeDraft()
  const matrix = requirementMatrix([supportedMatch])
  const run = optimizationRun({ matrix, stage: 'awaiting-plan-approval' })
  await blockApiRoutes(page)
  await prepareOrigin(page, {
    draft,
    activeWorkflow: true,
    domain: domainSeed({ run, matches: [supportedMatch] })
  })

  await page.goto('/en/agent')
  let app = page.getByRole('application', { name: 'Resume Agent' })
  await expect(app.getByText('Use the confirmed platform evidence in the profile summary.')).toBeVisible()
  await expect(app.getByRole('button', { name: 'Approve plan' })).toBeVisible()

  await page.reload()
  app = page.getByRole('application', { name: 'Resume Agent' })
  await expect(app.getByText('Use the confirmed platform evidence in the profile summary.')).toBeVisible()
  await app.getByRole('button', { name: 'Approve plan' }).click()
  await expect(app.getByText('Plan approved. Evidence-linked change generation is now unlocked.')).toBeVisible()
  await expect.poll(async () => {
    const runs = await readDomainRecords<OptimizationRun>(page, 'optimizationRuns')
    return runs[0]?.stage
  }).toBe('generating-changes')
})

test('awaiting answers survives a reload and can continue with the saved career fact', async ({ page }) => {
  const draft = resumeDraft()
  const matrix = requirementMatrix([gapMatch])
  const run = awaitingAnswersOptimizationRun(matrix)
  const apiRequests = await blockApiRoutes(page)
  await prepareOrigin(page, {
    draft,
    activeWorkflow: true,
    domain: domainSeed({ run, matches: [gapMatch] })
  })

  await page.goto('/en/agent')
  let app = page.getByRole('application', { name: 'Resume Agent' })
  await expect(app.getByText(workflowQuestion)).toBeVisible()

  await page.reload()
  app = page.getByRole('application', { name: 'Resume Agent' })
  const workflow = app.getByRole('region', { name: targetJob.title })
  await expect(workflow.getByText(workflowQuestion)).toBeVisible()
  await expect(workflow.getByRole('combobox', { name: 'Existing career fact' })).toHaveValue(
    careerFact.id
  )
  await workflow.getByRole('button', { name: 'Link & confirm fact' }).click()

  await expect(workflow.getByText(
    'Evidence mapping is complete. Review the optimization plan next.'
  )).toBeVisible()
  await expect.poll(async () => {
    const runs = await readDomainRecords<OptimizationRun>(page, 'optimizationRuns')
    return runs[0]?.stage
  }).toBe('evidence-mapped')
  await expect.poll(async () => {
    const matches = await readDomainRecords<typeof supportedMatch>(page, 'requirementMatches')
    return matches[0]?.factIds
  }).toEqual([careerFact.id])
  expect(apiRequests).toEqual([])
})

test('changing the source resume marks persisted proposals stale and prevents apply', async ({ page }) => {
  const draft = resumeDraft()
  const matrix = requirementMatrix([supportedMatch])
  const changeFingerprint = fingerprintOptimizationInputs({
    sourceDraftId: draft.id,
    resume: draft.data,
    targetJob,
    requirements: matrix.requirements,
    requirementMatches: matrix.matches,
    careerFacts: [careerFact]
  })
  const run = optimizationRun({
    matrix,
    stage: 'awaiting-change-approval',
    changeFingerprint,
    changeSet: supportedChangeSet()
  })
  await blockApiRoutes(page)
  await prepareOrigin(page, {
    draft,
    activeWorkflow: true,
    domain: domainSeed({ run, matches: [supportedMatch] })
  })

  await page.goto('/en/agent')
  const app = page.getByRole('application', { name: 'Resume Agent' })
  await expect(app.getByRole('button', { name: `Accept ${proposedSummary}` })).toBeVisible()

  const changedDraft: ResumeDraft = {
    ...draft,
    updatedAt: later,
    data: {
      ...draft.data,
      profile: {
        ...draft.data.profile,
        summary: ['The master resume changed in another tab.']
      },
      metadata: { ...draft.data.metadata, updatedAt: later }
    }
  }
  await publishExternalDraft(page, changedDraft)

  await expect(app.getByRole('alert')).toContainText('The resume changed while the Agent was working')
  await expect(app.getByRole('button', { name: `Accept ${proposedSummary}` })).toHaveCount(0)
  await expect.poll(async () => {
    const runs = await readDomainRecords<OptimizationRun>(page, 'optimizationRuns')
    return runs[0]?.stage
  }).toBe('stale')
  await expect.poll(() => readDomainRecords(page, 'resumeVariants')).toHaveLength(0)
})

test('unsupported proposals expose no enabled apply path and create no variant', async ({ page }) => {
  const draft = resumeDraft()
  const matrix = requirementMatrix([gapMatch])
  const changeFingerprint = fingerprintOptimizationInputs({
    sourceDraftId: draft.id,
    resume: draft.data,
    targetJob,
    requirements: matrix.requirements,
    requirementMatches: matrix.matches,
    careerFacts: []
  })
  const unsupportedProposal = 'Increased platform revenue by 300%.'
  const run = optimizationRun({
    matrix,
    stage: 'awaiting-change-approval',
    changeFingerprint,
    changeSet: {
      summary: 'One unsupported proposal requires evidence.',
      changes: [{
        id: 'change-unsupported',
        path: 'profile.summary.0',
        original: draft.data.profile.summary[0],
        proposed: unsupportedProposal,
        reason: 'This claim has no supporting career fact.',
        needsConfirmation: true,
        evidence: {
          requirementIds: [requirement.id],
          factIds: [],
          matchType: 'gap',
          support: 'unsupported',
          confidence: 0,
          transformation: 'rewrite'
        }
      }],
      questions: ['What evidence supports this outcome?']
    }
  })
  await blockApiRoutes(page)
  await prepareOrigin(page, {
    draft,
    activeWorkflow: true,
    domain: domainSeed({ run, matches: [gapMatch], includeFact: false })
  })

  await page.goto('/en/agent')
  const app = page.getByRole('application', { name: 'Resume Agent' })
  await expect(app.locator('.resume-agent-app__blocked-reason')).toHaveText(
    'Blocked: no verified supporting evidence'
  )
  const accept = app.getByRole('button', { name: `Accept ${unsupportedProposal}` })
  await expect(accept).toBeDisabled()
  await expect(app.getByRole('button', { name: 'Accept all suggestions' })).toBeDisabled()
  await accept.evaluate((button: HTMLButtonElement) => button.click())

  await expect.poll(async () => {
    const runs = await readDomainRecords<OptimizationRun>(page, 'optimizationRuns')
    return runs[0]?.stage
  }).toBe('awaiting-change-approval')
  await expect.poll(() => readDomainRecords(page, 'resumeVariants')).toHaveLength(0)
})

function resumeData(): ResumeData {
  return normalizeResumeData({
    profile: {
      name: 'Ada Candidate',
      title: 'Platform Engineer',
      summary: ['Builds reliable systems.'],
      tags: ['Platform'],
      links: []
    },
    targetRole: 'Staff Platform Engineer',
    skills: [{ group: 'Core', items: ['TypeScript'] }],
    experiences: [{
      company: 'Example Co',
      role: 'Platform Engineer',
      period: '2022 - Present',
      location: 'Remote',
      tags: ['Platform'],
      bullets: ['Led platform delivery across five product teams.']
    }],
    projects: [],
    education: [],
    certifications: [],
    awards: [],
    languages: ['English'],
    openSource: [],
    metadata: { source: 'paste', locale: 'en', updatedAt: now }
  })
}

function resumeDraft(): ResumeDraft {
  return {
    id: draftId,
    name: 'Safety Resume',
    source: 'paste',
    createdAt: now,
    updatedAt: now,
    data: resumeData(),
    snapshots: []
  }
}

function requirementMatrix(matches: RequirementMatrix['matches']): RequirementMatrix {
  return {
    version: 1,
    targetJobId: targetJob.id,
    inputFingerprint: 'matrix-safety-v1',
    requirements: [requirement],
    matches
  }
}

function optimizationRun(input: {
  matrix: RequirementMatrix
  stage: 'awaiting-plan-approval' | 'awaiting-change-approval'
  changeFingerprint?: string
  changeSet?: OptimizationRun['changeSet']
}): OptimizationRun {
  const approvedAt = input.stage === 'awaiting-change-approval' ? '2026-07-16T08:05:00.000Z' : undefined
  return {
    version: 1,
    id: 'run-safety',
    sourceDraftId: draftId,
    targetJobId: targetJob.id,
    stage: input.stage,
    inputFingerprint: input.matrix.inputFingerprint,
    requirementMatches: input.matrix.matches,
    questions: [],
    plan: {
      id: 'plan-safety',
      summary: 'Use the confirmed platform evidence in the profile summary.',
      items: [{
        id: 'plan-item-safety',
        requirementIds: [requirement.id],
        factIds: input.matrix.matches.flatMap((match) => match.factIds),
        targetPath: 'profile.summary.0',
        intent: 'Make the available platform evidence easy to review.',
        transformation: 'rewrite'
      }],
      ...(approvedAt ? { approvedAt } : {})
    },
    ...(input.changeSet ? { changeSet: input.changeSet } : {}),
    ...(input.changeFingerprint ? { changeInputFingerprint: input.changeFingerprint } : {}),
    scoreBefore: scoreRequirementMatrix(input.matrix),
    createdAt: now,
    updatedAt: approvedAt ?? now
  }
}

function awaitingAnswersOptimizationRun(matrix: RequirementMatrix): OptimizationRun {
  return {
    version: 1,
    id: 'run-safety',
    sourceDraftId: draftId,
    targetJobId: targetJob.id,
    stage: 'awaiting-answers',
    inputFingerprint: matrix.inputFingerprint,
    requirementMatches: matrix.matches,
    questions: [{
      id: 'question-safety',
      requirementId: requirement.id,
      prompt: workflowQuestion,
      status: 'open',
      factIds: []
    }],
    scoreBefore: scoreRequirementMatrix(matrix),
    createdAt: now,
    updatedAt: now
  }
}

function supportedChangeSet(): NonNullable<OptimizationRun['changeSet']> {
  return {
    summary: 'One evidence-linked rewrite is ready for review.',
    changes: [{
      id: 'change-supported',
      path: 'profile.summary.0',
      original: 'Builds reliable systems.',
      proposed: proposedSummary,
      reason: 'Make the confirmed platform leadership evidence explicit.',
      needsConfirmation: true,
      evidence: {
        requirementIds: [requirement.id],
        factIds: [careerFact.id],
        matchType: 'direct',
        support: 'user-confirmed',
        confidence: 0.95,
        transformation: 'rewrite'
      }
    }],
    questions: []
  }
}

function domainSeed(input: {
  run: OptimizationRun
  matches: DomainSeed['requirementMatches']
  includeFact?: boolean
}): DomainSeed {
  const includeFact = input.includeFact ?? true
  return {
    evidenceSources: includeFact ? [evidenceSource] : [],
    careerFacts: includeFact ? [careerFact] : [],
    targetJobs: [targetJob],
    jobRequirements: [requirement],
    requirementMatches: input.matches,
    resumeVariants: [],
    optimizationRuns: [input.run]
  }
}

async function prepareOrigin(page: Page, input: {
  draft: ResumeDraft
  activeWorkflow?: boolean
  domain?: DomainSeed
}) {
  await page.goto('/en')
  await page.evaluate(({ draft, activeWorkflow }) => {
    localStorage.setItem('job-seeker-agent-drafts-v1', JSON.stringify({
      version: 1,
      state: { activeDraftId: draft.id, drafts: [draft] }
    }))
    if (activeWorkflow) {
      localStorage.setItem('job-seeker-agent-active-workflow-v1', JSON.stringify({
        targetJobId: 'job-safety',
        optimizationRunId: 'run-safety'
      }))
    }
  }, { draft: input.draft, activeWorkflow: input.activeWorkflow ?? false })
  if (input.domain) await seedDomainDatabase(page, input.domain)
}

async function setProviderPreference(
  page: Page,
  mode: 'chrome-built-in' | 'openai-compatible' | 'automatic',
  allowCloudFallback: boolean
) {
  await page.evaluate(({ mode, allowCloudFallback }) => {
    localStorage.setItem('job-seeker-agent-ai-provider-preference-v1', JSON.stringify({
      version: 1,
      mode,
      allowCloudFallback
    }))
  }, { mode, allowCloudFallback })
}

async function completeCoreWorkflowFromJd(page: Page) {
  await page.goto('/en/jd-match')
  const matchApp = page.getByRole('application', { name: 'Target Job' })
  await matchApp.getByRole('textbox', { name: 'Job description' }).fill(targetJob.description)
  await matchApp.getByRole('button', { name: 'Extract requirements' }).click()
  await expect(matchApp.getByRole('heading', { name: 'Extracted requirement matrix' })).toBeVisible()
  await expect(matchApp.getByRole('heading', { name: requirement.text })).toBeVisible()
  await matchApp.getByRole('button', { name: 'Confirm requirement' }).click()
  await matchApp.getByRole('button', { name: 'Create Agent run' }).click()
  await expect(matchApp.getByText(
    'Target job and resumable Agent run saved in this browser.'
  )).toBeVisible()

  await page.goto('/en/agent')
  const agent = page.getByRole('application', { name: 'Resume Agent' })
  await agent.getByRole('textbox', { name: 'Optimization instruction' }).fill(
    'Emphasize verified platform impact'
  )
  const workflow = agent.getByRole('region', { name: targetJob.title })
  await expect(workflow.getByText(workflowQuestion)).toBeVisible()
  await workflow.getByRole('textbox', { name: 'New career fact' }).fill(careerFact.text)
  await workflow.getByRole('button', { name: 'Save as confirmed fact' }).click()
  await expect(workflow.getByText(
    'Evidence mapping is complete. Review the optimization plan next.'
  )).toBeVisible()

  await workflow.getByRole('button', { name: 'Prepare optimization plan' }).click()
  await expect(workflow.getByText(workflowPlanSummary)).toBeVisible()
  await workflow.getByRole('button', { name: 'Approve plan' }).click()
  await expect(workflow.getByText(
    'Plan approved. Evidence-linked change generation is now unlocked.'
  )).toBeVisible()

  await agent.getByRole('button', { name: 'Generate change proposals' }).click()
  await expect(agent.getByText(workflowChangeSummary)).toBeVisible()
  await agent.getByRole('checkbox', {
    name: `I verified this change is accurate: ${boundedProposal}`
  }).check()
  await agent.getByRole('button', { name: 'Accept all suggestions' }).click()
  await expect(agent.locator('.resume-agent-app__variant-status')).toContainText(
    'Your master resume was not changed.'
  )
}

async function expectAppliedVariant(page: Page, originalDraft: ResumeDraft) {
  await expect.poll(async () => {
    const runs = await readDomainRecords<OptimizationRun>(page, 'optimizationRuns')
    return {
      stage: runs[0]?.stage,
      acceptedChanges: runs[0]?.acceptedChangeIds?.length
    }
  }).toEqual({ stage: 'applied', acceptedChanges: 1 })
  await expect.poll(async () => {
    const variants = await readDomainRecords<ResumeVariant>(page, 'resumeVariants')
    return variants.length
  }).toBe(1)
  const variants = await readDomainRecords<ResumeVariant>(page, 'resumeVariants')
  expect(variants[0]).toMatchObject({
    sourceDraftId: originalDraft.id,
    data: {
      experiences: [{ bullets: [boundedProposal] }]
    }
  })
  expect(await readActiveResumeData(page)).toEqual(originalDraft.data)
}

async function installChromeLanguageModel(page: Page, response: unknown) {
  await page.addInitScript((serializedResponse) => {
    Object.defineProperty(globalThis, 'LanguageModel', {
      configurable: true,
      value: {
        availability: async () => 'available',
        create: async () => ({
          contextUsage: 0,
          contextWindow: 8_192,
          measureContextUsage: async () => 256,
          prompt: async () => JSON.stringify(serializedResponse),
          destroy: () => undefined
        })
      }
    })
  }, response)
}

async function installChromeWorkflowLanguageModel(page: Page) {
  await page.addInitScript(({ report, planSummary, changeSummary, proposed }) => {
    Object.defineProperty(globalThis, 'LanguageModel', {
      configurable: true,
      value: {
        availability: async () => 'available',
        create: async () => ({
          contextUsage: 0,
          contextWindow: 8_192,
          measureContextUsage: async () => 256,
          prompt: async (serializedInput: string) => {
            const input = JSON.parse(serializedInput) as Record<string, unknown>
            if (typeof input.jobDescription === 'string') return JSON.stringify(report)
            if (
              typeof input.instruction === 'string'
              && Array.isArray(input.requirements)
              && Array.isArray(input.careerFacts)
              && input.target === undefined
            ) {
              const requirements = input.requirements as Array<{ id: string }>
              const facts = input.careerFacts as Array<{ id: string }>
              const targets = input.resumeTargets as Array<{ path: string }>
              const target = targets.find(({ path }) => path === 'experiences.0.bullets.0')
              if (!target) throw new Error('Expected a bounded experience-bullet target.')
              return JSON.stringify({
                id: 'plan-chrome-e2e',
                summary: planSummary,
                items: [{
                  id: 'plan-item-chrome-e2e',
                  requirementIds: [requirements[0].id],
                  factIds: [facts[0].id],
                  targetPath: target.path,
                  intent: 'Make the confirmed platform evidence explicit.',
                  transformation: 'rewrite'
                }]
              })
            }
            if (typeof input.target === 'object' && input.target !== null) {
              const target = input.target as { path: string; original: string }
              const requirements = input.requirements as Array<{ id: string }>
              const facts = input.careerFacts as Array<{
                id: string
                verification: 'user-confirmed' | 'document-backed'
              }>
              return JSON.stringify({
                summary: changeSummary,
                changes: [{
                  id: 'change-chrome-e2e',
                  path: target.path,
                  original: target.original,
                  proposed,
                  reason: 'Use only the confirmed platform delivery evidence.',
                  needsConfirmation: true,
                  evidence: {
                    requirementIds: [requirements[0].id],
                    factIds: [facts[0].id],
                    matchType: 'direct',
                    support: facts[0].verification === 'document-backed'
                      ? 'verified'
                      : 'user-confirmed',
                    confidence: 0.96,
                    transformation: 'rewrite'
                  }
                }],
                questions: []
              })
            }
            throw new Error('Unexpected Chrome workflow prompt.')
          },
          destroy: () => undefined
        })
      }
    })
  }, {
    report: workflowJDReport,
    planSummary: workflowPlanSummary,
    changeSummary: workflowChangeSummary,
    proposed: boundedProposal
  })
}

async function installUnavailableChromeLanguageModel(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, 'LanguageModel', {
      configurable: true,
      value: {
        availability: async () => 'unavailable',
        create: async () => { throw new Error('Unavailable models must not create a session.') }
      }
    })
  })
}

async function blockApiRoutes(page: Page) {
  const requests: string[] = []
  await page.route('**/api/**', async (route: Route) => {
    requests.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`)
    await route.abort('blockedbyclient')
  })
  return requests
}

async function installCloudWorkflowRoutes(page: Page) {
  const requests: string[] = []
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    requests.push(`${request.method()} ${pathname}`)
    expect(request.headers()).toMatchObject({
      'x-job-seeker-agent-ai-key': 'sk-e2e-browser-key',
      'x-job-seeker-agent-ai-base-url': 'https://byok.example/v1',
      'x-job-seeker-agent-ai-model': 'e2e-cloud-model'
    })

    if (pathname === '/api/jd-match') {
      const body = request.postDataJSON() as {
        jd: string
        locale: 'en'
        resume: ResumeData
      }
      const analysis = buildJDRequirementAnalysis({
        report: workflowJDReport,
        jobDescription: body.jd,
        locale: body.locale,
        resume: body.resume,
        timestamp: now
      })
      await fulfillJson(route, {
        sections: workflowJDReport,
        ...analysis,
        model: 'e2e-cloud-model'
      })
      return
    }

    if (pathname === '/api/resume/plan') {
      const body = request.postDataJSON() as {
        requirements: Array<{ id: string }>
        careerFacts: Array<{ id: string }>
        resumeTargets: Array<{ path: string }>
      }
      const target = body.resumeTargets.find(({ path }) => (
        path === 'experiences.0.bullets.0'
      ))
      if (!target) throw new Error('Expected a bounded experience-bullet target.')
      await fulfillJson(route, {
        plan: {
          id: 'plan-cloud-e2e',
          summary: workflowPlanSummary,
          items: [{
            id: 'plan-item-cloud-e2e',
            requirementIds: [body.requirements[0].id],
            factIds: [body.careerFacts[0].id],
            targetPath: target.path,
            intent: 'Make the confirmed platform evidence explicit.',
            transformation: 'rewrite'
          }]
        },
        model: 'e2e-cloud-model'
      })
      return
    }

    if (pathname === '/api/resume/optimize') {
      const body = request.postDataJSON() as {
        resume: ResumeData
        requirements: Array<{ id: string }>
        careerFacts: Array<{
          id: string
          verification: 'user-confirmed' | 'document-backed'
        }>
      }
      await fulfillJson(route, {
        changeSet: {
          summary: workflowChangeSummary,
          changes: [{
            id: 'change-cloud-e2e',
            path: 'experiences.0.bullets.0',
            original: body.resume.experiences[0].bullets[0],
            proposed: boundedProposal,
            reason: 'Use only the confirmed platform delivery evidence.',
            needsConfirmation: true,
            evidence: {
              requirementIds: [body.requirements[0].id],
              factIds: [body.careerFacts[0].id],
              matchType: 'direct',
              support: body.careerFacts[0].verification === 'document-backed'
                ? 'verified'
                : 'user-confirmed',
              confidence: 0.96,
              transformation: 'rewrite'
            }
          }],
          questions: []
        },
        model: 'e2e-cloud-model'
      })
      return
    }

    await route.fulfill({ status: 500, body: `Unexpected AI route: ${pathname}` })
  })
  return requests
}

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body)
  })
}

async function seedDomainDatabase(page: Page, seed: DomainSeed) {
  await page.evaluate(async (records) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('resume-os-domain')
      request.onupgradeneeded = () => {
        const database = request.result
        database.createObjectStore('evidenceSources', { keyPath: 'id' })
        database.createObjectStore('careerFacts', { keyPath: 'id' })
        database.createObjectStore('targetJobs', { keyPath: 'id' })
        database.createObjectStore('jobRequirements', { keyPath: 'id' })
        database.createObjectStore('requirementMatches', { keyPath: 'requirementId' })
        database.createObjectStore('resumeVariants', { keyPath: 'id' })
        database.createObjectStore('optimizationRuns', { keyPath: 'id' })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const names = Object.keys(records) as Array<keyof typeof records>
      const transaction = database.transaction(names, 'readwrite')
      for (const name of names) {
        for (const record of records[name]) transaction.objectStore(name).put(record)
      }
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
    } finally {
      database.close()
    }
  }, seed)
}

async function publishExternalDraft(page: Page, draft: ResumeDraft) {
  await page.evaluate((nextDraft) => {
    const serialized = JSON.stringify({
      version: 1,
      state: { activeDraftId: nextDraft.id, drafts: [nextDraft] }
    })
    localStorage.setItem('job-seeker-agent-drafts-v1', serialized)
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'job-seeker-agent-drafts-v1',
      newValue: serialized,
      storageArea: localStorage
    }))
  }, draft)
}

async function readActiveDraftName(page: Page) {
  return page.evaluate(() => {
    const value = localStorage.getItem('job-seeker-agent-drafts-v1')
    if (!value) return null
    const envelope = JSON.parse(value) as {
      state?: { activeDraftId?: string | null; drafts?: Array<{ id: string; name: string }> }
    }
    return envelope.state?.drafts?.find(({ id }) => id === envelope.state?.activeDraftId)?.name ?? null
  })
}

async function readActiveWorkflowPreference(page: Page) {
  return page.evaluate(() => localStorage.getItem('job-seeker-agent-active-workflow-v1'))
}

async function readActiveResumeData(page: Page) {
  return page.evaluate(() => {
    const value = localStorage.getItem('job-seeker-agent-drafts-v1')
    if (!value) return null
    const envelope = JSON.parse(value) as {
      state?: {
        activeDraftId?: string | null
        drafts?: Array<{ id: string; data: ResumeData }>
      }
    }
    return envelope.state?.drafts?.find(
      ({ id }) => id === envelope.state?.activeDraftId
    )?.data ?? null
  })
}

async function readDomainRecords<T = unknown>(page: Page, storeName: string) {
  return page.evaluate(async (name) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('resume-os-domain')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const transaction = database.transaction(name, 'readonly')
      return await new Promise<unknown[]>((resolve, reject) => {
        const request = transaction.objectStore(name).getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    } finally {
      database.close()
    }
  }, storeName) as Promise<T[]>
}
