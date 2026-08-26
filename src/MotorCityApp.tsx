import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  ArrowRight,
  ArrowRightLeft,
  BarChart3,
  BookOpen,
  Boxes,
  Clock3,
  Factory,
  Flag,
  Gauge,
  LogOut,
  PackageCheck,
  Play,
  Plus,
  RotateCcw,
} from 'lucide-react'
import './Game.css'
import { ConverterPanel } from './components/ConverterPanel'
import { EndRunPanel } from './components/EndRunPanel'
import { GameBoard } from './components/GameBoard'
import { Modal } from './components/Modal'
import { NewRunPanel } from './components/NewRunPanel'
import { RecipePanel } from './components/RecipePanel'
import { RoundBriefing } from './components/RoundBriefing'
import { StatisticsPanel } from './components/StatisticsPanel'
import {
  advanceRound,
  allocateResources,
  convertResources,
  createGame,
  getCarStatus,
  getCompleted,
  getRevenue,
  getWip,
  moveCar,
  repositionCar,
  resetRound,
} from './game/engine'
import {
  RESOURCES,
  type GameState,
  type GameSetup,
  type Resource,
  type ResourcePool,
  type Stage,
} from './game/types'
import type { PlayerCommand } from './team/types'
import { roundTimerDurationSeconds } from './game/timer'
import {
  formatRoundCountdown,
  remainingRoundSeconds,
  roundTimerAnnouncement,
} from './team/roundTimer'

const STORAGE_KEY = 'motor-city-demo-game-v1'
const ENDED_STORAGE_KEY = 'motor-city-demo-game-ended-v1'

type NoticeTone = 'info' | 'error' | 'success'

interface Notice {
  message: string
  tone: NoticeTone
}

const OPENING_NOTICE: Notice = {
  message: 'Drag a car to the next station, or select it and pick a lane.',
  tone: 'info',
}

function loadGame(): GameState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const game = JSON.parse(saved) as GameState
      return {
        ...game,
        config: createGame({
          ...game.config,
          notes: game.config.notes ?? '',
        }).config,
      }
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY)
  }
  return createGame()
}

const loadSoloEnded = () =>
  localStorage.getItem(STORAGE_KEY) !== null
  && localStorage.getItem(ENDED_STORAGE_KEY) === '1'

interface ConfirmationPanelProps {
  message: string
  confirmLabel: string
  busy: boolean
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}

function ConfirmationPanel({
  message,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: ConfirmationPanelProps) {
  return (
    <div className="confirmation-panel">
      <p>{message}</p>
      <div className="modal-actions">
        <button className="button button-secondary" type="button" onClick={onCancel} disabled={busy}>Keep playing</button>
        <button className="button button-danger" type="button" onClick={() => void onConfirm()} disabled={busy}>{confirmLabel}</button>
      </div>
    </div>
  )
}

export interface RemoteGameController {
  game: GameState
  sessionLabel: string
  onCommand: (command: PlayerCommand) => Promise<string | null>
  onExit: () => void
  timer: {
    roundStartedAt: string | null
    roundTimedOut: boolean
    serverClock: {
      serverTimeMs: number
      monotonicTimeMs: number
    }
  }
}

interface MotorCityAppProps {
  remote?: RemoteGameController
  onExit?: () => void
}

function MotorCityApp({ remote, onExit }: MotorCityAppProps) {
  const [soloGame, setSoloGame] = useState<GameState>(loadGame)
  const [soloEnded, setSoloEnded] = useState(loadSoloEnded)
  const [selectedCarId, setSelectedCarId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(OPENING_NOTICE)
  const [busy, setBusy] = useState(false)
  const [timerNow, setTimerNow] = useState(
    () => remote?.timer.serverClock.serverTimeMs ?? Date.now(),
  )
  const [timerAnnouncement, setTimerAnnouncement] = useState('')
  const announcementRound = useRef<string | null>(null)
  const announcedThresholds = useRef(new Set<number>())
  const previousTimerRemaining = useRef<number | null>(null)
  const expiryAttempt = useRef<string | null>(null)
  const expiryRetryTimer = useRef<number | null>(null)
  const game = remote?.game ?? soloGame
  const [activeModal, setActiveModal] = useState<
    'new-run' | 'recipes' | 'converter' | 'statistics' | 'end-run' | 'briefing'
    | 'confirm-reset' | 'confirm-advance' | 'confirm-end' | null
  >(null)

  const announce = useCallback(
    (message: string, tone: NoticeTone = 'info') => setNotice({ message, tone }),
    [],
  )

  useEffect(() => {
    if (!remote) localStorage.setItem(STORAGE_KEY, JSON.stringify(soloGame))
  }, [remote, soloGame])

  useEffect(() => {
    if (!remote) localStorage.setItem(ENDED_STORAGE_KEY, soloEnded ? '1' : '0')
  }, [remote, soloEnded])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedCarId(null)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  useEffect(() => () => {
    if (expiryRetryTimer.current !== null) {
      window.clearTimeout(expiryRetryTimer.current)
    }
  }, [])

  const readyToMove = useMemo(
    () => game.cars.filter((car) => getCarStatus(game, car).canMove).length,
    [game],
  )

  const completedTotal = Object.values(getCompleted(game)).reduce(
    (total, value) => total + value,
    0,
  )
  const wipTotal = Object.values(getWip(game)).reduce(
    (total, value) => total + value,
    0,
  )
  const timerDuration = remote
    ? roundTimerDurationSeconds(game.config.timer, game.round + 1)
    : null
  const timerRemaining = remainingRoundSeconds(
    remote?.timer.roundStartedAt ?? null,
    timerDuration,
    timerNow,
    remote?.timer.roundTimedOut ?? false,
  )
  const controlsLocked = busy
    || Boolean(remote?.timer.roundTimedOut)
    || timerRemaining === 0
  const visibleModal = remote?.timer.roundTimedOut ? null : activeModal

  useEffect(() => {
    const startedAt = remote?.timer.roundStartedAt ?? null
    if (!startedAt || timerRemaining === null || timerRemaining === 0) {
      previousTimerRemaining.current = timerRemaining
      return
    }
    if (announcementRound.current !== startedAt) {
      announcementRound.current = startedAt
      announcedThresholds.current.clear()
      previousTimerRemaining.current = null
      setTimerAnnouncement('')
    }
    const announcement = roundTimerAnnouncement(
      previousTimerRemaining.current,
      timerRemaining,
    )
    previousTimerRemaining.current = timerRemaining
    if (
      announcement
      && !announcedThresholds.current.has(announcement.threshold)
    ) {
      announcedThresholds.current.add(announcement.threshold)
      setTimerAnnouncement(announcement.message)
    }
  }, [remote?.timer.roundStartedAt, timerRemaining])

  const handleSelectCar = (carId: string) => {
    setSelectedCarId((current) => (current === carId ? null : carId))
    const car = game.cars.find((candidate) => candidate.id === carId)
    if (car) announce(`${car.model} model selected.`)
  }

  const runRemoteCommand = async (
    command: PlayerCommand,
    successMessage: string,
  ) => {
    if (!remote) return 'No team session is connected.'
    setBusy(true)
    try {
      const error = await remote.onCommand(command)
      if (error) {
        announce(error, 'error')
        return error
      }
      announce(successMessage, 'success')
      return null
    } finally {
      setBusy(false)
    }
  }

  const expireRound = useEffectEvent(async () => {
    if (!remote) return 'No team session is connected.'
    setBusy(true)
    try {
      const error = await remote.onCommand({ type: 'timeout' })
      if (error) {
        announce(error, 'error')
        return error
      }
      announce('Time is up. Remaining materials were allocated.', 'success')
      return null
    } finally {
      setBusy(false)
    }
  })

  useEffect(() => {
    if (!remote?.timer.roundStartedAt || timerDuration === null || remote.timer.roundTimedOut) {
      return
    }
    const tick = () => setTimerNow(
      remote.timer.serverClock.serverTimeMs
      + performance.now()
      - remote.timer.serverClock.monotonicTimeMs,
    )
    tick()
    const timer = window.setInterval(tick, 1_000)
    return () => window.clearInterval(timer)
  }, [
    remote?.timer.roundStartedAt,
    remote?.timer.roundTimedOut,
    remote?.timer.serverClock.monotonicTimeMs,
    remote?.timer.serverClock.serverTimeMs,
    timerDuration,
  ])

  useEffect(() => {
    const startedAt = remote?.timer.roundStartedAt
    if (!remote || !startedAt || timerRemaining !== 0 || remote.timer.roundTimedOut) return
    const key = `${game.round}:${startedAt}`
    if (expiryAttempt.current === key) return
    expiryAttempt.current = key
    void expireRound().then((error) => {
      if (!error) return
      expiryRetryTimer.current = window.setTimeout(() => {
        if (expiryAttempt.current === key) expiryAttempt.current = null
        expiryRetryTimer.current = null
      }, 5_000)
    })
  }, [game.round, remote, timerNow, timerRemaining])

  useEffect(() => {
    if (remote?.timer.roundTimedOut) setActiveModal(null)
  }, [remote?.timer.roundTimedOut])

  const handleMove = async (carId: string, stage: Stage, row: number) => {
    if (remote) {
      const error = await runRemoteCommand(
        { type: 'move', carId, toStage: stage, toRow: row },
        `Car moved to ${stage}.`,
      )
      if (!error) setSelectedCarId(null)
      if (!error) setActiveModal(null)
      return
    }
    const result = moveCar(game, carId, stage, row)
    if (result.error) {
      announce(result.error, 'error')
      return
    }
    setSoloGame(result.state)
    setSelectedCarId(null)
    announce(`Car moved to ${stage}.`, 'success')
  }

  const handleReposition = async (carId: string, row: number) => {
    if (remote) {
      await runRemoteCommand(
        { type: 'reposition', carId, toRow: row },
        `Moved to lane ${row + 1}. Allocation runs top lane down.`,
      )
      return
    }
    const result = repositionCar(game, carId, row)
    if (result.error) {
      announce(result.error, 'error')
      return
    }
    setSoloGame(result.state)
    announce(`Moved to lane ${row + 1}. Allocation runs top lane down.`, 'success')
  }

  const handleAllocate = async () => {
    if (remote) {
      await runRemoteCommand(
        { type: 'allocate' },
        'Resources allocated from the top lane down.',
      )
      return
    }
    const next = allocateResources(game)
    const used = RESOURCES.reduce(
      (total, resource) => total + (game.resources[resource] - next.resources[resource]),
      0,
    )
    setSoloGame(next)
    announce(
      used > 0
        ? `${used} material${used === 1 ? '' : 's'} allocated from the top lane down.`
        : 'No station could take materials this round.',
      used > 0 ? 'success' : 'info',
    )
  }

  const handleAdvance = async () => {
    if (remote) {
      const error = await runRemoteCommand(
        { type: 'advance' },
        `Round ${game.round + 2} is live.`,
      )
      if (!error) {
        setSelectedCarId(null)
        setActiveModal('briefing')
      }
      return
    }
    setSoloGame((current) => advanceRound(current))
    setSelectedCarId(null)
    announce(`Round ${game.round + 2} is live.`, 'success')
    setActiveModal('briefing')
  }

  const handleReset = async () => {
    if (remote) {
      const error = await runRemoteCommand(
        { type: 'reset' },
        'Round restored to its starting position.',
      )
      if (!error) setSelectedCarId(null)
      return
    }
    setSoloGame((current) => resetRound(current))
    setSelectedCarId(null)
    setActiveModal(null)
    announce('Round restored to its starting position.')
  }

  const handleNewGame = (setup: GameSetup) => {
    setSoloGame(createGame(setup))
    setSelectedCarId(null)
    setSoloEnded(false)
    setNotice(OPENING_NOTICE)
    setActiveModal(null)
  }

  const finishSoloRun = () => {
    setSoloEnded(true)
    setActiveModal(null)
  }

  const openNewRunFromSummary = () => {
    setActiveModal('new-run')
  }

  const handleConvert = async (spend: ResourcePool, receive: Resource) => {
    if (remote) {
      return runRemoteCommand(
        { type: 'convert', spend, receive },
        `Four resources exchanged for one ${receive}.`,
      )
    }
    const result = convertResources(game, spend, receive)
    if (result.error) return result.error
    setSoloGame(result.state)
    announce(`Four resources exchanged for one ${receive}.`, 'success')
    return null
  }

  if (!remote && soloEnded) {
    return (
      <div className="solo-finished-shell">
        <header className="topbar">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">
              <Factory size={22} strokeWidth={1.8} />
            </span>
            <div><h1>Motor City</h1><p>Production complete</p></div>
          </div>
          <div className="shift-readout" aria-label="Final round">
            <div><span>Final round</span><strong>{String(game.round + 1).padStart(2, '0')}</strong></div>
          </div>
          <div className="topbar-actions">
            {onExit && (
              <button className="button button-quiet" type="button" onClick={onExit}>
                <LogOut size={17} aria-hidden="true" /> Home
              </button>
            )}
            <button className="button button-quiet" type="button" onClick={openNewRunFromSummary}>
              <Plus size={17} aria-hidden="true" /> New run
            </button>
          </div>
        </header>
        <main className="solo-finished-main">
          <section className="solo-finished-panel" aria-labelledby="final-run-title">
            <header>
              <p>Through round {game.round + 1}</p>
              <h2 id="final-run-title">Final run summary</h2>
            </header>
            <EndRunPanel
              game={game}
              showPenalty
              allowDownload
              onNewRun={openNewRunFromSummary}
              onExit={onExit}
            />
          </section>
        </main>
        <Modal open={activeModal === 'new-run'} eyebrow="Solo mode" title="New production run" onClose={() => setActiveModal(null)}>
          <NewRunPanel config={game.config} onStart={handleNewGame} onCancel={() => setActiveModal(null)} />
        </Modal>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <Factory size={22} strokeWidth={1.8} />
          </span>
          <div>
            <h1>Motor City</h1>
            <p>{remote?.sessionLabel ?? 'Supply game'}</p>
          </div>
        </div>

        <div className="shift-readout" aria-label="Round status">
          <div>
            <span>Round</span>
            <strong key={game.round} className="value-pulse">
              {String(game.round + 1).padStart(2, '0')}
            </strong>
          </div>
          {timerRemaining !== null && (
            <div
              className={timerRemaining === 0 ? 'round-timer timer-ended' : 'round-timer'}
              role="timer"
              aria-label={`${formatRoundCountdown(timerRemaining)} remaining`}
            >
              <span><Clock3 size={13} aria-hidden="true" /> {timerRemaining === 0 ? 'Time up' : 'Time left'}</span>
              <strong aria-hidden="true">{formatRoundCountdown(timerRemaining)}</strong>
            </div>
          )}
          <p className="sr-only" role="status" aria-live="polite">
            {timerAnnouncement}
          </p>
        </div>

        <div className="topbar-actions">
          {!remote && onExit && (
            <button className="button button-quiet" type="button" onClick={onExit}>
              <LogOut size={17} aria-hidden="true" /> Exit
            </button>
          )}
          <button
            className="button button-quiet"
            type="button"
            onClick={remote ? remote.onExit : () => setActiveModal('new-run')}
          >
            {remote ? <LogOut size={17} aria-hidden="true" /> : <Plus size={17} aria-hidden="true" />}
            {remote ? 'Leave team' : 'New run'}
          </button>
        </div>
      </header>

      <section className="operations-bar" aria-label="Current resources and actions">
        <div className="resource-list">
          {RESOURCES.map((resource) => (
            <div className={`resource resource-${resource}`} key={resource}>
              <span className="resource-swatch" aria-hidden="true" />
              <span>{resource} material</span>
              <strong
                key={`${game.round}-${game.resources[resource]}`}
                className="value-pulse"
              >
                {game.resources[resource]}
              </strong>
            </div>
          ))}
        </div>
        <div className="operation-actions">
          <button className="button button-secondary" type="button" onClick={() => setActiveModal('recipes')}>
            <BookOpen size={16} aria-hidden="true" /> Recipes
          </button>
          <button className="button button-secondary" type="button" onClick={() => setActiveModal('converter')}>
            <ArrowRightLeft size={16} aria-hidden="true" /> Converter
          </button>
          <button className="button button-primary" type="button" onClick={handleAllocate} disabled={controlsLocked}>
            <Play size={16} fill="currentColor" aria-hidden="true" /> Allocate
          </button>
        </div>
      </section>

      <main>
        <section className="summary-strip" aria-label="Run summary">
          <div><PackageCheck size={18} /><span>Completed</span><strong>{completedTotal}</strong></div>
          <div><Gauge size={18} /><span>Work in process</span><strong>{wipTotal}</strong></div>
          <div><BarChart3 size={18} /><span>Revenue</span><strong>${getRevenue(game).toFixed(2)}</strong></div>
          <div><Boxes size={18} /><span>Materials on hand</span><strong>{RESOURCES.reduce((sum, resource) => sum + game.resources[resource], 0)}</strong></div>
        </section>

        <div className="board-heading">
          <div>
            <p>Plant 01</p>
            <h2>Factory floor</h2>
          </div>
          <div className="board-heading-actions">
            <div className="board-legend" aria-label="Board status legend">
              <span className="ready-count">
                <i className="legend-ready" /> {readyToMove} ready to move
              </span>
              <span><i className="legend-wait" /> Waiting</span>
              <span><i className="legend-cure" /> Curing</span>
            </div>
            <button className="button button-secondary" type="button" onClick={() => setActiveModal('statistics')}>
              <BarChart3 size={16} aria-hidden="true" /> Statistics
            </button>
          </div>
        </div>

        <GameBoard
          game={game}
          selectedCarId={selectedCarId}
          busy={controlsLocked}
          onSelectCar={handleSelectCar}
          onMove={handleMove}
          onReposition={handleReposition}
          onBlocked={(message) => announce(message, 'error')}
        />
      </main>

      <footer className="command-dock">
        <button className="button button-quiet" type="button" onClick={() => setActiveModal('confirm-reset')} disabled={controlsLocked}>
          <RotateCcw size={17} aria-hidden="true" /> Reset round
        </button>
        <p className={`dock-notice notice-${notice.tone}`} role="status" aria-live="polite">
          {notice.message}
        </p>
        <button className="button button-end" type="button" onClick={() => setActiveModal(remote ? 'end-run' : 'confirm-end')} disabled={controlsLocked}>
          <Flag size={16} aria-hidden="true" /> {remote ? 'Summary' : 'End run'}
        </button>
        <button className="button button-next" type="button" onClick={() => setActiveModal('confirm-advance')} disabled={controlsLocked}>
          Next round <ArrowRight size={18} aria-hidden="true" />
        </button>
      </footer>

      <Modal open={visibleModal === 'new-run'} eyebrow="Solo mode" title="New production run" onClose={() => setActiveModal(null)}>
        <NewRunPanel config={game.config} onStart={handleNewGame} onCancel={() => setActiveModal(null)} />
      </Modal>
      <Modal
        open={visibleModal === 'briefing'}
        eyebrow={`Shift ${String(game.round + 1).padStart(2, '0')}`}
        title={`Round ${game.round + 1}`}
        onClose={() => setActiveModal(null)}
      >
        <RoundBriefing
          game={game}
          previous={game.history[game.history.length - 1] ?? null}
          onDismiss={() => setActiveModal(null)}
        />
      </Modal>
      <Modal
        open={Boolean(remote?.timer.roundTimedOut)}
        eyebrow={`Round ${game.round + 1}`}
        title="Time is up"
        onClose={() => undefined}
        dismissible={false}
      >
        <div className="timeout-panel">
          <Clock3 size={34} aria-hidden="true" />
          <p>Remaining materials were allocated automatically.</p>
          <button className="button button-primary" type="button" disabled={busy} onClick={() => void handleAdvance()}>
            Advance round <ArrowRight size={17} aria-hidden="true" />
          </button>
        </div>
      </Modal>
      <Modal open={visibleModal === 'recipes'} eyebrow="Reference" title="Model recipes" onClose={() => setActiveModal(null)} wide>
        <RecipePanel config={game.config} />
      </Modal>
      <Modal open={visibleModal === 'converter'} eyebrow="Materials" title="Resource converter" onClose={() => setActiveModal(null)}>
        <ConverterPanel resources={game.resources} onConvert={handleConvert} onClose={() => setActiveModal(null)} />
      </Modal>
      <Modal open={visibleModal === 'statistics'} eyebrow="Run performance" title="Round statistics" onClose={() => setActiveModal(null)} wide>
        <StatisticsPanel game={game} />
      </Modal>
      <Modal open={visibleModal === 'confirm-reset'} eyebrow="Restore checkpoint" title="Reset this round?" onClose={() => setActiveModal(null)}>
        <ConfirmationPanel
          message="This discards every move, allocation, and conversion made since this round began."
          confirmLabel="Reset round"
          busy={busy}
          onCancel={() => setActiveModal(null)}
          onConfirm={handleReset}
        />
      </Modal>
      <Modal open={visibleModal === 'confirm-advance'} eyebrow="Commit checkpoint" title={`Advance to round ${game.round + 2}?`} onClose={() => setActiveModal(null)}>
        <ConfirmationPanel
          message="This records the current factory state and delivers the next round of materials."
          confirmLabel="Advance round"
          busy={busy}
          onCancel={() => setActiveModal(null)}
          onConfirm={handleAdvance}
        />
      </Modal>
      <Modal open={visibleModal === 'confirm-end'} eyebrow="Finish solo run" title="End production?" onClose={() => setActiveModal(null)}>
        <ConfirmationPanel
          message="This locks the run and reveals the final score. You can download the results or start again from the summary."
          confirmLabel="Finish run"
          busy={false}
          onCancel={() => setActiveModal(null)}
          onConfirm={finishSoloRun}
        />
      </Modal>
      <Modal
        open={Boolean(remote) && visibleModal === 'end-run'}
        eyebrow={`Through round ${game.round + 1}`}
        title="Run progress"
        onClose={() => setActiveModal(null)}
        wide
      >
        <EndRunPanel
          game={game}
          onContinue={() => setActiveModal(null)}
          onNewRun={remote?.onExit ?? (() => setActiveModal(null))}
          newRunLabel="Leave team"
        />
      </Modal>
    </div>
  )
}

export default MotorCityApp