import type { AnswerMode, TargetSeconds } from './domain';
import type { PracticeCategory } from './practice';

/**
 * Call-type presets. A profile carries one, and it shapes the *instruction*
 * side of the prompt (how to answer) while the profile text stays reference
 * data (what is true about the user). Rules are fixed strings authored here;
 * they never embed user-supplied text, so they can sit in the system prompt
 * without fencing.
 *
 * This is deliberately not "one user profile per tech stack": the same
 * person interviews for a React role on Monday and a Go role on Tuesday. The
 * profile (background) stays, the call type and tech stack change per call.
 */

export type CallType =
  | 'general'
  | 'technical-interview'
  | 'behavioral-interview'
  | 'sales-call'
  | 'customer-support'
  | 'team-meeting';

export interface CallTypePreset {
  id: CallType;
  label: string;
  /** One-line explanation shown next to the picker. */
  description: string;
  /** Instruction-position guidance appended to the system prompt. */
  rules: readonly string[];
  /** Response style that suits this call type; the UI suggests it, never forces it. */
  suggestedMode: AnswerMode;
  suggestedTargetSeconds: TargetSeconds;
  /** Practice-deck category most relevant to this call type. */
  practiceCategory: PracticeCategory | 'all';
}

export const CALL_TYPES: readonly CallTypePreset[] = [
  {
    id: 'general',
    label: 'General',
    description: 'Balanced spoken answers with no extra assumptions about the setting.',
    rules: [],
    suggestedMode: 'natural',
    suggestedTargetSeconds: 30,
    practiceCategory: 'all',
  },
  {
    id: 'technical-interview',
    label: 'Technical interview',
    description: 'Concrete engineering answers that name real tools, trade-offs, and reasoning.',
    rules: [
      'This is a technical interview. Be concrete: name the specific technologies, patterns, and trade-offs from the tech stack and profile, and explain the reasoning behind a choice rather than listing buzzwords.',
      'If the question is a coding or system-design task, outline the approach in spoken steps (clarify constraints, propose a design, note trade-offs, say how you would verify it) instead of dictating code.',
      'Never claim hands-on experience with a technology that is not listed in the profile or tech stack. If asked about one, say you would ramp up on it and relate it to something you do know.',
    ],
    suggestedMode: 'natural',
    suggestedTargetSeconds: 30,
    practiceCategory: 'technical',
  },
  {
    id: 'behavioral-interview',
    label: 'Behavioral interview',
    description: 'Story-shaped answers: one specific situation, what you did, the result.',
    rules: [
      'This is a behavioral interview. Lead with one specific situation drawn from the profile, say what you personally did, and end with an observable result or lesson.',
      'Prefer one well-told example over several vague ones. Do not invent metrics that the profile does not state.',
    ],
    suggestedMode: 'star',
    suggestedTargetSeconds: 60,
    practiceCategory: 'behavioral',
  },
  {
    id: 'sales-call',
    label: 'Sales or discovery call',
    description: 'You are the seller: focus on the customer problem, ask sharp questions.',
    rules: [
      'This is a sales or discovery call and the user is the seller. Focus on the customer’s stated problem, ask one focused discovery question when key details are missing, and tie any product claim to a benefit for the customer.',
      'Do not invent pricing, features, timelines, or customer references that are not in the reference data.',
    ],
    suggestedMode: 'concise',
    suggestedTargetSeconds: 15,
    practiceCategory: 'all',
  },
  {
    id: 'customer-support',
    label: 'Customer support',
    description: 'You are the agent: acknowledge, then give clear next steps.',
    rules: [
      'This is a customer support conversation and the user is the support agent. Acknowledge the customer’s issue in one sentence, then give clear next steps or ask for the single detail needed to proceed.',
      'Stay calm and concrete. Never promise an outcome, refund, or timeline that the reference data does not support.',
    ],
    suggestedMode: 'concise',
    suggestedTargetSeconds: 15,
    practiceCategory: 'all',
  },
  {
    id: 'team-meeting',
    label: 'Team meeting',
    description: 'Internal work call: brief position, reason, next step.',
    rules: [
      'This is an internal work meeting. Respond as a colleague: state a position or update briefly, give the reason, and name the next step or decision needed.',
    ],
    suggestedMode: 'concise',
    suggestedTargetSeconds: 15,
    practiceCategory: 'teamwork',
  },
];

export const CALL_TYPE_IDS = CALL_TYPES.map((c) => c.id) as [CallType, ...CallType[]];

export const DEFAULT_CALL_TYPE: CallType = 'general';

/** Preset for an id; unknown or missing ids fall back to 'general'. */
export function callTypePreset(id: string | undefined | null): CallTypePreset {
  return CALL_TYPES.find((c) => c.id === id) ?? CALL_TYPES[0];
}
