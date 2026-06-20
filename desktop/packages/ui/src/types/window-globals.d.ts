import type { RuntimeAPIs } from '@/lib/api/types';
import type { DesktopBootOutcome } from '@/lib/desktopBoot';
import type { useAgentsStore } from '@/stores/useAgentsStore';
import type { useCommandsStore } from '@/stores/useCommandsStore';
import type { useConfigStore } from '@/stores/useConfigStore';
import type { useGitIdentitiesStore } from '@/stores/useGitIdentitiesStore';
import type { useSkillsStore } from '@/stores/useSkillsStore';
import type { StreamPerfState } from '@/stores/utils/streamDebug';

type DesktopServerRuntime = {
  origin: string;
  axCodePort: number | null;
  apiPrefix: string;
  cliAvailable: boolean;
};

type AxCodeDebugTools = {
  getLastAssistantMessage: () => unknown;
  getAllMessages: (truncate?: boolean) => unknown[];
  truncateMessages: (messages: unknown[]) => unknown[];
  getAppStatus: () => Promise<unknown>;
  checkLastMessage: () => boolean;
  findEmptyMessages: () => unknown[];
  showRetryHelp: () => void;
  getStreamingState: () => unknown;
  analyzeMessageCompletionConsistency: (options?: unknown) => unknown;
  checkCompletionStatus: () => unknown;
};

declare global {
  interface Window {
    __axCodeDebug?: AxCodeDebugTools;
    __AX_CODE_DESKTOP_DESKTOP_BOOT_OUTCOME__?: DesktopBootOutcome;
    __AX_CODE_DESKTOP_DESKTOP_SERVER__?: DesktopServerRuntime;
    __AX_CODE_DESKTOP_ELECTRON__?: {
      runtime?: string;
      recordStartupEvent?: (name: string, details?: Record<string, unknown>) => Promise<unknown>;
    };
    __AX_CODE_DESKTOP_HOME__?: string;
    __AX_CODE_DESKTOP_LOCAL_ORIGIN__?: string;
    __AX_CODE_DESKTOP_MACOS_MAJOR__?: number;
    __AX_CODE_DESKTOP_PANEL_TYPE__?: 'chat' | 'agentManager';
    __AX_CODE_DESKTOP_PLATFORM__?: string;
    __AX_CODE_DESKTOP_RUNTIME_APIS__?: RuntimeAPIs;
    __openchamberStreamPerfState?: StreamPerfState;
    __zustand_agents_store__?: typeof useAgentsStore;
    __zustand_commands_store__?: typeof useCommandsStore;
    __zustand_config_store__?: typeof useConfigStore;
    __zustand_git_identities_store__?: typeof useGitIdentitiesStore;
    __zustand_skills_store__?: typeof useSkillsStore;
  }
}

export {};
