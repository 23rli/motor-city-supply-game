import type { CSSProperties } from 'react'
import { Check, Clock3 } from 'lucide-react'
import blueCar from '../assets/cars/blue.webp'
import greenCar from '../assets/cars/green.webp'
import redCar from '../assets/cars/red.webp'
import yellowCar from '../assets/cars/yellow.webp'
import { RECIPES } from '../game/engine'
import type { Car, CarModel, Resource } from '../game/types'

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

const STAGE_RESOURCE: Partial<Record<Car['stage'], Resource>> = {
  manufacturing: 'red',
  assembly: 'yellow',
  quality: 'blue',
}

interface CarTokenProps {
  car: Car
  selected: boolean
  onSelect: (carId: string) => void
}

export function CarToken({ car, selected, onSelect }: CarTokenProps) {
  const resource = STAGE_RESOURCE[car.stage]
  const progress = resource
    ? `${car.resources[resource]}/${RECIPES[car.model][resource]} ${resource}`
    : car.stage === 'paint'
      ? car.ready ? 'Cured' : 'Painting'
      : 'Ready'

  return (
    <button
      className={`car-token${selected ? ' car-token-selected' : ''}`}
      style={{ '--model-color': MODEL_COLORS[car.model] } as CSSProperties}
      type="button"
      aria-pressed={selected}
      aria-label={`${car.model} model, ${progress}${selected ? ', selected' : ''}`}
      onClick={() => onSelect(car.id)}
    >
      <img src={CAR_IMAGES[car.model]} alt="" draggable="false" />
      <span className="car-token-footer">
        <strong>{car.model}</strong>
        <span className={car.ready ? 'car-ready' : 'car-waiting'}>
          {car.ready ? <Check size={12} /> : <Clock3 size={12} />}
          {progress}
        </span>
      </span>
    </button>
  )
}