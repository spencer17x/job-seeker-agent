'use client'

import dynamic from 'next/dynamic'
import {
  Activity,
  Bot,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronRight,
  ClipboardPaste,
  ExternalLink,
  FileText,
  CalendarClock,
  LayoutDashboard,
  MessageSquareText,
  Pause,
  Play,
  Radar,
  Save,
  Send,
  Settings2,
  SlidersHorizontal,
  X
} from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react'
import { usePathname } from '@/i18n/navigation'
import { useResumeDraft } from '@/components/resume-draft-provider'
import { isTrustedResumeSource } from '@/lib/resume-model'
import { ApplicationPipeline } from '@/components/apps/application-pipeline'
import { ResumeVariantLibrary } from '@/components/apps/resume-variant-library'
import { JobProcessBoard } from '@/components/apps/job-process-board'
import { JobHistoryLearningPanel } from '@/components/apps/job-history-learning-panel'
import { useJobStrategyMemory } from '@/components/apps/use-job-strategy-memory'
import { useApplicationController } from '@/components/apps/use-application-controller'
import { useBossConversationController } from '@/components/apps/use-boss-conversation-controller'
import { useJobSearchProfileController } from '@/components/apps/use-job-search-profile-controller'
import { useJobDiscoveryController } from '@/components/apps/use-job-discovery-controller'
import { JobAgentRuntimeStatus } from '@/components/apps/job-agent-runtime-status'
import { buttonVariants } from '@/components/ui/button'
import { CAREER_EVIDENCE_CHANGED_EVENT } from '@/lib/agent/career-evidence'
import { ACTIVE_WORKFLOW_CHANGED_EVENT } from '@/lib/agent/workflow-persistence'
import { createDomainStore, type IndexedDbDomainStore } from '@/lib/agent/domain-store'
import {
  type ApplicationRecord,
  type JobPosting,
  type JobRecommendation,
  type JobSearchProfile,
  type JobSource
} from '@/lib/jobs/job-domain'
import type { BossConversationMessage, BossConversationThread } from '@/lib/jobs/boss-conversation'
import { loadJobWorkspaceSnapshot } from '@/lib/jobs/job-workspace'
import { formatMonthlyCompensation, recommendationReasonMessageKey, sanitizeJobDisplayText } from '@/lib/jobs/job-display'
import {
  configureBrowserJobAgent,
  detectBrowserAgentSessions,
  diagnoseBossBrowserAdapter,
  getBrowserJobAgentRuntime,
  readBrowserJobAgentCycle,
  reportBrowserJobAgentCycle,
  summarizeBossHistory,
  JOB_AGENT_WAKE_EVENT,
  LEGACY_JOB_AGENT_WAKE_EVENT,
  type BrowserBossAdapterDiagnostic,
  type BrowserJobAgentRuntime,
  type BrowserPlatformSession
} from '@/lib/jobs/browser-agent-protocol'
import {
  DEFAULT_JOB_AGENT_PREFERENCES,
  JOB_AGENT_PLATFORM_IDS,
  JOB_AGENT_PREFERENCES_KEY,
  LEGACY_JOB_AGENT_PREFERENCES_KEY,
  parseJobAgentPreferences,
  serializeJobAgentPreferences,
  type JobAgentPreferences
} from '@/lib/jobs/job-agent-policy'
import { readMigratedStorageValue } from '@/lib/brand-migration'
import { simulateJobAgentFromHistory, type JobHistorySimulation } from '@/lib/jobs/job-history-learning'
import type { ApplicationPacket } from '@/lib/jobs/application-record'
import { createSameOriginJobSourceAdapter, type JobSourceAdapter } from '@/lib/jobs/sources'
import type { AppId } from '@/lib/desktop/types'
import { cn } from '@/lib/utils'

type SourceKind = Extract<JobSource['kind'], 'greenhouse' | 'lever'>
type JobWorkspaceSection = 'overview' | 'opportunities' | 'resumes' | 'conversations' | 'applications' | 'interviews' | 'activity' | 'preferences' | 'profile' | 'target-job' | 'settings' | 'setup'

const LazyInterviewWorkspace = dynamic(
  () => import('@/components/apps/interview-workspace').then((module) => module.InterviewWorkspace),
  { loading: JobEmbeddedLoading }
)
const LazyJDMatchApp = dynamic(
  () => import('@/components/apps/jd-match-app').then((module) => module.JDMatchApp),
  { loading: JobEmbeddedLoading }
)
const LazyResumeStudioApp = dynamic(
  () => import('@/components/apps/resume-studio-app').then((module) => module.ResumeStudioApp),
  { loading: JobEmbeddedLoading }
)
const LazyResumeAgentApp = dynamic(
  () => import('@/components/apps/resume-agent-app').then((module) => module.ResumeAgentApp),
  { loading: JobEmbeddedLoading }
)
const LazySettingsApp = dynamic(
  () => import('@/components/apps/settings-app').then((module) => module.SettingsApp),
  { loading: JobEmbeddedLoading }
)
const LazyJobAgentSetup = dynamic(
  () => import('@/components/apps/job-agent-setup').then((module) => module.JobAgentSetup),
  { loading: JobEmbeddedLoading }
)

function JobEmbeddedLoading() {
  const t = useTranslations('jobRadar.workspace')
  return <div className="job-embedded-loading" role="status" aria-label={t('loadingModule')} aria-busy="true"><span /></div>
}

function Link({ href, onClick, ...props }: Omit<ComponentPropsWithoutRef<'a'>, 'href'> & { href: string }) {
  const locale = useLocale()
  return <a {...props} href={`/${locale}${href}`} onClick={(event) => {
    onClick?.(event)
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
      || props.target === '_blank'
    ) return
    event.preventDefault()
    navigateJobWorkspace(locale, href)
  }} />
}

function navigateJobWorkspace(locale: string, href: string) {
  const localizedHref = href.startsWith(`/${locale}/`) ? href : `/${locale}${href}`
  window.history.pushState(null, '', localizedHref)
}

export type JobRadarAppProps = {
  appId?: AppId
  store?: IndexedDbDomainStore
  createAdapter?: (kind: SourceKind) => JobSourceAdapter
}

export function JobRadarApp({ store: storeOverride, createAdapter = createSameOriginJobSourceAdapter }: JobRadarAppProps = {}) {
  const t = useTranslations('jobRadar')
  const desktopT = useTranslations('desktop')
  const locale = useLocale()
  const pathname = usePathname()
  const workspaceSection = jobWorkspaceSection(pathname)
  const { activeDraft } = useResumeDraft()
  const trustedDraftSource = Boolean(activeDraft && isTrustedResumeSource(activeDraft.source))
  const [evidenceReadyDraftId, setEvidenceReadyDraftId] = useState('')
  const [evidenceCheckedDraftId, setEvidenceCheckedDraftId] = useState('')
  const trustedEvidenceReady = Boolean(activeDraft && evidenceReadyDraftId === activeDraft.id)
  const trustedDraft = trustedDraftSource && trustedEvidenceReady
  const [store] = useState(() => storeOverride ?? createDomainStore())
  const [sources, setSources] = useState<JobSource[]>([])
  const [profiles, setProfiles] = useState<JobSearchProfile[]>([])
  const [postings, setPostings] = useState<JobPosting[]>([])
  const [recommendations, setRecommendations] = useState<JobRecommendation[]>([])
  const [applications, setApplications] = useState<ApplicationRecord[]>([])
  const [packets, setPackets] = useState<ApplicationPacket[]>([])
  const [conversationThreads, setConversationThreads] = useState<BossConversationThread[]>([])
  const [conversationMessages, setConversationMessages] = useState<BossConversationMessage[]>([])
  const [agentPreferences, setAgentPreferences] = useState<JobAgentPreferences>(DEFAULT_JOB_AGENT_PREFERENCES)
  const [agentPreferencesHydrated, setAgentPreferencesHydrated] = useState(false)
  const [browserSessions, setBrowserSessions] = useState<BrowserPlatformSession[]>([])
  const [browserAgentAvailable, setBrowserAgentAvailable] = useState(false)
  const [adapterDiagnostics, setAdapterDiagnostics] = useState<BrowserBossAdapterDiagnostic[]>([])
  const [browserJobRuntime, setBrowserJobRuntime] = useState<BrowserJobAgentRuntime | null>(null)
  const [diagnosingAdapter, setDiagnosingAdapter] = useState(false)
  const [historyLearningBusy, setHistoryLearningBusy] = useState(false)
  const [historySimulation, setHistorySimulation] = useState<JobHistorySimulation | null>(null)
  const strategyMemory = useJobStrategyMemory()
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const activeBrowserCyclesRef = useRef(new Set<string>())
  const loadGenerationRef = useRef(0)
  const savedSearchProfile = profiles[0]
  const agentSetupComplete = trustedDraft && Boolean(savedSearchProfile?.titles.length)
  const agentExecutionEnabled = agentPreferences.enabled && agentSetupComplete
  const agentRunning = agentExecutionEnabled && browserAgentAvailable

  const load = useCallback(async () => {
    const generation = loadGenerationRef.current + 1
    loadGenerationRef.current = generation
    const snapshot = await loadJobWorkspaceSnapshot({ store, activeDraft })
    if (loadGenerationRef.current !== generation) return
    setEvidenceReadyDraftId(snapshot.evidenceReady && activeDraft ? activeDraft.id : '')
    setEvidenceCheckedDraftId(activeDraft?.id ?? '')
    setSources(snapshot.sources)
    setProfiles(snapshot.profiles)
    setPostings(snapshot.postings)
    setRecommendations(snapshot.recommendations)
    setApplications(snapshot.applications)
    setConversationThreads(snapshot.conversationThreads)
    setConversationMessages(snapshot.conversationMessages)
    setPackets(snapshot.packets)
    setLoaded(true)
  }, [activeDraft, store])

  const profileController = useJobSearchProfileController({
    store,
    profiles,
    activeDraft,
    trustedDraft,
    loaded,
    preferences: agentPreferences,
    setPreferences: setAgentPreferences,
    reload: load,
    setError,
    setNotice
  })
  const discoveryController = useJobDiscoveryController({
    store,
    activeDraft,
    trustedDraft,
    browserAgentAvailable,
    sources,
    profiles,
    postings,
    recommendations,
    applications,
    preferences: agentPreferences,
    selectedPlatforms: profileController.selectedPlatforms,
    titles: profileController.titles,
    saveProfile: profileController.saveProfile,
    reload: load,
    navigate: (href) => navigateJobWorkspace(locale, href),
    setError,
    setNotice,
    createAdapter
  })

  const applicationController = useApplicationController({
    store,
    activeDraft,
    enabled: trustedDraft,
    applications,
    reload: load,
    setError,
    setNotice
  })
  const conversationController = useBossConversationController({
    store,
    preferences: agentPreferences,
    threads: conversationThreads,
    messages: conversationMessages,
    reload: load,
    setError,
    setNotice
  })

  useEffect(() => {
    let active = true
    void load().catch(() => { if (active) setError(t('errors.storage')) })
    return () => {
      active = false
      discoveryController.cancel()
    }
  }, [discoveryController.cancel, load, store, t])
  useEffect(() => {
    setAgentPreferences(parseJobAgentPreferences(readMigratedStorageValue(
      window.localStorage,
      JOB_AGENT_PREFERENCES_KEY,
      LEGACY_JOB_AGENT_PREFERENCES_KEY
    )))
    setAgentPreferencesHydrated(true)
  }, [])
  useEffect(() => {
    if (!agentPreferencesHydrated) return
    window.localStorage.setItem(JOB_AGENT_PREFERENCES_KEY, serializeJobAgentPreferences(agentPreferences))
  }, [agentPreferences, agentPreferencesHydrated])
  useEffect(() => {
    const evidenceCheckPending = Boolean(
      trustedDraftSource && activeDraft && evidenceCheckedDraftId !== activeDraft.id
    )
    if (!loaded || !agentPreferencesHydrated || evidenceCheckPending || agentSetupComplete) return
    setAgentPreferences((current) => current.enabled ? { ...current, enabled: false } : current)
  }, [activeDraft, agentPreferencesHydrated, agentSetupComplete, evidenceCheckedDraftId, loaded, trustedDraftSource])
  useEffect(() => {
    let active = true
    void detectBrowserAgentSessions({ window }).then((response) => {
      if (!active) return
      const available = response.ok
      setBrowserAgentAvailable(available)
      setBrowserSessions(response.sessions ?? [])
      if (available) {
        void conversationController.syncSignals().then(() => conversationController.drainAutopilotQueue())
        void runBossAdapterDiagnostics()
        void refreshBrowserJobRuntime()
      }
    })
    return () => { active = false }
  }, [conversationController.syncSignals])
  useEffect(() => {
    const refresh = () => { void load() }
    window.addEventListener(ACTIVE_WORKFLOW_CHANGED_EVENT, refresh)
    window.addEventListener(CAREER_EVIDENCE_CHANGED_EVENT, refresh)
    return () => {
      window.removeEventListener(ACTIVE_WORKFLOW_CHANGED_EVENT, refresh)
      window.removeEventListener(CAREER_EVIDENCE_CHANGED_EVENT, refresh)
    }
  }, [load])

  useEffect(() => {
    if (!browserAgentAvailable) return
    const timeout = window.setTimeout(() => {
      void configureBrowserJobAgent({ window, enabled: agentExecutionEnabled, intervalMinutes: 15 }).then((response) => {
        if (response.jobAgentRuntime) setBrowserJobRuntime(response.jobAgentRuntime)
      })
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [agentExecutionEnabled, browserAgentAvailable])
  useEffect(() => {
    const wake = (event: Event) => {
      const parsed = readBrowserJobAgentCycle(event)
      if (!parsed.success || activeBrowserCyclesRef.current.has(parsed.data.id)) return
      activeBrowserCyclesRef.current.add(parsed.data.id)
      const run = async () => {
        try {
          if (!agentExecutionEnabled || !profileController.titles.trim() || discoveryController.busySourceId) {
            const response = await reportBrowserJobAgentCycle({ window, cycleId: parsed.data.id, status: 'skipped' })
            if (response.jobAgentRuntime) setBrowserJobRuntime(response.jobAgentRuntime)
            return
          }
          await Promise.all([discoveryController.searchMarket(), conversationController.syncSignals()])
          await conversationController.drainAutopilotQueue()
          const response = await reportBrowserJobAgentCycle({ window, cycleId: parsed.data.id, status: 'completed' })
          if (response.jobAgentRuntime) setBrowserJobRuntime(response.jobAgentRuntime)
        } catch {
          const response = await reportBrowserJobAgentCycle({ window, cycleId: parsed.data.id, status: 'failed' }).catch(() => null)
          if (response?.jobAgentRuntime) setBrowserJobRuntime(response.jobAgentRuntime)
        } finally {
          activeBrowserCyclesRef.current.delete(parsed.data.id)
        }
      }
      void run()
    }
    window.addEventListener(JOB_AGENT_WAKE_EVENT, wake)
    window.addEventListener(LEGACY_JOB_AGENT_WAKE_EVENT, wake)
    return () => {
      window.removeEventListener(JOB_AGENT_WAKE_EVENT, wake)
      window.removeEventListener(LEGACY_JOB_AGENT_WAKE_EVENT, wake)
    }
  }, [agentExecutionEnabled, conversationController.syncSignals, discoveryController.busySourceId, discoveryController.searchMarket, profileController.titles])

  function toggleJobAgent() {
    if (!agentSetupComplete) return
    setAgentPreferences((current) => {
      const enabled = !current.enabled
      if (!enabled) discoveryController.cancel()
      return { ...current, enabled }
    })
  }

  async function startConfiguredAgent() {
    const managedPreferences: JobAgentPreferences = {
      ...agentPreferences,
      version: 2,
      enabled: true,
      autonomy: 'autopilot',
      autoSendResume: true
    }
    setAgentPreferences(managedPreferences)
    window.localStorage.setItem(JOB_AGENT_PREFERENCES_KEY, serializeJobAgentPreferences(managedPreferences))
    navigateJobWorkspace(locale, '/jobs/opportunities')
    await Promise.all([
      discoveryController.searchMarket({ managed: true }),
      conversationController.syncSignals()
    ])
    await conversationController.drainAutopilotQueue()
  }

  async function runBossAdapterDiagnostics() {
    setDiagnosingAdapter(true)
    try {
      const response = await diagnoseBossBrowserAdapter({ window })
      setAdapterDiagnostics(response.ok ? response.diagnostics ?? [] : [])
    } finally {
      setDiagnosingAdapter(false)
    }
  }

  async function refreshBrowserJobRuntime() {
    const response = await getBrowserJobAgentRuntime({ window })
    if (response.jobAgentRuntime) setBrowserJobRuntime(response.jobAgentRuntime)
  }

  async function simulateHistoryLearning() {
    setHistoryLearningBusy(true)
    setError('')
    try {
      const response = await summarizeBossHistory({ window, timeoutMs: 8_000 })
      setHistorySimulation(simulateJobAgentFromHistory({
        boss: response.ok ? response.historySummary : undefined,
        applications,
        messages: conversationMessages,
        now: new Date().toISOString()
      }))
    } catch {
      setError(t('historyLearning.readFailed'))
    } finally {
      setHistoryLearningBusy(false)
    }
  }

  function applyHistoryLearning() {
    if (!historySimulation || historySimulation.sampleSize === 0) return
    const settings = {
      minimumMatchScore: historySimulation.recommendedMinimumMatchScore,
      dailyContactLimit: historySimulation.recommendedDailyContactLimit,
      autonomy: 'autopilot' as const,
      autoSendResume: true
    }
    setAgentPreferences((current) => ({
      ...current,
      ...settings,
      learnFromReplies: true,
      learnFromOutcomes: true
    }))
    strategyMemory.record(historySimulation, settings)
    setNotice(t('historyLearning.applied'))
    setHistorySimulation(null)
  }

  function setStrategyMemoryEnabled(enabled: boolean) {
    strategyMemory.setEnabled(enabled)
    setAgentPreferences((current) => ({
      ...current,
      learnFromReplies: enabled,
      learnFromOutcomes: enabled
    }))
  }

  const { visible, recommendationByPosting, applicationByPosting, selectedPosting, selectedRecommendation } = discoveryController
  const pendingRequirements = applications.filter((item) => ['saved', 'analyzing', 'preparing'].includes(item.status)).length
  const readyApplications = applications.filter((item) => item.status === 'ready-to-apply').length
  const pendingMessages = conversationMessages.filter((item) => ['awaiting-approval', 'approved', 'failed'].includes(item.status)).length
  const managedMode = agentPreferences.enabled && agentPreferences.autonomy === 'autopilot'
  const unmanagedVariantCount = applications.filter((application) => (
    application.targetJobId
    && !application.resumeVariantId
    && ['saved', 'analyzing', 'preparing'].includes(application.status)
  )).length
  useEffect(() => {
    if (!managedMode || !trustedDraft || unmanagedVariantCount === 0) return
    const timeout = window.setTimeout(() => { void discoveryController.prepareManagedVariants() }, 0)
    return () => window.clearTimeout(timeout)
  }, [discoveryController.prepareManagedVariants, managedMode, trustedDraft, unmanagedVariantCount])
  useEffect(() => {
    if (!managedMode || !browserAgentAvailable || pendingMessages === 0) return
    const timeout = window.setTimeout(() => { void conversationController.drainAutopilotQueue() }, 0)
    return () => window.clearTimeout(timeout)
  }, [browserAgentAvailable, conversationController.drainAutopilotQueue, managedMode, pendingMessages])
  const applicationCounts = {
    applied: applications.filter((item) => ['applied', 'interviewing', 'offered', 'rejected'].includes(item.status)).length,
    viewed: applications.filter((item) => item.status !== 'saved').length,
    conversations: conversationThreads.filter((item) => item.status === 'active').length,
    interviews: applications.filter((item) => item.status === 'interviewing').length,
    offers: applications.filter((item) => item.status === 'offered').length
  }
  const navItems: Array<{ id: JobWorkspaceSection; href: string; icon: typeof LayoutDashboard }> = [
    { id: 'overview', href: '/jobs', icon: LayoutDashboard },
    { id: 'opportunities', href: '/jobs/opportunities', icon: BriefcaseBusiness },
    { id: 'resumes', href: '/jobs/resumes', icon: FileText },
    { id: 'conversations', href: '/jobs/conversations', icon: MessageSquareText },
    { id: 'applications', href: '/jobs/applications', icon: Send },
    { id: 'interviews', href: '/jobs/interviews', icon: CalendarClock },
    { id: 'activity', href: '/jobs/activity', icon: Activity }
  ]

  const navLinkClass = (active: boolean) => cn(
    'flex h-11 shrink-0 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2',
    active ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
  )

  return <main className="job-workspace flex min-h-full min-w-0 flex-col overflow-hidden bg-slate-50 text-slate-950 lg:grid lg:grid-cols-[240px_minmax(0,1fr)]" data-ui-theme="light" aria-label={t('title')}>
    <aside className="job-workspace__sidebar sticky top-0 z-20 flex min-h-0 min-w-0 items-center gap-2 overflow-x-auto border-b border-slate-200 bg-white px-3 py-3 lg:static lg:flex-col lg:items-stretch lg:overflow-visible lg:border-r lg:border-b-0 lg:px-4 lg:py-6">
      <div className="job-workspace__brand hidden items-center gap-3 px-2 pb-8 text-lg font-bold tracking-tight text-slate-950 lg:flex"><span className="grid size-9 place-items-center rounded-xl border border-slate-200 bg-slate-50 text-blue-700 shadow-sm"><Bot size={19} aria-hidden="true" /></span><strong>{t('workspace.brand')}</strong></div>
      <nav className="flex shrink-0 gap-1 lg:grid" aria-label={t('workspace.navigation')}>{navItems.map(({ id, href, icon: Icon }) => <Link className={navLinkClass(workspaceSection === id)} key={id} href={href} data-active={workspaceSection === id}><Icon size={17} aria-hidden="true" /><span>{t(`workspace.nav.${id}`)}</span></Link>)}</nav>
      <div className="job-workspace__sidebar-footer ml-auto flex shrink-0 gap-1 lg:mt-auto lg:ml-0 lg:grid lg:border-t lg:border-slate-200 lg:pt-4"><Link className={navLinkClass(workspaceSection === 'setup' || workspaceSection === 'preferences')} href="/jobs/setup" data-active={workspaceSection === 'setup' || workspaceSection === 'preferences'}><SlidersHorizontal size={17} aria-hidden="true" /><span>{t('workspace.nav.preferences')}</span></Link><Link className={navLinkClass(workspaceSection === 'profile')} href="/jobs/profile" data-active={workspaceSection === 'profile'} aria-label={activeDraft?.data.profile.name || t('workspace.candidate')}><span className="grid size-7 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-semibold text-white">{activeDraft?.data.profile.name?.slice(0, 1) || 'R'}</span><strong className="hidden min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm lg:block">{activeDraft?.data.profile.name || t('workspace.candidate')}</strong></Link></div>
    </aside>
    <section className="job-workspace__main min-h-0 min-w-0 overflow-auto bg-slate-50">
      <header className="job-workspace__topbar sticky top-[65px] z-10 flex min-h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white/95 px-5 backdrop-blur lg:top-0 lg:min-h-20 lg:px-8"><h1 className="text-lg font-semibold tracking-tight text-slate-950">{t(`workspace.pageTitle.${workspaceSection}`)}</h1><div className="flex items-center gap-3"><span className="inline-flex items-center gap-2 text-sm text-slate-600" data-connected={browserAgentAvailable}><i className={cn('size-2 rounded-full', browserAgentAvailable ? 'bg-emerald-500' : 'bg-slate-400')} />{browserAgentAvailable ? t('workspace.connected') : t('workspace.disconnected')}</span><Link className={buttonVariants({ variant: 'ghost', size: 'icon' })} href="/jobs/settings" aria-label={t('workspace.settings')}><Settings2 size={18} /></Link></div></header>
      {error ? <p className="job-workspace__alert" data-tone="error" role="alert">{error}</p> : null}
      {notice ? <p className="job-workspace__alert" data-tone="success" role="status">{notice}</p> : null}

      {workspaceSection === 'overview' ? <div className="job-overview">
        <section className="job-overview__agent">
          <div><span data-running={agentRunning} /><div><h2>{!agentSetupComplete ? t('workspace.setupRequired') : !agentPreferences.enabled ? t('workspace.agentPaused') : browserAgentAvailable ? t('workspace.agentRunning') : t('workspace.agentReady')}</h2><p>{agentSetupComplete ? t('workspace.targetSummary', { titles: savedSearchProfile?.titles.slice(0, 2).join('、') || t('unknown'), location: savedSearchProfile?.locations[0] || t('unknown') }) : t('workspace.setupHelp')}</p></div></div>
          <div>{!agentSetupComplete ? <Link className="job-button job-button--primary" href="/jobs/setup">{t('workspace.setupAction')}<ChevronRight size={16} /></Link> : <><button type="button" className="job-button job-button--secondary" onClick={toggleJobAgent}>{agentPreferences.enabled ? <Pause size={15} /> : <Play size={15} />}{agentPreferences.enabled ? t('workspace.pauseAgent') : t('workspace.startAgent')}</button><Link className="job-button job-button--primary" href={pendingRequirements > 0 ? '/jobs/resumes' : pendingMessages > 0 ? '/jobs/conversations' : '/jobs/opportunities'}>{t(managedMode ? 'workspace.viewProgress' : 'workspace.reviewTasks')}<ChevronRight size={16} /></Link></>}</div>
        </section>
        <JobAgentRuntimeStatus runtime={browserJobRuntime} />
        <div className="job-overview__columns">
          <section><h2>{t('workspace.todayActivity')}</h2><div className="job-overview__timeline">
            <Link href="/jobs/opportunities"><time>{formatActivityTime(postings[0]?.lastCheckedAt, locale)}</time><span><BriefcaseBusiness size={17} /></span><div><strong>{t('workspace.activityFound', { count: postings.length })}</strong><p>{t('workspace.activityFoundHelp')}</p></div><ChevronRight size={17} /></Link>
            <Link href="/jobs/resumes"><time>{formatActivityTime(applications[0]?.updatedAt, locale)}</time><span><FileText size={17} /></span><div><strong>{t('workspace.activityResume', { count: packets.length })}</strong><p>{t('workspace.activityResumeHelp')}</p></div><ChevronRight size={17} /></Link>
            <Link href="/jobs/conversations"><time>{formatActivityTime(conversationMessages[0]?.updatedAt, locale)}</time><span><MessageSquareText size={17} /></span><div><strong>{t('workspace.activityMessages', { count: conversationMessages.length })}</strong><p>{t('workspace.activityMessagesHelp')}</p></div><ChevronRight size={17} /></Link>
            <Link href="/jobs/applications"><time>{formatActivityTime(applications.at(-1)?.updatedAt, locale)}</time><span><Send size={17} /></span><div><strong>{t('workspace.activityApplications', { count: applications.length })}</strong><p>{t('workspace.activityApplicationsHelp')}</p></div><ChevronRight size={17} /></Link>
          </div></section>
          <section><h2>{t(managedMode ? 'workspace.agentProcessing' : 'workspace.needsAttention')}</h2><div className="job-overview__tasks">
            <Link href="/jobs/opportunities"><span data-tone="blue"><BriefcaseBusiness size={16} /></span><div><strong>{t(managedMode ? 'workspace.processingJobs' : 'workspace.taskReviewJobs')}</strong><p>{t(managedMode ? 'workspace.processingCount' : 'workspace.taskCount', { count: recommendations.filter((item) => (item.decision ?? 'new') === 'new').length })}</p></div><ChevronRight size={17} /></Link>
            <Link href="/jobs/resumes"><span data-tone="amber"><FileText size={16} /></span><div><strong>{t(managedMode ? 'workspace.processingResumes' : 'workspace.taskResume')}</strong><p>{t(managedMode ? 'workspace.processingCount' : 'workspace.taskCount', { count: pendingRequirements })}</p></div><ChevronRight size={17} /></Link>
            <Link href="/jobs/conversations"><span data-tone="red"><MessageSquareText size={16} /></span><div><strong>{t(managedMode ? 'workspace.monitoringConversations' : 'workspace.taskMessages')}</strong><p>{t(managedMode ? 'workspace.processingCount' : 'workspace.taskCount', { count: pendingMessages })}</p></div><ChevronRight size={17} /></Link>
          </div></section>
        </div>
        <section className="job-overview__progress"><h2>{t('workspace.applicationProgress')}</h2><div>{(['applied', 'viewed', 'conversations', 'interviews', 'offers'] as const).map((key) => <article key={key}><strong>{applicationCounts[key]}</strong><span>{t(`workspace.progress.${key}`)}</span></article>)}</div></section>
        <JobProcessBoard applications={applications} postings={postings} threads={conversationThreads} messages={conversationMessages} />
        <JobHistoryLearningPanel simulation={historySimulation} memory={strategyMemory.memory} exportText={strategyMemory.exportText} busy={historyLearningBusy} onSimulate={() => void simulateHistoryLearning()} onApply={applyHistoryLearning} onDismiss={() => setHistorySimulation(null)} onSetEnabled={setStrategyMemoryEnabled} onClear={strategyMemory.clear} />
      </div> : null}

      {workspaceSection === 'opportunities' ? <div className="job-opportunities">
        <section className="job-opportunities__list"><header><div><h2>{t('inbox')}</h2><p>{t('workspace.opportunityHelp')}</p></div><button type="button" className="job-button job-button--primary" onClick={() => void discoveryController.searchMarket()} disabled={Boolean(discoveryController.busySourceId) || !trustedDraft || !profileController.titles.trim()}><Radar size={15} />{discoveryController.busySourceId ? t('marketStarting') : t('jobAgent.runNow')}</button></header><div className="job-opportunities__filters" role="group" aria-label={t('filters')}>{(['all', 'new', 'saved', 'needs-analysis', 'ready', 'applied'] as const).map((value) => <button key={value} type="button" aria-pressed={discoveryController.filter === value} onClick={() => discoveryController.setFilter(value)}>{t(`filter.${value}`)}</button>)}</div>{!trustedDraft ? <JobWorkspaceEmpty message={trustedDraftSource ? t('evidenceRequired') : t('resumeRequired')} action={trustedDraftSource ? t('workspace.retryEvidenceAction') : t('workspace.importResumeAction')} href="/jobs/profile" /> : visible.length === 0 ? <p className="job-workspace__empty">{t('empty')}</p> : <ul>{visible.map((posting) => { const recommendation = recommendationByPosting.get(posting.id); const application = applicationByPosting.get(posting.id); return <li key={posting.id}><button type="button" data-selected={selectedPosting?.id === posting.id} onClick={() => discoveryController.setSelectedPostingId(posting.id)}><div><strong>{sanitizeJobDisplayText(posting.title)}</strong><span>{sanitizeJobDisplayText(posting.company)}</span></div><span>{formatMonthlyCompensation(posting) || posting.location || t('unknown')}</span><b>{recommendation?.preliminaryScore !== undefined ? `${Math.round(recommendation.preliminaryScore)}%` : '—'}</b><small>{application ? t(`application.status.${application.status}`) : t(`filter.${recommendation?.decision ?? 'new'}`)}</small></button></li>})}</ul>}</section>
        <section className="job-opportunities__detail">{selectedPosting ? <><header><span>{sanitizeJobDisplayText(selectedPosting.company)}</span><h2>{sanitizeJobDisplayText(selectedPosting.title)}</h2><p>{[selectedPosting.location, selectedPosting.workplaceType, selectedPosting.employmentType].filter(Boolean).join(' · ') || t('unknown')}</p></header><div className="job-opportunities__score"><span>{t('workspace.matchScore')}</span><strong>{selectedRecommendation?.preliminaryScore !== undefined ? `${Math.round(selectedRecommendation.preliminaryScore)}%` : '—'}</strong></div><section><h3>{t('whyRecommended')}</h3>{selectedRecommendation?.reasons.length ? <ol>{selectedRecommendation.reasons.slice(0, 3).map((reason) => <li key={reason.code} data-tone={reason.contribution > 0 ? 'positive' : 'neutral'}><CheckCircle2 size={15} />{t(`reasonCode.${recommendationReasonMessageKey(reason.code, reason.contribution)}`, { score: Math.round(Math.abs(reason.contribution)) })}</li>)}</ol> : <p>{t('unknownRecommendation')}</p>}</section><p className="job-opportunities__description">{sanitizeJobDisplayText(selectedPosting.description).slice(0, 520)}</p><footer>{selectedRecommendation ? <><button type="button" className="job-button job-button--primary" onClick={() => void discoveryController.analyzePosting(selectedPosting, selectedRecommendation)}>{t(managedMode ? 'workspace.processNow' : 'workspace.confirmInterest')}</button><button type="button" className="job-button job-button--secondary" onClick={() => void discoveryController.decide(selectedRecommendation, 'saved')}><Save size={14} />{t('save')}</button><button type="button" className="job-button job-button--secondary" onClick={() => void discoveryController.decide(selectedRecommendation, 'ignored')}>{t('ignore')}</button></> : null}<a href={selectedPosting.canonicalUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} />{t('openOriginal')}</a></footer></> : <p className="job-workspace__empty">{t('workspace.selectOpportunity')}</p>}</section>
      </div> : null}

      {workspaceSection === 'resumes' ? <div className="job-workspace__content"><section className="job-section-heading"><div><h2>{t('workspace.resumeTasksTitle')}</h2><p>{t('workspace.resumeTasksHelp')}</p></div><span>{pendingRequirements + readyApplications}</span></section><ResumeVariantLibrary store={store} sourceDraftId={trustedDraft ? activeDraft?.id : undefined} baseResume={trustedDraft ? activeDraft?.data : undefined} plannedTitles={savedSearchProfile?.titles ?? []} /><div className="job-resume-agent"><LazyResumeAgentApp appId="agent" /></div><ApplicationPipeline packets={packets} pendingId={applicationController.busyApplicationId} onPrepare={(id) => void applicationController.prepare(id)} onMarkApplied={(id) => void applicationController.confirmApplied(id)} onNotesChange={(id, notes) => void applicationController.saveNotes(id, notes)} /></div> : null}

      {workspaceSection === 'conversations' ? <div className="job-workspace__content"><section className="job-section-heading"><div><h2>{t('jobAgent.messageQueueTitle')}</h2><p>{t('jobAgent.messageQueueHelp')}</p></div><span>{conversationMessages.length}</span></section>{conversationMessages.length === 0 ? <section className="job-conversation-empty"><span><MessageSquareText size={24} /></span><h3>{t('jobAgent.emptyTitle')}</h3><p>{t('jobAgent.emptyDescription', { count: pendingRequirements })}</p><small>{agentPreferences.enabled ? t('jobAgent.emptyNextScan') : t('jobAgent.emptyPaused')}</small><footer><Link className="job-button job-button--primary" href="/jobs/resumes">{t('jobAgent.emptyViewResumes')}</Link><a className="job-button job-button--secondary" href="https://www.zhipin.com/web/geek/chat" target="_blank" rel="noopener noreferrer">{t('jobAgent.openBossChat')}</a></footer></section> : <BossConversationQueue managed={managedMode} threads={conversationThreads} messages={conversationMessages} applications={applications} postings={postings} pendingMessageId={conversationController.busyMessageId} pendingResumeThreadId={conversationController.busyResumeThreadId} onRevise={(messageId, body) => void conversationController.revise(messageId, body)} onVerify={(messageId) => void conversationController.verifyAndApprove(messageId)} onSend={(messageId) => void conversationController.sendApproved(messageId)} onSendResume={(thread) => void conversationController.sendRequestedResume(thread)} />}</div> : null}

      {workspaceSection === 'applications' ? <div className="job-workspace__content"><section className="job-section-heading"><div><h2>{t('application.title')}</h2><p>{t('application.description')}</p></div><span>{applications.length}</span></section>{loaded && packets.length === 0 ? <JobWorkspaceEmpty message={t('application.empty')} action={t('application.emptyAction')} href="/jobs/opportunities" /> : <ApplicationPipeline packets={packets} pendingId={applicationController.busyApplicationId} onPrepare={(id) => void applicationController.prepare(id)} onMarkApplied={(id) => void applicationController.confirmApplied(id)} onNotesChange={(id, notes) => void applicationController.saveNotes(id, notes)} />}</div> : null}

      {workspaceSection === 'interviews' ? <LazyInterviewWorkspace store={store} applications={applications} postings={postings} locale={locale} onChanged={load} /> : null}

      {workspaceSection === 'setup' ? <LazyJobAgentSetup trustedResume={trustedDraft} resumeEditor={<LazyResumeStudioApp appId="studio" />} analysis={profileController.setupAnalysis} values={profileController.setupValues} onChange={profileController.updateSetupValue} onAnalyzeGoal={profileController.analyzeGoal} onSave={async () => Boolean(await profileController.saveProfile())} onStart={startConfiguredAgent} /> : null}

      {workspaceSection === 'profile' ? <div className="job-workspace__embedded" role="application" aria-label={desktopT('apps.studio')}><LazyResumeStudioApp appId="studio" /></div> : null}

      {workspaceSection === 'target-job' ? <div className="job-workspace__embedded" role="application" aria-label={desktopT('apps.jd-match')}><LazyJDMatchApp appId="jd-match" /></div> : null}

      {workspaceSection === 'settings' ? <div className="job-workspace__embedded" role="application" aria-label={desktopT('apps.settings')}><LazySettingsApp appId="settings" /></div> : null}

      {workspaceSection === 'activity' ? <div className="job-workspace__content"><section className="job-section-heading"><div><h2>{t('workspace.activityTitle')}</h2><p>{t('workspace.activityHelp')}</p></div></section><div className="job-activity-list">{postings.slice(0, 12).map((posting) => <article key={posting.id}><span><BriefcaseBusiness size={16} /></span><div><strong>{t('workspace.activityPosting', { title: posting.title })}</strong><p>{posting.company} · {posting.lastCheckedAt.slice(0, 10)}</p></div></article>)}{postings.length === 0 ? <p className="job-workspace__empty">{t('workspace.noActivity')}</p> : null}</div></div> : null}

      {workspaceSection === 'preferences' ? <div className="job-preferences"><section><header><h2>{t('workspace.preferencesTitle')}</h2><p>{t('workspace.preferencesHelp')}</p></header><div className="job-preferences__grid"><label>{t('profileName')}<input value={profileController.profileName} onChange={(event) => profileController.setProfileName(event.target.value)} /></label><label>{t('titles')}<input value={profileController.titles} onChange={(event) => profileController.setTitles(event.target.value)} /></label><label>{t('locations')}<input value={profileController.locations} onChange={(event) => profileController.setLocations(event.target.value)} /></label><label>{t('preferredCompanies')}<input value={profileController.preferredCompanies} onChange={(event) => profileController.setPreferredCompanies(event.target.value)} placeholder={t('preferredCompaniesPlaceholder')} /></label><label>{t('requiredTerms')}<input value={profileController.requiredTerms} onChange={(event) => profileController.setRequiredTerms(event.target.value)} /></label><label>{t('preferredTerms')}<input value={profileController.preferredTerms} onChange={(event) => profileController.setPreferredTerms(event.target.value)} /></label><label>{t('excludedTerms')}<input value={profileController.excludedTerms} onChange={(event) => profileController.setExcludedTerms(event.target.value)} /></label></div><button type="button" className="job-button job-button--primary" onClick={() => void profileController.saveProfile()} disabled={!profileController.profileName.trim() || !profileController.titles.trim()}><Save size={15} />{t('saveProfile')}</button></section><section className="job-adapter-diagnostics"><header><div><h2>{t('jobAgent.diagnosticsTitle')}</h2><p>{t('jobAgent.diagnosticsHelp')}</p></div><button type="button" className="job-button job-button--secondary" onClick={() => void runBossAdapterDiagnostics()} disabled={diagnosingAdapter}>{t('jobAgent.runDiagnostics')}</button></header>{adapterDiagnostics.length === 0 ? <div className="job-adapter-diagnostics__empty"><p>{t('jobAgent.diagnosticsEmpty')}</p><a href="https://www.zhipin.com/web/geek/chat" target="_blank" rel="noopener noreferrer">{t('jobAgent.openBossChat')}</a></div> : <div className="job-adapter-diagnostics__list">{adapterDiagnostics.map((diagnostic, index) => <article key={`${diagnostic.pageKind}-${diagnostic.frameId}-${index}`}><header><strong>{t(`jobAgent.diagnosticPage.${diagnostic.pageKind}`)}</strong><span>{t(`jobAgent.session.${diagnostic.sessionState}`)}</span></header><div>{(['discovery', 'conversation', 'messageSend', 'resumeUpload'] as const).map((key) => <p key={key} data-ready={diagnostic.ready[key]}><CheckCircle2 size={14} />{t(`jobAgent.diagnosticReady.${key}`)}</p>)}</div><small>{t('jobAgent.diagnosticCounts', { jobs: diagnostic.counts.jobLinks, editors: diagnostic.counts.editors, send: diagnostic.counts.sendControls, identities: diagnostic.counts.recipientIdentities, conversations: diagnostic.counts.conversationIdentities, names: diagnostic.counts.recipientNames, pdf: diagnostic.counts.pdfInputs })}</small></article>)}</div>}</section><details><summary>{t('importJob')}</summary><p>{t('importJobHelp')}</p><label>{t('clipboardJob')}<textarea value={discoveryController.clipboardJobText} onChange={(event) => discoveryController.setClipboardJobText(event.target.value)} rows={5} placeholder={t('clipboardJobPlaceholder')} /></label><button type="button" className="job-button job-button--secondary" onClick={discoveryController.prefillFromClipboard} disabled={!discoveryController.clipboardJobText.trim()}><ClipboardPaste size={14} />{t('parseClipboardJob')}</button><div className="job-preferences__grid"><label>{t('importUrl')}<input type="url" value={discoveryController.importUrl} onChange={(event) => discoveryController.setImportUrl(event.target.value)} /></label><label>{t('importTitle')}<input value={discoveryController.importTitle} onChange={(event) => discoveryController.setImportTitle(event.target.value)} /></label><label>{t('importCompany')}<input value={discoveryController.importCompany} onChange={(event) => discoveryController.setImportCompany(event.target.value)} /></label><label>{t('importLocation')}<input value={discoveryController.importLocation} onChange={(event) => discoveryController.setImportLocation(event.target.value)} /></label></div><label>{t('importDescription')}<textarea value={discoveryController.importDescription} onChange={(event) => discoveryController.setImportDescription(event.target.value)} rows={6} /></label><button type="button" className="job-button job-button--primary" onClick={() => void discoveryController.importAndAnalyze()} disabled={!trustedDraft || !discoveryController.importUrl.trim() || !discoveryController.importTitle.trim() || !discoveryController.importCompany.trim() || !discoveryController.importDescription.trim()}>{t('importAndAnalyze')}</button></details></div> : null}
    </section>
  </main>
}

function JobWorkspaceEmpty({ message, action, href }: { message: string; action: string; href: string }) {
  return <section className="job-workspace__empty-state"><p>{message}</p><Link className="job-button job-button--primary" href={href}>{action}</Link></section>
}

export function BossConversationQueue({
  managed = false,
  threads,
  messages,
  applications,
  postings,
  pendingMessageId,
  pendingResumeThreadId,
  onRevise,
  onVerify,
  onSend,
  onSendResume
}: {
  managed?: boolean
  threads: BossConversationThread[]
  messages: BossConversationMessage[]
  applications: ApplicationRecord[]
  postings: JobPosting[]
  pendingMessageId?: string
  pendingResumeThreadId?: string
  onRevise: (messageId: string, body: string) => void
  onVerify: (messageId: string) => void
  onSend: (messageId: string) => void
  onSendResume?: (thread: BossConversationThread) => void
}) {
  const t = useTranslations('jobRadar.jobAgent')
  const applicationById = new Map(applications.map((application) => [application.id, application]))
  const postingById = new Map(postings.map((posting) => [posting.id, posting]))
  const visible = messages.flatMap((message) => {
    const thread = threads.find((item) => item.id === message.threadId)
    const application = thread ? applicationById.get(thread.applicationId) : undefined
    const posting = application ? postingById.get(application.postingId) : undefined
    return thread && application && posting ? [{ message, thread, posting }] : []
  })
  if (visible.length === 0) return null
  return <section className="boss-conversation-queue" aria-labelledby="boss-conversation-title">
    <header><div><MessageSquareText size={15} aria-hidden="true" /><span><strong id="boss-conversation-title">{t('messageQueueTitle')}</strong><small>{t('messageQueueHelp')}</small></span></div></header>
    <ul>{visible.map(({ message, thread, posting }) => <li key={message.id}>
      <article>
        <header><div><strong>{posting.title}</strong><span>{posting.company}</span></div><b>{t(`messageStatus.${message.status}`)}</b></header>
        <p>{thread.recipientName
          ? t('messageRecipient', { name: thread.recipientName })
          : t('messageRecipientPending')}</p>
        <p>{t('recruitmentStage', { stage: t(`stage.${thread.recruitmentStage}`) })}</p>
        <label>{t('messageDraft')}<textarea defaultValue={message.body} maxLength={5_000} onBlur={(event) => onRevise(message.id, event.target.value)} /></label>
        <small>{t('messageEvidence', { count: message.evidenceFactIds.length })}</small>
        {managed && ['awaiting-approval', 'approved', 'sending'].includes(message.status) ? <small>{t('managedQueue')}</small> : null}
        {!managed && message.status === 'awaiting-approval' ? <button type="button" disabled={pendingMessageId === message.id} onClick={() => onVerify(message.id)}>{t('messageVerifyAndApprove')}</button> : null}
        {!managed && message.status === 'approved' ? <button type="button" disabled={pendingMessageId === message.id} onClick={() => onSend(message.id)}>{t('messageSendApproved')}</button> : null}
        {!managed && thread.recruitmentStage === 'resume-requested' && onSendResume ? <button type="button" disabled={pendingResumeThreadId === thread.id} onClick={() => onSendResume(thread)}>{t('sendRequestedResume')}</button> : null}
      </article>
    </li>)}</ul>
  </section>
}

function jobWorkspaceSection(pathname: string): JobWorkspaceSection {
  const normalized = pathname.replace(/^\/(?:zh|en)(?=\/)/u, '').replace(/\/+$/u, '')
  const section = normalized.split('/')[2]
  return section === 'opportunities'
    || section === 'resumes'
    || section === 'conversations'
    || section === 'applications'
    || section === 'interviews'
    || section === 'activity'
    || section === 'preferences'
    || section === 'profile'
    || section === 'target-job'
    || section === 'settings'
    || section === 'setup'
    ? section
    : 'overview'
}

function formatActivityTime(value: string | undefined, locale: string) {
  if (!value || Number.isNaN(Date.parse(value))) return '—'
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(value))
}
