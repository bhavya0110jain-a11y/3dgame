/**
 * Sprint 2: first-run onboarding (src/game/Tutorial.ts + src/data/tutorial.ts). Pure unit tests — the save, event bus,
 * device and persist hooks are injected, so no Game/DOM is needed.
 */
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/EventBus';
import { TUTORIAL_RUNS, defaultSave, type SaveData } from '../../src/core/Save';
import { Tutorial, type InputDevice } from '../../src/game/Tutorial';
import { HINTS, HINT_MOVE_DELAY, HINT_LOW_LIGHT } from '../../src/data/tutorial';

type Hint = { id: string; text: string; duration: number; priority: number };

function setup(over: Partial<SaveData> = {}, device: InputDevice = 'keyboard') {
  const save: SaveData = { ...defaultSave(), ...over };
  const events = new EventBus();
  const shown: Hint[] = [];
  events.on('tutorial:hint', (h) => shown.push(h));
  let persists = 0;
  let dev = device;
  const tut = new Tutorial(() => save, events, () => dev, () => void persists++);
  return { save, tut, shown, persists: () => persists, setDevice: (d: InputDevice) => (dev = d) };
}

describe('Tutorial data', () => {
  it('hints_idMatchesKey_andHaveTextDurationPriority', () => {
    for (const [k, h] of Object.entries(HINTS)) {
      expect(h.id).toBe(k);
      expect(h.text.length).toBeGreaterThan(0);
      expect(h.duration).toBeGreaterThan(0);
      expect(Number.isFinite(h.priority)).toBe(true);
    }
  });

  it('tuningConstants_inSaneRanges', () => {
    expect(HINT_MOVE_DELAY).toBeGreaterThanOrEqual(0);
    expect(HINT_LOW_LIGHT).toBeGreaterThan(0);
    expect(HINT_LOW_LIGHT).toBeLessThan(1);
    expect(TUTORIAL_RUNS).toBeGreaterThanOrEqual(1);
  });
});

describe('Tutorial activation', () => {
  it('onRunStart_freshSave_isActive', () => {
    const { tut } = setup();
    tut.onRunStart();
    expect(tut.active).toBe(true);
  });

  it('onRunStart_runsAtTutorialLimit_isInactive', () => {
    const { tut, shown } = setup({ runs: TUTORIAL_RUNS });
    tut.onRunStart();
    expect(tut.active).toBe(false);
    expect(tut.show('ember')).toBe(false);
    tut.update(10);
    expect(shown).toHaveLength(0);
  });

  it('onRunStart_hintsSettingOff_isInactive', () => {
    const save = defaultSave();
    save.settings.hints = false;
    const { tut } = setup({ settings: save.settings });
    tut.onRunStart();
    expect(tut.active).toBe(false);
  });

  it('show_beforeRunStart_doesNothing', () => {
    const { tut, shown } = setup();
    expect(tut.show('ember')).toBe(false);
    expect(shown).toHaveLength(0);
  });

  it('onRunEnd_afterStart_deactivatesAndCancelsMoveHint', () => {
    const { tut, shown } = setup();
    tut.onRunStart();
    tut.onRunEnd();
    tut.update(HINT_MOVE_DELAY + 1);
    expect(tut.active).toBe(false);
    expect(shown).toHaveLength(0);
  });
});

describe('Tutorial hints', () => {
  it('update_pastMoveDelay_emitsMoveHintOnce', () => {
    const { tut, shown } = setup();
    tut.onRunStart();
    tut.update(HINT_MOVE_DELAY / 2);
    expect(shown).toHaveLength(0);
    tut.update(HINT_MOVE_DELAY);
    tut.update(5);
    expect(shown.map((h) => h.id)).toEqual(['move']);
  });

  it('show_sameIdTwice_emitsOnceAndRecordsSeen', () => {
    const { tut, shown, save, persists } = setup();
    tut.onRunStart();
    expect(tut.show('ember')).toBe(true);
    expect(tut.show('ember')).toBe(false);
    expect(shown).toHaveLength(1);
    expect(save.hintsSeen).toEqual(['ember']);
    expect(tut.seen('ember')).toBe(true);
    expect(persists()).toBe(1);
  });

  it('show_unknownId_returnsFalseAndDoesNotRecord', () => {
    const { tut, save } = setup();
    tut.onRunStart();
    expect(tut.show('no_such_hint')).toBe(false);
    expect(save.hintsSeen).toEqual([]);
  });

  it('show_hintSeenInEarlierRun_notRepeatedInSecondRun', () => {
    const { tut, shown } = setup({ hintsSeen: ['move', 'ember'], runs: 1 });
    tut.onRunStart();
    tut.update(HINT_MOVE_DELAY + 0.1);
    expect(tut.show('ember')).toBe(false);
    expect(tut.show('boss')).toBe(true);
    expect(shown.map((h) => h.id)).toEqual(['boss']);
  });

  it('show_payload_carriesDurationAndPriorityFromData', () => {
    const { tut, shown } = setup();
    tut.onRunStart();
    tut.show('boss');
    expect(shown[0]).toEqual({ id: 'boss', text: HINTS.boss.text, duration: HINTS.boss.duration, priority: HINTS.boss.priority });
  });

  it('show_touchDevice_usesTouchText', () => {
    const { tut, shown } = setup({}, 'touch');
    tut.onRunStart();
    tut.show('move');
    expect(shown[0].text).toBe(HINTS.move.touch);
  });

  it('show_gamepadDevice_usesGamepadText', () => {
    const { tut, shown } = setup({}, 'gamepad');
    tut.onRunStart();
    tut.show('move');
    expect(shown[0].text).toBe(HINTS.move.gamepad);
  });

  it('show_deviceWithoutVariant_fallsBackToDefaultText', () => {
    const { tut, shown } = setup({}, 'touch');
    tut.onRunStart();
    tut.show('ember'); // ember has no touch variant
    expect(shown[0].text).toBe(HINTS.ember.text);
  });
});
