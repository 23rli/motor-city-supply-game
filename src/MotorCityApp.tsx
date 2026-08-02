import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  ArrowRightLeft,
  BarChart3,
  BookOpen,
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
import { NewRunPanel, type ResourcePlan } from './components/NewRunPanel'
import { RecipePanel } from './components/RecipePanel'
import { RoundBriefing } from './components/RoundBriefing'
import { StatisticsPanel } from './components/StatisticsPanel'
import {
  advanceRound,
  allocateResources,
  convertResources,
  createGame,
  createRandomResourceSchedule,
  getCarStatus,
  getCompleted,
  getProjectedPenalty,
  getRevenue,
  getWip,
  moveCar,
  repositionCar,
  resetRound,
} from './game/engine'
import {
  RESOURCES,
  type CarModel,
  type GameState,
  type Resource,
  type ResourcePool,
  type Stage,
} from './game/types'
import type { PlayerCommand } from './team/types'

const STORAGE_KEY = 'motor-city-demo-game-v1'

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
    if (saved) return JSON.parse(saved) as GameState
  } catch {
    localStorage.removeItem(STORAGE_KEY)
  }
  return createGame()
}

export interface RemoteGameController {
  game: GameState
  sessionLabel: string
  onCommand: (command: PlayerCommand) => Promise<string | null>
  onExit: () => void
}

interface MotorCityAppProps {
  remote?: RemoteGameController
  onExit?: () => void
}

function MotorCityApp({ remote, onExit }: MotorCityAppProps) {
  const [soloGame, setSoloGame] = useState<GameState>(loadGame)
  const [selectedCarId, setSelectedCarId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(OPENING_NOTICE)
  const [busy, setBusy] = useState(false)
  const game = remote?.game ?? soloGame
  const [activeModal, setActiveModal] = useState<
    'new-run' | 'recipes' | 'converter' | 'statistics' | 'end-run' | 'briefing' | null
  >(null)

  const announce = useCallback(
    (message: string, tone: NoticeTone = 'info') => setNotice({ message, tone }),
    [],
  )

  useEffect(() => {
    if (!remote) localStorage.setItem(STORAGE_KEY, JSON.stringify(soloGame))
  }, [remote, soloGame])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedCarId(null)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
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

  const handleMove = async (carId: string, stage: Stage, row: number) => {
    if (remote) {
      const error = await runRemoteCommand(
        { type: 'move', carId, toStage: stage, toRow: row },
        `Car moved to ${stage}.`,
      )
      if (!error) setSelectedCarId(null)
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
    announce('Round restored to its starting position.')
  }

  const handleNewGame = (models: CarModel[], resourcePlan: ResourcePlan) => {
    setSoloGame(createGame({
      enabledModels: models,
      resourceSchedule: resourcePlan === 'random'
        ? createRandomResourceSchedule()
        : undefined,
    }))
    setSelectedCarId(null)
    setNotice(OPENING_NOTICE)
    setActiveModal(null)
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
          <button className="button button-primary" type="button" onClick={handleAllocate} disabled={busy}>
            <Play size={16} fill="currentColor" aria-hidden="true" /> Allocate
          </button>
        </div>
      </section>

      <main>
        <section className="summary-strip" aria-label="Run summary">
          <div><PackageCheck size={18} /><span>Completed</span><strong>{completedTotal}</strong></div>
          <div><Gauge size={18} /><span>Work in process</span><strong>{wipTotal}</strong></div>
          <div><BarChart3 size={18} /><span>Revenue</span><strong>${getRevenue(game).toFixed(2)}</strong></div>
          <div><i className="penalty-dot" /><span>WIP exposure</span><strong>${getProjectedPenalty(game).toFixed(2)}</strong></div>
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
          busy={busy}
          onSelectCar={handleSelectCar}
          onMove={handleMove}
          onReposition={handleReposition}
          onBlocked={(message) => announce(message, 'error')}
        />
      </main>

      <footer className="command-dock">
        <button className="button button-quiet" type="button" onClick={handleReset} disabled={busy}>
          <RotateCcw size={17} aria-hidden="true" /> Reset round
        </button>
        <p className={`dock-notice notice-${notice.tone}`} role="status" aria-live="polite">
          {notice.message}
        </p>
        <button className="button button-end" type="button" onClick={() => setActiveModal('end-run')}>
          <Flag size={16} aria-hidden="true" /> {remote ? 'Summary' : 'End run'}
        </button>
        <button className="button button-next" type="button" onClick={handleAdvance} disabled={busy}>
          Next round <ArrowRight size={18} aria-hidden="true" />
        </button>
      </footer>

      <Modal open={activeModal === 'new-run'} eyebrow="Solo mode" title="New production run" onClose={() => setActiveModal(null)}>        <NewRunPanel enabledModels={game.config.enabledModels} onStart={handleNewGame} onCancel={() => setActiveModal(null)} />
      </Modal>
      <Modal
        open={activeModal === 'briefing'}
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
      <Modal open={activeModal === 'recipes'} eyebrow="Reference" title="Model recipes" onClose={() => setActiveModal(null)} wide>
        <RecipePanel config={game.config} />
      </Modal>
      <Modal open={activeModal === 'converter'} eyebrow="Materials" title="Resource converter" onClose={() => setActiveModal(null)}>
        <ConverterPanel resources={game.resources} onConvert={handleConvert} onClose={() => setActiveModal(null)} />
      </Modal>
      <Modal open={activeModal === 'statistics'} eyebrow="Run performance" title="Round statistics" onClose={() => setActiveModal(null)} wide>
        <StatisticsPanel game={game} />
      </Modal>
      <Modal open={activeModal === 'end-run'} eyebrow={`Through round ${game.round + 1}`} title="Run summary" onClose={() => setActiveModal(null)} wide>
        <EndRunPanel
          game={game}
          onContinue={() => setActiveModal(null)}
          onNewRun={remote ? remote.onExit : () => setActiveModal('new-run')}
          newRunLabel={remote ? 'Leave team' : 'New run'}
        />
      </Modal>
    </div>
  )
}

export default MotorCityApp