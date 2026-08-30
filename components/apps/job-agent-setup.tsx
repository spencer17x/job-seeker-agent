'use client'

import { Check, ChevronLeft, ChevronRight, Play, Upload } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import type { JobAgentAutonomy } from '@/lib/jobs/job-agent-policy'
import type { JobEmploymentType, JobWorkplaceType } from '@/lib/jobs/job-domain'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

export type JobSetupValues = {
  goalDescription: string
  profileName: string
  titles: string
  locations: string
  preferredCompanies: string
  blockedCompanies: string
  requiredTerms: string
  preferredTerms: string
  excludedTerms: string
  industries: string
  experienceLevels: string
  educationLevels: string
  companySizes: string
  financingStages: string
  minimumSalary: string
  maximumSalary: string
  maximumAgeDays: number
  workplaceTypes: JobWorkplaceType[]
  employmentTypes: JobEmploymentType[]
  minimumMatchScore: number
  dailyContactLimit: number
  autonomy: JobAgentAutonomy
  autoSendResume: boolean
}

export function JobAgentSetup({
  trustedResume,
  resumeEditor,
  analysis,
  values,
  onChange,
  onAnalyzeGoal,
  onSave,
  onStart
}: {
  trustedResume: boolean
  resumeEditor: ReactNode
  analysis: { name: string; role: string; suggestedTitles: string[]; skills: string[]; experienceCount: number } | null
  values: JobSetupValues
  onChange: <Key extends keyof JobSetupValues>(key: Key, value: JobSetupValues[Key]) => void
  onAnalyzeGoal: () => void
  onSave: () => Promise<boolean>
  onStart: () => Promise<void>
}) {
  const t = useTranslations('jobRadar.setup')
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!trustedResume && step > 2) setStep(2)
  }, [step, trustedResume])

  const saveOptions = async () => {
    setSaving(true)
    try {
      if (await onSave()) {
        onChange('autonomy', 'autopilot')
        onChange('autoSendResume', true)
        setStep(5)
      }
    } finally {
      setSaving(false)
    }
  }

  return <div className="job-setup mx-auto grid w-full max-w-[1440px] gap-8 p-6 text-slate-950 lg:p-10">
    <header className="job-setup__header grid items-end gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(520px,.9fr)]">
      <div>
        <Badge className="mb-3">{t('eyebrow')}</Badge>
        <h2 className="text-3xl font-bold tracking-tight text-slate-950">{t('title')}</h2>
        <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600">{t('description')}</p>
      </div>
      <ol className="grid grid-cols-5 gap-1" aria-label={t('title')}>{([1, 2, 3, 4, 5] as const).map((value) => {
        const active = step === value
        const complete = step > value
        return <li key={value} aria-current={active ? 'step' : undefined} className={cn('relative grid justify-items-center gap-2 text-center text-xs font-medium text-slate-500 before:absolute before:top-4 before:right-1/2 before:left-[-50%] before:h-px before:bg-slate-200 before:content-[\'\'] first:before:hidden', (active || complete) && 'text-blue-700')}>
          <span className={cn('relative z-10 grid size-8 place-items-center rounded-full border border-slate-300 bg-white font-semibold text-slate-600 shadow-sm', (active || complete) && 'border-blue-600 bg-blue-600 text-white')}>{complete ? <Check size={15} /> : value}</span>
          <small className="text-[11px] leading-4 sm:text-xs">{t(`steps.${value}`)}</small>
        </li>
      })}</ol>
    </header>

    {step === 1 ? <Card className="job-setup__panel overflow-hidden">
      <CardHeader className="border-b border-slate-100 bg-slate-50/60">
        <CardTitle>{t('goalTitle')}</CardTitle>
        <CardDescription>{t('goalHelp')}</CardDescription>
      </CardHeader>
      <CardContent className="pt-6">
        <Label className="grid gap-3 text-slate-800">{t('goalDescription')}<Textarea className="min-h-48 text-base" rows={7} value={values.goalDescription} onChange={(event) => onChange('goalDescription', event.target.value)} placeholder={t('goalPlaceholder')} /></Label>
      </CardContent>
      <CardFooter className="justify-end border-t border-slate-100 bg-slate-50/40 pt-5">
        <Button size="lg" disabled={!values.goalDescription.trim()} onClick={() => { onAnalyzeGoal(); setStep(2) }}>{t('analyzeGoal')}<ChevronRight size={16} /></Button>
      </CardFooter>
    </Card> : null}

    {step === 2 ? <Card className="job-setup__panel overflow-hidden">
      <CardHeader className="flex-row items-start gap-3 border-b border-slate-100 bg-slate-50/60"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700"><Upload size={20} /></span><div><CardTitle>{t('resumeTitle')}</CardTitle><CardDescription className="mt-1">{t('resumeHelp')}</CardDescription></div></CardHeader>
      <CardContent className="pt-6"><div className="job-setup__embedded max-h-[620px] overflow-auto rounded-xl border border-slate-200 bg-white">{resumeEditor}</div></CardContent>
      <CardFooter className="justify-between border-t border-slate-100 bg-slate-50/40 pt-5"><Button variant="outline" onClick={() => setStep(1)}><ChevronLeft size={16} />{t('back')}</Button><Button disabled={!trustedResume} onClick={() => setStep(3)}>{t('continue')}<ChevronRight size={16} /></Button></CardFooter>
    </Card> : null}

    {step === 3 ? <Card className="job-setup__panel overflow-hidden">
      <CardHeader className="flex-row items-start gap-3 border-b border-slate-100 bg-slate-50/60"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Check size={20} /></span><div><CardTitle>{t('analysisTitle')}</CardTitle><CardDescription className="mt-1">{t('analysisHelp')}</CardDescription></div></CardHeader>
      <CardContent className="pt-6">{analysis ? <div className="job-setup__analysis grid gap-4 md:grid-cols-2 xl:grid-cols-4"><AnalysisItem label={t('candidate')} value={analysis.name || t('unknown')} /><AnalysisItem label={t('currentRole')} value={analysis.role || t('unknown')} /><AnalysisItem label={t('experienceCount')} value={String(analysis.experienceCount)} /><AnalysisItem label={t('suggestedRoles')} value={analysis.suggestedTitles.join('、') || t('unknown')} /><article className="job-setup__analysis-wide rounded-xl border border-slate-200 bg-slate-50 p-4 md:col-span-2 xl:col-span-4"><span className="text-xs font-medium text-slate-500">{t('skills')}</span><div className="mt-3 flex flex-wrap gap-2">{analysis.skills.slice(0, 16).map((skill) => <Badge key={skill}>{skill}</Badge>)}</div></article></div> : null}</CardContent>
      <CardFooter className="justify-between border-t border-slate-100 bg-slate-50/40 pt-5"><Button variant="outline" onClick={() => setStep(2)}><ChevronLeft size={16} />{t('back')}</Button><Button onClick={() => setStep(4)}>{t('confirmAnalysis')}<ChevronRight size={16} /></Button></CardFooter>
    </Card> : null}

    {step === 4 ? <Card className="job-setup__panel overflow-hidden">
      <CardHeader className="border-b border-slate-100 bg-slate-50/60"><CardTitle>{t('optionsTitle')}</CardTitle><CardDescription>{t('optionsHelp')}</CardDescription></CardHeader>
      <CardContent className="pt-6"><div className="job-setup__fields grid gap-5 md:grid-cols-2"><TextField label={t('profileName')} value={values.profileName} onChange={(value) => onChange('profileName', value)} /><TextField label={t('titles')} value={values.titles} onChange={(value) => onChange('titles', value)} required /><TextField label={t('locations')} value={values.locations} onChange={(value) => onChange('locations', value)} /><div className="job-setup__salary grid grid-cols-2 gap-3"><TextField label={t('minimumSalary')} value={values.minimumSalary} onChange={(value) => onChange('minimumSalary', value)} type="number" /><TextField label={t('maximumSalary')} value={values.maximumSalary} onChange={(value) => onChange('maximumSalary', value)} type="number" /></div><TextField label={t('experienceLevels')} value={values.experienceLevels} onChange={(value) => onChange('experienceLevels', value)} /><TextField label={t('educationLevels')} value={values.educationLevels} onChange={(value) => onChange('educationLevels', value)} /><TextField label={t('industries')} value={values.industries} onChange={(value) => onChange('industries', value)} /><TextField label={t('preferredCompanies')} value={values.preferredCompanies} onChange={(value) => onChange('preferredCompanies', value)} /><TextField label={t('blockedCompanies')} value={values.blockedCompanies} onChange={(value) => onChange('blockedCompanies', value)} /><TextField label={t('companySizes')} value={values.companySizes} onChange={(value) => onChange('companySizes', value)} /><TextField label={t('financingStages')} value={values.financingStages} onChange={(value) => onChange('financingStages', value)} /><TextField label={t('requiredTerms')} value={values.requiredTerms} onChange={(value) => onChange('requiredTerms', value)} /><TextField label={t('preferredTerms')} value={values.preferredTerms} onChange={(value) => onChange('preferredTerms', value)} /><TextField label={t('excludedTerms')} value={values.excludedTerms} onChange={(value) => onChange('excludedTerms', value)} /><Label className="grid gap-2">{t('maximumAgeDays')}<select className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" value={values.maximumAgeDays} onChange={(event) => onChange('maximumAgeDays', Number(event.target.value))}>{[1, 3, 7, 14, 30].map((days) => <option key={days} value={days}>{t('days', { days })}</option>)}</select></Label><CheckboxGroup label={t('workplaceTypes')} values={values.workplaceTypes} options={['remote', 'hybrid', 'onsite']} message={(value) => t(`workplace.${value}`)} onChange={(value) => onChange('workplaceTypes', value)} /><CheckboxGroup label={t('employmentTypes')} values={values.employmentTypes} options={['full-time', 'part-time', 'contract', 'internship', 'other']} message={(value) => t(`employment.${value}`)} onChange={(value) => onChange('employmentTypes', value)} /></div></CardContent>
      <CardFooter className="justify-between border-t border-slate-100 bg-slate-50/40 pt-5"><Button variant="outline" onClick={() => setStep(3)}><ChevronLeft size={16} />{t('back')}</Button><Button disabled={saving || !values.titles.trim()} onClick={() => void saveOptions()}>{saving ? t('saving') : t('saveOptions')}<ChevronRight size={16} /></Button></CardFooter>
    </Card> : null}

    {step === 5 ? <Card className="job-setup__panel overflow-hidden">
      <CardHeader className="border-b border-slate-100 bg-slate-50/60"><CardTitle>{t('delegationTitle')}</CardTitle><CardDescription>{t('delegationHelp')}</CardDescription></CardHeader>
      <CardContent className="space-y-6 pt-6"><div className="rounded-xl border border-blue-200 bg-blue-50 p-5 text-blue-950"><strong className="text-base">{t('autonomyMode.autopilot')}</strong><p className="mt-2 text-sm leading-6 text-blue-800">{t('managedAutomationHelp')}</p><div className="mt-4 flex flex-wrap gap-2"><Badge>{t('managedVariant')}</Badge><Badge>{t('managedCommunication')}</Badge><Badge>{t('managedResumeDelivery')}</Badge></div></div><div className="grid gap-5 md:grid-cols-2"><TextField label={t('minimumMatchScore')} type="number" min={0} max={100} value={String(values.minimumMatchScore)} onChange={(value) => onChange('minimumMatchScore', Math.min(100, Math.max(0, Number(value))))} /><TextField label={t('dailyContactLimit')} type="number" min={1} max={100} value={String(values.dailyContactLimit)} onChange={(value) => onChange('dailyContactLimit', Math.min(100, Math.max(1, Number(value))))} /></div><div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950"><strong className="text-sm">{t('boundaryTitle')}</strong><ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-amber-900"><li>{t('boundarySubmission')}</li><li>{t('boundaryCaptcha')}</li><li>{t('boundaryOutcome')}</li></ul></div></CardContent>
      <CardFooter className="justify-between border-t border-slate-100 bg-slate-50/40 pt-5"><Button variant="outline" onClick={() => setStep(4)}><ChevronLeft size={16} />{t('back')}</Button><Button size="lg" onClick={() => void onStart()}><Play size={16} />{t('start')}</Button></CardFooter>
    </Card> : null}
  </div>
}

function TextField({ label, value, onChange, required = false, type = 'text', min, max }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; type?: 'text' | 'number'; min?: number; max?: number }) {
  return <Label className="grid gap-2">{label}<Input type={type} value={value} required={required} min={min} max={max} onChange={(event) => onChange(event.target.value)} /></Label>
}

function CheckboxGroup<Value extends string>({ label, values, options, message, onChange }: { label: string; values: Value[]; options: Value[]; message: (value: Value) => string; onChange: (values: Value[]) => void }) {
  return <fieldset className="rounded-xl border border-slate-200 p-4"><legend className="px-2 text-sm font-semibold text-slate-800">{label}</legend><div className="flex flex-wrap gap-2">{options.map((option) => <Label className={cn('flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 transition', values.includes(option) ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white hover:bg-slate-50')} key={option}><input className="size-4 accent-blue-600" type="checkbox" checked={values.includes(option)} onChange={(event) => onChange(event.target.checked ? [...values, option] : values.filter((value) => value !== option))} /><span>{message(option)}</span></Label>)}</div></fieldset>
}

function AnalysisItem({ label, value }: { label: string; value: string }) {
  return <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><span className="text-xs font-medium text-slate-500">{label}</span><strong className="mt-2 block text-sm font-semibold text-slate-950">{value}</strong></article>
}
