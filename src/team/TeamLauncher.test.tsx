/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_REVENUE, DEFAULT_WIP_PENALTY } from '../game/engine'
import { recommendedClassTimerConfig } from '../game/timer'
import { CAR_MODELS } from '../game/types'
import { isRecommendedClassSetup } from './recommended-setup'
import { RecommendedSetupCard } from './TeamLauncher'

const recommendedSetup = {
  models: [...CAR_MODELS],
  resourcePlan: 'classic' as const,
  revenue: { ...DEFAULT_REVENUE },
  wipPenalty: { ...DEFAULT_WIP_PENALTY },
  endRound: 10,
  penaltyRound: 10,
  timer: recommendedClassTimerConfig(),
}

describe('recommended facilitator setup', () => {
  it('recognizes the complete preset and detects customization', () => {
    expect(isRecommendedClassSetup(recommendedSetup)).toBe(true)
    expect(isRecommendedClassSetup({ ...recommendedSetup, endRound: 11 })).toBe(false)
    expect(isRecommendedClassSetup({
      ...recommendedSetup,
      timer: { ...recommendedSetup.timer, enabled: false },
    })).toBe(false)
  })

  it('shows the professor-facing summary and announces its applied state', () => {
    const markup = renderToStaticMarkup(
      <RecommendedSetupCard applied onRestore={vi.fn()} />,
    )

    expect(markup).toContain('Recommended default')
    expect(markup).toContain('10-round class')
    expect(markup).toContain('standard economics')
    expect(markup).toContain('final/WIP at 10')
    expect(markup).toContain('timer 10 min R1-5, 5 min R6-10')
    expect(markup).toContain('role="status"')
    expect(markup).toContain('Recommended setup applied.')
    expect(markup).toContain('disabled=""')
  })

  it('keeps the recommended summary and restore control stacked on mobile', () => {
    const css = readFileSync(new URL('../Launcher.css', import.meta.url), 'utf8')

    expect(css).toMatch(
      /@media \(max-width: 520px\)[\s\S]*\.recommended-setup\s*{\s*grid-template-columns:\s*1fr;/,
    )
    expect(css).toMatch(/\.recommended-setup \.button\s*{\s*width:\s*100%;/)
  })
})