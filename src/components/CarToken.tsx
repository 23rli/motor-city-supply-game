import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { Ban, Check, Droplets, Hourglass, PackageCheck, Sparkles, Truck } from 'lucide-react'
import blueCar from '../assets/cars/blue.webp'
import greenCar from '../assets/cars/green.webp'
import redCar from '../assets/cars/red.webp'
import yellowCar from '../assets/cars/yellow.webp'
import type { CarStatus } from '../game/engine'
import type { Car, CarModel } from '../game/types'

const CAR_IMAGES: Record<CarModel, string> = {
  blue: blueCar,
  green: greenCar,
  red: redCar,
  yellow: yellowCar,
}

const MODEL_COLORS: Record<CarModel, string> = {
  blue: '#2f65a7',
  green: '#137164',
  red: '#b83b31',
  yellow: '#d7a91f',
}

const PHASE_ICONS = {
  ready: Check,
  'awaiting-resources': Droplets,
  'awaiting-round': Hourglass,
  queued: PackageCheck,
  curing: Sparkles,
  cured: Check,
  shipped: Truck,
  blocked: Ban,
} as const

const CURE_STEPS = 2
const CURE_PROGRESS = { queued: 0, curing: 1, cured: CURE_STEPS } as const

function describe(status: CarStatus): string {
  switch (status.phase) {
    case 'awaiting-resources':
      return `Needs ${status.shortfall} ${status.resource}`
    case 'awaiting-round':
      return 'Moves next round'
    case 'queued':
      return 'Batch loading'
    case 'curing':
      return 'Curing'
    case 'cured':
      return status.canMove ? 'Cured' : 'Cured / blocked'
    case 'shipped':
      return 'Shipped'
    default:
      return status.canMove ? 'Ready to move' : 'No open lane ahead'
  }
}

interface CarTokenProps {
  car: Car
  status: CarStatus
  selected?: boolean
  dragging?: boolean
  ghost?: boolean
  onSelect?: (carId: string) => void
  onDragStart?: (event: ReactPointerEvent<HTMLElement>, carId: string) => void
}

export function CarToken({
  car,
  status,
  selected = false,
  dragging = false,
  ghost = false,
  onSelect,
  onDragStart,
}: CarTokenProps) {
  const label = describe(status)
  const blocked = !status.canMove && (status.phase === 'ready' || status.phase === 'cured')
  const PhaseIcon = blocked ? PHASE_ICONS.blocked : PHASE_ICONS[status.phase]
  const serial = car.id.slice(car.model.length + 1)
  const cureProgress = status.phase in CURE_PROGRESS
    ? CURE_PROGRESS[status.phase as keyof typeof CURE_PROGRESS]
    : null

  const className = [
    'car-token',
    `car-token-${status.phase}`,
    blocked && 'car-token-blocked',
    selected && 'car-token-selected',
    status.canMove && 'car-token-actionable',
    dragging && 'car-token-dragging',
    ghost && 'car-token-ghost',
  ]
    .filter(Boolean)
    .join(' ')

  const style = { '--model-color': MODEL_COLORS[car.model] } as CSSProperties

  const body = (
    <>
      <span className="car-token-head">
        <strong>{car.model}</strong>
        <small>#{serial}</small>
      </span>

      <img src={CAR_IMAGES[car.model]} alt="" draggable="false" />

      {status.resource && (
        <span
          className={`car-token-pips pips-${status.resource}`}
          aria-hidden="true"
        >
          {Array.from({ length: status.required }, (_, index) => (
            <i className={index < status.held ? 'pip-filled' : ''} key={index} />
          ))}
        </span>
      )}

      {cureProgress !== null && (
        <span className="car-token-pips pips-cure" aria-hidden="true">
          {Array.from({ length: CURE_STEPS }, (_, index) => (
            <i className={index < cureProgress ? 'pip-filled' : ''} key={index} />
          ))}
        </span>
      )}

      <span className="car-token-status">
        <PhaseIcon size={11} aria-hidden="true" />
        {label}
      </span>
    </>
  )

  if (ghost) {
    return (
      <div className={className} style={style} aria-hidden="true">
        {body}
      </div>
    )
  }

  return (
    <button
      className={className}
      style={style}
      type="button"
      data-car-id={car.id}
      aria-pressed={selected}
      aria-label={`${car.model} model number ${serial}. ${label}.${
        status.resource
          ? ` ${status.held} of ${status.required} ${status.resource} loaded.`
          : ''
      }${status.canMove ? ' Select it to choose a lane.' : ''}`}
      onPointerDown={(event) => onDragStart?.(event, car.id)}
      onClick={() => onSelect?.(car.id)}
    >
      {body}
    </button>
  )
}
