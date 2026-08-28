import { describe, expect, it } from 'vitest'
import {
  DEFAULT_JOB_AGENT_PREFERENCES,
  canExecuteJobAgentAction,
  parseJobAgentPreferences,
  serializeJobAgentPreferences
} from './job-agent-policy'

describe('job agent policy', () => {
  it('falls back safely when persisted preferences are missing or invalid', () => {
    expect(parseJobAgentPreferences(null)).toEqual(DEFAULT_JOB_AGENT_PREFERENCES)
    expect(parseJobAgentPreferences('{"enabled":"yes"}')).toEqual(DEFAULT_JOB_AGENT_PREFERENCES)
  })

  it('round-trips bounded BOSS preferences', () => {
    const value = serializeJobAgentPreferences({
      ...DEFAULT_JOB_AGENT_PREFERENCES,
      enabled: true,
      platforms: ['boss']
    })
    expect(parseJobAgentPreferences(value)).toMatchObject({
      enabled: true,
      platforms: ['boss']
    })
  })

  it('starts paused with only BOSS Zhipin selected and no platform-specific setup', () => {
    expect(DEFAULT_JOB_AGENT_PREFERENCES).toMatchObject({
      enabled: false,
      autonomy: 'approval',
      autoSendResume: false
    })
    expect(DEFAULT_JOB_AGENT_PREFERENCES.platforms).toEqual(['boss'])
  })

  it('migrates older platform preferences into the initial domestic catalog', () => {
    expect(parseJobAgentPreferences(JSON.stringify({
      ...DEFAULT_JOB_AGENT_PREFERENCES,
      platforms: ['greenhouse', 'boss', 'linkedin', 'liepin']
    })).platforms).toEqual(['boss'])
  })

  it('migrates missing action limits and resume consent to fail-closed defaults', () => {
    expect(parseJobAgentPreferences(JSON.stringify({
      version: 1,
      enabled: true,
      autonomy: 'autopilot',
      platforms: ['boss'],
      learnFromReplies: true,
      learnFromOutcomes: true
    }))).toMatchObject({
      minimumMatchScore: 70,
      dailyContactLimit: 20,
      autoSendResume: false
    })
  })

  it('never sends or submits without both autopilot mode and an authorized connector', () => {
    const preferences = { ...DEFAULT_JOB_AGENT_PREFERENCES, enabled: true, autonomy: 'autopilot' as const }
    expect(canExecuteJobAgentAction({ action: 'discover', preferences })).toBe(true)
    expect(canExecuteJobAgentAction({ action: 'draft-message', preferences })).toBe(true)
    expect(canExecuteJobAgentAction({ action: 'send-message', preferences })).toBe(false)
    expect(canExecuteJobAgentAction({ action: 'send-message', preferences, connectorAuthorized: true })).toBe(true)
    expect(canExecuteJobAgentAction({ action: 'submit-application', preferences })).toBe(false)
    expect(canExecuteJobAgentAction({
      action: 'submit-application',
      preferences,
      connectorAuthorized: true
    })).toBe(false)
  })
})
