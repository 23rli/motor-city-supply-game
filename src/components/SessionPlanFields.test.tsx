/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { originalTimerConfig } from '../game/timer'
import { SessionPlanFields } from './SessionPlanFields'

const renderPlan = () => renderToStaticMarkup(
  <SessionPlanFields
    penaltyRound={10}
    endRound={10}
    timer={originalTimerConfig(10, true)}
    onPenaltyRoundChange={vi.fn()}
    onEndRoundChange={vi.fn()}
    onTimerChange={vi.fn()}
  />,
)

describe('facilitator session plan', () => {
  it('keeps the timer consequence visible while collapsing schedule details', () => {
    const markup = renderPlan()

    expect(markup).toContain('<strong>At 0:00</strong>')
    expect(markup).toContain('<details class="timer-schedule">')
    expect(markup).toContain('R1-8: 10 min; R9-10: 3 min')
    expect(markup).not.toContain('<details class="timer-schedule" open="">')
  })

  it('retains accessible names for compact inputs and help controls', () => {
    const markup = renderPlan()

    expect(markup).toContain('>Last round in timer block 1</span>')
    expect(markup).toContain('>Minutes per round in timer block 1</span>')
    expect(markup).toContain('aria-label="About the final round"')
    expect(markup).toContain('role="tooltip"')
  })

  it('defines the visually hidden utility in the global stylesheet', () => {
    const theme = readFileSync(new URL('../theme.css', import.meta.url), 'utf8')

    expect(theme).toMatch(/\.sr-only\s*{[^}]*clip-path:\s*inset\(50%\)/s)
  })
})