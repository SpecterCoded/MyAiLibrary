export default function FloatingDragHandle() {
  return (
    <div
      className="floating-tool-drag-handle flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-300 dark:text-slate-500"
      aria-label="Drag window"
      title="Drag window"
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
