import React from 'react';
import type { FileStatus } from './types';

const FILE_STATUS_COLORS: Record<FileStatus, string> = {
  open: 'var(--status-info)',
  modified: 'var(--status-warning)',
  'git-modified': 'var(--status-warning)',
  'git-added': 'var(--status-success)',
  'git-deleted': 'var(--status-error)',
};

export const FileStatusDot: React.FC<{ status: FileStatus }> = ({ status }) => (
  <span className="size-2 rounded-full" style={{ backgroundColor: FILE_STATUS_COLORS[status] }} />
);
