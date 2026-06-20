import { API_ENDPOINTS, HTTP_DEFAULTS, replacePathParams } from './http';

export type ScheduledTaskStatus = 'idle' | 'running' | 'success' | 'error';

export type ScheduledTask = {
  id: string;
  name: string;
  enabled: boolean;
  schedule: {
    kind: 'daily' | 'weekly' | 'once' | 'cron';
    times?: string[];
    time?: string;
    date?: string;
    weekdays?: number[];
    cron?: string;
    timezone?: string;
  };
  execution: {
    prompt: string;
    providerID: string;
    modelID: string;
    variant?: string;
    agent?: string;
  };
  state: {
    createdAt: number;
    updatedAt: number;
    lastRunAt?: number;
    lastStatus?: ScheduledTaskStatus;
    lastError?: string;
    lastDurationMs?: number;
    lastSessionId?: string;
    nextRunAt?: number;
  };
};

const parseErrorMessage = async (response: Response, fallback: string) => {
  try {
    const parsed = await response.json();
    if (parsed && typeof parsed.error === 'string' && parsed.error.trim().length > 0) {
      return parsed.error;
    }
  } catch {
    return fallback;
  }
  return fallback;
};

const ensureProjectID = (projectID: string): string => {
  const trimmed = typeof projectID === 'string' ? projectID.trim() : '';
  if (!trimmed) {
    throw new Error('projectId is required');
  }
  return trimmed;
};

export const fetchScheduledTasks = async (projectID: string): Promise<ScheduledTask[]> => {
  const safeProjectID = ensureProjectID(projectID);
  const response = await fetch(replacePathParams(API_ENDPOINTS.projects.scheduledTasksBase, { projectId: safeProjectID }));
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Failed to load scheduled tasks'));
  }
  const parsed = await response.json().catch(() => null);
  if (!parsed || !Array.isArray(parsed.tasks)) {
    return [];
  }
  return parsed.tasks as ScheduledTask[];
};

export const upsertScheduledTask = async (projectID: string, task: Partial<ScheduledTask>): Promise<ScheduledTask[]> => {
  const safeProjectID = ensureProjectID(projectID);
  const response = await fetch(replacePathParams(API_ENDPOINTS.projects.scheduledTasksBase, { projectId: safeProjectID }), {
    method: HTTP_DEFAULTS.method.put,
    headers: HTTP_DEFAULTS.headers.acceptAndContentTypeJson,
    body: JSON.stringify({ task }),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Failed to save scheduled task'));
  }
  const parsed = await response.json().catch(() => null);
  if (!parsed || !Array.isArray(parsed.tasks)) {
    return [];
  }
  return parsed.tasks as ScheduledTask[];
};

export const deleteScheduledTask = async (projectID: string, taskID: string): Promise<ScheduledTask[]> => {
  const safeProjectID = ensureProjectID(projectID);
  const safeTaskID = ensureProjectID(taskID);
  const response = await fetch(
    replacePathParams(API_ENDPOINTS.projects.scheduledTaskById, { projectId: safeProjectID, taskId: safeTaskID }),
    {
      method: HTTP_DEFAULTS.method.delete,
      headers: HTTP_DEFAULTS.headers.acceptJson,
    }
  );
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Failed to delete scheduled task'));
  }
  const parsed = await response.json().catch(() => null);
  if (!parsed || !Array.isArray(parsed.tasks)) {
    return [];
  }
  return parsed.tasks as ScheduledTask[];
};

export const runScheduledTaskNow = async (projectID: string, taskID: string): Promise<{ sessionId?: string }> => {
  const safeProjectID = ensureProjectID(projectID);
  const safeTaskID = ensureProjectID(taskID);
  const response = await fetch(
    replacePathParams(API_ENDPOINTS.projects.scheduledTaskRun, { projectId: safeProjectID, taskId: safeTaskID }),
    {
      method: HTTP_DEFAULTS.method.post,
      headers: HTTP_DEFAULTS.headers.acceptJson,
    }
  );
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Failed to run scheduled task'));
  }
  const parsed = await response.json().catch(() => null);
  return {
    sessionId: typeof parsed?.sessionId === 'string' && parsed.sessionId.length > 0 ? parsed.sessionId : undefined,
  };
};
