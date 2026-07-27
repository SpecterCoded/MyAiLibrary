import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

export default function FloatingDragHandle() {
  const [isDragging, setIsDragging] = useState(false)
  const activePointerId = useRef<number | null>(null)
  const lastPointerPosition = useRef<{ x: number; y: number } | null>(null)

  const stopDragging = () => {
    activePointerId.current = null
    lastPointerPosition.current = null
    setIsDragging(false)
    document.documentElement.classList.remove('floating-tool-pointer-dragging')
  }

  useEffect(() => stopDragging, [])

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !window.desktop?.moveFloatingToolBy) return
    event.preventDefault()
    activePointerId.current = event.pointerId
    lastPointerPosition.current = { x: event.screenX, y: event.screenY }
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsDragging(true)
    document.documentElement.classList.add('floating-tool-pointer-dragging')
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerId.current !== event.pointerId || !lastPointerPosition.current) return
    const deltaX = event.screenX - lastPointerPosition.current.x
    const deltaY = event.screenY - lastPointerPosition.current.y
    lastPointerPosition.current = { x: event.screenX, y: event.screenY }
    if (deltaX !== 0 || deltaY !== 0) window.desktop?.moveFloatingToolBy(deltaX, deltaY)
  }

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerId.current !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    stopDragging()
  }

  return (
    <div
      className={`floating-tool-drag-handle flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-300 dark:text-slate-500 ${isDragging ? 'is-dragging' : ''}`}
      aria-label="Drag window"
      title="Drag window"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={stopDragging}
    >
      <svg className="h-4 w-3" viewBox="0 0 12 16" fill="currentColor" aria-hidden="true">
        <circle cx="3" cy="3" r="1.25" />
        <circle cx="9" cy="3" r="1.25" />
        <circle cx="3" cy="8" r="1.25" />
        <circle cx="9" cy="8" r="1.25" />
        <circle cx="3" cy="13" r="1.25" />
        <circle cx="9" cy="13" r="1.25" />
      </svg>
    </div>
  )
}
