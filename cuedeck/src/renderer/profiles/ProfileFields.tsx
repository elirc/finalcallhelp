import React from 'react';
import { CALL_TYPES, callTypePreset, type CallType } from '../../shared/callTypes';
import type { AnswerMode } from '../../shared/domain';

export interface ProfileDraft {
  name: string;
  summary: string;
  roleContext: string;
  emphasisNotes: string;
  callType: CallType;
  techStack: string;
}

export const EMPTY_PROFILE_DRAFT: ProfileDraft = {
  name: '',
  summary: '',
  roleContext: '',
  emphasisNotes: '',
  callType: 'general',
  techStack: '',
};

const MODE_LABEL: Record<AnswerMode, string> = {
  natural: 'Natural',
  concise: 'Concise',
  bullets: 'Bullets',
  star: 'STAR',
  clarify: 'Clarify',
};

/**
 * Call-type and tech-stack fields, shared by onboarding and Preferences so
 * both places describe the feature the same way.
 */
export function CallTypeFields({
  draft,
  onChange,
}: {
  draft: Pick<ProfileDraft, 'callType' | 'techStack'>;
  onChange: (patch: Partial<Pick<ProfileDraft, 'callType' | 'techStack'>>) => void;
}): React.JSX.Element {
  const preset = callTypePreset(draft.callType);
  return (
    <>
      <label className="field">
        <span>Call type</span>
        <select
          value={draft.callType}
          onChange={(e) => onChange({ callType: e.target.value as CallType })}
          data-testid="profile-call-type"
        >
          {CALL_TYPES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <span className="hint">
          {preset.description} Suggested style: {MODE_LABEL[preset.suggestedMode]},{' '}
          {preset.suggestedTargetSeconds} s.
        </span>
      </label>
      <label className="field">
        <span>Tech stack and domain (optional)</span>
        <textarea
          rows={2}
          maxLength={4000}
          placeholder="e.g. TypeScript, React, Node, Postgres, AWS; payments domain. Responses only claim hands-on experience with what is listed here or in your background."
          value={draft.techStack}
          onChange={(e) => onChange({ techStack: e.target.value })}
          data-testid="profile-tech-stack"
        />
      </label>
    </>
  );
}
