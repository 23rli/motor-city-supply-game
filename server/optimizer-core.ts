import { createRequire } from 'node:module'
import {
  BOARD_ROWS,
  PAINT_CAPACITY,
  RECIPES,
  advanceRound,
  allocateResources,
  convertResources,
  createGame,
  getLegalMoves,
  getRoundSummary,
  moveCar,
  repositionCar,
} from '../src/game/engine'
import {
  CAR_MODELS,
  RESOURCES,
  type Car,
  type CarModel,
  type GameState,
  type ModelValues,
  type Resource,
  type ResourcePool,
  type Stage,
} from '../src/game/types'
import type { TeamExportPlayer } from '../src/team/types'
import { calculatePlayerReport } from './report'
import type { OptimizationInput } from './session-store-core'

const FACTORY_STAGES = ['manufacturing', 'assembly', 'quality'] as const
type FactoryStage = (typeof FACTORY_STAGES)[number]
type Allocation = Record<Resource, ModelValues>
type SolverProof = 'optimal' | 'feasible'

const STAGE_RESOURCE: Record<FactoryStage, Resource> = {
  manufacturing: 'red',
  assembly: 'yellow',
  quality: 'blue',
}

interface Term {
  name: string
  coefficient: number
}

interface OptimizationRound {
  enterManufacturing: ModelValues
  toAssembly: ModelValues
  toQuality: ModelValues
  toPaint: ModelValues
  shipped: ModelValues
  allocation: Allocation
  convertedResources: ResourcePool
}

interface OptimizationWitness {
  proof: SolverProof
  objective: number
  rounds: OptimizationRound[]
}

export interface OptimizationSolution {
  proof: SolverProof
  player: TeamExportPlayer
  solveTimeMs: number
}

export interface OptimizationOptions {
  timeLimitSeconds?: number
}

interface ConversionStep {
  spend: ResourcePool
  receive: Resource
}

interface HighsColumn {
  Primal?: number
}

interface HighsResult {
  Status: string
  ObjectiveValue: number
  Columns: Record<string, HighsColumn>
}

interface HighsInstance {
  solve(problem: string, options: Record<string, unknown>): HighsResult
}

type HighsLoader = () => Promise<HighsInstance>
const loadHiGHS = createRequire(import.meta.url)('highs') as HighsLoader

class LinearModel {
  private readonly constraints: string[] = []
  private readonly bounds: string[] = []
  private readonly generals = new Set<string>()
  private readonly binaries = new Set<string>()

  variable(name: string, upper: number, kind: 'integer' | 'binary' = 'integer') {
    if (kind === 'binary') {
      this.binaries.add(name)
      return name
    }
    this.bounds.push(` 0 <= ${name} <= ${formatNumber(upper)}`)
    this.generals.add(name)
    return name
  }

  constraint(
    name: string,
    terms: Term[],
    relation: '<=' | '>=' | '=',
    right: number,
  ) {
    this.constraints.push(
      ` ${name}: ${formatTerms(terms)} ${relation} ${formatNumber(right)}`,
    )
  }

  render(direction: 'Maximize' | 'Minimize', objective: Term[]) {
    return [
      direction,
      ` score: ${formatTerms(objective)}`,
      'Subject To',
      ...this.constraints,
      'Bounds',
      ...this.bounds,
      ...(this.generals.size > 0
        ? ['General', ...chunk([...this.generals], 16).map((names) => ` ${names.join(' ')}`)]
        : []),
      ...(this.binaries.size > 0
        ? ['Binary', ...chunk([...this.binaries], 16).map((names) => ` ${names.join(' ')}`)]
        : []),
      'End',
    ].join('\n')
  }
}

const chunk = <T>(values: T[], size: number) => {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

const formatNumber = (value: number) => {
  if (!Number.isFinite(value)) throw new Error('The optimization model contains a non-finite number.')
  const normalized = Math.abs(value) < 1e-12 ? 0 : value
  return Number.isInteger(normalized) ? String(normalized) : String(normalized)
}

const formatTerms = (terms: Term[]) => {
  const combined = new Map<string, number>()
  for (const term of terms) {
    combined.set(term.name, (combined.get(term.name) ?? 0) + term.coefficient)
  }
  const entries = [...combined].filter(([, coefficient]) => Math.abs(coefficient) >= 1e-12)
  if (entries.length === 0) return '0'
  return entries.map(([name, coefficient], index) => {
    const sign = coefficient < 0 ? '-' : index === 0 ? '' : '+'
    const magnitude = Math.abs(coefficient)
    const factor = magnitude === 1 ? '' : `${formatNumber(magnitude)} `
    return `${sign}${sign ? ' ' : ''}${factor}${name}`
  }).join(' ')
}

const term = (name: string, coefficient = 1): Term => ({ name, coefficient })
const negate = (terms: Term[]) => terms.map(({ name, coefficient }) => ({
  name,
  coefficient: -coefficient,
}))

const enterName = (model: CarModel, round: number) => `enter_${model}_${round}`
const outName = (stage: FactoryStage, model: CarModel, round: number) =>
  `out_${stage}_${model}_${round}`
const doneName = (model: CarModel, round: number) => `done_${model}_${round}`
const batchName = (round: number) => `batch_${round}`
const conversionInventoryName = (
  resource: Resource,
  round: number,
  step: number,
) => `conversion_inventory_${resource}_${round}_${step}`
const conversionActiveName = (round: number, step: number) =>
  `conversion_active_${round}_${step}`
const conversionSpendName = (resource: Resource, round: number, step: number) =>
  `conversion_spend_${resource}_${round}_${step}`
const conversionReceiveName = (resource: Resource, round: number, step: number) =>
  `conversion_receive_${resource}_${round}_${step}`
const stockName = (
  stage: FactoryStage,
  model: CarModel,
  round: number,
  held: number,
) => `stock_${stage}_${model}_${round}_${held}`
const flowName = (
  stage: FactoryStage,
  model: CarModel,
  round: number,
  held: number,
  after: number,
) => `flow_${stage}_${model}_${round}_${held}_${after}`
const exhaustName = (resource: Resource, round: number) => `exhaust_${resource}_${round}`

const emptyPool = (): ResourcePool => ({ red: 0, yellow: 0, blue: 0 })
const emptyModels = (): ModelValues => ({ blue: 0, green: 0, red: 0, yellow: 0 })
const emptyAllocation = (): Allocation => ({
  red: emptyModels(),
  yellow: emptyModels(),
  blue: emptyModels(),
})

const poolKey = (pool: ResourcePool) => RESOURCES
  .map((resource) => pool[resource])
  .join(':')

function reachableConversionPools(initial: ResourcePool) {
  const queue: Array<{ pool: ResourcePool; steps: ConversionStep[] }> = [
    { pool: { ...initial }, steps: [] },
  ]
  const reachable = new Map<string, { pool: ResourcePool; steps: ConversionStep[] }>([
    [poolKey(initial), queue[0]],
  ])
  while (queue.length > 0) {
    const current = queue.shift()!
    for (let red = 0; red <= Math.min(4, current.pool.red); red += 1) {
      for (let yellow = 0; yellow <= Math.min(4 - red, current.pool.yellow); yellow += 1) {
        const blue = 4 - red - yellow
        if (blue < 0 || blue > current.pool.blue) continue
        const spend = { red, yellow, blue }
        for (const receive of RESOURCES) {
          const next = {
            red: current.pool.red - red + (receive === 'red' ? 1 : 0),
            yellow: current.pool.yellow - yellow + (receive === 'yellow' ? 1 : 0),
            blue: current.pool.blue - blue + (receive === 'blue' ? 1 : 0),
          }
          const key = poolKey(next)
          if (reachable.has(key)) continue
          const entry = {
            pool: next,
            steps: [...current.steps, { spend, receive }],
          }
          reachable.set(key, entry)
          queue.push(entry)
        }
      }
    }
  }
  return [...reachable.values()]
}

function toExportPlayer(
  state: GameState,
  input: OptimizationInput,
  proof: SolverProof,
): TeamExportPlayer {
  const metrics = calculatePlayerReport(state, input)
  return {
    id: `optimization-${input.endRound}-${input.penaltyRound}`,
    name: proof === 'optimal' ? 'Optimal Run' : 'Best Run Found',
    identifier: null,
    ...metrics,
    stateVersion: input.endRound,
    lastSeenAt: '1970-01-01T00:00:00.000Z',
    history: [...state.history, getRoundSummary(state)],
  }
}

function buildGreedyBaseline(input: OptimizationInput) {
  let state = createGame(input.config)
  const models = CAR_MODELS
    .filter((carModel) => input.config.enabledModels.includes(carModel))
    .sort((left, right) => (
      input.config.revenue[right] - input.config.revenue[left]
      || CAR_MODELS.indexOf(left) - CAR_MODELS.indexOf(right)
    ))

  const moveDownstream = (stage: Stage) => {
    const candidates = state.cars
      .filter((car) => car.stage === stage)
      .sort((left, right) => (
        models.indexOf(left.model) - models.indexOf(right.model)
        || left.row - right.row
      ))
    for (const car of candidates) {
      const legal = getLegalMoves(state, car.id)
      if (legal.length === 0) continue
      const result = moveCar(state, car.id, legal[0].stage, legal[0].row)
      if (!result.error) state = result.state
    }
  }

  for (let round = 0; round < input.endRound; round += 1) {
    moveDownstream('paint')
    moveDownstream('quality')
    moveDownstream('assembly')
    moveDownstream('manufacturing')

    if (input.endRound - round >= 6) {
      for (let lane = 0; lane < BOARD_ROWS; lane += 1) {
        const carModel = models.find((candidate) => input.config.revenue[candidate] > 0)
        if (!carModel) break
        const planning = state.cars.find((car) => (
          car.stage === 'planning' && car.model === carModel
        ))
        if (!planning) break
        const legal = getLegalMoves(state, planning.id)
        if (legal.length === 0) break
        const result = moveCar(state, planning.id, legal[0].stage, legal[0].row)
        if (result.error) break
        state = result.state
      }
    }

    let best = {
      steps: [] as ConversionStep[],
      score: Number.NEGATIVE_INFINITY,
    }
    for (const candidate of reachableConversionPools(state.resources)) {
      const before = state
      const allocated = allocateResources({
        ...state,
        resources: { ...candidate.pool },
        convertedResources: { ...candidate.pool },
      })
      const fullValue = allocated.cars.reduce((total, car) => {
        const stage = car.stage as FactoryStage
        if (!FACTORY_STAGES.includes(stage)) return total
        const resource = STAGE_RESOURCE[stage]
        return car.resources[resource] >= RECIPES[car.model][resource]
          ? total + input.config.revenue[car.model]
          : total
      }, 0)
      const used = RESOURCES.reduce(
        (total, resource) => total + candidate.pool[resource] - allocated.resources[resource],
        0,
      )
      const score = fullValue * 1_000 + used * 10 - candidate.steps.length
      if (score > best.score) best = { steps: candidate.steps, score }
      state = before
    }
    for (const step of best.steps) {
      const result = convertResources(state, step.spend, step.receive)
      if (result.error) throw new Error(`Greedy conversion failed: ${result.error}`)
      state = result.state
    }
    state = allocateResources(state)
    if (round + 1 < input.endRound) state = advanceRound(state)
  }
  return state
}

function buildIdleBaseline(input: OptimizationInput) {
  let state = createGame(input.config)
  for (let round = 1; round < input.endRound; round += 1) {
    state = advanceRound(state)
  }
  return state
}

const scheduleAt = (input: OptimizationInput, round: number) =>
  input.config.resourceSchedule[round] ?? emptyPool()

const maximumConversions = (pool: ResourcePool) => {
  const total = RESOURCES.reduce((sum, resource) => sum + pool[resource], 0)
  return total < 4 ? 0 : Math.floor((total - 1) / 3)
}

function allocationTerms(
  stage: FactoryStage,
  model: CarModel,
  round: number,
): Term[] {
  const resource = STAGE_RESOURCE[stage]
  const required = RECIPES[model][resource]
  const terms: Term[] = []
  for (let held = 0; held <= required; held += 1) {
    for (let after = held + 1; after <= required; after += 1) {
      terms.push(term(flowName(stage, model, round, held, after), after - held))
    }
  }
  return terms
}

function stockTerms(stage: FactoryStage, model: CarModel, round: number): Term[] {
  const required = RECIPES[model][STAGE_RESOURCE[stage]]
  return Array.from({ length: required + 1 }, (_, held) => (
    term(stockName(stage, model, round, held))
  ))
}

function buildOptimizationModel(input: OptimizationInput) {
  const model = new LinearModel()
  const models = CAR_MODELS.filter((carModel) => input.config.enabledModels.includes(carModel))
  const rounds = input.endRound
  const maximumRoundResources = Math.max(
    0,
    ...Array.from({ length: rounds }, (_, round) => (
      RESOURCES.reduce((sum, resource) => sum + scheduleAt(input, round)[resource], 0)
    )),
  )
  const bigM = Math.max(100, maximumRoundResources + BOARD_ROWS * 3)

  for (let round = 0; round < rounds; round += 1) {
    const pool = scheduleAt(input, round)
    const conversionSteps = maximumConversions(pool)

    for (const carModel of models) {
      model.variable(enterName(carModel, round), BOARD_ROWS)
      model.variable(doneName(carModel, round), PAINT_CAPACITY)
      for (const stage of FACTORY_STAGES) {
        model.variable(outName(stage, carModel, round), BOARD_ROWS)
        const required = RECIPES[carModel][STAGE_RESOURCE[stage]]
        for (let held = 0; held <= required; held += 1) {
          model.variable(stockName(stage, carModel, round, held), BOARD_ROWS)
          for (let after = held; after <= required; after += 1) {
            model.variable(flowName(stage, carModel, round, held, after), BOARD_ROWS)
          }
        }
      }
    }
    model.variable(batchName(round), 1, 'binary')
    for (let step = 0; step <= conversionSteps; step += 1) {
      for (const resource of RESOURCES) {
        model.variable(
          conversionInventoryName(resource, round, step),
          pool[resource] + conversionSteps,
        )
      }
      if (step === conversionSteps) continue
      model.variable(conversionActiveName(round, step), 1, 'binary')
      for (const resource of RESOURCES) {
        model.variable(conversionSpendName(resource, round, step), 4)
        model.variable(conversionReceiveName(resource, round, step), 1, 'binary')
      }
    }
    for (const resource of RESOURCES) {
      model.variable(exhaustName(resource, round), 1, 'binary')
    }
  }

  for (let round = 0; round < rounds; round += 1) {
    for (const [stageIndex, stage] of FACTORY_STAGES.entries()) {
      const resource = STAGE_RESOURCE[stage]
      const stationStock: Term[] = []
      const partialFlows: Term[] = []

      for (const carModel of models) {
        const required = RECIPES[carModel][resource]
        const outgoing = outName(stage, carModel, round)
        const previousFull = round > 0
          ? stockName(stage, carModel, round - 1, required)
          : null
        model.constraint(
          `ready_${stage}_${carModel}_${round}`,
          [term(outgoing), ...(previousFull ? [term(previousFull, -1)] : [])],
          '<=',
          0,
        )

        const incoming = stageIndex === 0
          ? enterName(carModel, round)
          : outName(FACTORY_STAGES[stageIndex - 1], carModel, round)

        for (let held = 0; held <= required; held += 1) {
          const flowOut = Array.from(
            { length: required - held + 1 },
            (_, offset) => term(flowName(stage, carModel, round, held, held + offset)),
          )
          const previous = round > 0
            ? stockName(stage, carModel, round - 1, held)
            : null
          model.constraint(
            `flow_balance_${stage}_${carModel}_${round}_${held}`,
            [
              ...flowOut,
              ...(previous ? [term(previous, -1)] : []),
              ...(held === required ? [term(outgoing)] : []),
              ...(held === 0 ? [term(incoming, -1)] : []),
            ],
            '=',
            0,
          )
        }

        for (let after = 0; after <= required; after += 1) {
          model.constraint(
            `stock_balance_${stage}_${carModel}_${round}_${after}`,
            [
              term(stockName(stage, carModel, round, after)),
              ...Array.from(
                { length: after + 1 },
                (_, held) => term(flowName(stage, carModel, round, held, after), -1),
              ),
            ],
            '=',
            0,
          )
          stationStock.push(term(stockName(stage, carModel, round, after)))
        }

        for (let held = 0; held <= required; held += 1) {
          for (let after = held + 1; after < required; after += 1) {
            partialFlows.push(term(flowName(stage, carModel, round, held, after)))
          }
        }
      }

      model.constraint(`capacity_${stage}_${round}`, stationStock, '<=', BOARD_ROWS)
      model.constraint(`partial_${resource}_${round}`, partialFlows, '<=', 1)
    }

    const conversionSteps = maximumConversions(scheduleAt(input, round))
    for (const resource of RESOURCES) {
      model.constraint(
        `conversion_initial_${resource}_${round}`,
        [term(conversionInventoryName(resource, round, 0))],
        '=',
        scheduleAt(input, round)[resource],
      )
    }
    for (let step = 0; step < conversionSteps; step += 1) {
      model.constraint(
        `conversion_spend_total_${round}_${step}`,
        [
          ...RESOURCES.map((resource) => term(conversionSpendName(resource, round, step))),
          term(conversionActiveName(round, step), -4),
        ],
        '=',
        0,
      )
      model.constraint(
        `conversion_receive_total_${round}_${step}`,
        [
          ...RESOURCES.map((resource) => term(conversionReceiveName(resource, round, step))),
          term(conversionActiveName(round, step), -1),
        ],
        '=',
        0,
      )
      if (step > 0) {
        model.constraint(
          `conversion_prefix_${round}_${step}`,
          [
            term(conversionActiveName(round, step)),
            term(conversionActiveName(round, step - 1), -1),
          ],
          '<=',
          0,
        )
      }
      for (const resource of RESOURCES) {
        model.constraint(
          `conversion_available_${resource}_${round}_${step}`,
          [
            term(conversionSpendName(resource, round, step)),
            term(conversionInventoryName(resource, round, step), -1),
          ],
          '<=',
          0,
        )
        model.constraint(
          `conversion_balance_${resource}_${round}_${step}`,
          [
            term(conversionInventoryName(resource, round, step + 1)),
            term(conversionInventoryName(resource, round, step), -1),
            term(conversionSpendName(resource, round, step)),
            term(conversionReceiveName(resource, round, step), -1),
          ],
          '=',
          0,
        )
      }
    }

    for (const resource of RESOURCES) {
      const used = models.flatMap((carModel) => (
        allocationTerms(FACTORY_STAGES[RESOURCES.indexOf(resource)], carModel, round)
      ))
      const demand = models.flatMap((carModel) => {
        const stage = FACTORY_STAGES[RESOURCES.indexOf(resource)]
        const required = RECIPES[carModel][resource]
        const incoming = resource === 'red'
          ? enterName(carModel, round)
          : outName(FACTORY_STAGES[RESOURCES.indexOf(resource) - 1], carModel, round)
        return Array.from({ length: required + 1 }, (_, held) => {
          const previous = round > 0
            ? stockName(stage, carModel, round - 1, held)
            : null
          const coefficient = required - held
          return [
            ...(previous ? [term(previous, coefficient)] : []),
            ...(held === required ? [term(outName(stage, carModel, round), -coefficient)] : []),
            ...(held === 0 ? [term(incoming, coefficient)] : []),
          ]
        }).flat()
      })
      const available = [term(conversionInventoryName(
        resource,
        round,
        conversionSteps,
      ))]
      model.constraint(
        `available_${resource}_${round}`,
        [...used, ...negate(available)],
        '<=',
        0,
      )
      model.constraint(
        `demand_${resource}_${round}`,
        [...used, ...negate(demand)],
        '<=',
        0,
      )
      model.constraint(
        `exhaust_pool_${resource}_${round}`,
        [...available, ...negate(used), term(exhaustName(resource, round), -bigM)],
        '<=',
        0,
      )
      model.constraint(
        `exhaust_demand_${resource}_${round}`,
        [
          ...demand,
          ...negate(used),
          term(exhaustName(resource, round), bigM),
        ],
        '<=',
        bigM,
      )
    }

    const paintEntries = models.map((carModel) => (
      term(outName('quality', carModel, round))
    ))
    model.constraint(
      `paint_upper_${round}`,
      [...paintEntries, term(batchName(round), -PAINT_CAPACITY)],
      '<=',
      0,
    )
    model.constraint(
      `paint_lower_${round}`,
      [...paintEntries, term(batchName(round), -1)],
      '>=',
      0,
    )
    if (round > 0) {
      model.constraint(
        `paint_cycle_${round}`,
        [term(batchName(round)), term(batchName(round - 1))],
        '<=',
        1,
      )
    }
    for (const carModel of models) {
      model.constraint(
        `shipped_${carModel}_${round}`,
        [
          term(doneName(carModel, round)),
          ...(round >= 2
            ? [term(outName('quality', carModel, round - 2), -1)]
            : []),
        ],
        '=',
        0,
      )
    }
  }

  const objective: Term[] = []
  const endIndex = input.endRound - 1
  const penaltyIndex = input.penaltyRound - 1
  for (const carModel of models) {
    for (let round = 0; round <= endIndex; round += 1) {
      objective.push(term(doneName(carModel, round), input.config.revenue[carModel]))
    }
    for (const stage of FACTORY_STAGES) {
      objective.push(...stockTerms(stage, carModel, penaltyIndex).map(({ name, coefficient }) => ({
        name,
        coefficient: -input.config.wipPenalty[carModel] * coefficient,
      })))
    }
    objective.push(term(
      outName('quality', carModel, penaltyIndex),
      -input.config.wipPenalty[carModel],
    ))
    if (penaltyIndex > 0) {
      objective.push(term(
        outName('quality', carModel, penaltyIndex - 1),
        -input.config.wipPenalty[carModel],
      ))
    }
  }

  return {
    lp: model.render('Maximize', objective),
    models,
  }
}

const solutionValue = (
  columns: Record<string, { Primal?: number }> | undefined,
  name: string,
) => Math.max(0, Math.round(columns?.[name]?.Primal ?? 0))

function witnessFromSolution(
  input: OptimizationInput,
  models: CarModel[],
  status: string,
  objective: number,
  columns: Record<string, { Primal?: number }>,
): OptimizationWitness {
  const proof: SolverProof = status === 'Optimal' ? 'optimal' : 'feasible'
  const rounds = Array.from({ length: input.endRound }, (_, round): OptimizationRound => {
    const counts = (name: (carModel: CarModel) => string) => {
      const values = emptyModels()
      for (const carModel of models) values[carModel] = solutionValue(columns, name(carModel))
      return values
    }
    const allocation = emptyAllocation()
    for (const resource of RESOURCES) {
      const stage = FACTORY_STAGES[RESOURCES.indexOf(resource)]
      for (const carModel of models) {
        allocation[resource][carModel] = Math.round(
          allocationTerms(stage, carModel, round).reduce(
            (sum, item) => sum + item.coefficient * (columns[item.name]?.Primal ?? 0),
            0,
          ),
        )
      }
    }
    const convertedResources = emptyPool()
    const conversionSteps = maximumConversions(scheduleAt(input, round))
    for (const resource of RESOURCES) {
      convertedResources[resource] = solutionValue(
        columns,
        conversionInventoryName(resource, round, conversionSteps),
      )
    }
    return {
      enterManufacturing: counts((carModel) => enterName(carModel, round)),
      toAssembly: counts((carModel) => outName('manufacturing', carModel, round)),
      toQuality: counts((carModel) => outName('assembly', carModel, round)),
      toPaint: counts((carModel) => outName('quality', carModel, round)),
      shipped: counts((carModel) => doneName(carModel, round)),
      allocation,
      convertedResources,
    }
  })
  return { proof, objective, rounds }
}

interface PlannedCar {
  key: string
  model: CarModel
  held: number
  incoming: boolean
}

function replayWitness(input: OptimizationInput, witness: OptimizationWitness): TeamExportPlayer {
  let state = createGame(input.config)
  const models = CAR_MODELS.filter((carModel) => input.config.enabledModels.includes(carModel))

  const selectedCars = (stage: Stage, counts: ModelValues) => {
    const selected: Car[] = []
    for (const carModel of models) {
      const resource = FACTORY_STAGES.includes(stage as FactoryStage)
        ? STAGE_RESOURCE[stage as FactoryStage]
        : null
      const eligible = state.cars.filter((car) => (
        car.stage === stage
        && car.model === carModel
        && car.ready
        && (!resource || car.resources[resource] >= RECIPES[carModel][resource])
      ))
      if (eligible.length < counts[carModel]) {
        throw new Error(`Round ${state.round + 1} cannot move enough ${carModel} cars from ${stage}.`)
      }
      selected.push(...eligible.slice(0, counts[carModel]))
    }
    return selected
  }

  const move = (carId: string, toStage: Stage, row: number) => {
    const result = moveCar(state, carId, toStage, row)
    if (result.error) throw new Error(`Round ${state.round + 1}: ${result.error}`)
    state = result.state
  }

  const reposition = (carId: string, row: number) => {
    const result = repositionCar(state, carId, row)
    if (result.error) throw new Error(`Round ${state.round + 1}: ${result.error}`)
    state = result.state
  }

  const convertTo = (target: ResourcePool) => {
    const match = reachableConversionPools(state.resources)
      .find((candidate) => poolKey(candidate.pool) === poolKey(target))
    if (!match) throw new Error(`Round ${state.round + 1} has no legal exchange sequence.`)
    for (const step of match.steps) {
      const result = convertResources(state, step.spend, step.receive)
      if (result.error) throw new Error(`Round ${state.round + 1}: ${result.error}`)
      state = result.state
    }
  }

  const allocationOrder = (
    cars: PlannedCar[],
    resource: Resource,
    available: number,
    target: ModelValues,
  ) => {
    const search = (
      remaining: PlannedCar[],
      pool: number,
      totals: ModelValues,
      order: PlannedCar[],
    ): PlannedCar[] | null => {
      if (remaining.length === 0) {
        return CAR_MODELS.every((carModel) => totals[carModel] === target[carModel])
          ? order
          : null
      }
      const seen = new Set<string>()
      for (let index = 0; index < remaining.length; index += 1) {
        const car = remaining[index]
        const needed = Math.max(RECIPES[car.model][resource] - car.held, 0)
        const signature = `${car.model}:${needed}:${car.incoming}`
        if (seen.has(signature)) continue
        seen.add(signature)
        const allocated = Math.min(needed, pool)
        if (totals[car.model] + allocated > target[car.model]) continue
        const found = search(
          [...remaining.slice(0, index), ...remaining.slice(index + 1)],
          pool - allocated,
          { ...totals, [car.model]: totals[car.model] + allocated },
          [...order, car],
        )
        if (found) return found
      }
      return null
    }
    const order = search(cars, available, emptyModels(), [])
    if (!order) throw new Error(`Round ${state.round + 1} has no legal ${resource} allocation order.`)
    return order
  }

  const arrangeExisting = (stage: FactoryStage, targets: Map<string, number>) => {
    for (const [carId, targetRow] of targets) {
      let car = state.cars.find((candidate) => candidate.id === carId)!
      if (car.row === targetRow) continue
      const blocker = state.cars.find((candidate) => (
        candidate.stage === stage
        && candidate.row === targetRow
        && candidate.id !== carId
      ))
      if (blocker) {
        const occupied = new Set(
          state.cars.filter((candidate) => candidate.stage === stage).map((candidate) => candidate.row),
        )
        const emptyRow = Array.from({ length: BOARD_ROWS }, (_, row) => row)
          .find((row) => !occupied.has(row))
        if (emptyRow === undefined) {
          throw new Error(`Round ${state.round + 1} cannot reorder a full ${stage} station.`)
        }
        reposition(blocker.id, emptyRow)
      }
      car = state.cars.find((candidate) => candidate.id === carId)!
      if (car.row !== targetRow) reposition(carId, targetRow)
    }
  }

  const planStage = (
    stage: FactoryStage,
    outgoing: Car[],
    incoming: PlannedCar[],
    target: ModelValues,
  ) => {
    const outgoingIds = new Set(outgoing.map((car) => car.id))
    const existing = state.cars
      .filter((car) => car.stage === stage && !outgoingIds.has(car.id))
      .map((car) => ({
        key: car.id,
        model: car.model,
        held: car.resources[STAGE_RESOURCE[stage]],
        incoming: false,
        row: car.row,
      }))
    const resource = STAGE_RESOURCE[stage]
    let order: PlannedCar[]
    if (existing.length === BOARD_ROWS && incoming.length === 0) {
      order = [...existing].sort((left, right) => left.row - right.row)
      const remaining = { ...state.resources }
      const allocated = emptyModels()
      for (const car of order) {
        const amount = Math.min(
          RECIPES[car.model][resource] - car.held,
          remaining[resource],
        )
        allocated[car.model] += amount
        remaining[resource] -= amount
      }
      if (!CAR_MODELS.every((carModel) => allocated[carModel] === target[carModel])) {
        throw new Error(`Round ${state.round + 1} cannot change priority in a full ${stage} station.`)
      }
    } else {
      order = allocationOrder([...existing, ...incoming], resource, state.resources[resource], target)
    }
    arrangeExisting(
      stage,
      new Map(order.flatMap((car, row) => car.incoming ? [] : [[car.key, row] as const])),
    )
    return new Map(
      order.flatMap((car, row) => car.incoming ? [[car.key, row] as const] : []),
    )
  }

  const allocationDelta = (before: GameState, after: GameState) => {
    const delta = emptyAllocation()
    for (const afterCar of after.cars) {
      const beforeCar = before.cars.find((car) => car.id === afterCar.id)
      if (!beforeCar) continue
      for (const resource of RESOURCES) {
        delta[resource][afterCar.model] += afterCar.resources[resource] - beforeCar.resources[resource]
      }
    }
    return delta
  }

  for (let round = 0; round < input.endRound; round += 1) {
    const action = witness.rounds[round]
    convertTo(action.convertedResources)

    for (const car of selectedCars('paint', action.shipped)) move(car.id, 'done', 0)
    const leavingQuality = selectedCars('quality', action.toPaint)
    const leavingAssembly = selectedCars('assembly', action.toQuality)
    const leavingManufacturing = selectedCars('manufacturing', action.toAssembly)

    let paintRow = 0
    for (const car of leavingQuality) {
      while (state.cars.some((candidate) => (
        candidate.stage === 'paint' && candidate.row === paintRow
      ))) paintRow += 1
      move(car.id, 'paint', paintRow)
    }

    const qualityTargets = planStage(
      'quality',
      leavingQuality,
      leavingAssembly.map((car) => ({
        key: car.id,
        model: car.model,
        held: car.resources.blue,
        incoming: true,
      })),
      action.allocation.blue,
    )
    for (const car of leavingAssembly) move(car.id, 'quality', qualityTargets.get(car.id)!)

    const assemblyTargets = planStage(
      'assembly',
      leavingAssembly,
      leavingManufacturing.map((car) => ({
        key: car.id,
        model: car.model,
        held: car.resources.yellow,
        incoming: true,
      })),
      action.allocation.yellow,
    )
    for (const car of leavingManufacturing) move(car.id, 'assembly', assemblyTargets.get(car.id)!)

    const planning: PlannedCar[] = []
    for (const carModel of models) {
      for (let index = 0; index < action.enterManufacturing[carModel]; index += 1) {
        planning.push({ key: `planning_${carModel}_${index}`, model: carModel, held: 0, incoming: true })
      }
    }
    const manufacturingTargets = planStage(
      'manufacturing',
      leavingManufacturing,
      planning,
      action.allocation.red,
    )
    for (const planned of planning) {
      const planningCar = state.cars.find((car) => (
        car.stage === 'planning' && car.model === planned.model
      ))
      if (!planningCar) throw new Error(`Round ${round + 1} has no ${planned.model} planning car.`)
      move(planningCar.id, 'manufacturing', manufacturingTargets.get(planned.key)!)
    }

    const beforeAllocation = structuredClone(state)
    state = allocateResources(state)
    const actualAllocation = allocationDelta(beforeAllocation, state)
    if (JSON.stringify(actualAllocation) !== JSON.stringify(action.allocation)) {
      throw new Error(`Round ${round + 1} allocation did not match the solver witness.`)
    }
    if (round + 1 < input.endRound) state = advanceRound(state)
  }

  const metrics = calculatePlayerReport(state, input)
  if (Math.abs(metrics.projectedScore - witness.objective) > 1e-6) {
    throw new Error('The replayed score did not match the solver objective.')
  }
  return toExportPlayer(state, input, witness.proof)
}

export async function optimizeGame(
  input: OptimizationInput,
  options: OptimizationOptions = {},
): Promise<OptimizationSolution> {
  if (input.config.enabledModels.length === 0) {
    throw new Error('At least one model is required for optimization.')
  }
  if (input.endRound < 1 || input.endRound > 100) {
    throw new Error('Optimization supports between 1 and 100 rounds.')
  }
  if (input.penaltyRound < 1 || input.penaltyRound > input.endRound) {
    throw new Error('The WIP round must be within the optimized run.')
  }

  const startedAt = performance.now()
  const greedy = toExportPlayer(buildGreedyBaseline(input), input, 'feasible')
  const idle = toExportPlayer(buildIdleBaseline(input), input, 'feasible')
  const baseline = greedy.projectedScore >= idle.projectedScore ? greedy : idle
  const { lp, models } = buildOptimizationModel(input)
  const highs = await loadHiGHS()
  const result = highs.solve(lp, {
    time_limit: options.timeLimitSeconds ?? 60,
    mip_rel_gap: 0,
    random_seed: 0,
    presolve: 'on',
    output_flag: false,
    log_to_console: false,
    threads: 1,
  })
  const hasPrimal = Object.values(result.Columns).some((column) => (
    'Primal' in column && Number.isFinite(column.Primal)
  ))
  if (result.Status !== 'Optimal' && !hasPrimal) return {
    proof: 'feasible',
    player: baseline,
    solveTimeMs: Math.round(performance.now() - startedAt),
  }
  const witness = witnessFromSolution(
    input,
    models,
    result.Status,
    result.ObjectiveValue,
    result.Columns,
  )
  let player: TeamExportPlayer
  try {
    player = replayWitness(input, witness)
  } catch {
    return {
      proof: 'feasible',
      player: baseline,
      solveTimeMs: Math.round(performance.now() - startedAt),
    }
  }
  const proof = witness.proof === 'optimal'
    && baseline.projectedScore <= player.projectedScore + 1e-6
    ? 'optimal'
    : 'feasible'
  const selected = baseline.projectedScore > player.projectedScore
    ? { ...baseline, name: proof === 'optimal' ? 'Optimal Run' : 'Best Run Found' }
    : player
  return {
    proof,
    player: selected,
    solveTimeMs: Math.round(performance.now() - startedAt),
  }
}
