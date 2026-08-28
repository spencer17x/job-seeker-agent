import { expect, test, type Page, type Route } from '@playwright/test'
import { buildJDRequirementAnalysis, type JDMatchReport } from '../../lib/agent/jd-report'
import type { ResumeData } from '../../lib/resume-model'
import { createStableJobDomainId } from '../../lib/jobs/job-domain'

const now = '2026-07-13T00:00:00.000Z'
const jobCheckedAt = '2026-08-01T08:00:00.000Z'
const jobDescription = [
  'Staff AI Platform Engineer',
  'Lead reliable AI platform delivery across product teams.',
  'Required: TypeScript and measurable cross-team platform impact.'
].join('\n')
const originalBullet = 'AI platform engineer led reliable delivery for five product teams.'
const proposedBullet = 'Led reliable delivery for five product teams.'
const originalSummary = 'Ada Candidate builds useful systems.'
const proposedSummary = 'AI platform engineer led reliable delivery.'
const resumeSource = `Ada Candidate, Engineer, ${originalBullet}`

function resume(): ResumeData {
  return {
    profile: {
      name: 'Ada Candidate',
      title: 'Engineer',
      summary: [originalSummary],
      tags: ['AI'],
      links: []
    },
    targetRole: 'AI Engineer',
    skills: [{ group: 'Core', items: ['TypeScript', 'AI SDK'] }],
    experiences: [{
      company: 'Example Co',
      role: 'Engineer',
      period: '2024 - Present',
      location: 'Remote',
      tags: ['Platform'],
      bullets: [originalBullet]
    }],
    projects: [{
      id: 'ada-project',
      name: 'JobSeeker Agent',
      type: 'Product',
      tags: ['Next.js'],
      summary: 'Interactive resume workspace.',
      highlights: ['Shipped end to end.']
    }],
    education: [],
    certifications: [],
    awards: [],
    languages: ['English'],
    openSource: [],
    metadata: { source: 'paste', locale: 'en', updatedAt: now }
  }
}

const report: JDMatchReport = {
  jobTitle: 'Staff AI Platform Engineer',
  company: 'Evidence Labs',
  requirements: [{
    text: 'Lead reliable AI platform delivery across product teams.',
    category: 'experience',
    priority: 'must',
    weight: 5,
    keywords: ['AI platform', 'leadership', 'product teams']
  }],
  resumeEmphasis: ['Use verified platform delivery evidence.'],
  interviewPrep: ['Prepare a concrete cross-team impact example.']
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

function expectExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  expect(Object.keys(value).sort()).toEqual([...expected].sort())
}

function requestJson<T extends Record<string, unknown>>(route: Route) {
  expect(route.request().method()).toBe('POST')
  expect(route.request().headers()['content-type']).toContain('application/json')
  const body = route.request().postDataJSON() as unknown
  expect(body).not.toBeNull()
  expect(typeof body).toBe('object')
  return body as T
}

async function installAiMocks(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('job-seeker-agent-ai-provider-preference-v1', JSON.stringify({
      version: 1,
      mode: 'openai-compatible',
      allowCloudFallback: false
    }))
  })

  await page.route('**/api/**', (route) => {
    throw new Error(`Unexpected unmocked API request: ${route.request().method()} ${route.request().url()}`)
  })

  await page.route('**/api/resume/parse', async (route) => {
    const body = requestJson<{ text: string; locale: string; source: string }>(route)
    expectExactKeys(body, ['text', 'locale', 'source'])
    expect(body).toEqual({
      text: resumeSource,
      locale: 'en',
      source: 'paste'
    })
    await json(route, { data: resume(), model: 'deterministic-e2e' })
  })

  await page.route('**/api/jobs/discover', async (route) => {
    const body = requestJson<{ source: string; sourceKey: string }>(route)
    expectExactKeys(body, ['source', 'sourceKey'])
    expect(body).toEqual({ source: 'greenhouse', sourceKey: 'evidence-labs' })
    const sourceId = createStableJobDomainId('job-source', [body.source, body.sourceKey])
    await json(route, {
      sourceId,
      completeness: 'complete',
      checkedAt: jobCheckedAt,
      warnings: [],
      postings: [{
        id: createStableJobDomainId('job-posting', [body.source, body.sourceKey, 'staff-ai-1']),
        sourceId,
        externalId: 'staff-ai-1',
        canonicalUrl: 'https://boards.greenhouse.io/evidence-labs/jobs/staff-ai-1',
        applyUrl: 'https://boards.greenhouse.io/evidence-labs/jobs/staff-ai-1',
        title: 'Staff AI Platform Engineer',
        company: 'Evidence Labs',
        description: jobDescription,
        locale: 'en',
        location: 'Remote',
        workplaceType: 'remote',
        employmentType: 'full-time',
        firstSeenAt: jobCheckedAt,
        lastCheckedAt: jobCheckedAt,
        status: 'open',
        contentHash: 'e2e:staff-ai-1'
      }]
    })
  })

  await page.route('**/api/jd-match', async (route) => {
    const body = requestJson<{
      jd: string
      locale: 'en'
      resume: ResumeData
      targetIdentity: string
    }>(route)
    expectExactKeys(body, ['jd', 'locale', 'resume', 'targetIdentity'])
    expect(body.jd).toBe(jobDescription)
    expect(body.locale).toBe('en')
    expect(body.targetIdentity).toMatch(/^posting-/u)
    expect(body.resume).toMatchObject({
      profile: { name: 'Ada Candidate', title: 'Engineer' },
      experiences: [{ bullets: [originalBullet] }],
      metadata: { source: 'paste', locale: 'en' }
    })

    const analysis = buildJDRequirementAnalysis({
      report,
      jobDescription: body.jd,
      locale: body.locale,
      resume: body.resume,
      timestamp: now
    })
    await json(route, {
      sections: report,
      ...analysis,
      model: 'deterministic-e2e'
    })
  })

  await page.route('**/api/resume/plan', async (route) => {
    const body = requestJson<{
      locale: 'en'
      instruction: string
      sourceDraftId: string
      targetJobId: string
      requirements: Array<{ id: string; jobId: string; text: string }>
      requirementMatches: Array<{
        requirementId: string
        factIds: string[]
        status: 'direct' | 'partial' | 'gap'
      }>
      careerFacts: Array<{
        id: string
        text: string
        verification: 'imported' | 'user-confirmed' | 'document-backed'
      }>
      resumeTargets: Array<{
        path: string
        current: string | string[]
        transformations: string[]
      }>
    }>(route)
    expectExactKeys(body, [
      'locale',
      'instruction',
      'sourceDraftId',
      'targetJobId',
      'requirements',
      'requirementMatches',
      'careerFacts',
      'resumeTargets'
    ])
    expect(body.locale).toBe('en')
    expect(body.instruction).toBe('Emphasize verified platform impact')
    expect(body.requirements).toHaveLength(1)
    expect(body.requirementMatches).toHaveLength(1)

    const requirement = body.requirements[0]
    const match = body.requirementMatches[0]
    const fact = body.careerFacts.find((candidate) => (
      candidate.text === originalBullet && candidate.verification === 'user-confirmed'
    ))
    expect(requirement.jobId).toBe(body.targetJobId)
    expect(match).toMatchObject({
      requirementId: requirement.id,
      status: 'direct'
    })
    expect(fact).toBeDefined()
    expect(match.factIds).toEqual([fact!.id])
    const bulletTarget = body.resumeTargets.find(({ path }) => (
      path === 'experiences.0.bullets.0'
    ))
    const summaryTarget = body.resumeTargets.find(({ path }) => (
      path === 'profile.summary.0'
    ))
    expect(bulletTarget).toBeDefined()
    expect(summaryTarget).toBeDefined()

    await json(route, {
      plan: {
        id: 'plan-e2e',
        summary: 'Rewrite two fields using the user-confirmed delivery fact.',
        items: [{
          id: 'plan-item-rewrite',
          requirementIds: [requirement.id],
          factIds: [fact!.id],
          targetPath: bulletTarget!.path,
          intent: 'Make verified AI platform impact explicit without changing career history.',
          transformation: 'rewrite'
        }, {
          id: 'plan-item-summary',
          requirementIds: [requirement.id],
          factIds: [fact!.id],
          targetPath: summaryTarget!.path,
          intent: 'Carry the same verified impact into the existing summary.',
          transformation: 'rewrite'
        }]
      },
      model: 'deterministic-e2e'
    })
  })

  await page.route('**/api/resume/optimize', async (route) => {
    const body = requestJson<{
      resume: ResumeData
      locale: 'en'
      instruction: string
      jd: string
      requirements: Array<{ id: string; text: string }>
      requirementMatches: Array<{
        requirementId: string
        factIds: string[]
        status: 'direct' | 'partial' | 'gap'
      }>
      careerFacts: Array<{
        id: string
        text: string
        verification: 'imported' | 'user-confirmed' | 'document-backed'
      }>
      optimizationPlan: {
        id: string
        approvedAt?: string
        items: Array<{
          requirementIds: string[]
          factIds: string[]
          targetPath?: string
          transformation: string
        }>
      }
    }>(route)
    expectExactKeys(body, [
      'resume',
      'locale',
      'instruction',
      'jd',
      'requirements',
      'requirementMatches',
      'careerFacts',
      'optimizationPlan'
    ])
    expect(body.locale).toBe('en')
    expect(body.instruction).toBe('Emphasize verified platform impact')
    expect(body.jd).toBe(jobDescription)
    expect(body.resume.profile.summary[0]).toBe(originalSummary)
    expect(body.resume.experiences[0].bullets[0]).toBe(originalBullet)
    expect(body.optimizationPlan).toMatchObject({
      id: 'plan-e2e',
      approvedAt: expect.any(String)
    })

    const requirement = body.requirements[0]
    const fact = body.careerFacts.find((candidate) => (
      candidate.text === originalBullet && candidate.verification === 'user-confirmed'
    ))
    expect(requirement).toBeDefined()
    expect(fact).toBeDefined()
    expect(body.optimizationPlan.items).toContainEqual(expect.objectContaining({
      requirementIds: [requirement!.id],
      factIds: [fact!.id],
      transformation: 'rewrite'
    }))
    expect(body.requirementMatches).toEqual([expect.objectContaining({
      requirementId: requirement!.id,
      factIds: [fact!.id],
      status: 'direct'
    })])

    const evidence = {
      requirementIds: [requirement!.id],
      factIds: [fact!.id],
      matchType: 'direct',
      support: 'user-confirmed',
      confidence: 0.96,
      transformation: 'rewrite'
    }
    await json(route, {
      changeSet: {
        summary: 'Two evidence-linked rewrites ready for review.',
        changes: [
          {
            id: 'impact-bullet',
            path: 'experiences.0.bullets.0',
            original: originalBullet,
            proposed: proposedBullet,
            reason: 'Clarify the verified cross-team platform impact.',
            needsConfirmation: true,
            evidence
          },
          {
            id: 'profile-summary',
            path: 'profile.summary.0',
            original: originalSummary,
            proposed: proposedSummary,
            reason: 'Lead with the verified target-role signal.',
            needsConfirmation: true,
            evidence
          }
        ],
        questions: []
      },
      model: 'deterministic-e2e'
    })
  })
}

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop staged Evidence Agent workflow')
})

test('builds a reviewable Evidence Agent run and saves a variant without mutating the master', async ({ page }) => {
  await installAiMocks(page)

  await page.goto('/en/studio')
  const studio = page.getByRole('application', { name: 'Resume Studio' })
  await studio.getByRole('textbox', { name: 'Resume text' }).fill(
    resumeSource
  )
  await studio.getByRole('button', { name: 'Create draft' }).click()
  await expect(studio.getByRole('button', { name: 'Open Ada Candidate - AI Engineer' })).toBeVisible()
  await expect(studio.getByRole('region', { name: 'Career evidence' }).getByText(originalBullet)).toBeVisible()

  await expect.poll(() => readActiveMaster(page)).not.toBeNull()
  const masterBefore = await readActiveMaster(page)

  await page.goto('/en/jobs/preferences')
  const radar = page.getByRole('application', { name: 'Job Agent' })
  await radar.getByText('Bring back a job', { exact: true }).click()
  await radar.getByRole('textbox', { name: 'Quick paste' }).fill([
    'Job title: Staff AI Platform Engineer',
    'Company: Evidence Labs',
    'Location: Remote',
    'URL: https://www.zhipin.com/job_detail/staff-ai-1.html',
    `Job description: ${jobDescription}`
  ].join('\n'))
  await radar.getByRole('button', { name: 'Parse and prefill' }).click()
  await radar.getByRole('button', { name: 'Import and analyze' }).click()

  const jdMatch = page.getByRole('application', { name: 'Target Job' })
  await expect(jdMatch.getByRole('textbox', { name: 'Job description' })).toHaveValue(jobDescription)
  await jdMatch.getByRole('button', { name: 'Extract requirements' }).click()
  await expect(jdMatch.getByRole('heading', { name: 'Extracted requirement matrix' })).toBeVisible()
  await expect(jdMatch.getByRole('heading', {
    name: 'Lead reliable AI platform delivery across product teams.'
  })).toBeVisible()
  await expect(jdMatch.getByText('Not yet mapped', { exact: true })).toBeVisible()
  await jdMatch.getByRole('button', { name: 'Confirm requirement' }).click()
  await jdMatch.getByRole('button', { name: 'Create Agent run' }).click()
  await expect(jdMatch.getByText('Target job and Agent run saved; the Job Agent application is linked locally.')).toBeVisible()

  await page.goto('/en/agent')
  const agent = page.getByRole('application', { name: 'Resume Agent' })
  await agent.getByRole('textbox', { name: 'Optimization instruction' }).fill(
    'Emphasize verified platform impact'
  )
  const workflow = agent.getByRole('region', { name: 'Staff AI Platform Engineer' })
  await expect(workflow.getByText(
    'Do you have a verifiable career fact for this requirement: Lead reliable AI platform delivery across product teams.'
  )).toBeVisible()
  await workflow.getByRole('combobox', { name: 'Existing career fact' }).selectOption({
    label: `${originalBullet} · Imported · confirm on use`
  })
  await workflow.getByRole('button', { name: 'Link & confirm fact' }).click()
  await expect(workflow.getByText(
    'Evidence mapping is complete. Review the optimization plan next.'
  )).toBeVisible()

  await workflow.getByRole('button', { name: 'Prepare optimization plan' }).click()
  await expect(workflow.getByText('Rewrite two fields using the user-confirmed delivery fact.')).toBeVisible()
  await workflow.getByRole('button', { name: 'Approve plan' }).click()
  await expect(workflow.getByText(
    'Plan approved. Evidence-linked change generation is now unlocked.'
  )).toBeVisible()

  await agent.getByRole('button', { name: 'Generate change proposals' }).click()
  await expect(agent.getByText('Two evidence-linked rewrites ready for review.')).toBeVisible()
  const firstChange = agent.locator('.resume-agent-app__change').first()
  await expect(firstChange.getByText(
    'Lead reliable AI platform delivery across product teams.'
  )).toBeVisible()
  await expect(firstChange.getByText(originalBullet)).toBeVisible()

  await agent.getByRole('checkbox', {
    name: `I verified this change is accurate: ${proposedBullet}`
  }).check()
  await agent.getByRole('checkbox', {
    name: `I verified this change is accurate: ${proposedSummary}`
  }).check()
  await agent.getByRole('button', { name: 'Accept all suggestions' }).click()
  await expect(agent.locator('.resume-agent-app__variant-status')).toContainText(
    'Job-specific variant prepared: Ada Candidate - AI Engineer · AI Engineer. Your master resume was not changed.'
  )

  await expect.poll(() => readDomainOutcome(page)).toMatchObject({
    variants: [{
      sourceDraftId: expect.any(String),
      data: {
        profile: { summary: [proposedSummary] },
        experiences: [{ bullets: [proposedBullet] }]
      }
    }],
    runs: [{
      stage: 'applied',
      acceptedChangeIds: ['impact-bullet', 'profile-summary'],
      appliedVariantId: expect.any(String)
    }],
    applications: [{ status: 'analyzing', targetJobId: expect.any(String) }]
  })

  await page.goto('/en/jobs/applications')
  const applicationRadar = page.getByRole('application', { name: 'Job Agent' })
  await expect(applicationRadar.getByRole('heading', { name: 'Application packets' }).first()).toBeVisible()
  const packetCheck = applicationRadar.getByRole('button', { name: 'Check application packet' })
  if (await packetCheck.count()) await packetCheck.click()
  await expect(applicationRadar.getByRole('link', { name: 'Open application site' })).toHaveAttribute(
    'href',
    'https://www.zhipin.com/job_detail/staff-ai-1.html'
  )
  expect((await readDomainOutcome(page)).applications[0]?.status).toBe('ready-to-apply')
  await applicationRadar.getByRole('button', { name: 'I submitted this application' }).click()
  await expect.poll(async () => (await readDomainOutcome(page)).applications[0]).toMatchObject({
    status: 'applied',
    submittedAt: expect.any(String)
  })

  expect(await readActiveMaster(page)).toEqual(masterBefore)
  expect(masterBefore).toMatchObject({
    data: {
      profile: { summary: [originalSummary] },
      experiences: [{ bullets: [originalBullet] }]
    },
    snapshots: []
  })

  await page.goto('/en/classic')
  const review = page.getByRole('application', { name: 'Review & Export' })
  const version = review.getByRole('combobox', { name: 'Resume version' })
  await expect(version.getByRole('option', {
    name: 'Ada Candidate - AI Engineer · AI Engineer'
  })).toHaveCount(1)
  await expect(review.getByText(originalBullet, { exact: true })).toBeVisible()
  await expect(review.getByText(proposedBullet, { exact: true })).toHaveCount(0)

  await version.selectOption({ label: 'Ada Candidate - AI Engineer · AI Engineer' })
  await expect(review.getByText(proposedBullet, { exact: true })).toBeVisible()
  await expect(review.getByText(proposedSummary, { exact: true })).toBeVisible()

  await version.selectOption('master')
  await expect(review.getByText(originalBullet, { exact: true })).toBeVisible()
  await expect(review.getByText(proposedBullet, { exact: true })).toHaveCount(0)
})

async function readActiveMaster(page: Page) {
  return page.evaluate(() => {
    const serialized = localStorage.getItem('job-seeker-agent-drafts-v1')
    if (!serialized) return null
    const envelope = JSON.parse(serialized) as {
      state?: {
        activeDraftId?: string | null
        drafts?: Array<{
          id: string
          data: ResumeData
          snapshots: unknown[]
        }>
      }
    }
    return envelope.state?.drafts?.find(({ id }) => id === envelope.state?.activeDraftId) ?? null
  })
}

async function readDomainOutcome(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('resume-os-domain')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const transaction = database.transaction(['resumeVariants', 'optimizationRuns', 'applicationRecords'], 'readonly')
      const getAll = <T>(storeName: 'resumeVariants' | 'optimizationRuns' | 'applicationRecords') => (
        new Promise<T[]>((resolve, reject) => {
          const request = transaction.objectStore(storeName).getAll()
          request.onsuccess = () => resolve(request.result as T[])
          request.onerror = () => reject(request.error)
        })
      )
      const [variants, runs, applications] = await Promise.all([
        getAll<{
          sourceDraftId: string
          data: ResumeData
        }>('resumeVariants'),
        getAll<{
          stage: string
          acceptedChangeIds?: string[]
          appliedVariantId?: string
        }>('optimizationRuns'),
        getAll<{
          status: string
          targetJobId?: string
          submittedAt?: string
        }>('applicationRecords')
      ])
      return { variants, runs, applications }
    } finally {
      database.close()
    }
  })
}
