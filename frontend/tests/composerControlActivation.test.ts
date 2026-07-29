import { describe, expect, it, vi } from 'vitest';
import {
  activateComposerControlFromKeyboardClick,
  activateComposerControlFromPointer,
} from '../src/components/chat/composerControlActivation';

describe('chat composer control activation', () => {
  it('activates on the first primary pointer press before expansion moves the control', () => {
    const action = vi.fn();
    expect(activateComposerControlFromPointer({ button: 0, isPrimary: true }, action)).toBe(true);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('does not repeat the action on the following mouse click', () => {
    const action = vi.fn();
    activateComposerControlFromPointer({ button: 0, isPrimary: true }, action);
    activateComposerControlFromKeyboardClick({ detail: 1 }, action);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('preserves keyboard and assistive-technology activation', () => {
    const action = vi.fn();
    expect(activateComposerControlFromKeyboardClick({ detail: 0 }, action)).toBe(true);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('ignores right-clicks and non-primary pointers', () => {
    const action = vi.fn();
    expect(activateComposerControlFromPointer({ button: 2, isPrimary: true }, action)).toBe(false);
    expect(activateComposerControlFromPointer({ button: 0, isPrimary: false }, action)).toBe(false);
    expect(action).not.toHaveBeenCalled();
  });
});
