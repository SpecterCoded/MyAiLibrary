interface PrimaryPointerLike {
  button: number;
  isPrimary: boolean;
}

interface ClickLike {
  detail: number;
}

type ComposerControlAction = () => void | Promise<void>;

/**
 * Run before focus-within expands the centered composer and moves the button
 * away from the pointer. The later mouse/touch click is intentionally ignored.
 */
export function activateComposerControlFromPointer(
  event: PrimaryPointerLike,
  action: ComposerControlAction,
): boolean {
  if (!event.isPrimary || event.button !== 0) return false;
  void action();
  return true;
}

/**
 * Keyboard and assistive-technology clicks have detail=0 and do not produce a
 * pointerdown. Mouse/touch clicks have already been handled above.
 */
export function activateComposerControlFromKeyboardClick(
  event: ClickLike,
  action: ComposerControlAction,
): boolean {
  if (event.detail !== 0) return false;
  void action();
  return true;
}
