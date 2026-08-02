import { useCallback, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  BadgeCheck,
  ClipboardList,
  Cog,
  Flag,
  Hammer,
  Lock,
  Paintbrush,
} from 'lucide-react'
import { CarToken } from './CarToken'
import { useBoardDrag, type DropTarget } from './useBoardDrag'
import {
  BOARD_ROWS,
  getBoardActionError,
  getCarStatus,
  getLegalBoardTargets,
  getPaintBoothStatus,
  getRevenue,
} from '../game/engine'
import { STAGES, type GameState, type Stage } from '../game/types'

const STAGE_DETAILS = {
  planning: { label: 'Planning', note: 'Queue', icon: ClipboardList },
  manufacturing: { label: 'Manufacturing', note: 'Red / 1 round', icon: Hammer },
  assembly: { label: 'Assembly', note: 'Yellow / 1 round', icon: Cog },
  quality: { label: 'Quality', note: 'Blue / 1 round', icon: BadgeCheck },
  paint: { label: 'Paint', note: '2 rounds / max 3', icon: Paintbrush },
  done: { label: 'Done', note: 'Revenue posted', icon: Flag },
} as const

const LANE_STAGES = STAGES.filter((stage) => stage !== 'done')

interface GameBoardProps {
  game: GameState
  selectedCarId: string | null
  busy?: boolean
  onSelectCar: (carId: string) => void
  onMove: (carId: string, stage: Stage, row: number) => void
  onReposition: (carId: string, row: number) => void
  onBlocked: (message: string) => void
}

export function GameBoard({
  game,
  selectedCarId,
  busy = false,
  onSelectCar,
  onMove,
  onReposition,
  onBlocked,
}: GameBoardProps) {
  const isLegal = useCallback(
    (carId: string, target: DropTarget) =>
      getBoardActionError(game, carId, target.stage, target.row) === null,
    [game],
  )

  // A drop in the car's own station is a slide; anywhere else is a step forward.
  const commit = useCallback(
    (carId: string, stage: Stage, row: number) => {
      const car = game.cars.find((candidate) => candidate.id === carId)
      if (car && car.stage === stage) onReposition(carId, row)
      else onMove(carId, stage, row)
    },
    [game, onMove, onReposition],
  )

  const handleDrop = useCallback(
    (carId: string, target: DropTarget) => commit(carId, target.stage, target.row),
    [commit],
  )

  const handleReject = useCallback(
    (carId: string, target: DropTarget) => {
      const car = game.cars.find((candidate) => candidate.id === carId)
      // Putting a car back where it was is a change of mind, not an error.
      if (car && car.stage === target.stage && car.row === target.row) return
      const message = getBoardActionError(game, carId, target.stage, target.row)
      if (message) onBlocked(message)
    },
    [game, onBlocked],
  )

  const { drag, startDrag, consumeDragClick } = useBoardDrag({
    isLegal,
    onDrop: handleDrop,
    onReject: handleReject,
  })

  const handleSelect = useCallback(
    (carId: string) => {
      if (consumeDragClick()) return
      onSelectCar(carId)
    },
    [consumeDragClick, onSelectCar],
  )

  const statuses = useMemo(
    () => new Map(game.cars.map((car) => [car.id, getCarStatus(game, car)])),
    [game],
  )

  const activeCarId = drag?.carId ?? selectedCarId
  const activeCar = game.cars.find((car) => car.id === activeCarId)
  const legalKeys = useMemo(
    () =>
      new Set(
        getLegalBoardTargets(game, activeCarId ?? null).map(
          (move) => `${move.stage}:${move.row}`,
        ),
      ),
    [game, activeCarId],
  )

  const targetStage = activeCar
    ? STAGES[STAGES.indexOf(activeCar.stage) + 1]
    : undefined
  const canShip = activeCar !== undefined
    && legalKeys.has(`done:${activeCar.row}`)
  const booth = getPaintBoothStatus(game)
  const draggedCar = drag ? game.cars.find((car) => car.id === drag.carId) : undefined

  // A click target unmounts the moment it is used, so hand focus back to the car itself.
  const boardRef = useRef<HTMLDivElement>(null)
  const focusCarRef = useRef<{ carId: string; at: number } | null>(null)
  useEffect(() => {
    const intent = focusCarRef.current
    if (!intent) return
    focusCarRef.current = null
    // A rejected command never changes `game`, so a stale intent must not steal focus later.
    if (performance.now() - intent.at > 2000) return
    const token = document.querySelector<HTMLElement>(
      `[data-car-id="${CSS.escape(intent.carId)}"]`,
    )
    // A shipped car has no token left, so keep focus on the board rather than the page body.
    ;(token ?? boardRef.current)?.focus()
  }, [game])

  const moveAndFollow = useCallback(
    (carId: string, stage: Stage, row: number) => {
      focusCarRef.current = { carId, at: performance.now() }
      commit(carId, stage, row)
    },
    [commit],
  )

  const boothNote = booth.curing
    ? booth.cured > 0
      ? `Sealed / ${booth.cured} cured ready`
      : 'Sealed / cures next round'
    : booth.cured > 0
      ? `${booth.cured} cured / ship to done`
      : booth.occupancy > 0
        ? `Loading ${booth.occupancy} of ${booth.capacity}`
        : 'Booth open'

  return (
    <div
      className="board-scroll"
      ref={boardRef}
      role="group"
      tabIndex={-1}
      data-board-scroll=""
      aria-label="Factory floor"
    >
      <div className="factory-board">
        {LANE_STAGES.map((stage, stageIndex) => {
          const details = STAGE_DETAILS[stage]
          const StageIcon = details.icon
          const isTargetStage = stage === targetStage
          const isHomeStage = activeCar?.stage === stage
          const isDropColumn = isTargetStage || isHomeStage
          const occupancy = game.cars.filter((car) => car.stage === stage).length
          const isPaint = stage === 'paint'

          return (
            <section
              className={[
                'stage-column',
                `stage-${stage}`,
                isTargetStage && 'stage-target',
                isPaint && booth.curing && 'stage-sealed',
              ]
                .filter(Boolean)
                .join(' ')}
              key={stage}
              aria-labelledby={`stage-${stage}-title`}
            >
              <header>
                <div className="stage-number">
                  {String(stageIndex + 1).padStart(2, '0')}
                </div>
                <StageIcon size={19} strokeWidth={1.8} aria-hidden="true" />
                <div>
                  <h3 id={`stage-${stage}-title`}>{details.label}</h3>
                  <p>{details.note}</p>
                </div>
              </header>

              {isPaint ? (
                <div
                  className={`paint-status${booth.curing ? ' paint-status-sealed' : ''}`}
                >
                  <span className="paint-slots" aria-hidden="true">
                    {Array.from({ length: booth.capacity }, (_, slot) => (
                      <i
                        className={slot < booth.occupancy ? 'slot-filled' : ''}
                        key={slot}
                      />
                    ))}
                  </span>
                  <span className="paint-note">
                    {booth.curing && <Lock size={11} aria-hidden="true" />}
                    {boothNote}
                  </span>
                </div>
              ) : (
                <div className="stage-status">
                  <span className="stage-occupancy">
                    {occupancy} in station
                  </span>
                </div>
              )}

              <div className="stage-cells">
                {Array.from({ length: BOARD_ROWS }, (_, row) => {
                  const car = game.cars.find(
                    (candidate) =>
                      candidate.stage === stage && candidate.row === row,
                  )
                  const openTarget = legalKeys.has(`${stage}:${row}`)
                  const isHovered =
                    drag?.over?.stage === stage && drag.over.row === row
                  const isBlocked = Boolean(drag) && isDropColumn && !openTarget

                  const cellClass = [
                    'factory-cell',
                    car && 'cell-occupied',
                    isPaint && 'cell-bay',
                    openTarget && 'cell-open',
                    openTarget && isHomeStage && 'cell-slide',
                    isHovered && 'cell-hovered',
                    isBlocked && 'cell-blocked',
                  ]
                    .filter(Boolean)
                    .join(' ')

                  const laneNumber = (
                    <span className="lane-number">{row + 1}</span>
                  )

                  if (car) {
                    const status = statuses.get(car.id)!
                    return (
                      <div
                        className={cellClass}
                        key={row}
                        data-drop-stage={stage}
                        data-drop-row={row}
                      >
                        {laneNumber}
                        <CarToken
                          car={car}
                          status={status}
                          selected={car.id === selectedCarId}
                          dragging={drag?.carId === car.id}
                          onSelect={handleSelect}
                          onDragStart={busy ? undefined : startDrag}
                        />
                      </div>
                    )
                  }

                  if (openTarget && activeCarId) {
                    return (
                      <button
                        className={`${cellClass} move-target`}
                        type="button"
                        key={row}
                        disabled={busy}
                        data-drop-stage={stage}
                        data-drop-row={row}
                        onClick={() => moveAndFollow(activeCarId, stage, row)}
                        aria-label={
                          isHomeStage
                            ? `Slide to lane ${row + 1} of ${details.label}`
                            : `Move to ${details.label}, lane ${row + 1}`
                        }
                      >
                        {laneNumber}
                        <span className="target-ring" aria-hidden="true" />
                      </button>
                    )
                  }

                  return (
                    <div
                      className={cellClass}
                      key={row}
                      data-drop-stage={stage}
                      data-drop-row={row}
                    >
                      {laneNumber}
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}

        <ShippingBay
          game={game}
          open={canShip}
          busy={busy}
          hovered={drag?.over?.stage === 'done'}
          onShip={() =>
            activeCarId && activeCar
            && moveAndFollow(activeCarId, 'done', activeCar.row)
          }
          dropRow={activeCar?.row ?? 0}
        />
      </div>

      {drag && draggedCar
        && createPortal(
          <div
            className="drag-layer"
            style={{
              transform: `translate3d(${drag.x - drag.offsetX}px, ${drag.y - drag.offsetY}px, 0)`,
              width: drag.width,
              height: drag.height,
            }}
            data-blocked={drag.blocked ? 'true' : undefined}
          >
            <CarToken
              car={draggedCar}
              status={statuses.get(draggedCar.id)!}
              ghost
            />
          </div>,
          document.body,
        )}
    </div>
  )
}

interface ShippingBayProps {
  game: GameState
  open: boolean
  busy: boolean
  hovered: boolean
  dropRow: number
  onShip: () => void
}

function ShippingBay({ game, open, busy, hovered, dropRow, onShip }: ShippingBayProps) {
  const details = STAGE_DETAILS.done
  const StageIcon = details.icon
  const shipped = game.cars.filter((car) => car.stage === 'done')

  return (
    <section
      className={[
        'stage-column',
        'stage-done',
        open && 'stage-target',
        hovered && 'stage-hovered',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-labelledby="stage-done-title"
    >
      <header>
        <div className="stage-number">06</div>
        <StageIcon size={19} strokeWidth={1.8} aria-hidden="true" />
        <div>
          <h3 id="stage-done-title">{details.label}</h3>
          <p>{details.note}</p>
        </div>
      </header>

      <div className="stage-status">
        <span className="stage-occupancy">{shipped.length} shipped</span>
      </div>

      <div
        className={`shipping-bay${open ? ' bay-open' : ''}`}
        data-drop-stage="done"
        data-drop-row={dropRow}
      >
        <div className="ship-tally">
          {game.config.enabledModels.map((model) => (
            <div className={`ship-row ship-${model}`} key={model}>
              <span>{model}</span>
              <strong>
                {shipped.filter((car) => car.model === model).length}
              </strong>
            </div>
          ))}
        </div>

        <div className="ship-total">
          <span>Revenue posted</span>
          <strong>${getRevenue(game).toFixed(2)}</strong>
        </div>

        {open && (
          <button className="ship-action" type="button" disabled={busy} onClick={onShip}>
            <Flag size={15} aria-hidden="true" />
            Ship it
          </button>
        )}
      </div>
    </section>
  )
}
