import { z } from 'zod'
import { CAR_MODELS, RESOURCES, RESOURCE_PLANS, STAGES } from '../src/game/types'

const nameSchema = z.string().trim().min(1).max(80)
const carModelSchema = z.enum(CAR_MODELS)
const resourceSchema = z.enum(RESOURCES)
const stageSchema = z.enum(STAGES)

const modelValuesSchema = z.object({
  blue: z.number().nonnegative().finite(),
  green: z.number().nonnegative().finite(),
  red: z.number().nonnegative().finite(),
  yellow: z.number().nonnegative().finite(),
}).strict()

const resourcePoolSchema = z.object({
  red: z.number().int().nonnegative(),
  yellow: z.number().int().nonnegative(),
  blue: z.number().int().nonnegative(),
}).strict()

export const createSessionSchema = z.object({
  facilitatorName: nameSchema,
  enabledModels: z.array(carModelSchema).max(4).refine(
    (models) => new Set(models).size === models.length,
    'Models must be unique.',
  ),
  resourcePlan: z.enum(RESOURCE_PLANS).default('classic'),
  revenue: modelValuesSchema.optional(),
  wipPenalty: modelValuesSchema.optional(),
  notes: z.string().trim().max(2_000).default(''),
  reuse: z.object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z2-9]{6}$/),
    recoveryCode: z.string().min(20).max(128),
  }).strict().optional(),
}).strict().superRefine((input, context) => {
  if (!input.reuse && input.enabledModels.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['enabledModels'],
      message: 'Select at least one model for a new setup.',
    })
  }
})

export const joinSessionSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z2-9]{6}$/),
  playerName: nameSchema,
  identifier: z.string().trim().max(120).optional(),
}).strict()

export const rejoinSessionSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z2-9]{6}$/),
  playerName: nameSchema,
  recoveryCode: z.string().min(20).max(128),
}).strict()

export const gameParamsSchema = z.object({
  gameId: z.string().uuid(),
}).strict()

export const participantParamsSchema = z.object({
  gameId: z.string().uuid(),
  participantId: z.string().uuid(),
}).strict()

export const endSessionSchema = z.object({
  penaltyRound: z.number().int().min(1).max(10_000),
  endRound: z.number().int().min(1).max(10_000),
}).strict().refine(
  (input) => input.penaltyRound <= input.endRound,
  'The WIP measurement round cannot be after the report cutoff round.',
)

const commandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('move'),
    carId: z.string().min(1).max(100),
    toStage: stageSchema,
    toRow: z.number().int().min(0).max(7),
  }).strict(),
  z.object({
    type: z.literal('reposition'),
    carId: z.string().min(1).max(64),
    toRow: z.number().int().min(0).max(7),
  }).strict(),
  z.object({ type: z.literal('allocate') }).strict(),
  z.object({
    type: z.literal('convert'),
    spend: resourcePoolSchema,
    receive: resourceSchema,
  }).strict(),
  z.object({ type: z.literal('advance') }).strict(),
  z.object({ type: z.literal('reset') }).strict(),
])

export const playerCommandSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(16).max(128),
  command: commandSchema,
}).strict()

export type CreateSessionInput = z.infer<typeof createSessionSchema>
export type EndSessionInput = z.infer<typeof endSessionSchema>
export type JoinSessionInput = z.infer<typeof joinSessionSchema>
export type RejoinSessionInput = z.infer<typeof rejoinSessionSchema>
export type PlayerCommandInput = z.infer<typeof playerCommandSchema>