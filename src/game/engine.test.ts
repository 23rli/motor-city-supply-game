import { describe, expect, it } from 'vitest'
import {
  RECIPES,
  advanceRound,
  allocateResources,
  convertResources,
  createGame,
  createRandomResourceSchedule,
  getCompleted,
  getRevenue,
  getWip,
  moveCar,
  resetRound,
} from './engine'

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