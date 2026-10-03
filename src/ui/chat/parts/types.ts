import type { CoachUiPart } from '../../../app/types.ts';

export type TemplatesPart = Extract<CoachUiPart, { kind: 'templates' }>;
export type OptionsPart = Extract<CoachUiPart, { kind: 'options' }>;
export type DiffPart = Extract<CoachUiPart, { kind: 'diff' }>;
export type ShotPart = Extract<CoachUiPart, { kind: 'shot' }>;
export type NoticePart = Extract<CoachUiPart, { kind: 'notice' }>;
export type NoticeTone = NoticePart['tone'];
