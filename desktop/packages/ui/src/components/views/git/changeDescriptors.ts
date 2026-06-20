import type { GitStatus } from '@/lib/api/types';
import type { I18nKey } from '@/lib/i18n/store';

export type GitChangeDescriptor = {
  code: string;
  color: string;
  descriptionKey: I18nKey;
};

const GIT_CHANGE_DESCRIPTORS: Record<string, GitChangeDescriptor> = {
  '?': { code: '?', color: 'var(--status-info)', descriptionKey: 'diffView.change.untracked' },
  A: { code: 'A', color: 'var(--status-success)', descriptionKey: 'diffView.change.new' },
  D: { code: 'D', color: 'var(--status-error)', descriptionKey: 'diffView.change.deleted' },
  R: { code: 'R', color: 'var(--status-info)', descriptionKey: 'diffView.change.renamed' },
  C: { code: 'C', color: 'var(--status-info)', descriptionKey: 'diffView.change.copied' },
  M: { code: 'M', color: 'var(--status-warning)', descriptionKey: 'diffView.change.modified' },
};

const DEFAULT_GIT_CHANGE_DESCRIPTOR = GIT_CHANGE_DESCRIPTORS.M;

export const getGitChangeSymbol = (file: GitStatus['files'][number]): string => {
  const indexCode = file.index?.trim();
  const workingCode = file.working_dir?.trim();

  if (indexCode && indexCode !== '?') return indexCode.charAt(0);
  if (workingCode) return workingCode.charAt(0);

  return indexCode?.charAt(0) || workingCode?.charAt(0) || 'M';
};

export const describeGitChange = (file: GitStatus['files'][number]): GitChangeDescriptor => {
  const symbol = getGitChangeSymbol(file);
  return GIT_CHANGE_DESCRIPTORS[symbol] ?? DEFAULT_GIT_CHANGE_DESCRIPTOR;
};
