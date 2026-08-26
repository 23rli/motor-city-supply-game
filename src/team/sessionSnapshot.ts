import type { TeamSessionSnapshot } from './types'

const fingerprint = (value: TeamSessionSnapshot) => JSON.stringify({
  game: value.game,
  participant: {
    id: value.participant.id,
    role: value.participant.role,
    stateVersion: value.participant.stateVersion,
  },
  roster: value.roster.map((member) => ({
    id: member.id,
    name: member.name,
    role: member.role,
    stateVersion: member.stateVersion,
  })),
  state: value.state,
  stateVersion: value.stateVersion,
})

export function shouldApplySessionSnapshot(
  current: TeamSessionSnapshot,
  incoming: TeamSessionSnapshot,
) {
  if (
    current.game.id === incoming.game.id
    && current.participant.id === incoming.participant.id
    && incoming.stateVersion < current.stateVersion
  ) {
    return false
  }
  return fingerprint(current) !== fingerprint(incoming)
}