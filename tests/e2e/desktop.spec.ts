import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectNoDevelopmentOverlay, expectReadableScreenshot } from './support/screenshot-evidence'
import { waitForAppSurfaceToSettle } from './support/stable-motion'

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop window-management coverage')
})

async function windowGeometry(app: Locator) {
  return app.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
  })
}

async function loadAnonymousSample(page: Page) {
  await page.goto('/en/studio')
  const studio = page.getByRole('application', { name: 'Resume Studio' })
  await studio.getByRole('tab', { name: 'Demo / Sandbox' }).click()
  await studio.getByRole('button', { name: 'Load anonymous sample' }).click()
  await expect(studio.getByRole('heading', { name: 'Demo Candidate' })).toBeVisible()
}

async function setMotionPreference(page: Page, preference: 'Full motion' | 'Reduced motion') {
  const dock = page.getByRole('navigation', { name: 'Dock' })
  await dock.getByRole('button', { name: 'Settings' }).click()
  const settings = page.getByRole('application', { name: 'Settings' })
  await settings.getByRole('radio', { name: preference, exact: true }).click()
  await settings.getByRole('button', { name: 'Close Settings', exact: true }).click()
  await expect(settings).toBeHidden()
}

test('manages concurrent legacy tool windows with persistent geometry', async ({ page }) => {
  await page.goto('/en/studio')
  const dock = page.getByRole('navigation', { name: 'Dock' })
  const studio = page.getByRole('application', { name: 'Resume Studio' })
  await expect(studio).toBeVisible()

  await page.goto('/en/timeline')
  await expect(page.getByRole('application', { name: 'Career Timeline' })).toBeVisible()
  await page.goto('/en/classic')
  await expect(page.getByRole('application', { name: 'Review & Export' })).toBeVisible()
  await dock.getByRole('button', { name: 'Resume Agent' }).click()
  await expect(page).toHaveURL(/\/en\/agent$/)
  await expect(page.getByTestId('focused-app')).toHaveText('Resume Agent')
  await expect(page.getByRole('application')).toHaveCount(4)

  const agent = page.getByRole('application', { name: 'Resume Agent' })
  const timeline = page.getByRole('application', { name: 'Career Timeline' })
  await expect(agent).toBeVisible()
  await expect(timeline).toBeVisible()
  await dock.getByRole('button', { name: 'Career Timeline' }).click()
  await expect(page).toHaveURL(/\/en\/timeline$/)
  await expect(page.getByTestId('focused-app')).toHaveText('Career Timeline')

  const beforeDrag = await windowGeometry(timeline)
  const titlebar = timeline.locator('.desktop-window__titlebar')
  const titlebarBox = await titlebar.boundingBox()
  if (!titlebarBox) throw new Error('Timeline title bar is not measurable')
  await page.mouse.move(titlebarBox.x + titlebarBox.width / 2, titlebarBox.y + titlebarBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(titlebarBox.x + titlebarBox.width / 2 + 72, titlebarBox.y + titlebarBox.height / 2 + 44, { steps: 8 })
  await page.mouse.up()
  const afterDrag = await windowGeometry(timeline)
  expect(afterDrag.x).not.toBe(beforeDrag.x)

  const resizeHandle = timeline.locator('.desktop-window__resize-handle--se')
  const handleBox = await resizeHandle.boundingBox()
  if (!handleBox) throw new Error('Timeline resize handle is not measurable')
  const beforeResize = await windowGeometry(timeline)
  await page.mouse.move(handleBox.x + 4, handleBox.y + 4)
  await page.mouse.down()
  await page.mouse.move(handleBox.x + 64, handleBox.y + 42, { steps: 8 })
  await page.mouse.up()
  const afterResize = await windowGeometry(timeline)
  expect(afterResize.width + afterResize.height).toBeGreaterThan(beforeResize.width + beforeResize.height)

  await dock.getByRole('button', { name: 'Resume Agent' }).click()
  await expect(page.getByTestId('focused-app')).toHaveText('Resume Agent')
  const [agentZIndex, timelineZIndex] = await Promise.all([
    agent.evaluate((element) => Number(getComputedStyle(element.parentElement!).zIndex)),
    timeline.evaluate((element) => Number(getComputedStyle(element.parentElement!).zIndex))
  ])
  expect(agentZIndex).toBeGreaterThan(timelineZIndex)
  await agent.getByRole('button', { name: 'Minimize Resume Agent' }).click()
  await expect(agent).toBeHidden()
  await dock.getByRole('button', { name: 'Resume Agent' }).click()
  await expect(agent).toBeVisible()

  await agent.getByRole('button', { name: 'Maximize Resume Agent' }).click()
  await expect(agent).toHaveAttribute('data-window-status', 'maximized')
  await agent.getByRole('button', { name: 'Restore Resume Agent' }).click()
  await expect(agent).toHaveAttribute('data-window-status', 'open')

  const persisted = await windowGeometry(timeline)
  await page.reload()
  await expect(page.getByRole('application')).toHaveCount(4)
  expect(await windowGeometry(page.getByRole('application', { name: 'Career Timeline' }))).toEqual(persisted)
})

test('captures fully settled Studio windows at both acceptance viewports', async ({ page }) => {
  const captures = [
    { width: 1440, height: 900, path: '/tmp/job-seeker-agent-task14-acceptance-desktop-1440x900.png' },
    { width: 1280, height: 800, path: '/tmp/job-seeker-agent-task14-acceptance-desktop-1280x800.png' }
  ]

  for (const capture of captures) {
    await page.setViewportSize({ width: capture.width, height: capture.height })
    await page.goto('/en/studio')
    const studio = page.getByRole('application', { name: 'Resume Studio' })
    await expect(studio.getByRole('tab', { name: 'Paste' })).toBeVisible()
    await expect(studio.getByRole('heading', { name: 'Drafts' })).toBeVisible()
    await waitForAppSurfaceToSettle(studio)

    const state = await studio.evaluate((element) => {
      const motion = element.closest<HTMLElement>('.desktop-window-motion')
      const rect = element.getBoundingClientRect()
      if (!motion) throw new Error('Missing Studio motion frame')
      return {
        opacity: getComputedStyle(motion).opacity,
        motionStatus: motion.dataset.windowMotionStatus,
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        viewport: { width: window.innerWidth, height: window.innerHeight }
      }
    })
    expect(state.opacity).toBe('1')
    expect(state.motionStatus).toBe('open')
    expect(state.rect.left).toBeGreaterThanOrEqual(0)
    expect(state.rect.top).toBeGreaterThanOrEqual(30)
    expect(state.rect.right).toBeLessThanOrEqual(state.viewport.width)
    expect(state.rect.bottom).toBeLessThanOrEqual(state.viewport.height - 82)

    await expectNoDevelopmentOverlay(page)
    const image = await page.screenshot({ path: capture.path, fullPage: true })
    await expectReadableScreenshot(page, image)
  }
})

test('renders the AI agent constellation across desktop motion states and viewports', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/en/studio')

  const html = page.locator('html')
  const menuBar = page.getByTestId('menu-bar')
  const ambient = page.getByTestId('desktop-ambient')
  const launcher = page.getByTestId('desktop-launcher')
  const dock = page.getByTestId('dock')
  const workflowHud = page.getByTestId('workflow-overview')
  const stage = ambient.locator('.desktop-ambient__stage')
  const nodes = ambient.locator('[data-agent-node]')
  const phases = ambient.locator('[data-agent-phase]')

  await menuBar.getByRole('button', { name: 'Dark', exact: true }).click()
  await setMotionPreference(page, 'Full motion')
  await expect(html).toHaveAttribute('data-theme', 'dark')
  await expect(html).toHaveAttribute('data-motion', 'full')
  await expect(ambient).toHaveAttribute('aria-hidden', 'true')
  await expect(ambient).toHaveAttribute('data-scene', 'agent-constellation')
  await expect(ambient).toHaveAttribute('data-subdued', 'true')
  await expect(ambient).toHaveAttribute('data-reduced-motion', 'false')
  await expect(ambient).toHaveAttribute('data-cinematic-cycle', '14000')
  await expect(ambient).toHaveAttribute('data-story-duration', '14000')
  await expect(ambient).toHaveAttribute('data-story-mode', 'sequence')
  await expect(ambient).toHaveCSS('pointer-events', 'none')
  await expect(ambient.locator('[data-agent-core]')).toHaveCount(1)
  await expect(nodes).toHaveCount(6)
  await expect(phases).toHaveCount(4)
  await expect(ambient.locator('[data-agent-phase-rail]')).toHaveCount(1)
  await expect(ambient.locator('[data-story-output="resume-variant"]')).toHaveCount(1)
  await expect(ambient.locator('[data-story-status]')).toHaveCount(7)
  await expect(ambient.locator('video, canvas, img')).toHaveCount(0)
  await expect(page.locator('video, canvas, img')).toHaveCount(0)
  await expect(workflowHud).toBeVisible()
  await expect(launcher.getByRole('button')).toHaveCount(10)
  await expect(dock.locator('.desktop-dock-item:not([data-dock-supplemental])')).toHaveCount(7)

  expect(await launcher.getByRole('button').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('aria-label'))
  )).toEqual([
    'Resume Studio',
    'Job Agent',
    'Resume Agent',
    'Target Job',
    'Resume 3D',
    'Resume Book',
    'Review & Export',
    'Projects',
    'Career Timeline',
    'Terminal'
  ])
  expect(await dock.locator('.desktop-dock-item:not([data-dock-supplemental])').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('aria-label'))
  )).toEqual([
    'Resume Studio',
    'Job Agent',
    'Resume Agent',
    'Resume 3D',
    'Resume Book',
    'Projects',
    'Settings'
  ])

  expect(await nodes.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-ambient-app'))
  )).toEqual(['studio', 'agent', 'jd-match', 'resume-3d', 'projects', 'timeline'])
  expect(await phases.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-agent-phase'))
  )).toEqual(['retrieve', 'rank', 'synthesize', 'verify'])
  expect(await ambient.locator('[data-story-status]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-story-status'))
  )).toEqual(['ready', 'inputs', 'retrieve', 'rank', 'synthesize', 'verify', 'variant'])
  expect([
    ...(await ambient.locator('[data-story-step]').evaluateAll((elements) =>
      elements.slice(0, 2).map((element) => element.getAttribute('data-story-step'))
    )),
    ...(await phases.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-agent-phase'))
    )),
    'variant'
  ]).toEqual(['evidence', 'jd', 'retrieve', 'rank', 'synthesize', 'verify', 'variant'])

  await expectNoDevelopmentOverlay(page)
  const fullImage = await page.screenshot({
    path: '/tmp/job-seeker-agent-agent-constellation-full-1440x900.png'
  })
  await expectReadableScreenshot(page, fullImage)

  await setMotionPreference(page, 'Reduced motion')
  await expect(html).toHaveAttribute('data-motion', 'reduced')
  await expect(ambient).toHaveAttribute('data-reduced-motion', 'true')
  await expect(ambient).toHaveAttribute('data-story-mode', 'poster')
  await expect(ambient.locator('[data-story-output="resume-variant"]')).toHaveCSS('opacity', '1')
  await expect(ambient.locator('[data-story-status="variant"]')).toHaveCSS('opacity', '1')
  await expect(ambient.locator('.desktop-ambient__packet').first()).toHaveCSS('opacity', '0')
  await expect.poll(() => stage.evaluate((element) => [
    element.style.getPropertyValue('--ambient-shift-x'),
    element.style.getPropertyValue('--ambient-shift-y'),
    element.style.getPropertyValue('--ambient-tilt-x'),
    element.style.getPropertyValue('--ambient-tilt-y')
  ])).toEqual(['0px', '0px', '0deg', '0deg'])
  await expect.poll(() => ambient.evaluate((element) =>
    element.getAnimations({ subtree: true }).filter((animation) => animation.playState === 'running').length
  )).toBe(0)

  await expect(ambient).toHaveAttribute('data-pointer', 'false')
  expect(await stage.evaluate((element) => [
    element.style.getPropertyValue('--ambient-shift-x'),
    element.style.getPropertyValue('--ambient-shift-y'),
    element.style.getPropertyValue('--ambient-tilt-x'),
    element.style.getPropertyValue('--ambient-tilt-y')
  ])).toEqual(['0px', '0px', '0deg', '0deg'])

  const reducedImage = await page.screenshot({
    path: '/tmp/job-seeker-agent-agent-constellation-reduced-1440x900.png'
  })
  await expectReadableScreenshot(page, reducedImage)

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1440, height: 800 },
    { width: 1280, height: 720 },
    { width: 1440, height: 691 },
    { width: 1440, height: 634 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport)
    await expect(launcher).toBeVisible()
    await expect(launcher.getByRole('button')).toHaveCount(10)
    await expect(dock.getByRole('button')).toHaveCount(7)
    await expect.poll(() => ambient.evaluate((root) => {
      const desktop = root.parentElement
      if (!desktop) throw new Error('Ambient scene is missing its desktop surface')
      const surface = desktop.getBoundingClientRect()
      const stage = root.querySelector<HTMLElement>('.desktop-ambient__stage')?.getBoundingClientRect()
      const core = root.querySelector<HTMLElement>('[data-agent-core]')?.getBoundingClientRect()
      const rail = root.querySelector<HTMLElement>('[data-agent-phase-rail]')?.getBoundingClientRect()
      const hud = desktop.querySelector<HTMLElement>('[data-testid="workflow-overview"]')?.getBoundingClientRect()
      const launcher = desktop.querySelector<HTMLElement>('[data-testid="desktop-launcher"]')?.getBoundingClientRect()
      const dock = document.querySelector<HTMLElement>('[data-testid="dock"]')?.getBoundingClientRect()
      if (!stage || !core || !rail || !hud || !launcher || !dock) throw new Error('Missing cinematic layout target')
      const targets = Array.from(root.querySelectorAll<HTMLElement>(
        '[data-agent-core], [data-agent-node], [data-agent-node] .desktop-ambient__agent-copy, [data-agent-phase-rail]'
      )).map((element) => element.getBoundingClientRect())
      const overlaps = (first: DOMRect, second: DOMRect) => !(
        first.right <= second.left
        || first.left >= second.right
        || first.bottom <= second.top
        || first.top >= second.bottom
      )
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        documentFits: document.documentElement.scrollWidth <= window.innerWidth
          && document.documentElement.scrollHeight <= window.innerHeight,
        targetsMeasurable: targets.every((rect) => rect.width > 0 && rect.height > 0),
        targetsContained: targets.every((rect) => (
          rect.left >= surface.left - 1
          && rect.top >= surface.top - 1
          && rect.right <= surface.right + 1
          && rect.bottom <= surface.bottom + 1
        )),
        stageContained: stage.left >= surface.left - 1
          && stage.top >= surface.top - 1
          && stage.right <= surface.right + 1
          && stage.bottom <= surface.bottom + 1,
        railContained: rail.left >= surface.left - 1
          && rail.right <= surface.right + 1,
        dockContained: dock.left >= 0
          && dock.right <= window.innerWidth
          && dock.top >= 0
          && dock.bottom <= window.innerHeight,
        coreOverlapsHud: overlaps(core, hud),
        launcherOverlapsHud: overlaps(launcher, hud),
        launcherOverlapsAgentTarget: targets.some((target) => overlaps(launcher, target))
      }
    })).toEqual({
      viewport,
      documentFits: true,
      targetsMeasurable: true,
      targetsContained: true,
      stageContained: true,
      railContained: true,
      dockContained: true,
      coreOverlapsHud: false,
      launcherOverlapsHud: false,
      launcherOverlapsAgentTarget: false
    })
  }

  await page.setViewportSize({ width: 899, height: 768 })
  await expect(launcher).toBeHidden()
  await expect(dock.getByRole('button')).toHaveCount(11)

  await page.setViewportSize({ width: 900, height: 768 })
  await expect(launcher).toBeVisible()
  await expect(launcher.getByRole('button')).toHaveCount(10)
  await expect(dock.getByRole('button')).toHaveCount(7)
})

test('keeps deep links, history, locale, theme, and reduced motion coherent', async ({ page }) => {
  await page.goto('/en/timeline')
  await expect(page.getByRole('application', { name: 'Career Timeline' })).toBeVisible()
  await page.getByRole('navigation', { name: 'Dock' }).getByRole('button', { name: 'Settings' }).click()
  await expect(page).toHaveURL(/\/en\/settings$/)

  const settings = page.getByRole('application', { name: 'Settings' })
  await settings.getByRole('radio', { name: 'Light' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  expect(await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>('.desktop-shell')
    const menu = document.querySelector<HTMLElement>('[data-testid="menu-bar"]')
    const dock = document.querySelector<HTMLElement>('[data-testid="dock"]')
    const app = document.querySelector<HTMLElement>('[role="application"]')
    if (!shell || !menu || !dock || !app) throw new Error('Missing themed desktop surface')
    const customProperty = (element: HTMLElement, property: string) => (
      getComputedStyle(element).getPropertyValue(property).trim()
    )
    return {
      shellBackground: getComputedStyle(shell).backgroundColor,
      menuColorScheme: getComputedStyle(menu).colorScheme,
      menuPanel: customProperty(menu, '--theme-panel'),
      dockColorScheme: getComputedStyle(dock).colorScheme,
      dockPanel: customProperty(dock, '--theme-panel'),
      appBackground: getComputedStyle(app).backgroundColor
    }
  })).toEqual({
    shellBackground: 'rgb(238, 244, 246)',
    menuColorScheme: 'light',
    menuPanel: '#fff',
    dockColorScheme: 'light',
    dockPanel: '#fff',
    appBackground: 'rgba(246, 246, 248, 0.96)'
  })
  await settings.getByRole('radio', { name: 'Reduced motion' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced')
  await settings.getByRole('radio', { name: '中文' }).click()
  await expect(page).toHaveURL(/\/zh\/settings$/)
  await expect(page.getByRole('application', { name: '设置' })).toBeVisible()

  await page.goBack()
  await expect(page).toHaveURL(/\/en\/timeline$/)
  await page.goForward()
  await expect(page).toHaveURL(/\/zh\/settings$/)
})

test('survives project detail refresh and resets desktop state without deleting drafts', async ({ page }) => {
  await loadAnonymousSample(page)
  await page.goto('/en/projects')
  const projects = page.getByRole('application', { name: 'Projects' })
  await projects.getByRole('button', { name: 'Open Evidence RAG Lab' }).click()
  await expect(page).toHaveURL(/\/en\/projects\/evidence-rag-lab$/)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Evidence RAG Lab' })).toBeVisible()

  await page.evaluate(() => localStorage.setItem('job-seeker-agent-drafts-v1', 'draft-sentinel'))
  await page.getByRole('navigation', { name: 'Dock' }).getByRole('button', { name: 'Settings' }).click()
  const settings = page.getByRole('application', { name: 'Settings' })
  await settings.getByRole('button', { name: 'Reset desktop layout' }).click()
  await settings.getByRole('button', { name: 'Confirm reset' }).click()
  expect(await page.evaluate(() => localStorage.getItem('job-seeker-agent-drafts-v1'))).toBe('draft-sentinel')
  expect(await page.evaluate(() => localStorage.getItem('job-seeker-agent-desktop-v1'))).toBeNull()
})

test('keeps a BYOK key local and attaches it only to the AI diagnostic request', async ({ page }) => {
  let requestHeaders: Record<string, string> | null = null
  await page.route('**/api/chat', async (route) => {
    requestHeaders = await route.request().allHeaders()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ answer: 'ready', model: 'e2e-model' })
    })
  })
  await page.goto('/en/settings')

  const settings = page.getByRole('application', { name: 'Settings' })
  await settings.getByRole('radio', { name: /Self-configured AI/ }).check()
  await settings.getByLabel('API Base URL').fill('https://api.openai.com/v1')
  await settings.getByLabel('Model', { exact: true }).fill('e2e-model')
  await settings.getByLabel('API Key', { exact: true }).fill('e2e-user-key')
  await settings.getByRole('button', { name: 'Save AI configuration' }).click()
  await expect(settings.getByRole('status')).toContainText('this session')

  const storage = await page.evaluate(() => ({
    config: JSON.parse(localStorage.getItem('job-seeker-agent-ai-config-v1') ?? 'null'),
    localKey: localStorage.getItem('job-seeker-agent-ai-key'),
    sessionKey: sessionStorage.getItem('job-seeker-agent-ai-key')
  }))
  expect(storage.config).toEqual({
    version: 1,
    baseURL: 'https://api.openai.com/v1',
    model: 'e2e-model',
    rememberApiKey: false
  })
  expect(storage.localKey).toBeNull()
  expect(storage.sessionKey).toBe('e2e-user-key')

  await settings.getByRole('button', { name: 'Check selected AI' }).click()
  await expect(settings.getByText('Check succeeded: Self-configured AI · e2e-model')).toBeVisible()
  expect(requestHeaders).toMatchObject({
    'x-job-seeker-agent-ai-key': 'e2e-user-key',
    'x-job-seeker-agent-ai-base-url': 'https://api.openai.com/v1',
    'x-job-seeker-agent-ai-model': 'e2e-model'
  })
})
