import { create } from "zustand";
import { devtools, persist, createJSONStorage } from "zustand/middleware";
import type { Agent } from "@ax-code/sdk/v2";
import { axCodeClient } from "@/lib/ax-code/client";
import { scopeMatches, subscribeToConfigChanges } from "@/lib/configSync";
import type { ModelMetadata } from "@/types";
import { getSafeStorage } from "./utils/safeStorage";
import { filterVisibleAgents } from "./useAgentsStore";
import { useSessionUIStore } from "@/sync/session-ui-store";
import { useSelectionStore } from "@/sync/selection-store";
import { getRegisteredRuntimeAPIs } from "@/contexts/runtimeAPIRegistry";
import { updateDesktopSettings } from "@/lib/persistence";
import { useDirectoryStore } from "@/stores/useDirectoryStore";
import { streamDebugEnabled } from "@/stores/utils/streamDebug";
import { parseModelIdentifier } from "@/lib/modelIdentifier";
import { isPrimaryMode } from "@/lib/modelControlUtils";
import type { ProviderModel, ProviderWithModelList } from "@/types/providerModels";
import { API_ENDPOINTS } from "@/lib/http";

const MODELS_DEV_API_URL = "https://models.dev/api.json";
const MODELS_DEV_PROXY_URL = API_ENDPOINTS.openchamber.modelsMetadata;

const FALLBACK_PROVIDER_ID = "ax-code";
const FALLBACK_MODEL_ID = "big-pickle";
const GIT_UTILITY_PROVIDER_ID = "zen";
const GIT_UTILITY_PREFERRED_MODEL_ID = "big-pickle";

interface OpenChamberDefaults {
    defaultModel?: string;
    defaultVariant?: string;
    defaultAgent?: string;
    autoCreateWorktree?: boolean;
    gitmojiEnabled?: boolean;
    defaultFileViewerPreview?: boolean;
    zenModel?: string;
    messageStreamTransport?: 'auto' | 'ws' | 'sse';
}

const fetchOpenChamberDefaults = async (): Promise<OpenChamberDefaults> => {
    try {
        // 1. Runtime settings API (VSCode)
        const runtimeSettings = getRegisteredRuntimeAPIs()?.settings;
        if (runtimeSettings) {
            try {
                const result = await runtimeSettings.load();
                const data = result?.settings;
                if (data) {
                    const defaultModel = typeof data?.defaultModel === 'string' ? data.defaultModel.trim() : '';
                    const defaultVariant = typeof data?.defaultVariant === 'string' ? data.defaultVariant.trim() : '';
                    const defaultAgent = typeof data?.defaultAgent === 'string' ? data.defaultAgent.trim() : '';
                    const gitmojiEnabled = typeof data?.gitmojiEnabled === 'boolean' ? data.gitmojiEnabled : undefined;
                    const defaultFileViewerPreview = typeof data?.defaultFileViewerPreview === 'boolean' ? data.defaultFileViewerPreview : undefined;
                    const zenModel = typeof data?.zenModel === 'string' ? data.zenModel.trim() : '';
                    const messageStreamTransport =
                        data?.messageStreamTransport === 'ws' || data?.messageStreamTransport === 'sse' || data?.messageStreamTransport === 'auto'
                            ? data.messageStreamTransport
                            : undefined;

                    return {
                        defaultModel: defaultModel.length > 0 ? defaultModel : undefined,
                        defaultVariant: defaultVariant.length > 0 ? defaultVariant : undefined,
                        defaultAgent: defaultAgent.length > 0 ? defaultAgent : undefined,
                        autoCreateWorktree: typeof data?.autoCreateWorktree === 'boolean' ? data.autoCreateWorktree : undefined,
                        gitmojiEnabled,
                        defaultFileViewerPreview,
                        zenModel: zenModel.length > 0 ? zenModel : undefined,
                        messageStreamTransport,
                    };
                }
            } catch {
                // Fall through to fetch
            }
        }

        // 2. Fetch API (Web/server)
        const response = await fetch(API_ENDPOINTS.config.settings, {
            method: 'GET',
            headers: { Accept: 'application/json' },
        });
        if (!response.ok) {
            return {};
        }
        const data = await response.json();
        const defaultModel = typeof data?.defaultModel === 'string' ? data.defaultModel.trim() : '';
        const defaultVariant = typeof data?.defaultVariant === 'string' ? data.defaultVariant.trim() : '';
        const defaultAgent = typeof data?.defaultAgent === 'string' ? data.defaultAgent.trim() : '';
        const gitmojiEnabled = typeof data?.gitmojiEnabled === 'boolean' ? data.gitmojiEnabled : undefined;
        const defaultFileViewerPreview = typeof data?.defaultFileViewerPreview === 'boolean' ? data.defaultFileViewerPreview : undefined;
        const zenModel = typeof data?.zenModel === 'string' ? data.zenModel.trim() : '';
        const messageStreamTransport =
            data?.messageStreamTransport === 'ws' || data?.messageStreamTransport === 'sse' || data?.messageStreamTransport === 'auto'
                ? data.messageStreamTransport
                : undefined;

        return {
            defaultModel: defaultModel.length > 0 ? defaultModel : undefined,
            defaultVariant: defaultVariant.length > 0 ? defaultVariant : undefined,
            defaultAgent: defaultAgent.length > 0 ? defaultAgent : undefined,
            autoCreateWorktree: typeof data?.autoCreateWorktree === 'boolean' ? data.autoCreateWorktree : undefined,
            gitmojiEnabled,
            defaultFileViewerPreview,
            zenModel: zenModel.length > 0 ? zenModel : undefined,
            messageStreamTransport,
        };
    } catch {
        return {};
    }
};

const parseModelString = (modelString: string): { providerId: string; modelId: string } | null => {
    return parseModelIdentifier(modelString);
};

const normalizeProviderId = (value: string) => value?.toLowerCase?.() ?? '';

type GitModelSelection = { providerId: string; modelId: string };

const normalizeOptionalString = (value: unknown): string | undefined => {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
};

const hasProviderModel = (
    providers: ProviderWithModelList[],
    providerId: string,
    modelId: string
): boolean => {
    const provider = providers.find((item) => item.id === providerId);
    if (!provider) {
        return false;
    }
    return provider.models.some((model) => model.id === modelId);
};

const resolveGitGenerationModelSelection = ({
    providers,
    settingsZenModel,
}: {
    providers: ProviderWithModelList[];
    settingsZenModel?: string;
}): GitModelSelection | null => {
    const zenModel = normalizeOptionalString(settingsZenModel);

    if (!Array.isArray(providers) || providers.length === 0) {
        if (zenModel) {
            return { providerId: GIT_UTILITY_PROVIDER_ID, modelId: zenModel };
        }
        return null;
    }

    if (zenModel && hasProviderModel(providers, GIT_UTILITY_PROVIDER_ID, zenModel)) {
        return { providerId: GIT_UTILITY_PROVIDER_ID, modelId: zenModel };
    }

    if (hasProviderModel(providers, GIT_UTILITY_PROVIDER_ID, GIT_UTILITY_PREFERRED_MODEL_ID)) {
        return { providerId: GIT_UTILITY_PROVIDER_ID, modelId: GIT_UTILITY_PREFERRED_MODEL_ID };
    }

    const zenProvider = providers.find((provider) => provider.id === GIT_UTILITY_PROVIDER_ID);
    if (zenProvider?.models.length) {
        const randomIndex = Math.floor(Math.random() * zenProvider.models.length);
        const randomModelId = normalizeOptionalString(zenProvider.models[randomIndex]?.id);
        if (randomModelId) {
            return { providerId: GIT_UTILITY_PROVIDER_ID, modelId: randomModelId };
        }
    }

    return null;
};

interface ModelsDevModelEntry {
    id?: string;
    name?: string;
    tool_call?: boolean;
    reasoning?: boolean;
    temperature?: boolean;
    attachment?: boolean;
    modalities?: {
        input?: string[];
        output?: string[];
    };
    cost?: {
        input?: number;
        output?: number;
        cache_read?: number;
        cache_write?: number;
    };
    limit?: {
        context?: number;
        output?: number;
    };
    knowledge?: string;
    release_date?: string;
    last_updated?: string;
}

interface ModelsDevProviderEntry {
    id?: string;
    models?: Record<string, ModelsDevModelEntry | undefined>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

const isStringArray = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((item) => typeof item === "string");

const isModelsDevModelEntry = (value: unknown): value is ModelsDevModelEntry => {
    if (!isRecord(value)) {
        return false;
    }
    const candidate = value as ModelsDevModelEntry;
    if (candidate.modalities) {
        const { input, output } = candidate.modalities;
        if (input && !isStringArray(input)) {
            return false;
        }
        if (output && !isStringArray(output)) {
            return false;
        }
    }
    return true;
};

const isModelsDevProviderEntry = (value: unknown): value is ModelsDevProviderEntry => {
    if (!isRecord(value)) {
        return false;
    }
    const candidate = value as ModelsDevProviderEntry;
    return candidate.models === undefined || isRecord(candidate.models);
};

const buildModelMetadataKey = (providerId: string, modelId: string) => {
    const normalizedProvider = normalizeProviderId(providerId);
    if (!normalizedProvider || !modelId) {
        return '';
    }
    return `${normalizedProvider}/${modelId}`;
};

const mapModalities = (cap: { text: boolean; audio: boolean; image: boolean; video: boolean; pdf: boolean } | undefined): string[] => {
    if (!cap) return [];
    const result: string[] = [];
    if (cap.text) result.push('text');
    if (cap.audio) result.push('audio');
    if (cap.image) result.push('image');
    if (cap.video) result.push('video');
    if (cap.pdf) result.push('pdf');
    return result;
};

const deriveModelMetadata = (providerId: string, model: ProviderModel): ModelMetadata => ({
    id: model.id,
    providerId,
    name: model.name,
    tool_call: model.capabilities?.toolcall,
    reasoning: model.capabilities?.reasoning,
    temperature: model.capabilities?.temperature,
    attachment: model.capabilities?.attachment,
    modalities: model.capabilities ? {
        input: mapModalities(model.capabilities.input),
        output: mapModalities(model.capabilities.output),
    } : undefined,
    limit: model.limit,
    release_date: model.release_date,
});

const transformModelsDevResponse = (payload: unknown): Map<string, ModelMetadata> => {
    const metadataMap = new Map<string, ModelMetadata>();

    if (!isRecord(payload)) {
        return metadataMap;
    }

    for (const [providerKey, providerValue] of Object.entries(payload)) {
        if (!isModelsDevProviderEntry(providerValue)) {
            continue;
        }

        const providerId = typeof providerValue.id === 'string' && providerValue.id.length > 0 ? providerValue.id : providerKey;
        const models = providerValue.models;
        if (!models || !isRecord(models)) {
            continue;
        }

        for (const [modelKey, modelValue] of Object.entries(models)) {
            if (!isModelsDevModelEntry(modelValue)) {
                continue;
            }

            const resolvedModelId =
                typeof modelKey === 'string' && modelKey.length > 0
                    ? modelKey
                    : modelValue.id;

            if (!resolvedModelId || typeof resolvedModelId !== 'string' || resolvedModelId.length === 0) {
                continue;
            }

            const metadata: ModelMetadata = {
                id: typeof modelValue.id === 'string' && modelValue.id.length > 0 ? modelValue.id : resolvedModelId,
                providerId,
                name: typeof modelValue.name === 'string' ? modelValue.name : undefined,
                tool_call: typeof modelValue.tool_call === 'boolean' ? modelValue.tool_call : undefined,
                reasoning: typeof modelValue.reasoning === 'boolean' ? modelValue.reasoning : undefined,
                temperature: typeof modelValue.temperature === 'boolean' ? modelValue.temperature : undefined,
                attachment: typeof modelValue.attachment === 'boolean' ? modelValue.attachment : undefined,
                modalities: modelValue.modalities
                    ? {
                          input: isStringArray(modelValue.modalities.input) ? modelValue.modalities.input : undefined,
                          output: isStringArray(modelValue.modalities.output) ? modelValue.modalities.output : undefined,
                      }
                    : undefined,
                cost: modelValue.cost,
                limit: modelValue.limit,
                knowledge: typeof modelValue.knowledge === 'string' ? modelValue.knowledge : undefined,
                release_date: typeof modelValue.release_date === 'string' ? modelValue.release_date : undefined,
                last_updated: typeof modelValue.last_updated === 'string' ? modelValue.last_updated : undefined,
            };

            const key = buildModelMetadataKey(providerId, resolvedModelId);
            if (key) {
                metadataMap.set(key, metadata);
            }
        }
    }

    return metadataMap;
};

const fetchModelsDevMetadata = async (): Promise<Map<string, ModelMetadata>> => {
    if (typeof fetch !== 'function') {
        return new Map();
    }

    const sources = [MODELS_DEV_PROXY_URL, MODELS_DEV_API_URL];

    for (const source of sources) {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
        const timeout = controller ? setTimeout(() => controller.abort(), 8000) : undefined;

        try {
            const isAbsoluteUrl = /^https?:\/\//i.test(source);
            const requestInit: RequestInit = {
                signal: controller?.signal,
                headers: {
                    Accept: 'application/json',
                },
                cache: 'no-store',
            };

            if (isAbsoluteUrl) {
                requestInit.mode = 'cors';
            } else {
                requestInit.credentials = 'same-origin';
            }

            const response = await fetch(source, requestInit);

            if (!response.ok) {
                throw new Error(`Metadata request to ${source} returned status ${response.status}`);
            }

            const data = await response.json();
            return transformModelsDevResponse(data);
        } catch (error: unknown) {
            if ((error as Error)?.name === 'AbortError') {
                console.warn(`Model metadata request aborted (${source})`);
            } else {
                console.warn(`Failed to fetch model metadata from ${source}:`, error);
            }
        } finally {
            if (timeout) {
                clearTimeout(timeout);
            }
        }
    }

    return new Map();
};

let modelsMetadataInFlight: Promise<Map<string, ModelMetadata>> | null = null;

const ensureModelsMetadataFetch = (
    getModelsMetadata: () => Map<string, ModelMetadata>,
    setModelsMetadata: (metadata: Map<string, ModelMetadata>) => void,
) => {
    const existing = getModelsMetadata();
    if (existing.size > 0) {
        return;
    }

    if (modelsMetadataInFlight) {
        return;
    }

    modelsMetadataInFlight = fetchModelsDevMetadata()
        .then((metadata) => {
            if (metadata.size > 0) {
                setModelsMetadata(metadata);
            }
            return metadata;
        })
        .catch(() => new Map<string, ModelMetadata>())
        .finally(() => {
            modelsMetadataInFlight = null;
        });
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const CONNECTION_PROBE_TIMEOUT_MS = 800;

const probeAxCodeHealth = async (timeoutMs = CONNECTION_PROBE_TIMEOUT_MS): Promise<boolean> => {
    return Promise.race([
        axCodeClient.checkHealth().catch(() => false),
        sleep(Math.max(1, timeoutMs)).then(() => false),
    ]);
};

const DIRECTORY_KEY_GLOBAL = "__global__";

const toDirectoryKey = (directory: string | null | undefined): string => {
    const trimmed = typeof directory === 'string' ? directory.trim() : '';
    return trimmed.length > 0 ? trimmed : DIRECTORY_KEY_GLOBAL;
};

const fromDirectoryKey = (key: string): string | null => (key === DIRECTORY_KEY_GLOBAL ? null : key);

const resolveInitialDirectoryKey = (): string => {
    if (typeof window === 'undefined') {
        return DIRECTORY_KEY_GLOBAL;
    }

    const directory = axCodeClient.getDirectory() ?? useDirectoryStore.getState().currentDirectory;
    return toDirectoryKey(directory);
};

interface DirectoryScopedConfig {

    providers: ProviderWithModelList[];
    agents: Agent[];
    currentProviderId: string;
    currentModelId: string;
    currentVariant?: string | undefined;
    currentAgentName: string | undefined;
    selectedProviderId: string;
    agentModelSelections: { [agentName: string]: { providerId: string; modelId: string } };
    defaultProviders: { [key: string]: string };
}

interface ConfigStore {

    activeDirectoryKey: string;
    directoryScoped: Record<string, DirectoryScopedConfig>;

    providers: ProviderWithModelList[];
    providersLoading: boolean;
    providersError: string | null;
    agents: Agent[];
    currentProviderId: string;
    currentModelId: string;
    currentVariant: string | undefined;
    currentAgentName: string | undefined;
    selectedProviderId: string;
    agentModelSelections: { [agentName: string]: { providerId: string; modelId: string } };
    defaultProviders: { [key: string]: string };
    isConnected: boolean;
    hasEverConnected: boolean;
    connectionPhase: "connecting" | "connected" | "reconnecting";
    lastDisconnectReason: string | null;
    isInitialized: boolean;
    modelsMetadata: Map<string, ModelMetadata>;
    // OpenChamber settings-based defaults (take precedence over agent preferences)
    settingsDefaultModel: string | undefined; // format: "provider/model"
    settingsDefaultVariant: string | undefined;
    settingsDefaultAgent: string | undefined;
    settingsAutoCreateWorktree: boolean;
    settingsGitmojiEnabled: boolean;
    settingsDefaultFileViewerPreview: boolean;
    settingsZenModel: string | undefined;
    settingsMessageStreamTransport: 'auto' | 'ws' | 'sse';

    activateDirectory: (directory: string | null | undefined) => Promise<void>;

    loadProviders: (options?: { directory?: string | null }) => Promise<void>;
    loadAgents: (options?: { directory?: string | null }) => Promise<boolean>;
    invalidateModelMetadataCache: () => void;
    setProvider: (providerId: string) => void;
    setModel: (modelId: string) => void;
    setCurrentVariant: (variant: string | undefined) => void;
    cycleCurrentVariant: () => void;
    getCurrentModelVariants: () => string[];
    setAgent: (agentName: string | undefined) => void;
    setSelectedProvider: (providerId: string) => void;
    setSettingsDefaultModel: (model: string | undefined) => void;
    setSettingsDefaultVariant: (variant: string | undefined) => void;
    setSettingsDefaultAgent: (agent: string | undefined) => void;
    setSettingsAutoCreateWorktree: (enabled: boolean) => void;
    setSettingsGitmojiEnabled: (enabled: boolean) => void;
    setSettingsDefaultFileViewerPreview: (enabled: boolean) => void;
    setSettingsZenModel: (model: string | undefined) => void;
    setSettingsMessageStreamTransport: (transport: 'auto' | 'ws' | 'sse') => void;
    getResolvedGitGenerationModel: () => { providerId: string; modelId: string } | null;
    saveAgentModelSelection: (agentName: string, providerId: string, modelId: string) => void;
    getAgentModelSelection: (agentName: string) => { providerId: string; modelId: string } | null;
    probeConnection: (options?: { timeoutMs?: number }) => Promise<boolean>;
    checkConnection: () => Promise<boolean>;
    initializeApp: () => Promise<void>;
    getCurrentProvider: () => ProviderWithModelList | undefined;
    getCurrentModel: () => ProviderModel | undefined;
    getCurrentAgent: () => Agent | undefined;
    getModelMetadata: (providerId: string, modelId: string) => ModelMetadata | undefined;
    // Returns only visible agents (excludes hidden internal agents like title, compaction, summary)
    getVisibleAgents: () => Agent[];
}

// In-flight dedup: prevent concurrent duplicate loadProviders/loadAgents calls for the same directory
const _inFlightProviders = new Map<string, Promise<void>>();
// While the engine is still starting, provider reads fail transiently. Instead
// of surfacing a terminal "Unable to load providers" error, keep the loading
// state and re-poll until this per-directory deadline, then give up.
const _providerStartupPollUntil = new Map<string, number>();
// Pending re-poll timers, keyed by directory. The in-flight dedup map only
// covers a load that is actively running; this map reserves the directory
// across the gap between a failed cycle returning and its re-poll firing, so
// other callers don't fan out additional concurrent poll chains.
const _providerPollTimer = new Map<string, ReturnType<typeof setTimeout>>();
const PROVIDER_STARTUP_POLL_MS = 2000;
const PROVIDER_STARTUP_POLL_WINDOW_MS = 30000;
const PROVIDER_FETCH_TIMEOUT_MS = 10_000;

/**
 * Resolves settingsDefaultModel ("provider/model") into current selection IDs
 * if the provider and model exist in the loaded provider list.
 */
const resolveSettingsDefaultSelection = (
    providers: ProviderWithModelList[],
    settingsDefaultModel: string | undefined,
    settingsDefaultVariant: string | undefined,
): { currentProviderId: string; currentModelId: string; currentVariant?: string; selectedProviderId: string } | null => {
    if (!settingsDefaultModel) return null;
    const parsed = parseModelString(settingsDefaultModel);
    if (!parsed) return null;
    const settingsProvider = providers.find((p) => p.id === parsed.providerId);
    if (!settingsProvider?.models.some((m) => m.id === parsed.modelId)) return null;
    const model = settingsProvider.models.find((m) => m.id === parsed.modelId);
    const currentVariant = settingsDefaultVariant && (model as { variants?: Record<string, unknown> } | undefined)?.variants?.[settingsDefaultVariant]
        ? settingsDefaultVariant
        : undefined;
    return {
        currentProviderId: parsed.providerId,
        currentModelId: parsed.modelId,
        currentVariant: currentVariant,
        selectedProviderId: parsed.providerId,
    };
};

/**
 * Safely transform provider.models (which may be a record, array, or missing)
 * into a ProviderModel[].
 */
const normalizeProviderModels = (provider: { id?: string; models?: unknown }): ProviderModel[] => {
    const modelRecord = provider.models;
    if (Array.isArray(modelRecord)) {
        return modelRecord as ProviderModel[];
    }
    if (modelRecord && typeof modelRecord === 'object') {
        return Object.keys(modelRecord as Record<string, ProviderModel>).map((modelId) => (modelRecord as Record<string, ProviderModel>)[modelId]);
    }
    console.warn(`[loadProviders] Provider "${provider.id ?? 'unknown'}" has unexpected models shape:`, typeof modelRecord);
    return [];
};
const _inFlightAgents = new Map<string, Promise<boolean>>();
let _initializeAppInFlight: Promise<void> | null = null;

export const useConfigStore = create<ConfigStore>()(
    devtools(
        persist(
            (set, get) => ({

                activeDirectoryKey: resolveInitialDirectoryKey(),
                directoryScoped: {},

                providers: [],
                providersLoading: false,
                providersError: null,
                agents: [],
                currentProviderId: "",
                currentModelId: "",
                currentVariant: undefined,
                currentAgentName: undefined,
                selectedProviderId: "",
                agentModelSelections: {},
                defaultProviders: {},
                isConnected: false,
                hasEverConnected: false,
                connectionPhase: "connecting",
                lastDisconnectReason: null,
                isInitialized: false,
                modelsMetadata: new Map<string, ModelMetadata>(),
                settingsDefaultModel: undefined,
                settingsDefaultVariant: undefined,
                settingsDefaultAgent: undefined,
                settingsAutoCreateWorktree: false,
                settingsGitmojiEnabled: false,
                settingsDefaultFileViewerPreview: false,
                settingsZenModel: undefined,
                settingsMessageStreamTransport: 'auto',
                activateDirectory: async (directory) => {
                    const directoryKey = toDirectoryKey(directory);

                    // Cancel pending provider poll timers for the previous directory
                    // to prevent zombie re-polls after switching.
                    {
                        const prevKey = get().activeDirectoryKey;
                        if (prevKey && prevKey !== directoryKey) {
                            const pending = _providerPollTimer.get(prevKey);
                            if (pending) { clearTimeout(pending); _providerPollTimer.delete(prevKey); }
                            _providerStartupPollUntil.delete(prevKey);
                        }
                    }

                    set((state) => {
                        const snapshot = state.directoryScoped[directoryKey];
                        if (snapshot) {
                            return {
                                activeDirectoryKey: directoryKey,
                                providers: snapshot.providers,
                                agents: snapshot.agents,
                                currentProviderId: snapshot.currentProviderId,
                                currentModelId: snapshot.currentModelId,
                                currentVariant: snapshot.currentVariant,
                                currentAgentName: snapshot.currentAgentName,
                                selectedProviderId: snapshot.selectedProviderId,
                                agentModelSelections: snapshot.agentModelSelections,
                                defaultProviders: snapshot.defaultProviders,
                                providersLoading: false,
                                providersError: null,
                            };
                        }

                        return {
                            activeDirectoryKey: directoryKey,
                            providers: [],
                            agents: [],
                            currentProviderId: "",
                            currentModelId: "",
                            currentAgentName: undefined,
                            selectedProviderId: "",
                            agentModelSelections: {},
                            defaultProviders: {},
                            providersLoading: false,
                            providersError: null,
                        };
                    });

                    if (!get().isConnected) {
                        return;
                    }

                    await get().loadProviders({ directory: fromDirectoryKey(directoryKey) });
                    await get().loadAgents({ directory: fromDirectoryKey(directoryKey) });
                },

                loadProviders: async (options) => {
                    const directoryKey = toDirectoryKey(options?.directory ?? fromDirectoryKey(get().activeDirectoryKey));

                    // Dedup: if a load is already in-flight for this directory, reuse it
                    const existing = _inFlightProviders.get(directoryKey);
                    if (existing) return existing;
                    // A startup re-poll is already pending for this directory — don't
                    // fan out a second chain; the pending poll will perform the load.
                    if (_providerPollTimer.has(directoryKey)) return;

                    const promise = (async () => {
                    set((state) => state.activeDirectoryKey === directoryKey
                        ? { providersLoading: true, providersError: null }
                        : {});
                    let lastError: unknown = null;

                    // Retry budget MUST exceed the ax-code proxy provider-readiness
                    // grace window (OPEN_CODE_READY_GRACE_MS = 12s on the server).
                    // A newly installed user has zero providers configured, so their
                    // `providersReady` stays false for the full grace window and the
                    // proxy gates GET /config/providers with 503 until uptime > 12s.
                    // With 12 attempts and 250*(attempt+1) backoff, the last useful
                    // attempt lands at ~16.5s — safely past the gate — so the
                    // (possibly empty) list loads instead of surfacing a load error.
                    for (let attempt = 0; attempt < 12; attempt++) {
                        try {
                            ensureModelsMetadataFetch(
                                () => get().modelsMetadata,
                                (metadata) => set({ modelsMetadata: metadata }),
                            );
                            const apiResult = await Promise.race([
                                axCodeClient.withDirectory(
                                    fromDirectoryKey(directoryKey),
                                    () => axCodeClient.getProviders()
                                ),
                                sleep(PROVIDER_FETCH_TIMEOUT_MS).then((): never => {
                                    throw new Error(`Provider request timed out after ${PROVIDER_FETCH_TIMEOUT_MS / 1000}s`);
                                }),
                            ]);
                            const providers = Array.isArray(apiResult?.providers) ? apiResult.providers : [];
                            const defaults = apiResult?.default || {};

                            const processedProviders: ProviderWithModelList[] = providers.map((provider) => ({
                                ...provider,
                                models: normalizeProviderModels(provider),
                            }));

                            set((state) => {
                                const baseSnapshot: DirectoryScopedConfig = state.directoryScoped[directoryKey] ?? {
                                    providers: [],
                                    agents: [],
                                    currentProviderId: "",
                                    currentModelId: "",
                                    currentAgentName: undefined,
                                    selectedProviderId: "",
                                    agentModelSelections: {},
                                    defaultProviders: {},
                                };

                                const nextSnapshot: DirectoryScopedConfig = {
                                    ...baseSnapshot,
                                    providers: processedProviders,
                                    defaultProviders: defaults,
                                };

                                const nextState: Partial<ConfigStore> = {
                                    directoryScoped: {
                                        ...state.directoryScoped,
                                        [directoryKey]: nextSnapshot,
                                    },
                                };

                                if (state.activeDirectoryKey === directoryKey) {
                                    nextState.providers = processedProviders;
                                    nextState.defaultProviders = defaults;
                                    nextState.providersLoading = false;
                                    nextState.providersError = null;

                                    const resolved = resolveSettingsDefaultSelection(
                                        processedProviders,
                                        state.settingsDefaultModel,
                                        state.settingsDefaultVariant,
                                    );
                                    if (resolved && !state.currentProviderId && !state.currentModelId) {
                                        Object.assign(nextState, resolved);
                                        Object.assign(nextSnapshot, resolved);
                                    }
                                }

                                return nextState;
                            });

                            _providerStartupPollUntil.delete(directoryKey);
                            {
                                const pending = _providerPollTimer.get(directoryKey);
                                if (pending) { clearTimeout(pending); _providerPollTimer.delete(directoryKey); }
                            }
                            _inFlightProviders.delete(directoryKey);
                            return;
                        } catch (error) {
                            lastError = error;
                            const waitMs = 250 * (attempt + 1);
                            await new Promise((resolve) => setTimeout(resolve, waitMs));
                        }
                    }

                    // The engine is likely still starting (provider reads answer
                    // 503 {restarting:true} until it is up). Keep the loading
                    // state and re-poll until the deadline instead of showing a
                    // terminal error that usually clears itself within seconds.
                    {
                        const now = Date.now();
                        let pollUntil = _providerStartupPollUntil.get(directoryKey);
                        if (pollUntil === undefined) {
                            pollUntil = now + PROVIDER_STARTUP_POLL_WINDOW_MS;
                            _providerStartupPollUntil.set(directoryKey, pollUntil);
                        }
                        if (now < pollUntil) {
                            set((state) => state.activeDirectoryKey === directoryKey
                                ? { providersLoading: true, providersError: null }
                                : {});
                            const timer = setTimeout(() => {
                                _providerPollTimer.delete(directoryKey);
                                void get().loadProviders({ directory: fromDirectoryKey(directoryKey) });
                            }, PROVIDER_STARTUP_POLL_MS);
                            _providerPollTimer.set(directoryKey, timer);
                            return;
                        }
                        _providerStartupPollUntil.delete(directoryKey);
                    }

                    console.error("Failed to load providers:", lastError);

                    // Re-read from current state instead of using stale pre-loop snapshot.
                    // SSE events may have updated providers during the retry period.
                    set((state) => {
                        const baseSnapshot: DirectoryScopedConfig = state.directoryScoped[directoryKey] ?? {
                            providers: [],
                            agents: [],
                            currentProviderId: "",
                            currentModelId: "",
                            currentAgentName: undefined,
                            selectedProviderId: "",
                            agentModelSelections: {},
                            defaultProviders: {},
                        };

                        const fallbackProviders = baseSnapshot.providers.length > 0
                            ? baseSnapshot.providers
                            : (state.activeDirectoryKey === directoryKey ? state.providers : []);
                        const fallbackDefaults = baseSnapshot.defaultProviders
                            ? baseSnapshot.defaultProviders
                            : (state.activeDirectoryKey === directoryKey ? state.defaultProviders : {});

                        const nextSnapshot: DirectoryScopedConfig = {
                            ...baseSnapshot,
                            providers: fallbackProviders,
                            defaultProviders: fallbackDefaults,
                        };

                        const nextState: Partial<ConfigStore> = {
                            directoryScoped: {
                                ...state.directoryScoped,
                                [directoryKey]: nextSnapshot,
                            },
                        };

                        if (state.activeDirectoryKey === directoryKey) {
                            nextState.providers = fallbackProviders;
                            nextState.defaultProviders = fallbackDefaults;
                            nextState.providersLoading = false;
                            nextState.providersError = "Unable to load providers";

                            const resolved = resolveSettingsDefaultSelection(
                                fallbackProviders,
                                state.settingsDefaultModel,
                                state.settingsDefaultVariant,
                            );
                            if (resolved && !state.currentProviderId && !state.currentModelId) {
                                Object.assign(nextState, resolved);
                                Object.assign(nextSnapshot, resolved);
                            }
                        }

                        return nextState;
                    });
                    })().finally(() => _inFlightProviders.delete(directoryKey));

                    _inFlightProviders.set(directoryKey, promise);
                    return promise;
                },

                setProvider: (providerId: string) => {
                    const { providers } = get();
                    const provider = providers.find((p) => p.id === providerId);
 
                    if (!provider) {
                        return;
                    }
 
                    const firstModel = provider.models[0];
                    const newModelId = firstModel?.id || "";
 
                    set((state) => {
                        const directoryKey = state.activeDirectoryKey;
                        const baseSnapshot: DirectoryScopedConfig = state.directoryScoped[directoryKey] ?? {
                            providers: state.providers,
                            agents: state.agents,
                            currentProviderId: state.currentProviderId,
                            currentModelId: state.currentModelId,
                            currentVariant: state.currentVariant,
                            currentAgentName: state.currentAgentName,
                            selectedProviderId: state.selectedProviderId,
                            agentModelSelections: state.agentModelSelections,
                            defaultProviders: state.defaultProviders,
                        };

                        const nextSnapshot: DirectoryScopedConfig = {
                            ...baseSnapshot,
                            currentProviderId: providerId,
                            currentModelId: newModelId,
                            selectedProviderId: providerId,
                        };

                        return {
                            currentProviderId: providerId,
                            currentModelId: newModelId,
                            selectedProviderId: providerId,
                            directoryScoped: {
                                ...state.directoryScoped,
                                [directoryKey]: nextSnapshot,
                            },
                        };
                    });
                },

                setModel: (modelId: string) => {
                    set((state) => {
                        const directoryKey = state.activeDirectoryKey;
                        const baseSnapshot: DirectoryScopedConfig = state.directoryScoped[directoryKey] ?? {
                            providers: state.providers,
                            agents: state.agents,
                            currentProviderId: state.currentProviderId,
                            currentModelId: state.currentModelId,
                            currentVariant: state.currentVariant,
                            currentAgentName: state.currentAgentName,
                            selectedProviderId: state.selectedProviderId,
                            agentModelSelections: state.agentModelSelections,
                            defaultProviders: state.defaultProviders,
                        };
 
                        const nextSnapshot: DirectoryScopedConfig = {
                            ...baseSnapshot,
                            currentModelId: modelId,
                        };
 
                        return {
                            currentModelId: modelId,
                            directoryScoped: {
                                ...state.directoryScoped,
                                [directoryKey]: nextSnapshot,
                            },
                        };
                    });
                },

                setCurrentVariant: (variant: string | undefined) => {
                    set((state) => {
                        if (state.currentVariant === variant) {
                            return state;
                        }

                        const directoryKey = state.activeDirectoryKey;
                        const baseSnapshot: DirectoryScopedConfig = state.directoryScoped[directoryKey] ?? {
                            providers: state.providers,
                            agents: state.agents,
                            currentProviderId: state.currentProviderId,
                            currentModelId: state.currentModelId,
                            currentVariant: state.currentVariant,
                            currentAgentName: state.currentAgentName,
                            selectedProviderId: state.selectedProviderId,
                            agentModelSelections: state.agentModelSelections,
                            defaultProviders: state.defaultProviders,
                        };

                        const nextSnapshot: DirectoryScopedConfig = {
                            ...baseSnapshot,
                            currentVariant: variant,
                        };

                        return {
                            currentVariant: variant,
                            directoryScoped: {
                                ...state.directoryScoped,
                                [directoryKey]: nextSnapshot,
                            },
                        };
                    });
                },

                getCurrentModelVariants: () => {
                    const model = get().getCurrentModel();
                    const variants = (model as { variants?: Record<string, unknown> } | undefined)?.variants;
                    if (!variants) {
                        return [];
                    }
                    return Object.keys(variants);
                },

                cycleCurrentVariant: () => {
                    const variantKeys = get().getCurrentModelVariants();
                    if (variantKeys.length === 0) {
                        return;
                    }

                    const current = get().currentVariant;
                    if (!current) {
                        get().setCurrentVariant(variantKeys[0]);
                        return;
                    }

                    const index = variantKeys.indexOf(current);
                    if (index === -1 || index === variantKeys.length - 1) {
                        get().setCurrentVariant(undefined);
                        return;
                    }

                    get().setCurrentVariant(variantKeys[index + 1]);
                },
 
                setSelectedProvider: (providerId: string) => {
                    set((state) => {
                        const directoryKey = state.activeDirectoryKey;
                        const baseSnapshot: DirectoryScopedConfig = state.directoryScoped[directoryKey] ?? {
                            providers: state.providers,
                            agents: state.agents,
                            currentProviderId: state.currentProviderId,
                            currentModelId: state.currentModelId,
                            currentAgentName: state.currentAgentName,
                            selectedProviderId: state.selectedProviderId,
                            agentModelSelections: state.agentModelSelections,
                            defaultProviders: state.defaultProviders,
                        };

                        const nextSnapshot: DirectoryScopedConfig = {
                            ...baseSnapshot,
                            selectedProviderId: providerId,
                        };

                        return {
                            selectedProviderId: providerId,
                            directoryScoped: {
                                ...state.directoryScoped,
                                [directoryKey]: nextSnapshot,
                            },
                        };
                    });
                },

                saveAgentModelSelection: (agentName: string, providerId: string, modelId: string) => {
                    set((state) => {
                        const directoryKey = state.activeDirectoryKey;
                        const nextSelections = {
                            ...state.agentModelSelections,
                            [agentName]: { providerId, modelId },
                        };

                        const baseSnapshot: DirectoryScopedConfig = state.directoryScoped[directoryKey] ?? {
                            providers: state.providers,
                            agents: state.agents,
                            currentProviderId: state.currentProviderId,
                            currentModelId: state.currentModelId,
                            currentAgentName: state.currentAgentName,
                            selectedProviderId: state.selectedProviderId,
                            agentModelSelections: state.agentModelSelections,
                            defaultProviders: state.defaultProviders,
                        };

                        const nextSnapshot: DirectoryScopedConfig = {
                            ...baseSnapshot,
                            agentModelSelections: nextSelections,
                        };

                        return {
                            agentModelSelections: nextSelections,
                            directoryScoped: {
                                ...state.directoryScoped,
                                [directoryKey]: nextSnapshot,
                            },
                        };
                    });
                },

                getAgentModelSelection: (agentName: string) => {
                    const { agentModelSelections } = get();
                    return agentModelSelections[agentName] || null;
                },

                loadAgents: async (options) => {
                    const directoryKey = toDirectoryKey(options?.directory ?? fromDirectoryKey(get().activeDirectoryKey));

                    // Dedup: if a load is already in-flight for this directory, reuse it
                    const existing = _inFlightAgents.get(directoryKey);
                    if (existing) return existing;

                    const promise = (async (): Promise<boolean> => {
                    const existingSnapshot = get().directoryScoped[directoryKey];
                    const previousAgents = existingSnapshot?.agents ?? (get().activeDirectoryKey === directoryKey ? get().agents : []);
                    let lastError: unknown = null;

                    for (let attempt = 0; attempt < 3; attempt++) {
                        try {
                            // Fetch agents and OpenChamber settings in parallel
                            const [agents, openChamberDefaults] = await Promise.all([
                                axCodeClient.withDirectory(fromDirectoryKey(directoryKey), () => axCodeClient.listAgents()),
                                fetchOpenChamberDefaults(),
                            ]);

                            const safeAgents = Array.isArray(agents) ? agents : [];

                            const providers = get().activeDirectoryKey === directoryKey
                                ? get().providers
                                : (get().directoryScoped[directoryKey]?.providers ?? []);

                            const existingZenModel = normalizeOptionalString(get().settingsZenModel);

                            const defaultZenModel = normalizeOptionalString(openChamberDefaults.zenModel);

                            const resolvedExistingGitSelection = resolveGitGenerationModelSelection({
                                providers,
                                settingsZenModel: existingZenModel,
                            });

                            const resolvedDefaultGitSelection = resolveGitGenerationModelSelection({
                                providers,
                                settingsZenModel: defaultZenModel,
                            });

                            const resolvedGitSelection = resolvedExistingGitSelection || resolvedDefaultGitSelection;
                            const resolvedGitModelId = resolvedGitSelection?.modelId;
                            const resolvedZenModel = resolvedGitModelId || defaultZenModel || existingZenModel;

                            set((state) => {
                                const baseSnapshot: DirectoryScopedConfig = state.directoryScoped[directoryKey] ?? {
                                    providers,
                                    agents: previousAgents,
                                    currentProviderId: "",
                                    currentModelId: "",
                                    currentAgentName: undefined,
                                    selectedProviderId: "",
                                    agentModelSelections: {},
                                    defaultProviders: {},
                                };

                                const nextSnapshot: DirectoryScopedConfig = {
                                    ...baseSnapshot,
                                    providers,
                                    agents: safeAgents,
                                };

                                const nextState: Partial<ConfigStore> = {
                                    settingsDefaultModel: openChamberDefaults.defaultModel,
                                    settingsDefaultVariant: openChamberDefaults.defaultVariant,
                                    settingsDefaultAgent: openChamberDefaults.defaultAgent,
                                    settingsAutoCreateWorktree: openChamberDefaults.autoCreateWorktree ?? false,
                                    settingsGitmojiEnabled: openChamberDefaults.gitmojiEnabled ?? false,
                                    settingsDefaultFileViewerPreview: openChamberDefaults.defaultFileViewerPreview ?? false,
                                    settingsZenModel: resolvedZenModel,
                                    settingsMessageStreamTransport: openChamberDefaults.messageStreamTransport ?? state.settingsMessageStreamTransport ?? 'auto',
                                    directoryScoped: {
                                        ...state.directoryScoped,
                                        [directoryKey]: nextSnapshot,
                                    },
                                };

                                if (state.activeDirectoryKey === directoryKey) {
                                    nextState.agents = safeAgents;
                                }

                                return nextState;
                            });

                            const shouldPersistResolvedZenModel =
                                !!resolvedZenModel &&
                                resolvedZenModel !== defaultZenModel;

                            if (shouldPersistResolvedZenModel && resolvedZenModel) {
                                updateDesktopSettings({
                                    zenModel: resolvedZenModel,
                                    gitProviderId: '',
                                    gitModelId: '',
                                }).catch(() => {
                                    // Ignore errors - best effort cleanup
                                });
                            }

                            if (safeAgents.length === 0) {
                                set((state) => {
                                    const baseSnapshot: DirectoryScopedConfig = state.directoryScoped[directoryKey] ?? {
                                        providers,
                                        agents: [],
                            currentProviderId: "",
                            currentModelId: "",
                            currentVariant: undefined,
                            currentAgentName: undefined,
                                        selectedProviderId: "",
                                        agentModelSelections: {},
                                        defaultProviders: {},
                                    };

                                    const nextSnapshot: DirectoryScopedConfig = {
                                        ...baseSnapshot,
                                        providers,
                                        agents: [],
                                        currentAgentName: undefined,
                                    };

                                    const nextState: Partial<ConfigStore> = {
                                        directoryScoped: {
                                            ...state.directoryScoped,
                                            [directoryKey]: nextSnapshot,
                                        },
                                    };

                                    if (state.activeDirectoryKey === directoryKey) {
                                        nextState.currentAgentName = undefined;
                                    }

                                    return nextState;
                                });

                                return true;
                            }

                            // Helper to validate model exists in providers
                            const validateModel = (providerId: string, modelId: string): boolean => {
                                const provider = providers.find((p) => p.id === providerId);
                                if (!provider) return false;
                                return provider.models.some((m) => m.id === modelId);
                            };

                            // --- Agent Selection ---
                            // Priority: settings.defaultAgent → build → first primary → first agent
                            const primaryAgents = safeAgents.filter((agent) => isPrimaryMode(agent.mode));
                            const buildAgent = primaryAgents.find((agent) => agent.name === "build");
                            const fallbackAgent = buildAgent || primaryAgents[0] || safeAgents[0];

                            let resolvedAgent: Agent = fallbackAgent;

                            // Track invalid settings to clear
                             const invalidSettings: { defaultModel?: string; defaultVariant?: string; defaultAgent?: string } = {};

                            // 1. Check OpenChamber settings for default agent
                            if (openChamberDefaults.defaultAgent) {
                                const settingsAgent = safeAgents.find((agent) => agent.name === openChamberDefaults.defaultAgent);
                                if (settingsAgent) {
                                    resolvedAgent = settingsAgent;
                                } else {
                                    // Agent no longer exists - mark for clearing
                                    invalidSettings.defaultAgent = '';
                                }
                            }

                             // --- Model Selection ---
                             // Priority: settings.defaultModel → agent's preferred model → ax-code/big-pickle
                             let resolvedProviderId: string | undefined;
                             let resolvedModelId: string | undefined;
                             let resolvedVariant: string | undefined;

                             // 1. Check OpenChamber settings for default model
                             if (openChamberDefaults.defaultModel) {
                                 const parsed = parseModelString(openChamberDefaults.defaultModel);
                                 if (parsed && validateModel(parsed.providerId, parsed.modelId)) {
                                     resolvedProviderId = parsed.providerId;
                                     resolvedModelId = parsed.modelId;

                                     if (openChamberDefaults.defaultVariant) {
                                         const provider = providers.find((p) => p.id === parsed.providerId);
                                         const model = provider?.models.find((m) => m.id === parsed.modelId) as { variants?: Record<string, unknown> } | undefined;
                                         const variants = model?.variants;
                                         if (variants && Object.prototype.hasOwnProperty.call(variants, openChamberDefaults.defaultVariant)) {
                                             resolvedVariant = openChamberDefaults.defaultVariant;
                                         } else {
                                             invalidSettings.defaultVariant = '';
                                         }
                                     }
                                 } else {
                                     // Model no longer exists - mark for clearing
                                     invalidSettings.defaultModel = '';
                                 }
                             }

                            // 2. Fall back to agent's preferred model
                            if (!resolvedProviderId && resolvedAgent?.model?.providerID && resolvedAgent?.model?.modelID) {
                                const { providerID, modelID } = resolvedAgent.model;
                                if (validateModel(providerID, modelID)) {
                                    resolvedProviderId = providerID;
                                    resolvedModelId = modelID;
                                }
                            }

                            // 3. Fall back to ax-code/big-pickle
                            if (!resolvedProviderId) {
                                if (validateModel(FALLBACK_PROVIDER_ID, FALLBACK_MODEL_ID)) {
                                    resolvedProviderId = FALLBACK_PROVIDER_ID;
                                    resolvedModelId = FALLBACK_MODEL_ID;
                                } else {
                                    // Last resort: first provider's first model
                                    const firstProvider = providers[0];
                                    const firstModel = firstProvider?.models[0];
                                    if (firstProvider && firstModel) {
                                        resolvedProviderId = firstProvider.id;
                                        resolvedModelId = firstModel.id;
                                    }
                                }
                            }

                            set((state) => {
                                const baseSnapshot: DirectoryScopedConfig = state.directoryScoped[directoryKey] ?? {
                                    providers,
                                    agents: safeAgents,
                                    currentProviderId: "",
                                    currentModelId: "",
                                    currentAgentName: undefined,
                                    selectedProviderId: "",
                                    agentModelSelections: {},
                                    defaultProviders: {},
                                };

                                const nextSnapshot: DirectoryScopedConfig = {
                                    ...baseSnapshot,
                                    providers,
                                    agents: safeAgents,
                                    currentAgentName: resolvedAgent.name,
                                    currentProviderId: resolvedProviderId ?? baseSnapshot.currentProviderId,
                                    currentModelId: resolvedModelId ?? baseSnapshot.currentModelId,
                                    currentVariant: resolvedVariant,
                                };

                                const nextState: Partial<ConfigStore> = {
                                    directoryScoped: {
                                        ...state.directoryScoped,
                                        [directoryKey]: nextSnapshot,
                                    },
                                };

                                if (state.activeDirectoryKey === directoryKey) {
                                    nextState.currentAgentName = resolvedAgent.name;
                                    if (resolvedProviderId && resolvedModelId) {
                                        nextState.currentProviderId = resolvedProviderId;
                                        nextState.currentModelId = resolvedModelId;
                                        nextState.currentVariant = resolvedVariant;
                                    }
                                }

                                return nextState;
                            });

                            // Clear invalid settings from storage (best-effort cleanup)
                            if (Object.keys(invalidSettings).length > 0) {
                                // Also clear from store state
                                 set({
                                     settingsDefaultModel: invalidSettings.defaultModel !== undefined ? undefined : get().settingsDefaultModel,
                                     settingsDefaultVariant: invalidSettings.defaultVariant !== undefined ? undefined : get().settingsDefaultVariant,
                                     settingsDefaultAgent: invalidSettings.defaultAgent !== undefined ? undefined : get().settingsDefaultAgent,
                                 });
                                updateDesktopSettings(invalidSettings).catch(() => {
                                    // Ignore errors - best effort cleanup
                                });
                            }

                            return true;
                        } catch (error) {
                            lastError = error;
                            const waitMs = 200 * (attempt + 1);
                            await new Promise((resolve) => setTimeout(resolve, waitMs));
                        }
                    }

                    console.error("Failed to load agents:", lastError);

                    set((state) => {
                        const providers = state.activeDirectoryKey === directoryKey
                            ? state.providers
                            : (state.directoryScoped[directoryKey]?.providers ?? []);

                        const baseSnapshot: DirectoryScopedConfig = state.directoryScoped[directoryKey] ?? {
                            providers,
                            agents: [],
                            currentProviderId: "",
                            currentModelId: "",
                            currentAgentName: undefined,
                            selectedProviderId: "",
                            agentModelSelections: {},
                            defaultProviders: {},
                        };

                        const nextSnapshot: DirectoryScopedConfig = {
                            ...baseSnapshot,
                            providers,
                            agents: previousAgents,
                        };

                        const nextState: Partial<ConfigStore> = {
                            directoryScoped: {
                                ...state.directoryScoped,
                                [directoryKey]: nextSnapshot,
                            },
                        };

                        if (state.activeDirectoryKey === directoryKey) {
                            nextState.agents = previousAgents;
                        }

                        return nextState;
                    });

                    return false;
                    })().finally(() => _inFlightAgents.delete(directoryKey));

                    _inFlightAgents.set(directoryKey, promise);
                    return promise;
                },

                invalidateModelMetadataCache: () => {
                    modelsMetadataInFlight = null;
                    set({ modelsMetadata: new Map<string, ModelMetadata>() });
                },

                setAgent: (agentName: string | undefined) => {
                    const {
                        agents,
                        providers,
                        settingsDefaultModel,
                        settingsDefaultVariant,
                        currentProviderId,
                        currentModelId,
                    } = get();

                    set((state) => {
                        const directoryKey = state.activeDirectoryKey;
                        const baseSnapshot: DirectoryScopedConfig = state.directoryScoped[directoryKey] ?? {
                            providers: state.providers,
                            agents: state.agents,
                            currentProviderId: state.currentProviderId,
                            currentModelId: state.currentModelId,
                            currentAgentName: state.currentAgentName,
                            selectedProviderId: state.selectedProviderId,
                            agentModelSelections: state.agentModelSelections,
                            defaultProviders: state.defaultProviders,
                        };

                        const nextSnapshot: DirectoryScopedConfig = {
                            ...baseSnapshot,
                            currentAgentName: agentName,
                        };

                        return {
                            currentAgentName: agentName,
                            directoryScoped: {
                                ...state.directoryScoped,
                                [directoryKey]: nextSnapshot,
                            },
                        };
                    });

                    if (agentName) {
                        const { currentSessionId } = useSessionUIStore.getState();
                        const selState = useSelectionStore.getState();

                        if (currentSessionId) {
                            selState.saveSessionAgentSelection(currentSessionId, agentName);
                        }
                    }

                    if (agentName) {
                        const { currentSessionId } = useSessionUIStore.getState();

                        const applyResolvedModelSelection = (providerId: string, modelId: string, variant?: string) => {
                            set((state) => {
                                const directoryKey = state.activeDirectoryKey;
                                const baseSnapshot: DirectoryScopedConfig = state.directoryScoped[directoryKey] ?? {
                                    providers: state.providers,
                                    agents: state.agents,
                                    currentProviderId: state.currentProviderId,
                                    currentModelId: state.currentModelId,
                                    currentVariant: state.currentVariant,
                                    currentAgentName: state.currentAgentName,
                                    selectedProviderId: state.selectedProviderId,
                                    agentModelSelections: state.agentModelSelections,
                                    defaultProviders: state.defaultProviders,
                                };

                                const nextSnapshot: DirectoryScopedConfig = {
                                    ...baseSnapshot,
                                    currentProviderId: providerId,
                                    currentModelId: modelId,
                                    currentVariant: variant,
                                    selectedProviderId: providerId,
                                };

                                return {
                                    currentProviderId: providerId,
                                    currentModelId: modelId,
                                    currentVariant: variant,
                                    selectedProviderId: providerId,
                                    directoryScoped: {
                                        ...state.directoryScoped,
                                        [directoryKey]: nextSnapshot,
                                    },
                                };
                            });
                        };

                        // Prefer the selected agent's configured model when switching agents.
                        const agent = agents.find((candidate) => candidate.name === agentName);
                        const agentModelSelection = agent?.model;
                        if (agentModelSelection?.providerID && agentModelSelection?.modelID) {
                            const { providerID, modelID } = agentModelSelection;
                            const agentProvider = providers.find((provider) => provider.id === providerID);
                            const agentModel = agentProvider?.models.find((model) => model.id === modelID);

                            if (agentModel) {
                                applyResolvedModelSelection(providerID, modelID, undefined);
                                return;
                            }
                        }

                        if (currentSessionId) {
                            const existingAgentModel = useSelectionStore.getState().getAgentModelForSession(currentSessionId, agentName);
                            if (existingAgentModel && hasProviderModel(providers, existingAgentModel.providerId, existingAgentModel.modelId)) {
                                const savedVariant = useSelectionStore.getState().getAgentModelVariantForSession(
                                    currentSessionId,
                                    agentName,
                                    existingAgentModel.providerId,
                                    existingAgentModel.modelId,
                                );
                                if (
                                    currentProviderId !== existingAgentModel.providerId
                                    || currentModelId !== existingAgentModel.modelId
                                    || get().currentVariant !== savedVariant
                                ) {
                                    applyResolvedModelSelection(existingAgentModel.providerId, existingAgentModel.modelId, savedVariant);
                                }
                                return;
                            }
                        }

                        // If the agent has no preferred model, use settings default.
                        if (settingsDefaultModel) {
                            const parsed = parseModelString(settingsDefaultModel);
                            if (parsed) {
                                const settingsProvider = providers.find((p) => p.id === parsed.providerId);
                                if (settingsProvider?.models.some((m) => m.id === parsed.modelId)) {
                                    let nextVariant: string | undefined;
                                    if (settingsDefaultVariant) {
                                        const model = settingsProvider.models.find((m) => m.id === parsed.modelId) as { variants?: Record<string, unknown> } | undefined;
                                        const variants = model?.variants;
                                        if (variants && Object.prototype.hasOwnProperty.call(variants, settingsDefaultVariant)) {
                                            nextVariant = settingsDefaultVariant;
                                        }
                                    }

                                    applyResolvedModelSelection(parsed.providerId, parsed.modelId, nextVariant);
                                    return;
                                }
                            }
                        }

                        // Otherwise keep the current valid model selection unchanged.
                    }
                },

                 setSettingsDefaultModel: (model: string | undefined) => {
                     set({ settingsDefaultModel: model });
                 },

                 setSettingsDefaultVariant: (variant: string | undefined) => {
                     set({ settingsDefaultVariant: variant });
                 },
 
                 setSettingsDefaultAgent: (agent: string | undefined) => {
                     set({ settingsDefaultAgent: agent });
                 },

                setSettingsAutoCreateWorktree: (enabled: boolean) => {
                    set({ settingsAutoCreateWorktree: enabled });
                },

                setSettingsGitmojiEnabled: (enabled: boolean) => {
                    set({ settingsGitmojiEnabled: enabled });
                },

                setSettingsDefaultFileViewerPreview: (enabled: boolean) => {
                    set({ settingsDefaultFileViewerPreview: enabled });
                },

                setSettingsZenModel: (model: string | undefined) => {
                    set({ settingsZenModel: model });
                },

                setSettingsMessageStreamTransport: (transport: 'auto' | 'ws' | 'sse') => {
                    set({ settingsMessageStreamTransport: transport });
                },

                getResolvedGitGenerationModel: () => {
                    const state = get();
                    return resolveGitGenerationModelSelection({
                        providers: state.providers,
                        settingsZenModel: state.settingsZenModel,
                    });
                },

                probeConnection: async (options?: { timeoutMs?: number }) => {
                    const isHealthy = await probeAxCodeHealth(options?.timeoutMs);
                    if (isHealthy) {
                        set({ isConnected: true, hasEverConnected: true, connectionPhase: "connected" });
                        return true;
                    }

                    const state = get();
                    if (state.isConnected) {
                        return true;
                    }

                    set({
                        isConnected: false,
                        connectionPhase: state.hasEverConnected ? "reconnecting" : "connecting",
                        lastDisconnectReason: 'health_probe_unhealthy',
                    });
                    return false;
                },

                checkConnection: async () => {
                    const maxAttempts = 5;
                    let attempt = 0;
                    let lastError: unknown = null;

                    while (attempt < maxAttempts) {
                        try {
                            const isHealthy = await axCodeClient.checkHealth();
                            const hasEverConnected = get().hasEverConnected;
                            set(isHealthy
                                ? { isConnected: true, hasEverConnected: true, connectionPhase: "connected" }
                                : {
                                    isConnected: false,
                                    connectionPhase: hasEverConnected ? "reconnecting" : "connecting",
                                    lastDisconnectReason: 'health_check_unhealthy',
                                });
                            return isHealthy;
                        } catch (error) {
                            lastError = error;
                            attempt += 1;
                            const delay = 400 * attempt;
                            await sleep(delay);
                        }
                    }

                    if (lastError) {
                        console.warn("[ConfigStore] Failed to reach ax-code after retrying:", lastError);
                    }
                    set({
                        isConnected: false,
                        connectionPhase: get().hasEverConnected ? "reconnecting" : "connecting",
                        lastDisconnectReason: 'health_check_failed',
                    });
                    return false;
                },

                initializeApp: async () => {
                    if (_initializeAppInFlight) {
                        return _initializeAppInFlight;
                    }

                    const run = (async () => {
                        try {
                            const debug = streamDebugEnabled();
                            if (debug) console.log("Starting app initialization...");

                            const isConnected = await get().checkConnection();
                            if (debug) console.log("Connection check result:", isConnected);

                            if (!isConnected) {
                                if (debug) console.log("Server not connected");
                                // checkConnection already set lastDisconnectReason; do not overwrite.
                                set({
                                    isConnected: false,
                                    connectionPhase: get().hasEverConnected ? "reconnecting" : "connecting",
                                });
                                return;
                            }

                            if (debug) console.log("Initializing app...");
                            await axCodeClient.initApp();

                            if (debug) console.log("Loading providers...");
                            await get().loadProviders();

                            if (debug) console.log("Loading agents...");
                            await get().loadAgents();

                            set({ isInitialized: true, isConnected: true, hasEverConnected: true, connectionPhase: "connected" });
                            if (debug) console.log("App initialized successfully");
                        } catch (error) {
                            console.error("Failed to initialize app:", error);
                            set({
                                isInitialized: false,
                                isConnected: false,
                                connectionPhase: get().hasEverConnected ? "reconnecting" : "connecting",
                                lastDisconnectReason: 'init_error',
                            });
                        }
                    })().finally(() => {
                        _initializeAppInFlight = null;
                    });

                    _initializeAppInFlight = run;
                    return run;
                },

                getCurrentProvider: () => {
                    const { providers, currentProviderId } = get();
                    return providers.find((p) => p.id === currentProviderId);
                },

                getCurrentModel: () => {
                    const provider = get().getCurrentProvider();
                    const { currentModelId } = get();
                    if (!provider) {
                        return undefined;
                    }
                    return provider.models.find((model) => model.id === currentModelId);
                },

                getCurrentAgent: () => {
                    const { agents, currentAgentName } = get();
                    if (!currentAgentName) return undefined;
                    return agents.find((a) => a.name === currentAgentName);
                },
                getModelMetadata: (providerId: string, modelId: string) => {
                    const key = buildModelMetadataKey(providerId, modelId);
                    if (!key) {
                        return undefined;
                    }
                    const { modelsMetadata, providers } = get();
                    const cached = modelsMetadata.get(key);
                    if (cached) {
                        return cached;
                    }

                    // Fallback: derive metadata from provider model data (covers custom providers not in models.dev)
                    const provider = providers.find((p) => p.id === providerId);
                    if (!provider) {
                        return undefined;
                    }
                    const model = provider.models.find((m) => m.id === modelId);
                    if (!model) {
                        return undefined;
                    }

                    return deriveModelMetadata(providerId, model);
                },
                getVisibleAgents: () => {
                    const { agents } = get();
                    return filterVisibleAgents(agents);
                },
            }),
            {
                name: "config-store",
                storage: createJSONStorage(() => getSafeStorage()),
                partialize: (state) => ({
                    activeDirectoryKey: state.activeDirectoryKey,
                    directoryScoped: state.directoryScoped,
                    currentProviderId: state.currentProviderId,
                    currentModelId: state.currentModelId,
                    currentVariant: state.currentVariant,
                    currentAgentName: state.currentAgentName,
                    selectedProviderId: state.selectedProviderId,
                    agentModelSelections: state.agentModelSelections,
                    defaultProviders: state.defaultProviders,
                    settingsDefaultModel: state.settingsDefaultModel,
                    settingsDefaultVariant: state.settingsDefaultVariant,
                    settingsDefaultAgent: state.settingsDefaultAgent,
                    settingsAutoCreateWorktree: state.settingsAutoCreateWorktree,
                    settingsGitmojiEnabled: state.settingsGitmojiEnabled,
                    settingsDefaultFileViewerPreview: state.settingsDefaultFileViewerPreview,
                    settingsZenModel: state.settingsZenModel,
                    settingsMessageStreamTransport: state.settingsMessageStreamTransport,
                }),
             },
         ),
    ),
);

if (typeof window !== "undefined") {
    window.__zustand_config_store__ = useConfigStore;
}

let unsubscribeConfigStoreChanges: (() => void) | null = null;

if (!unsubscribeConfigStoreChanges) {
    unsubscribeConfigStoreChanges = subscribeToConfigChanges(async (event) => {
        const tasks: Promise<void>[] = [];

        if (scopeMatches(event, "agents")) {
            const { loadAgents } = useConfigStore.getState();
            tasks.push(loadAgents().then(() => {}));
        }

        if (scopeMatches(event, "providers")) {
            const { loadProviders } = useConfigStore.getState();
            tasks.push(loadProviders());
        }

        if (tasks.length > 0) {
            await Promise.all(tasks);
        }
    });
}

let unsubscribeConfigStoreDirectoryChanges: (() => void) | null = null;

if (typeof window !== "undefined" && !unsubscribeConfigStoreDirectoryChanges) {
    unsubscribeConfigStoreDirectoryChanges = useDirectoryStore.subscribe((state, prevState) => {
        const nextKey = toDirectoryKey(state.currentDirectory);
        const prevKey = toDirectoryKey(prevState.currentDirectory);
        if (nextKey === prevKey) {
            return;
        }

        void useConfigStore.getState().activateDirectory(state.currentDirectory);
    });
}
