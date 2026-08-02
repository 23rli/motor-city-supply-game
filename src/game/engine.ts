import {
  CAR_MODELS,
  RESOURCES,
  STAGES,
  type ActionResult,
  type Car,
  type CarModel,
  type GameConfig,
  type GameSnapshot,
  type GameState,
  type ModelValues,
  type Resource,
  type ResourcePool,
  type RoundSummary,
  type Stage,
} from './types'

export const BOARD_ROWS = 8
export const PAINT_CAPACITY = 3

export const RECIPES: Record<CarModel, ResourcePool> = {
  blue: { red: 3, yellow: 3, blue: 2 },
  green: { red: 2, yellow: 2, blue: 2 },
  red: { red: 3, yellow: 2, blue: 2 },
  yellow: { red: 2, yellow: 3, blue: 2 },
}

export const DEFAULT_REVENUE: ModelValues = {
  blue: 3,
  green: 2,
  red: 2.5,
  yellow: 2.5,
}

export const DEFAULT_WIP_PENALTY: ModelValues = {
  blue: 1.5,
  green: 1,
  red: 1.25,
  yellow: 1.25,
}

export const DEMO_RESOURCE_SCHEDULE: ResourcePool[] = [
  { red: 9, yellow: 7, blue: 3 },
  { red: 7, yellow: 8, blue: 4 },
  { red: 7, yellow: 8, blue: 3 },
  { red: 1, yellow: 8, blue: 2 },
  { red: 3, yellow: 7, blue: 3 },
  { red: 2, yellow: 6, blue: 2 },
  { red: 3, yellow: 7, blue: 1 },
  { red: 8, yellow: 5, blue: 4 },
  { red: 10, yellow: 2, blue: 2 },
  { red: 8, yellow: 7, blue: 1 },
]

export function createRandomResourceSchedule(
  rounds = 100,
  random = Math.random,
): ResourcePool[] {
  return Array.from({ length: rounds }, () => ({
    red: Math.floor(random() * 10) + 1,
    yellow: Math.floor(random() * 8) + 1,
    blue: Math.floor(random() * 4) + 1,
  }))
}

const EMPTY_RESOURCES: ResourcePool = { red: 0, yellow: 0, blue: 0 }

const clonePool = (pool: ResourcePool): ResourcePool => ({ ...pool })

const cloneCar = (car: Car): Car => ({
  ...car,
  resources: clonePool(car.resources),
})

const cloneSnapshot = (snapshot: GameSnapshot): GameSnapshot => ({
  ...snapshot,
  cars: snapshot.cars.map(cloneCar),
  resources: clonePool(snapshot.resources),
  convertedResources: clonePool(snapshot.convertedResources),
})

const makeCar = (
  model: CarModel,
  row: number,
  carNumber: number,
): Car => ({
  id: `${model}-${carNumber}`,
  model,
  stage: 'planning',
  row,
  resources: clonePool(EMPTY_RESOURCES),
  ready: true,
  completedRound: null,
})

const toSnapshot = (state: GameSnapshot): GameSnapshot => cloneSnapshot(state)

export function createGame(
  overrides: Partial<GameConfig> = {},
): GameState {
  const config: GameConfig = {
    enabledModels: [...(overrides.enabledModels ?? CAR_MODELS)],
    resourceSchedule: (
      overrides.resourceSchedule ?? DEMO_RESOURCE_SCHEDULE
    ).map(clonePool),
    revenue: { ...DEFAULT_REVENUE, ...overrides.revenue },
    wipPenalty: { ...DEFAULT_WIP_PENALTY, ...overrides.wipPenalty },
  }

  const cars = config.enabledModels.map((model, row) =>
    makeCar(model, row, row),
  )
  const resources = clonePool(
    config.resourceSchedule[0] ?? EMPTY_RESOURCES,
  )
  const initial: GameSnapshot = {
    round: 0,
    cars,
    resources,
    convertedResources: clonePool(resources),
    paintBatchStartedRound: null,
    nextCarNumber: cars.length,
  }

  return {
    ...cloneSnapshot(initial),
    config,
    checkpoint: cloneSnapshot(initial),
    history: [],
  }
}

const stageResource = (stage: Stage): Resource | null => {
  if (stage === 'manufacturing') return 'red'
  if (stage === 'assembly') return 'yellow'
  if (stage === 'quality') return 'blue'
  return null
}

const activeCars = (state: GameState): Car[] =>
  state.cars.filter((car) => car.stage !== 'done')

export function getCompleted(state: GameState): ModelValues {
  return CAR_MODELS.reduce<ModelValues>(
    (totals, model) => {
      totals[model] = state.cars.filter(
        (car) => car.model === model && car.stage === 'done',
      ).length
      return totals
    },
    { blue: 0, green: 0, red: 0, yellow: 0 },
  )
}

export function getWip(state: GameState): ModelValues {
  return CAR_MODELS.reduce<ModelValues>(
    (totals, model) => {
      totals[model] = state.cars.filter(
        (car) =>
          car.model === model &&
          car.stage !== 'planning' &&
          car.stage !== 'done',
      ).length
      return totals
    },
    { blue: 0, green: 0, red: 0, yellow: 0 },
  )
}

export function getRevenue(state: GameState): number {
  const completed = getCompleted(state)
  return CAR_MODELS.reduce(
    (total, model) => total + completed[model] * state.config.revenue[model],
    0,
  )
}

export function getProjectedPenalty(state: GameState): number {
  const wip = getWip(state)
  return CAR_MODELS.reduce(
    (total, model) => total + wip[model] * state.config.wipPenalty[model],
    0,
  )
}

export function getRoundSummary(state: GameState): RoundSummary {
  return {
    round: state.round,
    completed: getCompleted(state),
    revenue: getRevenue(state),
    wip: getWip(state),
    projectedPenalty: getProjectedPenalty(state),
    unusedResources: clonePool(state.resources),
  }
}

const moveError = (
  state: GameState,
  car: Car,
  toStage: Stage,
  toRow: number,
): string | null => {
  const fromIndex = STAGES.indexOf(car.stage)
  const toIndex = STAGES.indexOf(toStage)

  if (car.stage === 'done') return 'That car is already complete.'
  if (toIndex !== fromIndex + 1) return 'Cars move one station at a time.'
  if (!Number.isInteger(toRow) || toRow < 0 || toRow >= BOARD_ROWS) {
    return 'Choose a lane on the factory floor.'
  }

  const occupied = activeCars(state).some(
    (candidate) =>
      candidate.id !== car.id &&
      candidate.stage === toStage &&
      candidate.row === toRow,
  )
  if (occupied) return 'That station is already occupied.'

  const requiredResource = stageResource(car.stage)
  if (requiredResource) {
    const required = RECIPES[car.model][requiredResource]
    if (car.resources[requiredResource] < required) {
      return `This car still needs ${required - car.resources[requiredResource]} ${requiredResource} resource${required - car.resources[requiredResource] === 1 ? '' : 's'}.`
    }
  }

  if (car.stage !== 'planning' && !car.ready) {
    return 'This car must remain at its station until the next round.'
  }

  if (toStage === 'paint') {
    const paintCount = activeCars(state).filter(
      (candidate) => candidate.stage === 'paint',
    ).length
    if (paintCount >= PAINT_CAPACITY) return 'Paint can hold three cars.'
    if (state.paintBatchStartedRound !== null) {
      return 'The paint booth is processing the current batch.'
    }
  }

  return null
}

export function moveCar(
  state: GameState,
  carId: string,
  toStage: Stage,
  toRow: number,
): ActionResult {
  const car = state.cars.find((candidate) => candidate.id === carId)
  if (!car) return { state, error: 'That car could not be found.' }

  const error = moveError(state, car, toStage, toRow)
  if (error) return { state, error }

  const cars = state.cars.map(cloneCar)
  const movingCar = cars.find((candidate) => candidate.id === carId)!
  const previousStage = movingCar.stage
  movingCar.stage = toStage
  movingCar.row = toRow
  movingCar.ready = toStage === 'done'
  movingCar.completedRound = toStage === 'done' ? state.round : null

  let nextCarNumber = state.nextCarNumber
  if (previousStage === 'planning') {
    cars.push(makeCar(movingCar.model, car.row, nextCarNumber))
    nextCarNumber += 1
  }

  return {
    state: { ...state, cars, nextCarNumber },
    error: null,
  }
}

export interface CarMove {
  stage: Stage
  row: number
}

export type CarPhase =
  | 'shipped'
  | 'cured'
  | 'curing'
  | 'queued'
  | 'ready'
  | 'awaiting-resources'
  | 'awaiting-round'

export interface CarStatus {
  phase: CarPhase
  resource: Resource | null
  held: number
  required: number
  shortfall: number
  canMove: boolean
}

export interface PaintBoothStatus {
  occupancy: number
  capacity: number
  curing: boolean
  cured: number
  queued: number
  acceptsNewCars: boolean
}

/** Same verdict `moveCar` would give, without performing the move. */
export function getMoveError(
  state: GameState,
  carId: string,
  toStage: Stage,
  toRow: number,
): string | null {
  const car = state.cars.find((candidate) => candidate.id === carId)
  if (!car) return 'That car could not be found.'
  return moveError(state, car, toStage, toRow)
}

export function getLegalMoves(state: GameState, carId: string | null): CarMove[] {
  const car = state.cars.find((candidate) => candidate.id === carId)
  if (!car) return []
  const nextStage = STAGES[STAGES.indexOf(car.stage) + 1]
  if (!nextStage) return []
  const moves: CarMove[] = []
  for (let row = 0; row < BOARD_ROWS; row += 1) {
    if (moveError(state, car, nextStage, row) === null) {
      moves.push({ stage: nextStage, row })
    }
  }
  return moves
}

export function getPaintBoothStatus(state: GameState): PaintBoothStatus {
  const inBooth = state.cars.filter((car) => car.stage === 'paint')
  const cured = inBooth.filter((car) => car.ready).length
  const curing = state.paintBatchStartedRound !== null
  return {
    occupancy: inBooth.length,
    capacity: PAINT_CAPACITY,
    curing,
    cured,
    queued: inBooth.length - cured,
    acceptsNewCars: !curing && inBooth.length < PAINT_CAPACITY,
  }
}

export function getCarStatus(state: GameState, car: Car): CarStatus {
  const resource = stageResource(car.stage)
  const required = resource ? RECIPES[car.model][resource] : 0
  const held = resource ? car.resources[resource] : 0
  const shortfall = Math.max(required - held, 0)
  const canMove = getLegalMoves(state, car.id).length > 0

  const phase: CarPhase = car.stage === 'done'
    ? 'shipped'
    : car.stage === 'paint'
      ? car.ready ? 'cured' : state.paintBatchStartedRound !== null ? 'curing' : 'queued'
      : shortfall > 0
        ? 'awaiting-resources'
        : car.stage !== 'planning' && !car.ready
          ? 'awaiting-round'
          : 'ready'

  return { phase, resource, held, required, shortfall, canMove }
}

const repositionError = (
  state: GameState,
  car: Car,
  toRow: number,
): string | null => {
  if (car.stage === 'done') return 'That car is already complete.'
  if (!Number.isInteger(toRow) || toRow < 0 || toRow >= BOARD_ROWS) {
    return 'Choose a lane on the factory floor.'
  }
  if (toRow === car.row) return 'That car is already in that lane.'
  const occupied = activeCars(state).some(
    (candidate) =>
      candidate.id !== car.id
      && candidate.stage === car.stage
      && candidate.row === toRow,
  )
  return occupied ? 'That lane is already occupied.' : null
}

/**
 * Slides a car to another lane of the station it already occupies, the way a hand moves a
 * piece on the physical board. Station, materials, and cure timing are deliberately untouched;
 * only allocation order (which runs top lane down) changes.
 */
export function repositionCar(
  state: GameState,
  carId: string,
  toRow: number,
): ActionResult {
  const car = state.cars.find((candidate) => candidate.id === carId)
  if (!car) return { state, error: 'That car could not be found.' }

  const error = repositionError(state, car, toRow)
  if (error) return { state, error }

  const cars = state.cars.map(cloneCar)
  cars.find((candidate) => candidate.id === carId)!.row = toRow
  return { state: { ...state, cars }, error: null }
}

/** Verdict for either board gesture: a slide within a station, or a step forward. */
export function getBoardActionError(
  state: GameState,
  carId: string,
  toStage: Stage,
  toRow: number,
): string | null {
  const car = state.cars.find((candidate) => candidate.id === carId)
  if (!car) return 'That car could not be found.'
  return toStage === car.stage
    ? repositionError(state, car, toRow)
    : moveError(state, car, toStage, toRow)
}

export function getLegalRepositions(state: GameState, carId: string | null): CarMove[] {
  const car = state.cars.find((candidate) => candidate.id === carId)
  if (!car || car.stage === 'done') return []
  const targets: CarMove[] = []
  for (let row = 0; row < BOARD_ROWS; row += 1) {
    if (repositionError(state, car, row) === null) {
      targets.push({ stage: car.stage, row })
    }
  }
  return targets
}

/** Every lane the player may drop this car into, in its own station or the next one. */
export function getLegalBoardTargets(state: GameState, carId: string | null): CarMove[] {
  return [...getLegalRepositions(state, carId), ...getLegalMoves(state, carId)]
}

export function allocateResources(state: GameState): GameState {
  const cars = state.cars.map(cloneCar)
  const resources = clonePool(state.resources)
  const stageByResource: Record<Resource, Stage> = {
    red: 'manufacturing',
    yellow: 'assembly',
    blue: 'quality',
  }

  for (const resource of RESOURCES) {
    const candidates = cars
      .filter((car) => car.stage === stageByResource[resource])
      .sort((left, right) => left.row - right.row)

    for (const car of candidates) {
      const needed = RECIPES[car.model][resource] - car.resources[resource]
      const allocated = Math.min(Math.max(needed, 0), resources[resource])
      car.resources[resource] += allocated
      resources[resource] -= allocated
    }
  }

  return { ...state, cars, resources }
}

export function convertResources(
  state: GameState,
  spend: ResourcePool,
  receive: Resource,
): ActionResult {
  const spendTotal = RESOURCES.reduce(
    (total, resource) => total + spend[resource],
    0,
  )
  if (spendTotal !== 4) {
    return { state, error: 'Select exactly four resources to exchange.' }
  }
  if (
    RESOURCES.some(
      (resource) =>
        spend[resource] < 0 || spend[resource] > state.resources[resource],
    )
  ) {
    return { state, error: 'You cannot exchange resources you do not have.' }
  }

  const resources = clonePool(state.resources)
  const convertedResources = clonePool(state.convertedResources)
  for (const resource of RESOURCES) {
    resources[resource] -= spend[resource]
    convertedResources[resource] -= spend[resource]
  }
  resources[receive] += 1
  convertedResources[receive] += 1

  return {
    state: { ...state, resources, convertedResources },
    error: null,
  }
}

export function advanceRound(state: GameState): GameState {
  const cars = state.cars.map(cloneCar)
  let paintBatchStartedRound = state.paintBatchStartedRound

  for (const car of cars) {
    const resource = stageResource(car.stage)
    if (resource && car.resources[resource] >= RECIPES[car.model][resource]) {
      car.ready = true
    }
  }

  const paintCars = cars.filter((car) => car.stage === 'paint' && !car.ready)
  if (paintBatchStartedRound === null && paintCars.length > 0) {
    paintBatchStartedRound = state.round
  } else if (
    paintBatchStartedRound !== null &&
    state.round - paintBatchStartedRound >= 1
  ) {
    for (const car of paintCars) car.ready = true
    paintBatchStartedRound = null
  }

  const round = state.round + 1
  const resources = clonePool(
    state.config.resourceSchedule[round] ?? EMPTY_RESOURCES,
  )
  const nextSnapshot: GameSnapshot = {
    round,
    cars,
    resources,
    convertedResources: clonePool(resources),
    paintBatchStartedRound,
    nextCarNumber: state.nextCarNumber,
  }

  return {
    ...cloneSnapshot(nextSnapshot),
    config: state.config,
    checkpoint: toSnapshot(nextSnapshot),
    history: [...state.history, getRoundSummary(state)],
  }
}

export function resetRound(state: GameState): GameState {
  return {
    ...cloneSnapshot(state.checkpoint),
    config: state.config,
    checkpoint: cloneSnapshot(state.checkpoint),
    history: [...state.history],
  }
}