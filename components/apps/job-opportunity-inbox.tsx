'use client'

import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, Radar, Save, Search, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ApplicationRecord, JobPosting, JobRecommendation } from '@/lib/jobs/job-domain'
import { formatMonthlyCompensation, recommendationReasonMessageKey, sanitizeJobDisplayText } from '@/lib/jobs/job-display'
import type { JobOpportunityFilter } from './use-job-discovery-controller'

const PAGE_SIZE = 20

export function JobOpportunityInbox({
  postings, recommendationByPosting, applicationByPosting, selectedPostingId, onSelect,
  filter, onFilter, ready, emptyState, canSearch, searching, onSearch, onCancel,
  onAnalyze, onDecide, managed, importAction
}: {
  postings: JobPosting[]
  recommendationByPosting: ReadonlyMap<string, JobRecommendation>
  applicationByPosting: ReadonlyMap<string, ApplicationRecord>
  selectedPostingId: string
  onSelect: (id: string) => void
  filter: JobOpportunityFilter
  onFilter: (filter: JobOpportunityFilter) => void
  ready: boolean
  emptyState: ReactNode
  canSearch: boolean
  searching: boolean
  onSearch: () => void
  onCancel: () => void
  onAnalyze: (posting: JobPosting, recommendation: JobRecommendation) => Promise<void>
  onDecide: (recommendation: JobRecommendation, decision: 'saved' | 'ignored') => Promise<void>
  managed: boolean
  importAction: ReactNode
}) {
  const t = useTranslations('jobRadar')
  const [query, setQuery] = useState('')
  const [pagination, setPagination] = useState({ query: '', filter, page: 1 })
  const [mobileDetailId, setMobileDetailId] = useState('')
  const [pendingId, setPendingId] = useState('')
  const [actionError, setActionError] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const actionPending = useRef(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const inboxRef = useRef<HTMLDivElement>(null)
  const detailHeadingRef = useRef<HTMLHeadingElement>(null)
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())
  const returnFocusRef = useRef('')
  const queryTerms = useMemo(() => query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean), [query])
  const matching = useMemo(() => queryTerms.length === 0 ? postings : postings.filter((posting) => {
    const text = `${posting.title} ${posting.company} ${posting.location ?? ''}`.normalize('NFKC').toLocaleLowerCase()
    return queryTerms.every((term) => text.includes(term))
  }), [postings, queryTerms])
  const pageCount = Math.max(1, Math.ceil(matching.length / PAGE_SIZE))
  const page = pagination.query === query && pagination.filter === filter ? Math.min(pagination.page, pageCount) : 1
  const pagePostings = matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const selectedPosting = ready ? pagePostings.find((posting) => posting.id === selectedPostingId) ?? pagePostings[0] : undefined
  const recommendation = selectedPosting ? recommendationByPosting.get(selectedPosting.id) : undefined
  const detailOpen = Boolean(selectedPosting && mobileDetailId === selectedPosting.id)

  useEffect(() => { if (!searching) setCancelling(false) }, [searching])
  useEffect(() => {
    if (!detailOpen && returnFocusRef.current) {
      rowRefs.current.get(returnFocusRef.current)?.focus()
      returnFocusRef.current = ''
    }
    if (detailOpen && window.matchMedia?.('(max-width: 900px)').matches) {
      detailHeadingRef.current?.focus({ preventScroll: true })
      inboxRef.current?.scrollIntoView({ block: 'start' })
    }
  }, [detailOpen, mobileDetailId])

  function changePage(next: number) {
    setPagination({ query, filter, page: next })
    setMobileDetailId('')
    headingRef.current?.focus({ preventScroll: true })
    headingRef.current?.scrollIntoView({ block: 'start' })
  }

  async function runAction(id: string, action: () => Promise<void>) {
    if (actionPending.current) return
    actionPending.current = true
    setPendingId(id)
    setActionError(false)
    try {
      await action()
    } catch {
      setActionError(true)
    } finally {
      actionPending.current = false
      setPendingId('')
    }
  }

  return <div ref={inboxRef} className="job-opportunities" data-detail-open={detailOpen}>
    <section className="job-opportunities__list">
      <header>
        <div><h2 ref={headingRef} tabIndex={-1}>{t('inbox')}</h2><p>{t('workspace.opportunityHelp')}</p></div>
        <div className="job-opportunities__actions">
          {searching ? <button type="button" className="job-button job-button--secondary" disabled={cancelling} onClick={() => { setCancelling(true); onCancel() }}><X size={15} />{t(cancelling ? 'workspace.cancellingSearch' : 'workspace.cancelSearch')}</button> :
            <button type="button" className="job-button job-button--primary" onClick={onSearch} disabled={!canSearch}><Radar size={15} />{t('jobAgent.runNow')}</button>}
          {importAction}
        </div>
      </header>
      <label className="job-opportunities__search"><Search size={17} aria-hidden="true" /><span className="sr-only">{t('workspace.searchJobs')}</span><input type="search" value={query} disabled={!ready} placeholder={t('workspace.searchJobs')} onChange={(event) => { setQuery(event.target.value); setPagination({ query: event.target.value, filter, page: 1 }); setMobileDetailId('') }} /></label>
      <div className="job-opportunities__filters" role="group" aria-label={t('filters')}>
        {(['all', 'new', 'saved', 'needs-analysis', 'ready', 'applied', 'ignored', 'closed'] as const).map((value) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => { onFilter(value); setPagination({ query, filter: value, page: 1 }); setMobileDetailId('') }}>{t(`filter.${value}`)}</button>)}
      </div>
      {searching ? <p className="job-opportunities__search-progress" role="status">{t(cancelling ? 'workspace.cancellingSearchHelp' : 'marketStarting')}</p> : null}
      {!ready ? emptyState : matching.length === 0 ? <div className="job-workspace__empty">
        <p>{queryTerms.length || filter !== 'all' ? t('workspace.noFilteredJobs') : t('empty')}</p>
        {queryTerms.length || filter !== 'all' ? <button className="job-button job-button--secondary" type="button" onClick={() => { setQuery(''); onFilter('all'); setPagination({ query: '', filter: 'all', page: 1 }) }}>{t('workspace.clearFilters')}</button> : null}
      </div> : <>
        <ul aria-label={t('workspace.opportunityList')}>{pagePostings.map((posting) => {
          const itemRecommendation = recommendationByPosting.get(posting.id)
          const application = applicationByPosting.get(posting.id)
          return <li key={posting.id}><button type="button" ref={(element) => { if (element) rowRefs.current.set(posting.id, element); else rowRefs.current.delete(posting.id) }}
            data-selected={selectedPosting?.id === posting.id} aria-pressed={selectedPosting?.id === posting.id}
            onClick={() => { onSelect(posting.id); setMobileDetailId(posting.id) }}>
            <div><strong>{sanitizeJobDisplayText(posting.title)}</strong><span>{sanitizeJobDisplayText(posting.company)}</span><span className="job-opportunities__location">{formatMonthlyCompensation(posting) || t('unknown')}</span></div>
            <b>{itemRecommendation?.preliminaryScore !== undefined ? `${Math.round(itemRecommendation.preliminaryScore)}%` : '—'}</b>
            <small>{posting.status === 'closed' ? t('filter.closed') : itemRecommendation?.decision === 'ignored' ? t('filter.ignored') : application ? t(`application.status.${application.status}`) : t(`filter.${itemRecommendation?.decision ?? 'new'}`)}</small>
          </button></li>
        })}</ul>
        <nav className="job-opportunities__pagination" aria-label={t('workspace.pagination')}>
          <span role="status">{t('workspace.resultCount', { count: matching.length, page, pages: pageCount })}</span>
          {pageCount > 1 ? <div><button type="button" className="job-button job-button--secondary" disabled={page === 1} aria-label={t('workspace.previousPage')} onClick={() => changePage(page - 1)}><ChevronLeft size={16} /></button><button type="button" className="job-button job-button--secondary" disabled={page === pageCount} aria-label={t('workspace.nextPage')} onClick={() => changePage(page + 1)}><ChevronRight size={16} /></button></div> : null}
        </nav>
      </>}
    </section>
    <section className="job-opportunities__detail">
      {selectedPosting ? <>
        <button type="button" className="job-opportunities__back job-button job-button--secondary" onClick={() => { returnFocusRef.current = selectedPosting.id; setMobileDetailId('') }}><ArrowLeft size={16} />{t('workspace.backToOpportunities')}</button>
        <header><span>{sanitizeJobDisplayText(selectedPosting.company)}</span><h2 ref={detailHeadingRef} tabIndex={-1}>{sanitizeJobDisplayText(selectedPosting.title)}</h2><p>{[
          selectedPosting.location,
          selectedPosting.workplaceType ? t(`setup.workplace.${selectedPosting.workplaceType}`) : '',
          selectedPosting.employmentType ? t(`setup.employment.${selectedPosting.employmentType}`) : ''
        ].filter(Boolean).join(' · ') || t('unknown')}</p></header>
        <div className="job-opportunities__score"><span>{t('workspace.matchScore')}</span><strong>{recommendation?.preliminaryScore !== undefined ? `${Math.round(recommendation.preliminaryScore)}%` : '—'}</strong></div>
        <section><h3>{t('whyRecommended')}</h3>{recommendation?.reasons.length ? <ol>{recommendation.reasons.slice(0, 3).map((reason) => <li key={reason.code} data-tone={reason.contribution > 0 ? 'positive' : 'neutral'}><CheckCircle2 size={15} />{t(`reasonCode.${recommendationReasonMessageKey(reason.code, reason.contribution)}`, { score: Math.round(Math.abs(reason.contribution)) })}</li>)}</ol> : <p>{t('unknownRecommendation')}</p>}</section>
        <JobDescription key={selectedPosting.id} description={selectedPosting.description} />
        {actionError ? <p role="alert" className="job-workspace__alert" data-tone="error">{t('workspace.opportunityFailed')}</p> : null}
        <footer>{recommendation ? <>
          <button type="button" className="job-button job-button--primary" disabled={Boolean(pendingId) || selectedPosting.status === 'closed'} onClick={() => void runAction(selectedPosting.id, () => onAnalyze(selectedPosting, recommendation))}>{t(pendingId === selectedPosting.id ? 'workspace.processingOpportunity' : managed ? 'workspace.processNow' : 'workspace.confirmInterest')}</button>
          <button type="button" className="job-button job-button--secondary" disabled={Boolean(pendingId)} onClick={() => void runAction(selectedPosting.id, () => onDecide(recommendation, 'saved'))}><Save size={14} />{t('save')}</button>
          <button type="button" className="job-button job-button--secondary" disabled={Boolean(pendingId) || recommendation.decision === 'ignored'} onClick={() => void runAction(selectedPosting.id, () => onDecide(recommendation, 'ignored'))}>{t('ignore')}</button>
        </> : null}<a href={selectedPosting.canonicalUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} />{t('openOriginal')}</a></footer>
      </> : <p className="job-workspace__empty">{t('workspace.selectOpportunity')}</p>}
    </section>
  </div>
}

function JobDescription({ description }: { description: string }) {
  const t = useTranslations('jobRadar.workspace')
  const [expanded, setExpanded] = useState(false)
  const text = useMemo(() => description.split(/\r?\n/u).map(sanitizeJobDisplayText).join('\n').trim(), [description])
  return <section className="job-opportunities__description">
    <h3>{t('jobDescription')}</h3>
    <p>{expanded || text.length <= 520 ? text : `${text.slice(0, 520)}…`}</p>
    {text.length > 520 ? <button type="button" className="job-button job-button--secondary" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{t(expanded ? 'collapseDescription' : 'expandDescription')}</button> : null}
  </section>
}
