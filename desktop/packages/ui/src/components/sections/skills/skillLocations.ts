import type { SkillScope, SkillSource } from '@/stores/useSkillsStore';

export type SkillLocationValue = 'user-ax-code' | 'project-ax-code' | 'user-claude' | 'project-claude' | 'user-agents' | 'project-agents';

export const SKILL_LOCATION_OPTIONS: Array<{
  value: SkillLocationValue;
  scope: SkillScope;
  source: SkillSource;
  label: string;
  description: string;
}> = [
  {
    value: 'user-ax-code',
    scope: 'user',
    source: 'ax-code',
    label: 'User / AX Code',
    description: 'Global AX Code config location',
  },
  {
    value: 'project-ax-code',
    scope: 'project',
    source: 'ax-code',
    label: 'Project / AX Code',
    description: 'Current project .ax-code location',
  },
  {
    value: 'user-agents',
    scope: 'user',
    source: 'agents',
    label: 'User / Agents',
    description: 'Global .agents compatibility location',
  },
  {
    value: 'project-agents',
    scope: 'project',
    source: 'agents',
    label: 'Project / Agents',
    description: 'Current project .agents compatibility location',
  },
];

export function locationValueFrom(scope: SkillScope, source: SkillSource): SkillLocationValue {
  if (scope === 'project' && source === 'claude') return 'project-claude';
  if (scope === 'project' && source === 'agents') return 'project-agents';
  if (source === 'claude') return 'user-claude';
  if (scope === 'project') return 'project-ax-code';
  if (source === 'agents') return 'user-agents';
  return 'user-ax-code';
}

export function locationPartsFrom(value: SkillLocationValue): { scope: SkillScope; source: SkillSource } {
  if (value === 'user-claude') return { scope: 'user', source: 'claude' };
  if (value === 'project-claude') return { scope: 'project', source: 'claude' };
  const match = SKILL_LOCATION_OPTIONS.find((option) => option.value === value);
  if (!match) {
    return { scope: 'user', source: 'ax-code' };
  }
  return { scope: match.scope, source: match.source };
}

export function locationLabel(scope: SkillScope, source: SkillSource): string {
  if (scope === 'user' && source === 'claude') return 'User / Claude';
  if (scope === 'project' && source === 'claude') return 'Project / Claude';
  const match = SKILL_LOCATION_OPTIONS.find((option) => option.scope === scope && option.source === source);
  return match?.label || `${scope} / ${source}`;
}
