'use client'

import {
  CalendarCheck2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Eye,
  FileText,
  MessageCircleMore,
  Send,
  Target
} from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useState, type CSSProperties } from 'react'
import type { BossConversationMessage, BossConversationThread } from '@/lib/jobs/boss-conversation'
import type { ApplicationRecord, JobPosting, JobRecommendation } from '@/lib/jobs/job-domain'
import { formatMonthlyCompensation, sanitizeJobDisplayText } from '@/lib/jobs/job-display'

type LifecycleStage = 'discovery' | 'matched' | 'resume' | 'conversation' | 'application' | 'interview'

const STAGE_ICONS = {
  discovery: Eye,
  matched: Target,
  resume: FileText,
  conversation: MessageCircleMore,
  application: Send,
  interview: CalendarCheck2
} satisfies Record<LifecycleStage, typeof Eye>

export function JobLifecycleCommandCenter({
  applications,
  postings,
  recommendations,
  threads,
  messages
}: {
  applications: ApplicationRecord[]
  postings: JobPosting[]
  recommendations: JobRecommendation[]
  threads: BossConversationThread[]
  messages: BossConversationMessage[]
}) {
  const t = useTranslations('jobRadar.processBoard')
  const locale = useLocale()
  const [expandedApplicationId, setExpandedApplicationId] = useState('')
  const postingById = new Map(postings.map((posting) => [posting.id, posting]))
  const recommendationByPosting = new Map(recommendations.map((recommendation) => [recommendation.postingId, recommendation]))
  const threadByApplication = new Map(threads.map((thread) => [thread.applicationId, thread]))
  const latestMessageByThread = new Map<string, BossConversationMessage>()
  for (const message of [...messages].sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))) {
    latestMessageByThread.set(message.threadId, message)
  }

  const appliedCount = applications.filter((application) => (
    ['applied', 'interviewing', 'offered', 'rejected'].includes(application.status)
  )).length
  const interviewCount = applications.filter((application) => (
    ['interviewing', 'offered', 'rejected'].includes(application.status)
  )).length
  const stageCounts: Record<LifecycleStage, number> = {
    discovery: postings.length,
    matched: applications.length,
    resume: applications.filter((application) => Boolean(application.resumeVariantId)).length,
    conversation: threads.length,
    application: appliedCount,
    interview: interviewCount
  }
  const stages = Object.keys(STAGE_ICONS) as LifecycleStage[]
  const visibleApplications = applications.slice(0, 3)

  return <section className="job-lifecycle" aria-labelledby="job-lifecycle-title">
    <h2 id="job-lifecycle-title" className="sr-only">{t('title')}</h2>
    <ol className="job-lifecycle__stages" aria-label={t('lifecycleAria')}>
      {stages.map((stage, index) => {
        const Icon = STAGE_ICONS[stage]
        const active = stageCounts[stage] > 0
        return <li key={stage} data-active={active} style={{ '--stage-index': index } as CSSProperties}>
          <span className="job-lifecycle__stage-icon"><Icon size={19} aria-hidden="true" /></span>
          <span><strong>{t(`stages.${stage}`)}</strong><small>{t('stageCount', { count: stageCounts[stage] })}</small></span>
          {index < stages.length - 1 ? <ChevronRight className="job-lifecycle__stage-chevron" size={16} aria-hidden="true" /> : null}
        </li>
      })}
    </ol>

    {applications.length === 0 ? <div className="job-lifecycle__empty">
      <span><Target size={22} aria-hidden="true" /></span>
      <div><strong>{t('emptyFlowTitle')}</strong><p>{t('emptyFlowHelp')}</p></div>
    </div> : <div className="job-lifecycle__table" role="table" aria-label={t('title')}>
      <div role="row" className="job-lifecycle__heading">
        <span role="columnheader">{t('job')}</span>
        {stages.map((stage) => <span role="columnheader" key={stage}>{t(`stages.${stage}`)}</span>)}
        <span role="columnheader" className="sr-only">{t('details')}</span>
      </div>
      {visibleApplications.map((application, index) => {
        const posting = postingById.get(application.postingId)
        const recommendation = recommendationByPosting.get(application.postingId)
        const matchScore = recommendation?.preliminaryScore
        const thread = threadByApplication.get(application.id)
        const message = thread ? latestMessageByThread.get(thread.id) : undefined
        const expanded = expandedApplicationId === application.id
        const updatedAt = [application.updatedAt, thread?.updatedAt, message?.updatedAt]
          .filter((value): value is string => Boolean(value))
          .sort()
          .at(-1) ?? application.updatedAt
        const postingMeta = [...new Set([
          posting ? sanitizeJobDisplayText(posting.company) : t('unknown'),
          posting?.location,
          posting ? formatMonthlyCompensation(posting) : ''
        ].filter(Boolean))]
        return <div className="job-lifecycle__record" key={application.id} style={{ '--row-index': index } as CSSProperties}>
          <div role="row" className="job-lifecycle__row">
            <span role="cell" className="job-lifecycle__job">
              <span className="job-lifecycle__company-icon"><FileText size={16} aria-hidden="true" /></span>
              <span><strong>{sanitizeJobDisplayText(posting?.title ?? t('unknown'))}</strong><small>{postingMeta.join(' · ')}</small></span>
            </span>
            <LifecycleCell state="ready" label={t('discovered')} detail={formatCompactDate(posting?.lastCheckedAt, locale)} />
            <LifecycleCell state={matchScore !== undefined ? 'ready' : 'waiting'} label={matchScore !== undefined ? t('matchReady') : t('matchWaiting')} detail={matchScore !== undefined ? t('matchValue', { score: Math.round(matchScore) }) : undefined} />
            <LifecycleCell state={application.resumeVariantId ? 'ready' : 'waiting'} label={application.resumeVariantId ? t('resumeReady') : t('resumePreparing')} />
            <LifecycleCell state={thread?.status ?? 'waiting'} label={thread ? t(`conversationStage.${thread.recruitmentStage}`) : t('notStarted')} detail={message ? t(`messageStatus.${message.status}`) : undefined} />
            <LifecycleCell state={application.status} label={t(`applicationStatus.${application.status}`)} detail={application.submittedAt ? formatCompactDate(application.submittedAt, locale) : undefined} />
            <LifecycleCell state={['interviewing', 'offered', 'rejected'].includes(application.status) ? application.status : 'waiting'} label={['interviewing', 'offered', 'rejected'].includes(application.status) ? t(`interviewStatus.${application.status}`) : t('noInterview')} />
            <span role="cell" className="job-lifecycle__expand-cell"><button type="button" aria-expanded={expanded} aria-label={t(expanded ? 'collapseDetails' : 'expandDetails', { title: posting?.title ?? t('unknown') })} onClick={() => setExpandedApplicationId(expanded ? '' : application.id)}><ChevronDown size={17} aria-hidden="true" /></button></span>
          </div>
          {expanded ? <div className="job-lifecycle__details">
            <span><CheckCircle2 size={16} aria-hidden="true" /><strong>{t('auditCurrent')}</strong></span>
            <p>{t('auditUpdated', { value: new Date(updatedAt) })}</p>
            <p>{thread?.recipientName ? t('verifiedRecipient', { name: thread.recipientName }) : t('recipientPending')}</p>
          </div> : null}
        </div>
      })}
    </div>}
  </section>
}

function LifecycleCell({ state, label, detail }: { state: string; label: string; detail?: string }) {
  return <span role="cell" className="job-lifecycle__cell" data-state={state}>
    <span><i aria-hidden="true" />{label}</span>
    {detail ? <small>{detail}</small> : null}
  </span>
}

function formatCompactDate(value: string | undefined, locale: string) {
  if (!value || Number.isNaN(Date.parse(value))) return '—'
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(value))
}
