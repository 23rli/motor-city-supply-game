import {
  BadgeCheck,
  ClipboardList,
  Cog,
  Flag,
  Hammer,
  Paintbrush,
} from 'lucide-react'
import { CarToken } from './CarToken'
import { BOARD_ROWS } from '../game/engine'
import { CAR_MODELS, STAGES, type GameState, type Stage } from '../game/types'

const STAGE_DETAILS = {
  planning: { label: 'Planning', note: 'Ready now', icon: ClipboardList },
  manufacturing: { label: 'Manufacturing', note: 'Red / 1 round', icon: Hammer },
  assembly: { label: 'Assembly', note: 'Yellow / 1 round', icon: Cog },
  quality: { label: 'Quality', note: 'Blue / 1 round', icon: BadgeCheck },
  paint: { label: 'Paint', note: '2 rounds / max 3', icon: Paintbrush },
  done: { label: 'Done', note: 'Revenue posted', icon: Flag },
} as const

interface GameBoardProps {
  game: GameState
  selectedCarId: string | null
  onSelectCar: (carId: string) => void
  onMove: (stage: Stage, row: number) => void
}

export function GameBoard({ game, selectedCarId, onSelectCar, onMove }: GameBoardProps) {
  const selectedCar = game.cars.find((car) => car.id === selectedCarId)
  const targetStage = selectedCar
    ? STAGES[STAGES.indexOf(selectedCar.stage) + 1]
    : undefined

  return (
    <div className="board-scroll" aria-label="Factory floor">
      <div className="factory-board">
        {STAGES.map((stage, stageIndex) => {
          const details = STAGE_DETAILS[stage]
          const StageIcon = details.icon
          const isTargetStage = stage === targetStage
          return (
            <section
              className={`stage-column stage-${stage}${isTargetStage ? ' stage-target' : ''}`}
              key={stage}
              aria-labelledby={`stage-${stage}-title`}
            >
              <header>
                <div className="stage-number">{String(stageIndex + 1).padStart(2, '0')}</div>
                <StageIcon size={19} strokeWidth={1.8} aria-hidden="true" />
                <div><h3 id={`stage-${stage}-title`}>{details.label}</h3><p>{details.note}</p></div>
              </header>

              <div className="stage-cells">
                {Array.from({ length: BOARD_ROWS }, (_, row) => {
                  const car = game.cars.find(
                    (candidate) => candidate.stage === stage && candidate.row === row,
                  )
                  if (car && stage !== 'done') {
                    return (
                      <div className="factory-cell cell-occupied" key={row}>
                        <span className="lane-number">{row + 1}</span>
                        <CarToken car={car} selected={car.id === selectedCarId} onSelect={onSelectCar} />
                      </div>
                    )
                  }
                  if (isTargetStage) {
                    return (
                      <button
                        className="factory-cell move-target"
                        type="button"
                        key={row}
                        onClick={() => onMove(stage, row)}
                        aria-label={`Move selected car to ${details.label}, lane ${row + 1}`}
                      >
                        <span className="lane-number">{row + 1}</span>
                        <span className="target-ring" aria-hidden="true">+</span>
                      </button>
                    )
                  }
                  if (stage === 'done' && row < CAR_MODELS.length) {
                    const model = CAR_MODELS[row]
                    const count = game.cars.filter(
                      (candidate) => candidate.stage === 'done' && candidate.model === model,
                    ).length
                    return (
                      <div className="factory-cell completed-cell" key={row}>
                        <span className="lane-number">{row + 1}</span>
                        <span className={`completion-model completion-${model}`}>{model}</span>
                        <strong>{count}</strong>
                      </div>
                    )
                  }
                  return <div className="factory-cell" key={row}><span className="lane-number">{row + 1}</span></div>
                })}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}