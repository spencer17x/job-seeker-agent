'use client'

import { BrainCircuit, Check, Download, PauseCircle, PlayCircle, RefreshCw, Trash2, X } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import type { JobHistorySimulation } from '@/lib/jobs/job-history-learning'
import type { JobStrategyMemory } from '@/lib/jobs/job-strategy-memory'

export function JobHistoryLearningPanel({ simulation, memory, exportText, busy, onSimulate, onApply, onDismiss, onSetEnabled, onClear }: {
  simulation: JobHistorySimulation | null
  memory: JobStrategyMemory
  exportText: string
  busy: boolean
  onSimulate: () => void
  onApply: () => void
  onDismiss: () => void
  onSetEnabled: (enabled: boolean) => void
  onClear: () => void
}) {
  const t = useTranslations('jobRadar.historyLearning')
  const locale = useLocale()
  const [confirmingClear, setConfirmingClear] = useState(false)
  const latest = memory.entries.at(-1)
  const exportHref = `data:application/json;charset=utf-8,${encodeURIComponent(exportText)}`
  return <section className="job-history-learning" aria-labelledby="job-history-learning-title">
    <header><div><BrainCircuit size={19} aria-hidden="true" /><div><h2 id="job-history-learning-title">{t('title')}</h2><p>{t('description')}</p></div></div><button type="button" className="job-button job-button--secondary" onClick={onSimulate} disabled={busy}><RefreshCw size={14} />{busy ? t('reading') : t('readHistory')}</button></header>
    <p className="job-history-learning__privacy">{t('privacy')}</p>
    <section className="job-history-learning__memory" aria-labelledby="job-strategy-memory-title">
      <header><div><strong id="job-strategy-memory-title">{t('memoryTitle')}</strong><span data-enabled={memory.enabled}>{memory.enabled ? t('memoryEnabled') : t('memoryDisabled')}</span></div><small>{t('memoryVersions', { count: memory.entries.length })}</small></header>
      {latest ? <dl>
        <div><dt>{t('lastApplied')}</dt><dd><time dateTime={latest.appliedAt}>{new Date(latest.appliedAt).toLocaleString(locale)}</time></dd></div>
        <div><dt>{t('minimumScore')}</dt><dd>{latest.settings.minimumMatchScore}%</dd></div>
        <div><dt>{t('dailyLimit')}</dt><dd>{latest.settings.dailyContactLimit}</dd></div>
        <div><dt>{t('automation')}</dt><dd>{t(`autonomy.${latest.settings.autonomy}`)}</dd></div>
      </dl> : <p>{t('memoryEmpty')}</p>}
      <footer>
        <button type="button" className="job-button job-button--secondary" onClick={() => onSetEnabled(!memory.enabled)}>{memory.enabled ? <PauseCircle size={14} /> : <PlayCircle size={14} />}{memory.enabled ? t('disableMemory') : t('enableMemory')}</button>
        {memory.entries.length > 0 ? <a className="job-button job-button--secondary" href={exportHref} download="job-seeker-agent-strategy-memory.json"><Download size={14} />{t('exportMemory')}</a> : null}
        {confirmingClear ? <div role="group" aria-label={t('clearConfirmation')}><button type="button" className="job-button job-button--secondary" onClick={() => { onClear(); setConfirmingClear(false) }}><Trash2 size={14} />{t('confirmClear')}</button><button type="button" className="job-button job-button--secondary" onClick={() => setConfirmingClear(false)}>{t('cancelClear')}</button></div> : <button type="button" className="job-button job-button--secondary" disabled={memory.entries.length === 0} onClick={() => setConfirmingClear(true)}><Trash2 size={14} />{t('clearMemory')}</button>}
      </footer>
      <small>{t('clearHelp')}</small>
    </section>
    {simulation ? <div className="job-history-learning__simulation">
      <header><div><strong>{t('simulationTitle')}</strong><span>{t('sampleSize', { count: simulation.sampleSize })}</span></div><button type="button" onClick={onDismiss} aria-label={t('dismiss')}><X size={14} /></button></header>
      <div className="job-history-learning__signals">
        {(['conversations', 'recruiterReplies', 'resumeRequests', 'interviewInvites', 'offers', 'rejections'] as const).map((key) => <article key={key}><strong>{simulation.signals[key]}</strong><span>{t(`signals.${key}`)}</span></article>)}
      </div>
      <dl>
        <div><dt>{t('minimumScore')}</dt><dd>{simulation.recommendedMinimumMatchScore}%</dd></div>
        <div><dt>{t('dailyLimit')}</dt><dd>{simulation.recommendedDailyContactLimit}</dd></div>
        <div><dt>{t('automation')}</dt><dd>{t(`autonomy.${simulation.recommendedAutonomy}`)}</dd></div>
        <div><dt>{t('autoResume')}</dt><dd>{simulation.recommendedAutoSendResume ? t('enabled') : t('disabled')}</dd></div>
      </dl>
      <ul>{simulation.reasonCodes.map((code) => <li key={code}>{t(`reasons.${code}`)}</li>)}</ul>
      <footer><button type="button" className="job-button job-button--primary" onClick={onApply} disabled={simulation.sampleSize === 0}><Check size={14} />{t('apply')}</button><button type="button" className="job-button job-button--secondary" onClick={onDismiss}>{t('keepCurrent')}</button></footer>
    </div> : null}
  </section>
}
