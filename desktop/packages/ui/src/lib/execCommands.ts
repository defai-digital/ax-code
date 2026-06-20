import type { CommandExecResult, FilesAPI, RuntimeAPIs } from '@/lib/api/types';
import { API_ENDPOINTS, HTTP_DEFAULTS } from './http';

type ExecCommandsResult = { success: boolean; results: CommandExecResult[] };

const DEFAULT_BASE_URL = import.meta.env.VITE_AX_CODE_URL || HTTP_DEFAULTS.apiPath.base;

const getBaseUrl = (): string => {
  if (typeof DEFAULT_BASE_URL === 'string' && DEFAULT_BASE_URL.startsWith('/')) {
    return DEFAULT_BASE_URL;
  }
  return DEFAULT_BASE_URL;
};

function getRuntimeFilesAPI(): FilesAPI | null {
  if (typeof window === 'undefined') return null;
  const apis = (window as typeof window & { __AX_CODE_DESKTOP_RUNTIME_APIS__?: RuntimeAPIs }).__AX_CODE_DESKTOP_RUNTIME_APIS__;
  if (apis?.files) {
    return apis.files;
  }
  return null;
}

export async function execCommands(commands: string[], cwd: string): Promise<ExecCommandsResult> {
  const runtimeFiles = getRuntimeFilesAPI();
  if (runtimeFiles?.execCommands) {
    return runtimeFiles.execCommands(commands, cwd);
  }

  const response = await fetch(`${getBaseUrl()}${API_ENDPOINTS.fs.exec}`, {
    method: HTTP_DEFAULTS.method.post,
    headers: HTTP_DEFAULTS.headers.contentTypeJson,
    body: JSON.stringify({ commands, cwd, background: false }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error((error as { error?: string }).error || 'Command exec failed');
  }

  const payload = (await response.json().catch(() => null)) as
    | { success?: boolean; results?: CommandExecResult[] }
    | null;

  return {
    success: Boolean(payload?.success),
    results: Array.isArray(payload?.results) ? payload!.results! : [],
  };
}

export async function execCommand(command: string, cwd: string): Promise<CommandExecResult> {
  const result = await execCommands([command], cwd);
  const first = result.results[0];
  if (!first) {
    return { command, success: result.success };
  }
  return first;
}
