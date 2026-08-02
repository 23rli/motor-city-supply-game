import {
  advanceRound,
  allocateResources,
  convertResources,
  moveCar,
  repositionCar,
  resetRound,
} from '../src/game/engine'
import type { GameState } from '../src/game/types'
import type { PlayerCommandInput } from './contracts'

export interface CommandApplication {
  state: GameState
  errorCode?: 'INVALID_MOVE' | 'INVALID_CONVERSION'
  error?: string
}

export function applyPlayerCommand(
  state: GameState,
  command: PlayerCommandInput['command'],
): CommandApplication {
  switch (command.type) {
    case 'move': {
      const result = moveCar(state, command.carId, command.toStage, command.toRow)
      return result.error
        ? { state, errorCode: 'INVALID_MOVE', error: result.error }
        : { state: result.state }
    }
    case 'reposition': {
      const result = repositionCar(state, command.carId, command.toRow)
      return result.error
        ? { state, errorCode: 'INVALID_MOVE', error: result.error }
        : { state: result.state }
    }
    case 'allocate':
      return { state: allocateResources(state) }
    case 'convert': {
      const result = convertResources(state, command.spend, command.receive)
      return result.error
        ? { state, errorCode: 'INVALID_CONVERSION', error: result.error }
        : { state: result.state }
    }
    case 'advance':
      return { state: advanceRound(state) }
    case 'reset':
      return { state: resetRound(state) }
  }
}