import i18n from "@/i18n";
import { fetchChannelModels } from "@/services/api/image";
import { applyMohangChannel, createModelChannel, normalizeChannelModels, useConfigStore } from "@/stores/use-config-store";
import { useMohangStore, type MohangKey } from "@/stores/use-mohang-store";
import { useThemeStore } from "@/stores/use-theme-store";

const protocol = "mohang-canvas-v1";
let port: MessagePort | null = null;
let connectionVersion = 0;
let modelsAbort: AbortController | null = null;
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

function request<T>(action: "keys" | "connect", keyId?: number): Promise<T> {
    const currentPort = port;
    if (!currentPort) return Promise.reject(new Error(i18n.t("mohang.disconnected")));
    return new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID();
        pending.set(requestId, { resolve: (value) => resolve(value as T), reject });
        currentPort.postMessage({ requestId, action, keyId });
    });
}

export function disconnectMohang(clearCredentials = true, keyId = useMohangStore.getState().selectedId) {
    connectionVersion++;
    modelsAbort?.abort();
    modelsAbort = null;
    useConfigStore.setState(({ config }) => {
        const channel = config.channels.find((item) => keyId !== undefined && item.mohangKeyId === keyId);
        if (!clearCredentials || !channel) return { hostedChannel: null };
        return {
            hostedChannel: null,
            config: {
                ...config,
                apiKey: config.apiKey === channel.apiKey ? "" : config.apiKey,
                channels: config.channels.map((item) => item.id === channel.id ? { ...item, apiKey: "" } : item),
            },
        };
    });
    useMohangStore.setState({ connectedKey: null, connecting: false, error: "" });
}

function closeBridge() {
    disconnectMohang(false);
    port?.close();
    port = null;
    pending.forEach(({ reject }) => reject(new Error(i18n.t("mohang.disconnected"))));
    pending.clear();
    useMohangStore.setState({ available: false, keys: [], selectedId: undefined, loading: false });
}

function applyContext(data: { theme?: string; locale?: string }) {
    if (data.theme === "light" || data.theme === "dark") useThemeStore.getState().setTheme(data.theme);
    if (data.locale) void i18n.changeLanguage(data.locale.startsWith("zh") ? "zh-CN" : "en-US");
}

export function startMohangBridge() {
    // The integration is only available inside the explicitly hosted, same-origin app.
    if (window.parent === window || import.meta.env.BASE_URL !== "/infinite-canvas/") return () => {};
    const session = crypto.randomUUID();
    const ready = () => window.parent.postMessage({ protocol, type: "ready", session }, window.location.origin);
    const receive = (event: MessageEvent) => {
        if (event.origin !== window.location.origin || event.source !== window.parent || event.data?.protocol !== protocol) return;
        if (event.data.type === "probe") {
            ready();
            return;
        }
        if (event.data.type !== "host" || event.data.session !== session || !event.ports[0]) return;
        closeBridge();
        port = event.ports[0];
        applyContext(event.data);
        port.onmessage = ({ data }) => {
            if (data?.type === "revoked") {
                closeBridge();
            } else if (data?.type === "context") {
                applyContext(data);
            } else if (typeof data?.requestId === "string") {
                const item = pending.get(data.requestId);
                if (!item) return;
                pending.delete(data.requestId);
                if (typeof data.error === "string") item.reject(new Error(data.error));
                else item.resolve(data.result);
            }
        };
        port.start();
        useMohangStore.setState({ available: true });
        void refreshMohangKeys();
    };
    window.addEventListener("message", receive);
    window.addEventListener("pagehide", closeBridge);
    ready();
    return () => {
        window.removeEventListener("message", receive);
        window.removeEventListener("pagehide", closeBridge);
        closeBridge();
    };
}

export async function refreshMohangKeys() {
    const currentPort = port;
    useMohangStore.setState({ loading: true, error: "" });
    try {
        const keys = await request<MohangKey[]>("keys");
        if (port !== currentPort) return;
        const { selectedId, connectedKey } = useMohangStore.getState();
        const selected = keys.find((key) => key.id === selectedId && !key.unavailableReason);
        if (connectedKey && !keys.some((key) => key.id === connectedKey.id && !key.unavailableReason)) disconnectMohang(true, connectedKey.id);
        const config = useConfigStore.getState().config;
        const savedChannels = config.channels.filter((channel) => channel.apiKey.trim() && keys.some((key) => key.id === channel.mohangKeyId && !key.unavailableReason));
        const saved = savedChannels.find((channel) => channel.mohangKeyId === selected?.id)
            ?? savedChannels.find((channel) => channel.apiKey === config.apiKey)
            ?? savedChannels[0];
        const connected = keys.find((key) => key.id === saved?.mohangKeyId && !key.unavailableReason);
        useConfigStore.setState({ hostedChannel: connected && saved ? saved : null });
        useMohangStore.setState({ keys, connectedKey: connected || null, selectedId: selected?.id ?? connected?.id ?? keys.find((key) => !key.unavailableReason)?.id });
    } catch (error) {
        if (port === currentPort) useMohangStore.setState({ error: error instanceof Error ? error.message : i18n.t("mohang.failed") });
    } finally {
        if (port === currentPort) useMohangStore.setState({ loading: false });
    }
}

export async function connectMohang() {
    const selectedId = useMohangStore.getState().selectedId;
    if (selectedId === undefined || !port) return;
    const version = ++connectionVersion;
    modelsAbort?.abort();
    const controller = new AbortController();
    modelsAbort = controller;
    useMohangStore.setState({ connecting: true, error: "" });
    try {
        const { apiKey, baseUrl, ...key } = await request<MohangKey & { apiKey: string; baseUrl: string }>("connect", selectedId);
        if (version !== connectionVersion) return;
        const channel = createModelChannel({ mohangKeyId: key.id, name: `MoHang API · ${key.name}`, baseUrl, apiKey, apiFormat: "openai" });
        const models = normalizeChannelModels(await fetchChannelModels(channel, { signal: controller.signal }));
        if (version !== connectionVersion) return;
        if (!models.length) throw new Error(i18n.t("mohang.noModels"));
        channel.models = key.imageEnabled ? models : models.filter((model) => model.capability !== "image");
        if (!channel.models.length) throw new Error(i18n.t("mohang.noModels"));
        useConfigStore.setState(({ config }) => {
            const next = applyMohangChannel(config, channel);
            return { config: next, hostedChannel: next.channels.find((item) => item.mohangKeyId === key.id) ?? null };
        });
        useMohangStore.setState({ connectedKey: key });
    } catch (error) {
        if (version === connectionVersion) useMohangStore.setState({ error: error instanceof Error ? error.message : i18n.t("mohang.failed") });
    } finally {
        if (version === connectionVersion) {
            modelsAbort = null;
            useMohangStore.setState({ connecting: false });
        }
    }
}
