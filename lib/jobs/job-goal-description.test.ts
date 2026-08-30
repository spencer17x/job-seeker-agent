import { describe, expect, it } from 'vitest'
import { analyzeJobGoalDescription } from './job-goal-description'

describe('job goal description', () => {
  it('derives bounded BOSS-style filters from a natural-language goal', () => {
    expect(analyzeJobGoalDescription(
      '想在杭州找全职 AI Agent工程师或AI全栈工程师，月薪 35K-60K，接受远程，偏好 TypeScript、React 和 RAG。'
    )).toEqual({
      titles: ['AI Agent工程师', 'AI全栈工程师', '全栈工程师'],
      locations: ['杭州'],
      minimumSalary: 35_000,
      maximumSalary: 60_000,
      experienceLevels: [],
      workplaceTypes: ['remote'],
      employmentTypes: ['full-time'],
      preferredTerms: ['AI Agent', 'RAG', 'TypeScript', 'React', '远程'],
      excludedTerms: []
    })
  })

  it('parses the configured 45K-60K Hangzhou AI search without losing outsourcing exclusion', () => {
    expect(analyzeJobGoalDescription(
      '想在杭州找全职 AI Agent 或 AI 全栈岗位，月薪 45K-60K，接受远程，偏好 TypeScript、React 和 RAG，不考虑外包。'
    )).toEqual({
      titles: ['AI Agent工程师', 'AI全栈工程师', '全栈工程师'],
      locations: ['杭州'],
      minimumSalary: 45_000,
      maximumSalary: 60_000,
      experienceLevels: [],
      workplaceTypes: ['remote'],
      employmentTypes: ['full-time'],
      preferredTerms: ['AI Agent', 'RAG', 'TypeScript', 'React', '远程'],
      excludedTerms: ['外包']
    })
  })

  it('does not invent filters that were not stated', () => {
    expect(analyzeJobGoalDescription('希望找合适的机会')).toEqual({
      titles: [], locations: [], experienceLevels: [], workplaceTypes: [], employmentTypes: [], preferredTerms: [], excludedTerms: []
    })
  })

  it('keeps experience ranges out of salary and honors outsourcing negation', () => {
    expect(analyzeJobGoalDescription(
      '想在上海找 Web3 前端或全栈岗位，优先远程，也接受混合办公，月薪至少 35K，3-5 年经验，不考虑外包。'
    )).toEqual({
      titles: ['前端工程师', '全栈工程师'],
      locations: ['上海'],
      minimumSalary: 35_000,
      experienceLevels: ['3-5 年'],
      workplaceTypes: ['remote', 'hybrid'],
      employmentTypes: [],
      preferredTerms: ['远程'],
      excludedTerms: ['外包']
    })
  })

  it('does not treat an English experience range as compensation', () => {
    expect(analyzeJobGoalDescription('Frontend roles with 3-5 years experience; exclude outsourcing.')).toMatchObject({
      titles: ['前端工程师'],
      experienceLevels: ['3-5 年'],
      excludedTerms: ['outsourcing']
    })
    expect(analyzeJobGoalDescription('Frontend roles with 3-5 years experience')).not.toHaveProperty('minimumSalary')
  })
})
