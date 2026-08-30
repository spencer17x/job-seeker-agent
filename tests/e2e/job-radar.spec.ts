import { expect, test, type Page, type Route } from '@playwright/test'
import { createResumeDraft, type ResumeData } from '../../lib/resume-model'

const resumeText = 'Ada Candidate, Platform Engineer, built reliable TypeScript platforms.'
const resume: ResumeData = {
  profile: { name: 'Ada Candidate', title: 'Platform Engineer', summary: ['Builds reliable systems.'], tags: ['TypeScript'], links: [] },
  targetRole: 'Platform Engineer',
  skills: [{ group: 'Core', items: ['TypeScript'] }],
  experiences: [], projects: [], education: [], certifications: [], awards: [], languages: [], openSource: [],
  metadata: { source: 'paste', locale: 'en', updatedAt: '2026-08-01T08:00:00.000Z' }
}
const draftWithoutEvidence = createResumeDraft(resume, {
  id: 'missing-evidence-draft',
  name: 'Ada Resume',
  source: 'paste',
  now: '2026-08-01T08:00:00.000Z'
})

async function json(route: Route, body: unknown) {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
}

async function createTrustedDraft(page: Page) {
  await page.route('**/api/resume/parse', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ text: resumeText, locale: 'en', source: 'paste' })
    await json(route, { data: resume, model: 'job-radar-e2e' })
  })
  await page.addInitScript(() => localStorage.setItem('job-seeker-agent-ai-provider-preference-v1', JSON.stringify({
    version: 1, mode: 'openai-compatible', allowCloudFallback: false
  })))
  await page.goto('/en/studio')
  const studio = page.getByRole('application', { name: 'Resume Studio' })
  await studio.getByRole('textbox', { name: 'Resume text' }).fill(resumeText)
  await studio.getByRole('button', { name: 'Create draft' }).click()
  await expect(studio.getByRole('heading', { name: 'Ada Candidate' })).toBeVisible()
}

test('uses the Job Agent backend as the localized product root', async ({ page }) => {
  await page.goto('/zh')
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await expect(page).toHaveURL(/\/zh\/jobs$/u)
  await expect(page.getByRole('application', { name: '求职 Agent' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '求职概览', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: '请先完成求职设置' })).toBeVisible()
  await expect(page.getByRole('link', { name: '开始设置' })).toBeVisible()
  await expect(page.getByRole('button', { name: '暂停' })).toHaveCount(0)
  await expect(page.locator('.desktop-shell, .mobile-home, .desktop-dock')).toHaveCount(0)
  const workspaceTheme = await page.locator('.job-workspace').evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      boundary: element.getAttribute('data-ui-theme'),
      background: style.backgroundColor,
      color: style.color,
      surface: style.getPropertyValue('--jw-surface').trim()
    }
  })
  expect(workspaceTheme).toEqual({
    boundary: 'light',
    background: 'rgb(248, 250, 252)',
    color: 'rgb(15, 23, 42)',
    surface: '#fff'
  })
})

test('exposes only BOSS Zhipin', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop platform-scope workflow')
  await createTrustedDraft(page)
  let discoveryRequests = 0
  await page.route('**/api/jobs/discover', async (route) => { discoveryRequests += 1; await route.abort() })

  await page.goto('/en/jobs')
  const radar = page.getByRole('application', { name: 'Job Agent' })
  await expect(radar.getByRole('navigation', { name: 'Job workspace navigation' }).getByRole('link')).toHaveCount(7)
  await expect(radar.getByText(/BOSS Zhipin/)).toBeVisible()
  await expect(radar.getByText('Greenhouse')).toHaveCount(0)
  await expect(radar.getByText('Lever')).toHaveCount(0)
  expect(discoveryRequests).toBe(0)
})

test('blocks matching until a missing Career Evidence import is repaired', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop evidence-readiness workflow')
  await page.addInitScript((draft) => localStorage.setItem('job-seeker-agent-drafts-v1', JSON.stringify({
    version: 1,
    state: { activeDraftId: draft.id, drafts: [draft] }
  })), draftWithoutEvidence)
  await page.goto('/en/jobs/opportunities')

  await expect(page.getByText(/Career Evidence is not saved locally/)).toBeVisible()
  await page.getByRole('link', { name: 'Repair Career Evidence' }).click()
  await expect(page).toHaveURL(/\/en\/jobs\/profile$/u)
  await page.getByRole('button', { name: 'Retry local evidence import' }).click()
  await expect(page.getByRole('region', { name: 'Career evidence' }).getByText('Ada Resume')).toBeVisible()
  await page.getByRole('link', { name: 'Opportunities', exact: true }).click()
  await expect(page.getByText(/Career Evidence is not saved locally/)).toHaveCount(0)
})

test('manages strategy memory independently from career and application data', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop strategy-memory workflow')
  await page.addInitScript(() => localStorage.setItem('job-seeker-agent-job-strategy-memory-v1', JSON.stringify({
    version: 1,
    enabled: true,
    entries: [{
      id: 'strategy-e2e',
      appliedAt: '2026-08-20T09:00:00.000Z',
      simulation: {
        version: 1,
        sampleSize: 20,
        recommendedMinimumMatchScore: 70,
        recommendedDailyContactLimit: 5,
        recommendedAutonomy: 'approval',
        recommendedAutoSendResume: false,
        signals: { conversations: 20, recruiterReplies: 5, resumeRequests: 0, interviewInvites: 1, offers: 0, rejections: 1, localApplications: 2 },
        reasonCodes: ['reply-observed'],
        simulatedAt: '2026-08-20T08:00:00.000Z'
      },
      settings: { minimumMatchScore: 70, dailyContactLimit: 5, autonomy: 'approval', autoSendResume: false }
    }]
  })))
  await page.goto('/en/jobs')

  await expect(page.getByText('1 applied versions')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Export memory' })).toHaveAttribute('download', 'job-seeker-agent-strategy-memory.json')
  await page.getByRole('button', { name: 'Disable learning' }).click()
  await expect.poll(() => page.evaluate(() => JSON.parse(
    localStorage.getItem('job-seeker-agent-job-strategy-memory-v1') ?? '{}'
  ).enabled)).toBe(false)
  await page.getByRole('button', { name: 'Clear memory' }).click()
  await page.getByRole('button', { name: 'Clear strategy memory' }).click()
  await expect.poll(() => page.evaluate(() => JSON.parse(
    localStorage.getItem('job-seeker-agent-job-strategy-memory-v1') ?? '{}'
  ).entries?.length)).toBe(0)
})

test('switches backend sections without an RSC navigation request', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop shallow-navigation coverage')
  await page.goto('/en/jobs')
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))

  await page.getByRole('link', { name: 'Opportunities', exact: true }).click()
  await expect(page).toHaveURL(/\/en\/jobs\/opportunities$/u)
  await expect(page.getByRole('heading', { name: 'Opportunity inbox', level: 1 })).toBeVisible()
  expect(requests.filter((url) => url.includes('_rsc=') || url.includes('.rsc'))).toEqual([])
})

test('collects a job goal before trusted resume import and does not run before setup', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop first-run setup coverage')
  await page.goto('/en/jobs')
  await page.getByRole('link', { name: 'Start setup' }).click()

  await expect(page).toHaveURL(/\/en\/jobs\/setup$/u)
  await expect(page.getByRole('heading', { name: 'Describe the job you want' })).toBeVisible()
  await page.getByRole('textbox', { name: 'My job-search goal' }).fill('Platform engineering roles in Shanghai')
  await page.getByRole('button', { name: 'Let Agent analyze goal' }).click()
  await expect(page.getByRole('heading', { name: 'Import a trusted resume' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue to analysis' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Pause' })).toHaveCount(0)
})

test('derives a resume search for BOSS Zhipin', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop market-search workflow')
  await createTrustedDraft(page)
  let discoveryRequests = 0
  await page.route('**/api/jobs/discover', async (route) => { discoveryRequests += 1; await route.abort() })

  await page.goto('/en/jobs/preferences')
  const radar = page.getByRole('application', { name: 'Job Agent' })
  await expect(radar.getByRole('textbox', { name: 'Target titles' })).toHaveValue('Platform Engineer')
  await radar.getByRole('button', { name: 'Save profile' }).click()
  await expect(radar.getByText('Search profile saved and current jobs rescored.')).toBeVisible()
  await radar.getByRole('link', { name: 'Opportunities', exact: true }).click()
  await radar.getByRole('button', { name: 'Run Agent now' }).click()
  await expect(radar.getByText('The selected platforms require official search or partner access. Open their official searches below.')).toBeVisible()
  expect(discoveryRequests).toBe(0)
})

test('starts screening and queues matching applications immediately after Agent configuration', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop configured-start workflow')
  await createTrustedDraft(page)
  await page.route('**/api/jd-match', async (route) => json(route, {
    sections: {
      jobTitle: 'Platform Engineer',
      company: 'Example Systems',
      requirements: [{
        text: 'Build reliable TypeScript platforms.',
        category: 'experience',
        priority: 'must',
        weight: 5,
        keywords: ['TypeScript', 'platform']
      }],
      resumeEmphasis: ['Use verified platform evidence.'],
      interviewPrep: ['Prepare a reliability example.']
    }
  }))
  await page.addInitScript(() => {
    const target = window as unknown as { __jobAgentQueries: string[] }
    target.__jobAgentQueries = []
    window.addEventListener('job-seeker-agent:browser-agent:request', (event) => {
      const request = (event as CustomEvent<{
        requestId: string
        action: string
        payload?: { query?: string }
      }>).detail
      if (request.action === 'search-boss-jobs' && request.payload?.query) {
        target.__jobAgentQueries.push(request.payload.query)
      }
      window.dispatchEvent(new CustomEvent('job-seeker-agent:browser-agent:response', { detail: {
        requestId: request.requestId,
        ok: true,
        ...(request.action === 'detect-platforms'
          ? { sessions: [{ platform: 'boss', state: 'available' }] }
          : request.action === 'search-boss-jobs'
            ? { jobs: [{
                externalId: 'boss-platform-1',
                url: 'https://www.zhipin.com/job_detail/boss-platform-1.html',
                title: 'Platform Engineer',
                company: 'Example Systems',
                summary: 'Build reliable TypeScript platforms in Shanghai.',
                location: 'Shanghai',
                minimumMonthlySalary: 30_000,
                maximumMonthlySalary: 45_000
              }] }
          : request.action === 'collect-boss-conversation-signals'
            ? { conversationSignals: [] }
            : request.action === 'diagnose-boss-adapter'
              ? { diagnostics: [] }
              : { jobs: [] })
      } }))
    })
  })

  await page.goto('/en/jobs/setup')
  const setup = page.getByRole('application', { name: 'Job Agent' })
  await setup.getByRole('textbox', { name: 'My job-search goal' }).fill('Platform Engineer roles in Shanghai')
  await setup.getByRole('button', { name: 'Let Agent analyze goal' }).click()
  await setup.getByRole('button', { name: 'Continue to analysis' }).click()
  await setup.getByRole('button', { name: 'Confirm and choose job criteria' }).click()
  await setup.getByRole('button', { name: 'Save job criteria' }).click()
  await setup.getByRole('button', { name: 'Start Agent' }).click()

  await expect(page).toHaveURL(/\/en\/jobs\/opportunities$/u)
  await expect.poll(() => page.evaluate(() => (
    window as unknown as { __jobAgentQueries: string[] }
  ).__jobAgentQueries)).toContain('Platform Engineer')
  await expect(setup.getByText('Created independent resume copies for 1 BOSS role(s) and queued verified outreach.')).toBeVisible()
  await expect(setup.getByText('Example Systems').first()).toBeVisible()
  await expect.poll(async () => (await readDomainRecords<{ status: string; targetJobId?: string; resumeVariantId?: string }>(
    page,
    'applicationRecords'
  ))[0]).toMatchObject({
    status: 'ready-to-apply',
    targetJobId: expect.any(String),
    resumeVariantId: expect.any(String)
  })
  await expect.poll(() => page.evaluate(() => JSON.parse(
    localStorage.getItem('job-seeker-agent:job-agent-preferences:v1') ?? '{}'
  ))).toMatchObject({ version: 2, enabled: true, autonomy: 'autopilot', autoSendResume: true })
})

test('brings a user-selected platform job into Target Job without fetching the page', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop Copilot handoff workflow')
  await createTrustedDraft(page)
  let discoveryRequests = 0
  await page.route('**/api/jobs/discover', async (route) => {
    discoveryRequests += 1
    await route.abort()
  })

  await page.goto('/en/jobs/preferences')
  const radar = page.getByRole('application', { name: 'Job Agent' })
  await expect(radar.getByRole('textbox', { name: 'Target titles' })).toHaveValue('Platform Engineer')
  await radar.getByText('Bring back a job', { exact: true }).click()
  await radar.getByRole('textbox', { name: 'Quick paste' }).fill(`
Job title: Senior Platform Engineer
Company: Example China
Location: Shanghai
URL: https://www.zhipin.com/job_detail/example.html
Job description: Build TypeScript developer platforms and improve delivery reliability.
  `)
  await radar.getByRole('button', { name: 'Parse and prefill' }).click()
  await expect(radar.getByRole('textbox', { name: 'Official job URL' })).toHaveValue(
    'https://www.zhipin.com/job_detail/example.html'
  )
  await expect(radar.getByRole('textbox', { name: 'Job title' })).toHaveValue('Senior Platform Engineer')
  await expect(radar.getByRole('textbox', { name: 'Company' })).toHaveValue('Example China')
  await radar.getByRole('button', { name: 'Import and analyze' }).click()

  const targetJob = page.getByRole('application', { name: 'Target Job' })
  await expect(targetJob.getByRole('textbox', { name: 'Job description' })).toHaveValue(
    'Build TypeScript developer platforms and improve delivery reliability.'
  )
  await expect(targetJob.getByText(/Example China · Senior Platform Engineer was loaded/)).toBeVisible()
  expect(discoveryRequests).toBe(0)
})

test('keeps the bilingual Job Agent route usable without horizontal overflow on mobile', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile Job Agent coverage')
  await page.goto('/zh/jobs')
  await expect(page.getByRole('heading', { name: '求职概览', level: 1 })).toBeVisible()
  await expect(page.getByRole('navigation', { name: '求职工作区导航' })).toBeVisible()
  await page.getByRole('link', { name: '岗位', exact: true }).click()
  await expect(page.getByText('请先导入或粘贴可信简历，再进行岗位匹配。')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0)
})

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
