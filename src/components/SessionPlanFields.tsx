import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react'
import { ChevronDown, CircleHelp, Clock3, Plus, RotateCcw, Trash2 } from 'lucide-react'
import type { RoundTimerConfig, RoundTimerSegment } from '../game/types'
import {
  describeRoundTimer,
  originalTimerConfig,
  validateTimerCoverage,
} from '../game/timer'

interface SessionPlanFieldsProps {
  penaltyRound: number
  endRound: number
  timer: RoundTimerConfig
  onPenaltyRoundChange: (round: number) => void
  onEndRoundChange: (round: number) => void
  onTimerChange: (timer: RoundTimerConfig) => void
}

const positiveInteger = (value: number) =>
  Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1

function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const descriptionId = useId()
  const containerRef = useRef<HTMLSpanElement>(null)
  const pointerActivation = useRef(false)
  const escapeDismissed = useRef(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const dismissOutside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      escapeDismissed.current = true
      setOpen(false)
    }
    document.addEventListener('pointerdown', dismissOutside)
    document.addEventListener('keydown', dismissWithEscape)
    return () => {
      document.removeEventListener('pointerdown', dismissOutside)
      document.removeEventListener('keydown', dismissWithEscape)
    }
  }, [open])

  return (
    <span
      className="info-tip"
      data-open={open}
      ref={containerRef}
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse' && !escapeDismissed.current) {
          setOpen(true)
        }
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') {
          escapeDismissed.current = false
          setOpen(false)
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          pointerActivation.current = false
          setOpen(false)
        }
      }}
    >
      <button
        className="info-tip-trigger"
        type="button"
        aria-label={label}
        aria-describedby={descriptionId}
        onPointerDown={() => {
          pointerActivation.current = true
          escapeDismissed.current = false
        }}
        onClick={() => {
          setOpen((current) => !current)
          pointerActivation.current = false
        }}
        onFocus={() => {
          if (!pointerActivation.current) setOpen(true)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            escapeDismissed.current = true
            setOpen(false)
          }
        }}
      >
        <CircleHelp size={16} aria-hidden="true" />
      </button>
      <span className="info-tip-content" id={descriptionId} role="tooltip">
        {children}
      </span>
    </span>
  )
}

interface IntegerInputProps {
  id?: string
  inputRef?: Ref<HTMLInputElement>
  min: number
  max: number
  value: number
  onCommit: (value: number) => void
}

function IntegerInput({
  id,
  inputRef,
  min,
  max,
  value,
  onCommit,
}: IntegerInputProps) {
  const [draft, setDraft] = useState(String(value))
  const cancelBlurCommit = useRef(false)

  useEffect(() => setDraft(String(value)), [value])

  const commit = () => {
    if (!draft.trim()) {
      setDraft(String(value))
      return
    }
    const parsed = Number(draft)
    if (!Number.isFinite(parsed)) {
      setDraft(String(value))
      return
    }
    const next = Math.min(max, Math.max(min, Math.floor(parsed)))
    setDraft(String(next))
    if (next !== value) onCommit(next)
  }

  return (
    <input
      id={id}
      ref={inputRef}
      type="number"
      min={min}
      max={max}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (cancelBlurCommit.current) {
          cancelBlurCommit.current = false
          return
        }
        commit()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          cancelBlurCommit.current = true
          setDraft(String(value))
          event.currentTarget.blur()
        }
      }}
    />
  )
}

export function SessionPlanFields({
  penaltyRound,
  endRound,
  timer,
  onPenaltyRoundChange,
  onEndRoundChange,
  onTimerChange,
}: SessionPlanFieldsProps) {
  const finalRoundId = useId()
  const penaltyRoundId = useId()
  const scheduleRef = useRef<HTMLDetailsElement>(null)
  const segmentInputRefs = useRef<Array<HTMLInputElement | null>>([])
  const addTimingButtonRef = useRef<HTMLButtonElement>(null)
  const pendingSegmentFocus = useRef<number | null>(null)
  const timerError = validateTimerCoverage(timer, endRound)
  const scoringError = penaltyRound > endRound
    ? 'The WIP round cannot be after the final round.'
    : null

  useEffect(() => {
    if (timerError && scheduleRef.current) scheduleRef.current.open = true
  }, [timerError])

  useEffect(() => {
    if (pendingSegmentFocus.current === null) return
    const target = segmentInputRefs.current[pendingSegmentFocus.current]
      ?? addTimingButtonRef.current
    pendingSegmentFocus.current = null
    target?.focus()
  }, [timer.segments.length])

  const updateSegment = (index: number, update: Partial<RoundTimerSegment>) => {
    const segments = timer.segments.map((segment) => ({ ...segment }))
    segments[index] = { ...segments[index], ...update }
    if (update.endRound !== undefined) {
      for (let next = index + 1; next < segments.length; next += 1) {
        segments[next].startRound = segments[next - 1].endRound + 1
        segments[next].endRound = Math.max(
          segments[next].startRound,
          segments[next].endRound,
        )
      }
    }
    onTimerChange({ ...timer, segments })
  }

  const splitLastSegment = () => {
    const segments = timer.segments.map((segment) => ({ ...segment }))
    const last = segments.at(-1)
    if (!last || last.endRound <= last.startRound) return
    const nextStart = Math.ceil((last.startRound + last.endRound) / 2)
    const previousEnd = last.endRound
    last.endRound = nextStart - 1
    segments.push({
      startRound: nextStart,
      endRound: previousEnd,
      durationSeconds: last.durationSeconds,
    })
    pendingSegmentFocus.current = segments.length - 1
    onTimerChange({ ...timer, segments })
  }

  const removeSegment = (index: number) => {
    if (timer.segments.length === 1) return
    const segments = timer.segments.map((segment) => ({ ...segment }))
    const [removed] = segments.splice(index, 1)
    if (index === 0) segments[0].startRound = 1
    else segments[index - 1].endRound = removed.endRound
    pendingSegmentFocus.current = Math.min(index, segments.length - 1)
    onTimerChange({ ...timer, segments })
  }

  const changeEndRound = (value: number) => {
    const nextEnd = positiveInteger(value)
    onEndRoundChange(nextEnd)
    if (penaltyRound === endRound) onPenaltyRoundChange(nextEnd)
    if (timer.segments.length === 0) return
    const segments = timer.segments.map((segment) => ({ ...segment }))
    const retained = segments.filter((segment) => segment.startRound <= nextEnd)
    const nextSegments = retained.length ? retained : [segments[0]]
    nextSegments.at(-1)!.endRound = nextEnd
    onTimerChange({ ...timer, segments: nextSegments })
  }

  return (
    <fieldset className="session-plan-fields">
      <legend>Class plan</legend>

      <div className="session-round-fields">
        <div className="session-plan-field">
          <div className="session-plan-label">
            <label htmlFor={finalRoundId}>Final round</label>
            <InfoTip label="About the final round">
              Revenue is scored through this round.
            </InfoTip>
          </div>
          <IntegerInput id={finalRoundId} min={1} max={10_000} value={endRound} onCommit={changeEndRound} />
        </div>
        <div className="session-plan-field">
          <div className="session-plan-label">
            <label htmlFor={penaltyRoundId}>WIP penalty round</label>
            <InfoTip label="About the WIP penalty round">
              Unfinished cars are measured here for the WIP charge.
            </InfoTip>
          </div>
          <IntegerInput id={penaltyRoundId} min={1} max={endRound} value={penaltyRound} onCommit={onPenaltyRoundChange} />
        </div>
      </div>

      <div className="timer-toggle-shell">
        <label className="timer-toggle">
          <input type="checkbox" checked={timer.enabled} onChange={(event) => onTimerChange({ ...timer, enabled: event.target.checked })} />
          <Clock3 size={18} aria-hidden="true" />
          <strong>Use a round timer</strong>
        </label>
        <InfoTip label="About round timers">
          Each player has an independent countdown that survives refresh and rejoin.
        </InfoTip>
      </div>

      {timer.enabled && (
        <div className="timer-setup">
          <div className="timer-consequence" role="note">
            <Clock3 size={17} aria-hidden="true" />
            <p><strong>At 0:00</strong> remaining materials auto-allocate. The player must advance.</p>
          </div>
          <details className="timer-schedule" ref={scheduleRef}>
            <summary>
              <span>
                <strong>Timing schedule</strong>
                <small>{describeRoundTimer(timer)}</small>
              </span>
              <ChevronDown size={18} aria-hidden="true" />
            </summary>
            <div className="timer-schedule-body">
              <div className="timer-blocks-head" aria-hidden="true">
                <span>Starts</span>
                <span>Ends</span>
                <span>Minutes</span>
                <span />
              </div>
              <div className="timer-blocks">
                {timer.segments.map((segment, index) => (
                  <div className="timer-block" role="group" aria-label={`Timer block ${index + 1}, starts at round ${segment.startRound}`} key={index}>
                    <strong>R{segment.startRound}</strong>
                    <label>
                      <span className="sr-only">Last round in timer block {index + 1}</span>
                      <IntegerInput inputRef={(node) => { segmentInputRefs.current[index] = node }} min={segment.startRound} max={endRound - (timer.segments.length - index - 1)} value={segment.endRound} onCommit={(value) => updateSegment(index, { endRound: value })} />
                    </label>
                    <label>
                      <span className="sr-only">Minutes per round in timer block {index + 1}</span>
                      <IntegerInput min={1} max={120} value={segment.durationSeconds / 60} onCommit={(value) => updateSegment(index, { durationSeconds: value * 60 })} />
                    </label>
                    <button className="icon-button setup-icon-button" type="button" disabled={timer.segments.length === 1} onClick={() => removeSegment(index)} aria-label={`Remove timer block ${index + 1}`} title="Remove timing block">
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="timer-setup-actions">
                <button ref={addTimingButtonRef} className="button button-secondary" type="button" disabled={(timer.segments.at(-1)?.endRound ?? 0) <= (timer.segments.at(-1)?.startRound ?? 0)} onClick={splitLastSegment}>
                  <Plus size={15} aria-hidden="true" /> Add timing change
                </button>
                <button className="button button-quiet" type="button" onClick={() => onTimerChange(originalTimerConfig(endRound, true))} title={endRound <= 8 ? 'All rounds use 10 minutes' : 'Rounds 1-8 use 10 minutes; later rounds use 3 minutes'}>
                  <RotateCcw size={15} aria-hidden="true" /> {endRound <= 8 ? 'Restore 10 min' : 'Restore 10 / 3 min'}
                </button>
              </div>
            </div>
          </details>
        </div>
      )}

      {(scoringError || timerError) && <p className="form-error" role="alert">{scoringError ?? timerError}</p>}
    </fieldset>
  )
}