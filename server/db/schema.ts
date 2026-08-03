export const INITIAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS games (
  id uuid PRIMARY KEY,
  code varchar(6) NOT NULL UNIQUE,
  status varchar(16) NOT NULL CHECK (status IN ('waiting', 'active', 'finished')),
  config jsonb NOT NULL,
  facilitator_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  started_at timestamptz,
  ended_at timestamptz,
  penalty_round integer CHECK (penalty_round >= 1),
  end_round integer CHECK (end_round >= 1)
);

ALTER TABLE games ADD COLUMN IF NOT EXISTS penalty_round integer;
ALTER TABLE games ADD COLUMN IF NOT EXISTS end_round integer;

CREATE TABLE IF NOT EXISTS participants (
  id uuid PRIMARY KEY,
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name varchar(80) NOT NULL,
  normalized_name varchar(80) NOT NULL,
  role varchar(16) NOT NULL CHECK (role IN ('facilitator', 'player')),
  token_hash char(64) NOT NULL UNIQUE,
  recovery_hash char(64) NOT NULL,
  token_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  state jsonb,
  state_version integer NOT NULL DEFAULT 0 CHECK (state_version >= 0),
  identifier varchar(120),
  joined_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  UNIQUE (game_id, normalized_name)
);

ALTER TABLE participants ADD COLUMN IF NOT EXISTS recovery_hash char(64);
ALTER TABLE participants ADD COLUMN IF NOT EXISTS token_expires_at timestamptz;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS identifier varchar(120);

CREATE INDEX IF NOT EXISTS participants_game_id_idx
  ON participants(game_id);

CREATE TABLE IF NOT EXISTS idempotency_receipts (
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  idempotency_key varchar(128) NOT NULL,
  fingerprint text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (participant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idempotency_receipts_created_at_idx
  ON idempotency_receipts(created_at);

CREATE TABLE IF NOT EXISTS round_snapshots (
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  round_number integer NOT NULL CHECK (round_number >= 0),
  summary jsonb NOT NULL,
  state jsonb NOT NULL,
  committed_at timestamptz NOT NULL,
  PRIMARY KEY (participant_id, round_number)
);

CREATE INDEX IF NOT EXISTS round_snapshots_game_round_idx
  ON round_snapshots(game_id, round_number);
`