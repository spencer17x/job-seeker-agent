'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useTranslations } from 'next-intl'
import type { IndexedDbDomainStore } from '@/lib/agent/domain-store'
import type { ResumeDraft } from '@/lib/resume-model'
import type { JobSetupValues } from './job-agent-setup'
import {
  createStableJobDomainId,
  jobSearchProfileSchema,
  type JobSearchProfile
} from '@/lib/jobs/job-domain'
import type { JobAgentPreferences } from '@/lib/jobs/job-agent-policy'
import { analyzeJobGoalDescription } from '@/lib/jobs/job-goal-description'
import { DEFAULT_JOB_MARKETPLACES, PRIMARY_JOB_MARKETPLACE_IDS, deriveJobSearchSeed, type JobMarketplaceId } from '@/lib/jobs/job-marketplace'
import { scoreCurrentJobPostings } from '@/lib/jobs/job-scoring'

export function useJobSearchProfileController(input: {
  store: IndexedDbDomainStore
  profiles: JobSearchProfile[]
  activeDraft: ResumeDraft | null
  trustedDraft: boolean
  loaded: boolean
  preferences: JobAgentPreferences
  setPreferences: Dispatch<SetStateAction<JobAgentPreferences>>
  reload: () => Promise<void>
  setError: (message: string) => void
  setNotice: (message: string) => void
}) {
  const t = useTranslations('jobRadar')
  const [profileName, setProfileName] = useState('')
  const [goalDescription, setGoalDescription] = useState('')
  const [titles, setTitles] = useState('')
  const [locations, setLocations] = useState('')
  const [preferredCompanies, setPreferredCompanies] = useState('')
  const [requiredTerms, setRequiredTerms] = useState('')
  const [preferredTerms, setPreferredTerms] = useState('')
  const [excludedTerms, setExcludedTerms] = useState('')
  const [selectedPlatforms, setSelectedPlatforms] = useState<JobMarketplaceId[]>([...DEFAULT_JOB_MARKETPLACES])
  const [advancedSetup, setAdvancedSetup] = useState({
    blockedCompanies: '', industries: '', experienceLevels: '', educationLevels: '',
    companySizes: '', financingStages: '', minimumSalary: '', maximumSalary: '',
    maximumAgeDays: 30,
    workplaceTypes: [] as JobSetupValues['workplaceTypes'],
    employmentTypes: [] as JobSetupValues['employmentTypes']
  })
  const hydratedProfileIdRef = useRef('')
  const seededDraftIdRef = useRef('')

  useEffect(() => {
    const profile = input.profiles[0]
    if (!profile || hydratedProfileIdRef.current === profile.id) return
    hydratedProfileIdRef.current = profile.id
    setProfileName(profile.name)
    const primaryPlatforms = profile.platforms?.filter((platform) => (
      PRIMARY_JOB_MARKETPLACE_IDS.includes(platform as typeof PRIMARY_JOB_MARKETPLACE_IDS[number])
    )) ?? []
    setSelectedPlatforms(primaryPlatforms.length ? primaryPlatforms : [...DEFAULT_JOB_MARKETPLACES])
    setTitles(profile.titles.join(', '))
    setLocations(profile.locations.join(', '))
    setPreferredCompanies(profile.preferredCompanies?.join(', ') ?? '')
    setRequiredTerms(profile.requiredTerms.join(', '))
    setPreferredTerms(profile.preferredTerms.join(', '))
    setExcludedTerms(profile.excludedTerms.join(', '))
    setAdvancedSetup({
      blockedCompanies: profile.blockedCompanies?.join(', ') ?? '',
      industries: profile.industries?.join(', ') ?? '',
      experienceLevels: profile.experienceLevels?.join(', ') ?? '',
      educationLevels: profile.educationLevels?.join(', ') ?? '',
      companySizes: profile.companySizes?.join(', ') ?? '',
      financingStages: profile.financingStages?.join(', ') ?? '',
      minimumSalary: profile.minimumMonthlySalary?.toString() ?? '',
      maximumSalary: profile.maximumMonthlySalary?.toString() ?? '',
      maximumAgeDays: profile.maximumAgeDays,
      workplaceTypes: profile.workplaceTypes,
      employmentTypes: profile.employmentTypes
    })
  }, [input.profiles])

  useEffect(() => {
    if (!input.loaded || input.profiles.length > 0 || !input.activeDraft || !input.trustedDraft) return
    if (seededDraftIdRef.current === input.activeDraft.id) return
    seededDraftIdRef.current = input.activeDraft.id
    const seed = deriveJobSearchSeed(input.activeDraft.data)
    setProfileName(seed.name)
    setTitles(seed.titles.join(', '))
    setLocations(seed.locations.join(', '))
    setPreferredTerms(seed.preferredTerms.join(', '))
  }, [input.activeDraft, input.loaded, input.profiles.length, input.trustedDraft])

  const updateSetupValue = useCallback((key: keyof JobSetupValues, value: JobSetupValues[keyof JobSetupValues]) => {
    if (key === 'goalDescription') return setGoalDescription(String(value))
    if (key === 'profileName') return setProfileName(String(value))
    if (key === 'titles') return setTitles(String(value))
    if (key === 'locations') return setLocations(String(value))
    if (key === 'preferredCompanies') return setPreferredCompanies(String(value))
    if (key === 'requiredTerms') return setRequiredTerms(String(value))
    if (key === 'preferredTerms') return setPreferredTerms(String(value))
    if (key === 'excludedTerms') return setExcludedTerms(String(value))
    if (key === 'minimumMatchScore' || key === 'dailyContactLimit' || key === 'autonomy' || key === 'autoSendResume') {
      input.setPreferences((current) => ({ ...current, [key]: value }))
      return
    }
    setAdvancedSetup((current) => ({ ...current, [key]: value }))
  }, [input])

  const analyzeGoal = useCallback(() => {
    const analyzed = analyzeJobGoalDescription(goalDescription)
    if (analyzed.titles.length > 0) setTitles(analyzed.titles.join(', '))
    if (analyzed.locations.length > 0) setLocations(analyzed.locations.join(', '))
    if (analyzed.preferredTerms.length > 0) {
      setPreferredTerms((current) => uniqueTerms(current, analyzed.preferredTerms))
    }
    if (analyzed.excludedTerms.length > 0) {
      setExcludedTerms((current) => uniqueTerms(current, analyzed.excludedTerms))
    }
    setAdvancedSetup((current) => ({
      ...current,
      ...(analyzed.minimumSalary !== undefined ? { minimumSalary: String(analyzed.minimumSalary) } : {}),
      ...(analyzed.maximumSalary !== undefined ? { maximumSalary: String(analyzed.maximumSalary) } : {}),
      ...(analyzed.experienceLevels.length > 0 ? { experienceLevels: analyzed.experienceLevels.join(', ') } : {}),
      ...(analyzed.workplaceTypes.length > 0 ? { workplaceTypes: analyzed.workplaceTypes } : {}),
      ...(analyzed.employmentTypes.length > 0 ? { employmentTypes: analyzed.employmentTypes } : {})
    }))
  }, [goalDescription])

  const saveProfile = useCallback(async (announce = true): Promise<JobSearchProfile | null> => {
    input.setError('')
    try {
      const now = new Date().toISOString()
      const existing = input.profiles[0]
      const profile = jobSearchProfileSchema.parse({
        id: existing?.id ?? createStableJobDomainId('search-profile', [profileName, titles]),
        name: profileName.trim(),
        platforms: selectedPlatforms,
        titles: splitTerms(titles), adjacentTitles: [],
        locations: splitTerms(locations), excludedLocations: [],
        requiredTerms: splitTerms(requiredTerms), preferredTerms: splitTerms(preferredTerms),
        excludedTerms: splitTerms(excludedTerms), preferredCompanies: splitTerms(preferredCompanies),
        blockedCompanies: splitTerms(advancedSetup.blockedCompanies),
        experienceLevels: splitTerms(advancedSetup.experienceLevels),
        educationLevels: splitTerms(advancedSetup.educationLevels),
        industries: splitTerms(advancedSetup.industries),
        companySizes: splitTerms(advancedSetup.companySizes),
        financingStages: splitTerms(advancedSetup.financingStages),
        ...(advancedSetup.minimumSalary ? { minimumMonthlySalary: Number(advancedSetup.minimumSalary) } : {}),
        ...(advancedSetup.maximumSalary ? { maximumMonthlySalary: Number(advancedSetup.maximumSalary) } : {}),
        workplaceTypes: advancedSetup.workplaceTypes,
        employmentTypes: advancedSetup.employmentTypes,
        maximumAgeDays: advancedSetup.maximumAgeDays,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      })
      await input.store.put('jobSearchProfiles', profile)
      if (input.activeDraft) {
        await scoreCurrentJobPostings({
          store: input.store,
          profile,
          sourceDraftId: input.activeDraft.id,
          now
        })
      }
      if (announce) input.setNotice(t('profileSaved'))
      await input.reload()
      return profile
    } catch {
      input.setError(t('errors.invalidProfile'))
      return null
    }
  }, [advancedSetup, excludedTerms, input, locations, preferredCompanies, preferredTerms, profileName, requiredTerms, selectedPlatforms, t, titles])

  const setupAnalysis = input.activeDraft && input.trustedDraft ? {
    name: input.activeDraft.data.profile.name,
    role: input.activeDraft.data.profile.title || input.activeDraft.data.targetRole || '',
    suggestedTitles: deriveJobSearchSeed(input.activeDraft.data).titles,
    skills: input.activeDraft.data.skills.flatMap((group) => group.items),
    experienceCount: input.activeDraft.data.experiences.length
  } : null

  const setupValues = useMemo<JobSetupValues>(() => ({
    goalDescription, profileName, titles, locations, preferredCompanies,
    blockedCompanies: advancedSetup.blockedCompanies,
    requiredTerms, preferredTerms, excludedTerms,
    industries: advancedSetup.industries,
    experienceLevels: advancedSetup.experienceLevels,
    educationLevels: advancedSetup.educationLevels,
    companySizes: advancedSetup.companySizes,
    financingStages: advancedSetup.financingStages,
    minimumSalary: advancedSetup.minimumSalary,
    maximumSalary: advancedSetup.maximumSalary,
    maximumAgeDays: advancedSetup.maximumAgeDays,
    workplaceTypes: advancedSetup.workplaceTypes,
    employmentTypes: advancedSetup.employmentTypes,
    minimumMatchScore: input.preferences.minimumMatchScore,
    dailyContactLimit: input.preferences.dailyContactLimit,
    autonomy: input.preferences.autonomy,
    autoSendResume: input.preferences.autoSendResume
  }), [advancedSetup, excludedTerms, goalDescription, input.preferences, locations, preferredCompanies, preferredTerms, profileName, requiredTerms, titles])

  return {
    profileName, setProfileName, titles, setTitles, locations, setLocations,
    preferredCompanies, setPreferredCompanies, requiredTerms, setRequiredTerms,
    preferredTerms, setPreferredTerms, excludedTerms, setExcludedTerms,
    selectedPlatforms, setSelectedPlatforms,
    primaryTitle: splitTerms(titles)[0],
    primaryLocation: splitTerms(locations)[0],
    setupAnalysis, setupValues, updateSetupValue, analyzeGoal, saveProfile
  }
}

export function splitJobSearchTerms(value: string) {
  return [...new Set(value.split(/[,，\n]/u).map((term) => term.trim()).filter(Boolean))]
}

function splitTerms(value: string) {
  return splitJobSearchTerms(value)
}

function uniqueTerms(current: string, additions: readonly string[]) {
  return [...new Set([...splitTerms(current), ...additions])].join(', ')
}
