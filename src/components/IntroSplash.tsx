import { useEffect, useState } from 'react'
import blueCar from '../assets/cars/blue.webp'
import greenCar from '../assets/cars/green.webp'
import redCar from '../assets/cars/red.webp'
import yellowCar from '../assets/cars/yellow.webp'

const LINE = [redCar, yellowCar, blueCar, greenCar]

interface IntroSplashProps {
  status: string
  onSkip?: () => void
}

export function IntroSplash({ status, onSkip }: IntroSplashProps) {
  const [lit, setLit] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setLit(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    if (!onSkip) return
    const skip = (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Escape') onSkip()
    }
    window.addEventListener('keydown', skip)
    return () => window.removeEventListener('keydown', skip)
  }, [onSkip])

  return (
    <div
      className={`intro${lit ? ' intro-lit' : ''}`}
      onClick={onSkip}
      role="status"
      aria-live="polite"
    >
      <div className="intro-hazard intro-hazard-top" aria-hidden="true" />

      <div className="intro-stage">
        <p className="intro-eyebrow">Supply chain simulation</p>
        <h1 className="intro-title" aria-label="Motor City">
          {'MOTOR'.split('').map((letter, index) => (
            <span style={{ '--i': index } as React.CSSProperties} key={`m${index}`}>{letter}</span>
          ))}
          <i />
          {'CITY'.split('').map((letter, index) => (
            <span style={{ '--i': index + 6 } as React.CSSProperties} key={`c${index}`}>{letter}</span>
          ))}
        </h1>

        <div className="intro-line" aria-hidden="true">
          {LINE.map((image, index) => (
            <img src={image} alt="" style={{ '--i': index } as React.CSSProperties} key={image} />
          ))}
        </div>

        <div className="intro-belt" aria-hidden="true"><span /></div>
        <p className="intro-status">{status}</p>
      </div>

      <div className="intro-hazard intro-hazard-bottom" aria-hidden="true" />
    </div>
  )
}
