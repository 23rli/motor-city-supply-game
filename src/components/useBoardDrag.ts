import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Stage } from '../game/types'

/** Pointer travel that separates a tap-to-select from a deliberate drag. */
const DRAG_THRESHOLD = 6
/** Distance from an edge at which the board starts following the pointer. */
const EDGE_ZONE = 104
const EDGE_SPEED = 22

export interface DropTarget {
  stage: Stage
  row: number
}

export interface DragState {
  carId: string
  x: number
  y: number
  width: number
  height: number
  offsetX: number
  offsetY: number
  over: DropTarget | null
  blocked: boolean
}

interface UseBoardDragOptions {
  isLegal: (carId: string, target: DropTarget) => boolean
  onDrop: (carId: string, target: DropTarget) => void
  onReject: (carId: string, target: DropTarget) => void
}

/**
 * Walks the whole hit stack rather than the topmost element, so the drag ghost and the
 * fixed command dock cannot swallow a drop over the lane beneath them.
 */
function resolveTarget(x: number, y: number): DropTarget | null {
  for (const element of document.elementsFromPoint(x, y)) {
    const cell = element.closest<HTMLElement>('[data-drop-stage]')
    if (!cell) continue
    const stage = cell.dataset.dropStage as Stage | undefined
    const row = cell.dataset.dropRow
    if (!stage || row === undefined) continue
    const parsedRow = Number(row)
    if (Number.isInteger(parsedRow)) return { stage, row: parsedRow }
  }
  return null
}

export function useBoardDrag({ isLegal, onDrop, onReject }: UseBoardDragOptions) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const draggedRef = useRef(false)
  const releaseRef = useRef<number | null>(null)
  const teardownRef = useRef<(() => void) | null>(null)

  // Handlers live for the length of a gesture, so read callbacks late rather than capturing them.
  const optionsRef = useRef({ isLegal, onDrop, onReject })
  useEffect(() => {
    optionsRef.current = { isLegal, onDrop, onReject }
  })

  const clearRelease = useCallback(() => {
    if (releaseRef.current === null) return
    window.clearTimeout(releaseRef.current)
    releaseRef.current = null
  }, [])

  useEffect(
    () => () => {
      teardownRef.current?.()
      if (releaseRef.current !== null) window.clearTimeout(releaseRef.current)
    },
    [],
  )

  const startDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, carId: string) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      teardownRef.current?.()

      const rect = event.currentTarget.getBoundingClientRect()
      const { pointerId, clientX: startX, clientY: startY } = event
      const offsetX = startX - rect.left
      const offsetY = startY - rect.top
      let active = false
      let pointerX = startX
      let pointerY = startY
      let edgeFrame = 0
      clearRelease()
      draggedRef.current = false

      const sync = () => {
        const target = resolveTarget(pointerX, pointerY)
        const legal = target !== null && optionsRef.current.isLegal(carId, target)
        setDrag({
          carId,
          x: pointerX,
          y: pointerY,
          width: rect.width,
          height: rect.height,
          offsetX,
          offsetY,
          over: legal ? target : null,
          blocked: target !== null && !legal,
        })
      }

      // A lane outside the viewport has to be reachable without letting go of the car.
      const followEdges = () => {
        edgeFrame = requestAnimationFrame(followEdges)
        let moved = false

        const fromTop = pointerY
        const fromBottom = window.innerHeight - pointerY
        const dy = fromTop < EDGE_ZONE
          ? -EDGE_SPEED * (1 - Math.max(fromTop, 0) / EDGE_ZONE)
          : fromBottom < EDGE_ZONE
            ? EDGE_SPEED * (1 - Math.max(fromBottom, 0) / EDGE_ZONE)
            : 0
        if (dy !== 0) {
          const before = window.scrollY
          window.scrollBy(0, dy)
          moved ||= window.scrollY !== before
        }

        const board = document.querySelector<HTMLElement>('[data-board-scroll]')
        if (board) {
          const bounds = board.getBoundingClientRect()
          const fromLeft = pointerX - bounds.left
          const fromRight = bounds.right - pointerX
          const dx = fromLeft < EDGE_ZONE
            ? -EDGE_SPEED * (1 - Math.max(fromLeft, 0) / EDGE_ZONE)
            : fromRight < EDGE_ZONE
              ? EDGE_SPEED * (1 - Math.max(fromRight, 0) / EDGE_ZONE)
              : 0
          if (dx !== 0) {
            const before = board.scrollLeft
            board.scrollLeft += dx
            moved ||= board.scrollLeft !== before
          }
        }

        // The board moved under a stationary pointer, so the hovered lane changed.
        if (moved) sync()
      }

      const teardown = () => {
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
        window.removeEventListener('pointercancel', handleCancel)
        window.removeEventListener('keydown', handleKey)
        if (edgeFrame) cancelAnimationFrame(edgeFrame)
        edgeFrame = 0
        document.body.classList.remove('board-dragging')
        teardownRef.current = null
        setDrag(null)
        if (!active) return
        // Outlive only the synthetic click this gesture produces, never a later keyboard activation.
        clearRelease()
        releaseRef.current = window.setTimeout(() => {
          draggedRef.current = false
          releaseRef.current = null
        }, 0)
      }

      function handleMove(moveEvent: PointerEvent) {
        if (moveEvent.pointerId !== pointerId) return
        if (
          !active
          && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY)
            < DRAG_THRESHOLD
        ) {
          return
        }
        if (!active) {
          active = true
          draggedRef.current = true
          document.body.classList.add('board-dragging')
          edgeFrame = requestAnimationFrame(followEdges)
        }
        moveEvent.preventDefault()

        pointerX = moveEvent.clientX
        pointerY = moveEvent.clientY
        sync()
      }

      function handleUp(upEvent: PointerEvent) {
        if (upEvent.pointerId !== pointerId) return
        const wasActive = active
        // Hit-test before teardown unmounts the ghost; the ghost is pointer-events:none either way.
        const target = wasActive
          ? resolveTarget(upEvent.clientX, upEvent.clientY)
          : null
        teardown()
        if (!wasActive || !target) return

        const { isLegal: legalNow, onDrop: drop, onReject: reject } = optionsRef.current
        if (legalNow(carId, target)) drop(carId, target)
        else reject(carId, target)
      }

      function handleCancel(cancelEvent: PointerEvent) {
        if (cancelEvent.pointerId === pointerId) teardown()
      }

      function handleKey(keyEvent: KeyboardEvent) {
        if (keyEvent.key === 'Escape') teardown()
      }

      window.addEventListener('pointermove', handleMove, { passive: false })
      window.addEventListener('pointerup', handleUp)
      window.addEventListener('pointercancel', handleCancel)
      window.addEventListener('keydown', handleKey)
      teardownRef.current = teardown
    },
    [clearRelease],
  )

  /** True for the click a finished drag emits, so it never re-toggles selection. */
  const consumeDragClick = useCallback(() => {
    if (!draggedRef.current) return false
    draggedRef.current = false
    clearRelease()
    return true
  }, [clearRelease])

  return { drag, startDrag, consumeDragClick }
}
