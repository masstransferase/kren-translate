import type { RewriteAxes } from './rewriteAxes.js';

export type RewriteModeAxes = Pick<
  RewriteAxes,
  | 'modality'
  | 'function'
  | 'domain'
  | 'formality'
  | 'voice'
  | 'stance'
  | 'length'
  | 'perspective'
>;

interface RewriteModeDefinition {
  id: string;
  label: string;
  axes: RewriteModeAxes;
}

// Plain English first, because it is the one preset that suits any text and is the
// sensible default reach. Then documents, then email, then spoken presentations, grouped
// by kind: a reader scanning the dropdown is looking for the sort of thing they are
// writing, which alphabetical order actively hides.
//
// No two modes may share an identical axis combination. matchingRewriteMode returns the
// first match, so a duplicate would make the later mode unreachable: selecting it would
// immediately relabel itself as the earlier one. A test enforces this, because the
// collision is invisible until someone picks the losing mode.
export const REWRITE_MODES = [
  {
    id: 'plainEnglish',
    label: 'Plain English',
    axes: {
      modality: 'written',
      function: 'general',
      domain: 'general',
      formality: 'neutral',
      voice: 'preserve',
      stance: 'direct',
      length: 'preserve',
      perspective: 'preserve'
    }
  },
  {
    id: 'manuscript',
    label: 'Manuscript',
    axes: {
      modality: 'written',
      function: 'manuscript',
      domain: 'scientific',
      formality: 'formal',
      voice: 'objective',
      stance: 'neutral',
      length: 'compress',
      perspective: 'impersonal'
    }
  },
  {
    // Assertive and first person, unlike a manuscript. A proposal has to claim
    // significance rather than report it, and reviewers read it as an argument.
    // Compressed because grant schemes impose page limits.
    id: 'grantProposal',
    label: 'Grant Proposal',
    axes: {
      modality: 'written',
      function: 'proposal',
      domain: 'scientific',
      formality: 'formal',
      voice: 'authoritative',
      stance: 'assertive',
      length: 'compress',
      perspective: 'first person'
    }
  },
  {
    // Perspective stays preserve rather than impersonal. Instructions are usually
    // imperative, and forcing impersonal turns "Click Save" into passive prose.
    id: 'instruction',
    label: 'Instruction',
    axes: {
      modality: 'written',
      function: 'general',
      domain: 'general',
      formality: 'neutral',
      voice: 'instructional',
      stance: 'direct',
      length: 'compress',
      perspective: 'preserve'
    }
  },
  {
    // Length preserved, not compressed. Technical precision is carried by qualifications
    // that a compression pass is tempted to drop.
    id: 'technicalDocument',
    label: 'Technical document',
    axes: {
      modality: 'written',
      function: 'report',
      domain: 'technical',
      formality: 'formal',
      voice: 'objective',
      stance: 'neutral',
      length: 'preserve',
      perspective: 'impersonal'
    }
  },
  {
    // Ceremonial formality, and never compressed. In a legal instrument the redundancy
    // is often load-bearing, and shortening it changes what it means.
    id: 'legalDocument',
    label: 'Legal document',
    axes: {
      modality: 'written',
      function: 'report',
      domain: 'legal',
      formality: 'ceremonial',
      voice: 'authoritative',
      stance: 'neutral',
      length: 'preserve',
      perspective: 'impersonal'
    }
  },
  {
    // Cautious stance, because regulatory writing states what is supported and no more.
    id: 'regulatoryDocument',
    label: 'Regulatory document',
    axes: {
      modality: 'written',
      function: 'report',
      domain: 'regulatory',
      formality: 'formal',
      voice: 'objective',
      stance: 'cautious',
      length: 'preserve',
      perspective: 'impersonal'
    }
  },
  {
    // Voice preserved. A professional email should sound like the person sending it;
    // imposing an authoritative voice is how ordinary mail starts reading as a memo.
    id: 'professionalEmail',
    label: 'Professional email',
    axes: {
      modality: 'written',
      function: 'email',
      domain: 'business',
      formality: 'formal',
      voice: 'preserve',
      stance: 'diplomatic',
      length: 'compress',
      perspective: 'first person'
    }
  },
  {
    id: 'casualEmail',
    label: 'Casual email',
    axes: {
      modality: 'written',
      function: 'email',
      domain: 'general',
      formality: 'casual',
      voice: 'preserve',
      stance: 'warm',
      length: 'compress',
      perspective: 'first person'
    }
  },
  {
    id: 'professionalPresentation',
    label: 'Professional presentation',
    axes: {
      modality: 'spoken',
      function: 'presentation',
      domain: 'business',
      formality: 'neutral',
      voice: 'authoritative',
      stance: 'direct',
      length: 'compress',
      perspective: 'first person'
    }
  },
  {
    id: 'researchPresentation',
    label: 'Research presentation',
    axes: {
      modality: 'spoken',
      function: 'presentation',
      domain: 'scientific',
      formality: 'neutral',
      voice: 'objective',
      stance: 'neutral',
      length: 'compress',
      perspective: 'first person'
    }
  },
  {
    // The only presentation that expands. Teaching adds the explanation a specialist
    // audience does not need, so compressing it removes the point.
    id: 'teachingPresentation',
    label: 'Teaching presentation',
    axes: {
      modality: 'spoken',
      function: 'presentation',
      domain: 'general',
      formality: 'neutral',
      voice: 'instructional',
      stance: 'warm',
      length: 'expand',
      perspective: 'first person'
    }
  },
  {
    // Assertive rather than direct, which is what separates it from the professional
    // presentation: an investor audience is being asked to back a claim, not briefed.
    id: 'investorPresentation',
    label: 'Investor presentation',
    axes: {
      modality: 'spoken',
      function: 'presentation',
      domain: 'business',
      formality: 'neutral',
      voice: 'authoritative',
      stance: 'assertive',
      length: 'compress',
      perspective: 'first person'
    }
  }
] as const satisfies readonly RewriteModeDefinition[];

export type RewriteMode = typeof REWRITE_MODES[number];
export type RewriteModeId = RewriteMode['id'];
export type RewriteModeAxisName = keyof RewriteModeAxes;
export type RewriteModeSettingKey = `rewrite.${RewriteModeAxisName}`;

export const CUSTOM_REWRITE_MODE_LABEL = 'Custom';

export function isRewriteModeId(value: unknown): value is RewriteModeId {
  return typeof value === 'string' && REWRITE_MODES.some((mode) => mode.id === value);
}

export function rewriteModeOptions(): Array<[RewriteModeId, string]> {
  return REWRITE_MODES.map((mode) => [mode.id, mode.label]);
}

export function rewriteModeById(id: RewriteModeId): RewriteMode {
  return REWRITE_MODES.find((mode) => mode.id === id) as RewriteMode;
}

export function rewriteModeSettingEntries(
  id: RewriteModeId
): Array<{ key: RewriteModeSettingKey; value: RewriteModeAxes[RewriteModeAxisName] }> {
  const mode = rewriteModeById(id);
  return Object.entries(mode.axes).map(([axis, value]) => ({
    key: `rewrite.${axis}` as RewriteModeSettingKey,
    value
  }));
}

export function matchingRewriteMode(axes: RewriteModeAxes): RewriteMode | undefined {
  return REWRITE_MODES.find((mode) =>
    Object.entries(mode.axes).every(([axis, value]) =>
      axes[axis as RewriteModeAxisName] === value
    )
  );
}

export function rewriteModeLabel(axes: RewriteModeAxes): string {
  return matchingRewriteMode(axes)?.label ?? CUSTOM_REWRITE_MODE_LABEL;
}
