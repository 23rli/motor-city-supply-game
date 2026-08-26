import type { GameConfig, GameState, ModelValues } from '../src/game/types'
import { normalizeGameState } from '../src/game/engine'

const HIDDEN_PENALTIES: ModelValues = {
  blue: 0,
  green: 0,
  red: 0,
  yellow: 0,
}

export function concealConfigNotes(config: GameConfig): GameConfig {
  return {
    ...structuredClone(config),
    notes: '',
  }
}

export function concealPlayerConfig(config: GameConfig): GameConfig {
  return {
    ...concealConfigNotes(config),
    wipPenalty: { ...HIDDEN_PENALTIES },
  }
}

export function concealPlayerState(state: GameState): GameState {
  const visible = normalizeGameState(state)
  visible.config = concealPlayerConfig(visible.config)
  visible.history = visible.history.map((round) => ({
    ...round,
    projectedPenalty: 0,
  }))
  return visible
}