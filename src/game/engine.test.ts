import { describe, expect, it } from 'vitest'
import {
  BOARD_ROWS,
  RECIPES,
  advanceRound,
  allocateResources,
  convertResources,
  createGame,
  createRandomResourceSchedule,
  getCarStatus,
  getCompleted,
  getBoardActionError,
  getLegalBoardTargets,
  getLegalMoves,
  getLegalRepositions,
  getMoveError,
  getPaintBoothStatus,
  getRevenue,
  getStationCounts,
  getWip,
  moveCar,
  repositionCar,
  resetRound,
} from './engine'
import { ROUND_STATIONS, STAGES, type GameState } from './types'

const abundantRounds = Array.from({ length: 12 }, () => ({
  red: 20,
  yellow: 20,
  blue: 20,
}))

const prepareCarsAtQuality = (models: ('blue' | 'green' | 'red' | 'yellow')[]) => {
  let state = createGame({
    enabledModels: models,
    resourceSchedule: abundantRounds,
  })
  const carIds = [...state.cars.map((car) => car.id)]
  for (const [row, carId] of carIds.entries()) {
    state = moveCar(state, carId, 'manufacturing', row).state
  }
  state = allocateResources(state)
  state = advanceRound(state)
  for (const [row, carId] of carIds.entries()) {
    state = moveCar(state, carId, 'assembly', row).state
  }
  state = allocateResources(state)
  state = advanceRound(state)
  for (const [row, carId] of carIds.entries()) {
    state = moveCar(state, carId, 'quality', row).state
  }
  state = allocateResources(state)
  state = advanceRound(state)
  return { state, carIds }
}

describe('Motor City parity engine', () => {
  it('preserves the original random resource ranges', () => {
    expect(createRandomResourceSchedule(2, () => 0.5)).toEqual([
      { red: 6, yellow: 5, blue: 3 },
      { red: 6, yellow: 5, blue: 3 },
    ])
  })

  it('preserves the four original car recipes', () => {
    expect(RECIPES).toEqual({
      blue: { red: 3, yellow: 3, blue: 2 },
      green: { red: 2, yellow: 2, blue: 2 },
      red: { red: 3, yellow: 2, blue: 2 },
      yellow: { red: 2, yellow: 3, blue: 2 },
    })
  })

  it('replenishes planning when a car enters manufacturing', () => {
    const initial = createGame({ enabledModels: ['green'] })
    const firstCar = initial.cars[0]
    const result = moveCar(initial, firstCar.id, 'manufacturing', 3)

    expect(result.error).toBeNull()
    expect(result.state.cars).toHaveLength(2)
    expect(result.state.cars).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'manufacturing', row: 3 }),
        expect.objectContaining({ stage: 'planning', row: 0 }),
      ]),
    )
  })

  it('allocates scarce resources from the top row down', () => {
    let state = createGame({
      enabledModels: ['green'],
      resourceSchedule: [{ red: 2, yellow: 0, blue: 0 }],
    })
    state = moveCar(state, state.cars[0].id, 'manufacturing', 5).state
    const nextPlanningCar = state.cars.find((car) => car.stage === 'planning')!
    state = moveCar(state, nextPlanningCar.id, 'manufacturing', 1).state
    state = allocateResources(state)

    const topCar = state.cars.find(
      (car) => car.stage === 'manufacturing' && car.row === 1,
    )!
    const lowerCar = state.cars.find(
      (car) => car.stage === 'manufacturing' && car.row === 5,
    )!
    expect(topCar.resources.red).toBe(2)
    expect(lowerCar.resources.red).toBe(0)
  })

  it('requires a completed station and one round of wait before moving', () => {
    let state = createGame({
      enabledModels: ['green'],
      resourceSchedule: abundantRounds,
    })
    const carId = state.cars[0].id
    state = moveCar(state, carId, 'manufacturing', 0).state
    state = allocateResources(state)

    expect(moveCar(state, carId, 'assembly', 0).error).toContain('next round')
    state = advanceRound(state)
    expect(moveCar(state, carId, 'assembly', 0).error).toBeNull()
  })

  it('exchanges any four available resources for one resource', () => {
    const state = createGame({
      enabledModels: ['green'],
      resourceSchedule: [{ red: 4, yellow: 2, blue: 1 }],
    })
    const result = convertResources(
      state,
      { red: 2, yellow: 2, blue: 0 },
      'blue',
    )

    expect(result.error).toBeNull()
    expect(result.state.resources).toEqual({ red: 2, yellow: 0, blue: 2 })
  })

  it('keeps cars in paint for the original two-round cycle', () => {
    let state = createGame({
      enabledModels: ['green'],
      resourceSchedule: abundantRounds,
    })
    const carId = state.cars[0].id

    state = moveCar(state, carId, 'manufacturing', 0).state
    state = allocateResources(state)
    state = advanceRound(state)
    state = moveCar(state, carId, 'assembly', 0).state
    state = allocateResources(state)
    state = advanceRound(state)
    state = moveCar(state, carId, 'quality', 0).state
    state = allocateResources(state)
    state = advanceRound(state)
    state = moveCar(state, carId, 'paint', 0).state

    state = advanceRound(state)
    expect(moveCar(state, carId, 'done', 0).error).toContain('next round')
    state = advanceRound(state)
    const completed = moveCar(state, carId, 'done', 0)
    expect(completed.error).toBeNull()
    expect(getCompleted(completed.state).green).toBe(1)
    expect(getRevenue(completed.state)).toBe(2)
  })

  it('accepts three paint cars and rejects a fourth', () => {
    let { state, carIds } = prepareCarsAtQuality([
      'blue',
      'green',
      'red',
      'yellow',
    ])
    for (const [row, carId] of carIds.slice(0, 3).entries()) {
      state = moveCar(state, carId, 'paint', row).state
    }

    expect(moveCar(state, carIds[3], 'paint', 3).error).toBe(
      'Paint can hold three cars.',
    )
  })

  it('blocks new paint entries while a smaller batch is processing', () => {
    let { state, carIds } = prepareCarsAtQuality(['blue', 'green', 'red'])
    state = moveCar(state, carIds[0], 'paint', 0).state
    state = moveCar(state, carIds[1], 'paint', 1).state
    state = advanceRound(state)

    expect(moveCar(state, carIds[2], 'paint', 2).error).toBe(
      'The paint booth is processing the current batch.',
    )
  })

  it('restores the exact beginning-of-round checkpoint', () => {
    const initial = createGame({ enabledModels: ['green'] })
    let changed = moveCar(
      initial,
      initial.cars[0].id,
      'manufacturing',
      4,
    ).state
    changed = allocateResources(changed)
    const reset = resetRound(changed)

    expect(reset.cars).toEqual(initial.cars)
    expect(reset.resources).toEqual(initial.resources)
    expect(getWip(reset).green).toBe(0)
  })
})

describe('board selectors', () => {
  it('never disagrees with the move it is describing', () => {
    const { state, carIds } = prepareCarsAtQuality(['blue', 'green'])
    const probed = [...carIds, 'missing-car']

    for (const carId of probed) {
      for (const stage of STAGES) {
        for (let row = 0; row < BOARD_ROWS; row += 1) {
          expect(getMoveError(state, carId, stage, row)).toBe(
            moveCar(state, carId, stage, row).error,
          )
        }
      }
    }
  })

  it('offers every free lane in the next stage and nowhere else', () => {
    const state = createGame({ enabledModels: ['green'] })

    expect(getLegalMoves(state, state.cars[0].id)).toEqual(
      Array.from({ length: BOARD_ROWS }, (_, row) => ({
        stage: 'manufacturing',
        row,
      })),
    )
  })

  it('drops lanes that are already occupied', () => {
    let state = createGame({ enabledModels: ['green', 'blue'] })
    state = moveCar(state, state.cars[0].id, 'manufacturing', 5).state
    const waiting = state.cars.find(
      (car) => car.stage === 'planning' && car.model === 'blue',
    )!

    expect(getLegalMoves(state, waiting.id).map((move) => move.row)).toEqual([
      0, 1, 2, 3, 4, 6, 7,
    ])
  })

  it('offers nothing while a car is short on resources or still dwelling', () => {
    let state = createGame({
      enabledModels: ['green'],
      resourceSchedule: [{ red: 0, yellow: 0, blue: 0 }, ...abundantRounds],
    })
    state = moveCar(state, state.cars[0].id, 'manufacturing', 0).state
    const carId = state.cars.find((car) => car.stage === 'manufacturing')!.id

    expect(getCarStatus(state, state.cars[0]).phase).toBe('awaiting-resources')
    expect(getLegalMoves(state, carId)).toEqual([])

    state = advanceRound(state)
    state = allocateResources(state)
    expect(getCarStatus(state, state.cars[0]).phase).toBe('awaiting-round')
    expect(getLegalMoves(state, carId)).toEqual([])

    state = advanceRound(state)
    expect(getCarStatus(state, state.cars[0]).phase).toBe('ready')
    expect(getLegalMoves(state, carId)).toHaveLength(BOARD_ROWS)
  })

  it('offers nothing once a car has shipped', () => {
    const state = createGame({ enabledModels: ['green'] })
    const shipped = { ...state.cars[0], stage: 'done' as const }

    expect(getCarStatus(state, shipped).phase).toBe('shipped')
    expect(
      getLegalMoves({ ...state, cars: [shipped] }, shipped.id),
    ).toEqual([])
  })

  it('tracks the paint booth through loading, curing, and cured', () => {
    let { state, carIds } = prepareCarsAtQuality(['blue', 'green', 'red', 'yellow'])

    expect(getPaintBoothStatus(state)).toEqual({
      occupancy: 0,
      capacity: 3,
      curing: false,
      cured: 0,
      queued: 0,
      acceptsNewCars: true,
    })

    state = moveCar(state, carIds[0], 'paint', 0).state
    state = moveCar(state, carIds[1], 'paint', 1).state
    expect(getPaintBoothStatus(state)).toMatchObject({
      occupancy: 2,
      curing: false,
      queued: 2,
      acceptsNewCars: true,
    })
    expect(getCarStatus(state, state.cars.find((car) => car.id === carIds[0])!).phase).toBe('queued')

    state = advanceRound(state)
    expect(getPaintBoothStatus(state)).toMatchObject({
      curing: true,
      cured: 0,
      acceptsNewCars: false,
    })
    expect(getCarStatus(state, state.cars.find((car) => car.id === carIds[0])!).phase).toBe('curing')
    expect(getLegalMoves(state, carIds[2])).toEqual([])

    state = advanceRound(state)
    expect(getPaintBoothStatus(state)).toMatchObject({
      curing: false,
      cured: 2,
      queued: 0,
      acceptsNewCars: true,
    })
    expect(getCarStatus(state, state.cars.find((car) => car.id === carIds[0])!).phase).toBe('cured')
    expect(getLegalMoves(state, carIds[0])).toHaveLength(BOARD_ROWS)
  })

  it('closes the booth to a fourth car without calling it a rule change', () => {
    let { state, carIds } = prepareCarsAtQuality(['blue', 'green', 'red', 'yellow'])
    for (const [row, carId] of carIds.slice(0, 3).entries()) {
      state = moveCar(state, carId, 'paint', row).state
    }

    expect(getPaintBoothStatus(state).acceptsNewCars).toBe(false)
    expect(getLegalMoves(state, carIds[3])).toEqual([])
    expect(getMoveError(state, carIds[3], 'paint', 3)).toBe(
      'Paint can hold three cars.',
    )
  })

  it('reports resource progress for the station a car is standing in', () => {
    let state = createGame({
      enabledModels: ['blue'],
      resourceSchedule: [{ red: 2, yellow: 0, blue: 0 }, ...abundantRounds],
    })
    state = moveCar(state, state.cars[0].id, 'manufacturing', 0).state
    state = allocateResources(state)
    const car = state.cars.find((candidate) => candidate.stage === 'manufacturing')!

    expect(getCarStatus(state, car)).toMatchObject({
      resource: 'red',
      held: 2,
      required: RECIPES.blue.red,
      shortfall: 1,
      canMove: false,
    })
  })
})

describe('sliding a car within its station', () => {
  it('changes only the lane, never the station, materials, or cure timing', () => {
    let state = createGame({
      enabledModels: ['green'],
      resourceSchedule: abundantRounds,
    })
    state = moveCar(state, state.cars[0].id, 'manufacturing', 0).state
    state = allocateResources(state)
    state = advanceRound(state)
    const before = state.cars.find((car) => car.stage === 'manufacturing')!

    const result = repositionCar(state, before.id, 6)
    const after = result.state.cars.find((car) => car.id === before.id)!

    expect(result.error).toBeNull()
    expect(after).toEqual({ ...before, row: 6 })
    expect(after.ready).toBe(true)
  })

  it('never spawns a replacement when a planning car only changes lane', () => {
    const state = createGame({ enabledModels: ['green', 'blue'] })
    const planning = state.cars[0]

    const result = repositionCar(state, planning.id, 5)

    expect(result.error).toBeNull()
    expect(result.state.cars).toHaveLength(state.cars.length)
    expect(result.state.nextCarNumber).toBe(state.nextCarNumber)
  })

  it('re-orders who gets scarce materials first', () => {
    const scarce = [{ red: 2, yellow: 0, blue: 0 }, ...abundantRounds]
    let state = createGame({ enabledModels: ['green', 'blue'], resourceSchedule: scarce })
    const [first, second] = state.cars.map((car) => car.id)
    state = moveCar(state, first, 'manufacturing', 0).state
    state = moveCar(state, second, 'manufacturing', 1).state

    const asPlaced = allocateResources(state)
    expect(asPlaced.cars.find((car) => car.id === first)!.resources.red).toBe(2)
    expect(asPlaced.cars.find((car) => car.id === second)!.resources.red).toBe(0)

    // Slide the second car above the first; allocation runs top lane down.
    let swapped = repositionCar(state, first, 4).state
    swapped = repositionCar(swapped, second, 0).state
    const reordered = allocateResources(swapped)

    expect(reordered.cars.find((car) => car.id === second)!.resources.red).toBe(2)
    expect(reordered.cars.find((car) => car.id === first)!.resources.red).toBe(0)
  })

  it('refuses an occupied lane, a shipped car, and an off-board lane', () => {
    let state = createGame({ enabledModels: ['green', 'blue'] })
    const [first, second] = state.cars.map((car) => car.id)
    state = moveCar(state, first, 'manufacturing', 2).state
    state = moveCar(state, second, 'manufacturing', 3).state

    expect(repositionCar(state, first, 3).error).toBe('That lane is already occupied.')
    expect(repositionCar(state, first, 8).error).toBe('Choose a lane on the factory floor.')
    expect(repositionCar(state, 'nope', 1).error).toBe('That car could not be found.')

    const shipped = { ...state.cars[0], stage: 'done' as const }
    expect(repositionCar({ ...state, cars: [shipped] }, shipped.id, 1).error).toBe(
      'That car is already complete.',
    )
  })

  it('lets a car pass another in the same station without disturbing it', () => {
    let state = createGame({ enabledModels: ['green', 'blue'] })
    const [first, second] = state.cars.map((car) => car.id)
    state = moveCar(state, first, 'manufacturing', 0).state
    state = moveCar(state, second, 'manufacturing', 1).state
    const untouched = state.cars.find((car) => car.id === second)!

    const result = repositionCar(state, first, 7)

    expect(result.error).toBeNull()
    expect(result.state.cars.find((car) => car.id === second)).toEqual(untouched)
  })

  it('offers a drop target for every free lane beside the car and ahead of it', () => {
    let state = createGame({ enabledModels: ['green'], resourceSchedule: abundantRounds })
    state = moveCar(state, state.cars[0].id, 'manufacturing', 3).state
    state = allocateResources(state)
    state = advanceRound(state)
    const carId = state.cars.find((car) => car.stage === 'manufacturing')!.id

    const slides = getLegalRepositions(state, carId)
    expect(slides.map((target) => target.row)).toEqual([0, 1, 2, 4, 5, 6, 7])
    expect(slides.every((target) => target.stage === 'manufacturing')).toBe(true)

    // The union is what the board offers: seven slides plus eight lanes forward.
    expect(getLegalBoardTargets(state, carId)).toHaveLength(15)
  })

  it('agrees with the action it describes, for slides and steps alike', () => {
    let state = createGame({ enabledModels: ['green', 'blue'], resourceSchedule: abundantRounds })
    state = moveCar(state, state.cars[0].id, 'manufacturing', 2).state
    const carId = state.cars.find((car) => car.stage === 'manufacturing')!.id

    for (let row = 0; row < BOARD_ROWS; row += 1) {
      expect(getBoardActionError(state, carId, 'manufacturing', row)).toBe(
        repositionCar(state, carId, row).error,
      )
      expect(getBoardActionError(state, carId, 'assembly', row)).toBe(
        moveCar(state, carId, 'assembly', row).error,
      )
    }
  })

  it('offers exactly the lanes it would accept, and no others', () => {
    let state = createGame({ enabledModels: ['green', 'blue'], resourceSchedule: abundantRounds })
    state = moveCar(state, state.cars[0].id, 'manufacturing', 2).state
    state = moveCar(state, state.cars[1].id, 'manufacturing', 5).state

    for (const car of state.cars) {
      const offered = new Set(
        getLegalBoardTargets(state, car.id).map((target) => `${target.stage}:${target.row}`),
      )
      for (const stage of STAGES) {
        for (let row = 0; row < BOARD_ROWS; row += 1) {
          expect(offered.has(`${stage}:${row}`)).toBe(
            getBoardActionError(state, car.id, stage, row) === null,
          )
        }
      }
    }
  })

  it('treats a car dropped back into its own lane as a non-move', () => {
    let state = createGame({ enabledModels: ['green'] })
    state = moveCar(state, state.cars[0].id, 'manufacturing', 4).state
    const car = state.cars.find((candidate) => candidate.stage === 'manufacturing')!

    expect(repositionCar(state, car.id, car.row).error).toBe(
      'That car is already in that lane.',
    )
    expect(getBoardActionError(state, car.id, car.stage, car.row)).toBe(
      'That car is already in that lane.',
    )
  })
})

describe('round record', () => {
  const totalOf = (values: Record<string, number>) =>
    Object.values(values).reduce((sum, value) => sum + value, 0)

  const stationTotal = (state: GameState) =>
    ROUND_STATIONS.reduce(
      (sum, station) => sum + totalOf(getStationCounts(state)[station]),
      0,
    )

  it('counts every car still on the floor exactly once', () => {
    let state = createGame({ enabledModels: ['blue', 'green', 'red', 'yellow'] })
    const onFloor = () => state.cars.filter((car) => car.stage !== 'done').length

    expect(stationTotal(state)).toBe(onFloor())

    for (let round = 0; round < 4; round += 1) {
      for (const car of state.cars.filter((item) => item.stage === 'planning').slice(0, 2)) {
        const result = moveCar(state, car.id, 'manufacturing', car.row)
        if (!result.error) state = result.state
      }
      state = allocateResources(state)
      state = advanceRound(state)
      expect(stationTotal(state)).toBe(onFloor())
    }
  })

  it('separates cars still curing from cars that have dried', () => {
    const prepared = prepareCarsAtQuality(['green'])
    let state = prepared.state
    const [carId] = prepared.carIds
    state = moveCar(state, carId, 'paint', 0).state

    expect(totalOf(getStationCounts(state).paint)).toBe(1)
    expect(totalOf(getStationCounts(state).dry)).toBe(0)

    state = allocateResources(state)
    state = advanceRound(state)
    state = allocateResources(state)
    state = advanceRound(state)

    expect(totalOf(getStationCounts(state).dry)).toBe(getPaintBoothStatus(state).cured)
  })

  it('records the resources issued and exchanged alongside what was left over', () => {
    let state = createGame({ enabledModels: ['green'] })
    state = allocateResources(state)
    state = advanceRound(state)

    const [first] = state.history
    expect(first.issuedResources).toEqual(state.config.resourceSchedule[0])
    expect(first.convertedResources).toBeDefined()
    expect(first.unusedResources).toBeDefined()
  })
})