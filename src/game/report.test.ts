import { describe, expect, it } from 'vitest'
import { advanceRound, createGame, moveCar } from './engine'
import { buildRunCsv } from './report'

describe('run report', () => {
  it('exports verified round summaries as spreadsheet-compatible CSV', () => {
    let game = createGame({ enabledModels: ['green'] })
    game = moveCar(game, game.cars[0].id, 'manufacturing', 0).state
    game = advanceRound(game)

    const csv = buildRunCsv(game)

    expect(csv).toContain('"Round","Revenue","Completed","WIP"')
    expect(csv).toContain('"1","0","0","1"')
    expect(csv).toContain('"2","0","0","1"')
  })
})