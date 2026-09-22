import { describe, expect, it } from 'vitest';
import {
  CALL_TYPES,
  CALL_TYPE_IDS,
  DEFAULT_CALL_TYPE,
  callTypePreset,
} from '../../src/shared/callTypes';
import { PRACTICE_CATEGORIES } from '../../src/shared/practice';
import { buildPrompt } from '../../src/shared/prompt';

describe('call-type presets', () => {
  it('has unique ids and a general default', () => {
    expect(new Set(CALL_TYPE_IDS).size).toBe(CALL_TYPE_IDS.length);
    expect(CALL_TYPE_IDS).toContain(DEFAULT_CALL_TYPE);
    expect(callTypePreset(DEFAULT_CALL_TYPE).rules).toEqual([]);
  });

  it('falls back to general for unknown or missing ids', () => {
    expect(callTypePreset(undefined).id).toBe('general');
    expect(callTypePreset(null).id).toBe('general');
    expect(callTypePreset('not-a-type').id).toBe('general');
  });

  it('points every preset at a practice category that exists', () => {
    const categories = PRACTICE_CATEGORIES.map((c) => c.id);
    for (const preset of CALL_TYPES) expect(categories).toContain(preset.practiceCategory);
  });

  it('keeps rules free of block delimiters so they can never be mistaken for data', () => {
    for (const preset of CALL_TYPES) {
      for (const rule of preset.rules) {
        expect(rule).not.toMatch(/<\/?[a-z_]+>/i);
        expect(rule.trim()).toBe(rule);
        expect(rule.length).toBeGreaterThan(20);
      }
    }
  });

  it('only changes the system prompt, never the fenced user data', () => {
    const base = {
      profile: { summary: 'Engineer.', roleContext: '', emphasisNotes: '' },
      transcript: 'Tell me about a hard bug.',
      answerMode: 'natural' as const,
      targetSeconds: 30 as const,
    };
    const general = buildPrompt(base);
    const technical = buildPrompt({
      ...base,
      profile: { ...base.profile, callType: 'technical-interview' },
    });
    expect(technical.user).toBe(general.user);
    expect(technical.system).not.toBe(general.system);
    for (const rule of callTypePreset('technical-interview').rules)
      expect(technical.system).toContain(rule);
  });
});
