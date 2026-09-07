import { expect, test, type Page } from '@playwright/test'
import { createResumeDraft, normalizeResumeData } from '../../lib/resume-model'
import { careerEvidenceSourceId } from '../../lib/agent/career-evidence'
import { jobSourceSchema, type JobPosting, type JobSearchProfile } from '../../lib/jobs/job-domain'
import { scoreJobRecommendation } from '../../lib/jobs/job-recommendation'
import { expectNoDevelopmentOverlay, expectReadableScreenshot } from './support/screenshot-evidence'

const now = '2026-09-07T00:00:00.000Z'

async function seedOpportunities(page: Page) {
  const draft = createResumeDraft(normalizeResumeData({
    profile: { name: 'Demo Candidate', title: 'Platform Engineer', summary: [], tags: [], links: [] },
    skills: [{ group: 'Engineering', items: ['TypeScript'] }],
    experiences: [], projects: [], education: [], certifications: [], awards: [], languages: [], openSource: [],
    metadata: { source: 'paste', locale: 'en', updatedAt: now }
  }), { id: 'ux-test-draft', name: 'Synthetic UX fixture', source: 'paste', now })
  const profile: JobSearchProfile = {
    id: 'ux-profile', name: 'Platform roles', platforms: ['boss'], titles: ['Platform Engineer'],
    adjacentTitles: [], locations: [], excludedLocations: [], workplaceTypes: [], employmentTypes: [],
    requiredTerms: [], preferredTerms: ['TypeScript'], excludedTerms: [], maximumAgeDays: 30, createdAt: now, updatedAt: now
  }
  const postings: JobPosting[] = Array.from({ length: 45 }, (_, index) => ({
    id: `ux-posting-${index}`, sourceId: 'ux-source', externalId: String(index),
    canonicalUrl: `https://www.zhipin.com/job_detail/ux-example-${index}.html`,
    applyUrl: `https://www.zhipin.com/job_detail/ux-example-${index}.html`,
    title: `Platform Engineer ${String(index).padStart(2, '0')}`, company: `Example Systems ${index}`,
    description: `${'Build reliable TypeScript platforms with the engineering team.\n'.repeat(18)}Final requirement: accessibility experience.`,
    locale: 'en', location: 'Shanghai', workplaceType: 'hybrid', employmentType: 'full-time',
    status: 'open', contentHash: `hash:ux-${index}`, firstSeenAt: now, lastCheckedAt: now
  }))
  await page.addInitScript((data) => {
    localStorage.setItem('job-seeker-agent-motion', 'reduced')
    localStorage.setItem('job-seeker-agent-drafts-v1', JSON.stringify({ version: 1, state: { activeDraftId: data.id, drafts: [data] } }))
  }, draft)
  await page.goto('/en/jobs')
  await expect(page.getByRole('heading', { name: 'Complete job setup first' })).toBeVisible()
  // The setup prompt can render before the asynchronous workspace database opens.
  await expect.poll(() => page.evaluate(async () => (
    (await indexedDB.databases()).some((database) => database.name === 'resume-os-domain')
  ))).toBe(true)
  await page.evaluate(async ({ records }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('resume-os-domain')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(Object.keys(records), 'readwrite')
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
        for (const [storeName, rows] of Object.entries(records)) {
          for (const row of rows) transaction.objectStore(storeName).put(row)
        }
      })
    } finally { database.close() }
  }, { records: {
    evidenceSources: [{ id: careerEvidenceSourceId(draft.id), type: 'resume-import', label: 'Synthetic UX fixture', createdAt: now }],
    jobSources: [jobSourceSchema.parse({ id: 'ux-source', kind: 'manual', label: 'Synthetic fixture', enabled: true, createdAt: now, updatedAt: now })],
    jobSearchProfiles: [profile], jobPostings: postings,
    jobRecommendations: postings.map((posting) => scoreJobRecommendation({ posting, profile, sourceDraftId: draft.id, facts: [], now }))
  } })
  await page.goto('/en/jobs/opportunities')
  await expect(page.getByRole('list', { name: 'Matching opportunities' })).toBeVisible()
}

test('keeps profile, preferences, and settings reachable and resets section scroll and focus', async ({ page }) => {
  await page.goto('/en/jobs')
  for (const name of ['Open settings', 'Job preferences', 'Candidate']) {
    await expect(page.getByRole('link', { name, exact: true })).toBeInViewport()
  }
  await page.getByRole('link', { name: 'Open settings' }).click()
  await expect(page.getByRole('heading', { name: 'Model and system settings', level: 1 })).toBeFocused()
  await expect(page.getByRole('heading', { name: 'Appearance', exact: true })).toBeVisible()
  await page.locator('.job-workspace__main').evaluate((element) => { element.scrollTop = 300 })
  await page.getByRole('link', { name: 'Opportunities', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Opportunity inbox', level: 1 })).toBeFocused()
  await expect.poll(() => page.locator('.job-workspace__main').evaluate((element) => element.scrollTop)).toBe(0)
  await expect(page.getByRole('link', { name: 'Opportunities', exact: true })).toHaveAttribute('aria-current', 'page')
  const topbar = await page.locator('.job-workspace__topbar').boundingBox()
  const content = await page.locator('.job-opportunities__list > header').boundingBox()
  expect(content!.y).toBeGreaterThanOrEqual(topbar!.y + topbar!.height - 1)
  await page.getByRole('link', { name: 'Job preferences', exact: true }).click()
  await expect(page).toHaveURL(/\/en\/jobs\/preferences$/u)
  await expect(page.getByText('Bring back a job', { exact: true })).toBeVisible()
})

test('preserves setup button contrast, readable input type, and spacing', async ({ page }, testInfo) => {
  await page.goto('/zh/jobs/setup')
  const input = page.getByRole('textbox', { name: '我的求职需求' })
  await input.fill('上海的 TypeScript 平台工程师岗位')
  const action = page.getByRole('button', { name: '让 Agent 分析需求' })
  await expect(action).toBeEnabled()
  await expect(action).toHaveCSS('color', 'rgb(255, 255, 255)')
  await expect(input).toHaveCSS('font-size', '16px')
  await expect(input).toHaveCSS('line-height', '24px')
  await expect(page.locator('.job-setup__header p')).toHaveCSS('margin-top', '12px')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width)
  await expectNoDevelopmentOverlay(page)
  const screenshot = await page.screenshot({ path: testInfo.outputPath('setup.png'), animations: 'disabled', scale: 'css' })
  await expectReadableScreenshot(page, screenshot)
})

test('honors saved reduced motion independently from the operating system', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.addInitScript(() => localStorage.setItem('job-seeker-agent-motion', 'reduced'))
  await page.goto('/en/jobs')
  await expect(page.locator('.job-overview')).toHaveCSS('animation-name', 'none')
  await page.getByRole('link', { name: 'Open settings' }).click()
  const motion = page.getByRole('radiogroup', { name: 'Motion preference' })
  await motion.getByRole('radio', { name: 'Full motion' }).click()
  await page.getByRole('link', { name: 'Today', exact: true }).click()
  await expect(page.locator('.job-overview')).toHaveCSS('animation-name', 'job-command-enter')
  await page.getByRole('link', { name: 'Open settings' }).click()
  await motion.getByRole('radio', { name: 'System', exact: true }).click()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('link', { name: 'Today', exact: true }).click()
  await expect(page.locator('.job-overview')).toHaveCSS('animation-name', 'none')
})

test('searches a paginated inbox and opens readable details with a mobile return path', async ({ page }, testInfo) => {
  await seedOpportunities(page)
  const list = page.getByRole('list', { name: 'Matching opportunities' })
  await expect(list.getByRole('button')).toHaveCount(20)
  await page.getByRole('button', { name: 'Next page' }).click()
  await expect(page.getByText('45 roles · Page 2 of 3')).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search title, company, or location' }).fill('Engineer 44')
  await expect(list.getByRole('button')).toHaveCount(1)
  await list.getByRole('button', { name: /Platform Engineer 44/ }).click()
  await expect(page.getByRole('heading', { name: 'Platform Engineer 44' })).toBeInViewport()
  if (testInfo.project.name.startsWith('mobile')) await expect(page.getByRole('button', { name: 'Back to opportunities' })).toBeInViewport()
  await page.getByRole('button', { name: 'Read full description' }).click()
  await expect(page.getByText(/Final requirement: accessibility experience/)).toBeVisible()
  await page.getByRole('button', { name: 'Show less' }).click()
  if (testInfo.project.name.startsWith('mobile')) {
    await expect(list).toBeHidden()
    await page.getByRole('button', { name: 'Back to opportunities' }).click()
    await expect(list.getByRole('button', { name: /Platform Engineer 44/ })).toBeFocused()
    await list.getByRole('button', { name: /Platform Engineer 44/ }).click()
  } else {
    await page.setViewportSize({ width: 1024, height: 900 })
  }
  expect(await page.locator('.job-workspace__main').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await expectNoDevelopmentOverlay(page)
  const screenshot = await page.screenshot({ path: testInfo.outputPath('opportunity-details.png'), animations: 'disabled', scale: 'css' })
  await expectReadableScreenshot(page, screenshot)
})
