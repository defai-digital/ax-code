const stripGitSuffix = (value: string) => value.replace(/\.git$/i, '');

const readSshScpPath = (value: string): string | null => {
  const atIndex = value.indexOf('@');
  if (atIndex === -1) return null;

  const afterUser = value.slice(atIndex + 1);
  if (afterUser.startsWith('[')) {
    const closingBracketIndex = afterUser.indexOf(']');
    if (closingBracketIndex === -1 || afterUser[closingBracketIndex + 1] !== ':') {
      return null;
    }
    return afterUser.slice(closingBracketIndex + 2);
  }

  const colonIndex = afterUser.indexOf(':');
  return colonIndex === -1 ? null : afterUser.slice(colonIndex + 1);
};

export const guessCatalogLabelFromSource = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';

  if (trimmed.startsWith('git@')) {
    const sshPath = readSshScpPath(trimmed);
    const label = sshPath ? stripGitSuffix(sshPath).trim() : '';
    return label || trimmed;
  }

  if (trimmed.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed);
      const label = stripGitSuffix(parsed.pathname.split('/').slice(1).filter(Boolean).join('/')).trim();
      return label || trimmed;
    } catch {
      return trimmed;
    }
  }

  const shorthand = trimmed.match(/^([^/\s]+)\/([^/\s]+)(?:\/.+)?$/);
  if (shorthand) {
    return `${shorthand[1]}/${stripGitSuffix(shorthand[2])}`;
  }
  return trimmed;
};
