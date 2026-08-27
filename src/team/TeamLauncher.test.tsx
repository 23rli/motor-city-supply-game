/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_REVENUE, DEFAULT_WIP_PENALTY } from '../game/engine'
import { recommendedEvanTimerConfig } from '../game/timer'
import { CAR_MODELS } from '../game/types'
import { isRecommendedEvanSetup } from './recommended-setup'
import { RecommendedSetupCard } from './TeamLauncher'

const recommendedSetup = {
  models: [...CAR_MODELS],
  resourcePlan: 'evan' as const,
  revenue: { ...DEFAULT_REVENUE },
  wipPenalty: { ...DEFAULT_WIP_PENALTY },
  endRound: 25,
  penaltyRound: 25,
  timer: recommendedEvanTimerConfig(),
}

describe('recommended facilitator setup', () => {
  it('recognizes the complete preset and detects customization', () => {
    expect(isRecommendedEvanSetup(recommendedSetup)).toBe(true)
    expect(isRecommendedEvanSetup({ ...recommendedSetup, endRound: 24 })).toBe(false)
    expect(isRecommendedEvanSetup({
      ...recommendedSetup,
      timer: { ...recommendedSetup.timer, enabled: false },
    })).toBe(false)
  })

  it('shows the professor-facing summary and announces its applied state', () => {
    const markup = renderToStaticMarkup(
      <RecommendedSetupCard applied onRestore={vi.fn()} />,
    )

    expect(markup).toContain('Recommended default')
    expect(markup).toContain('25-round class')
    expect(markup).toContain('Exact v1 sequence')
    expect(markup).toContain('standard economics')
    expect(markup).toContain('final/WIP at 25')
    expect(markup).toContain('timer 10 min R1-10, 5 min R11-25')
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