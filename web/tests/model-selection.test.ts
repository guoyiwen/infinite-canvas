import { afterAll, expect, test } from "bun:test";
import type { AiConfig, ModelCapability } from "../src/stores/use-config-store";
import type { CanvasNodeData } from "../src/types/canvas";

// Config and i18n use browser storage during module initialization.
const values = new Map<string, string>();
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
    },
});
afterAll(() => {
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
});

const { applyMohangChannel, defaultConfig, resolveModelForCapability, resolveModelRequestConfig, useConfigStore } = await import("../src/stores/use-config-store");
const { buildGenerationConfig } = await import("../src/lib/canvas/canvas-generation-helpers");
const { CanvasNodeType } = await import("../src/types/canvas");

const config: AiConfig = {
    ...defaultConfig,
    videoModel: "replacement::video-b",
    channels: [
        {
            id: "replacement",
            name: "Replacement",
            baseUrl: "https://example.com",
            apiKey: "test-key",
            apiFormat: "openai",
            models: [
                { name: "video-b", capability: "video" },
                { name: "video-a", capability: "video" },
                { name: "image-a", capability: "image" },
            ],
        },
    ],
};
const ready = useConfigStore.getState().isAiConfigReady;
const videoNode = (model: string): CanvasNodeData => ({
    id: "saved-video",
    type: CanvasNodeType.Video,
    title: "Saved video",
    position: { x: 0, y: 0 },
    width: 320,
    height: 180,
    metadata: { model, videoTaskId: "original-task", videoTaskProvider: "openai", seconds: "4" },
});

test("a saved video on a removed provider is not replaced by the default video model", () => {
    const selected = buildGenerationConfig(config, videoNode("removed::video-a"), "video");
    expect(selected.model).toBe("removed::video-a");
    expect(ready(selected, selected.model)).toBe(false);
});

test("removing a model from an existing provider prevents retry even with valid credentials", () => {
    const selected = buildGenerationConfig(config, videoNode("replacement::deleted-video"), "video");
    expect(selected.model).toBe("replacement::deleted-video");
    expect(ready(selected, selected.model)).toBe(false);
});

test("task recovery rejects a missing provider instead of querying the first provider", () => {
    expect(ready(config, "removed::video-a")).toBe(false);
    expect(ready(config, "unknown-video")).toBe(false);
});

test("an explicitly selected unavailable default is not replaced by the built-in default", () => {
    const selected = buildGenerationConfig({ ...config, videoModel: "removed::video-a" }, undefined, "video");
    expect(selected.model).toBe("removed::video-a");
    expect(ready(selected, selected.model)).toBe(false);
});

test("a new node without a selection still uses its configured default", () => {
    const selected = buildGenerationConfig(config, undefined, "video");
    expect(selected.model).toBe("replacement::video-b");
    expect(ready(selected, selected.model)).toBe(true);
});

test("switching generation capability still selects a model of the new capability", () => {
    expect(resolveModelForCapability(config, "replacement::image-a", "video")).toBe("replacement::video-b");
});

test("changing only the key on the same provider preserves the saved model and task", () => {
    const node = videoNode("replacement::video-a");
    const selected = buildGenerationConfig({ ...config, channels: [{ ...config.channels[0], apiKey: "rotated-key" }] }, node, "video");
    expect(selected.model).toBe("replacement::video-a");
    expect(ready(selected, selected.model)).toBe(true);
    expect(node.metadata?.videoTaskId).toBe("original-task");
    expect(ready({ ...selected, channels: [{ ...config.channels[0], apiKey: "" }] }, selected.model)).toBe(false);
});

test("unavailable explicit selections are preserved for every generation capability", () => {
    for (const capability of ["image", "video", "text", "audio"] as ModelCapability[]) {
        expect(resolveModelForCapability(config, `removed::${capability}`, capability)).toBe(`removed::${capability}`);
    }
});

test("connecting replaces the default provider in place and preserves other providers", () => {
    const saved = { ...defaultConfig, channels: [config.channels[0], defaultConfig.channels[0]] };
    const channel = { ...config.channels[0], id: "default", mohangKeyId: 1, name: "MoHang API", apiKey: "test-imported-key", baseUrl: "https://mohang.cc" };
    const next = applyMohangChannel(saved, channel);
    expect(next.channels).toEqual([config.channels[0], channel]);
    expect(next.imageModel).toBe("default::image-a");
    expect(next.videoModel).toBe("default::video-b");
    expect(next.textModel).toBe("");
    expect(next.audioModel).toBe("");
    expect(next.models).toContain("replacement::image-a");
    expect(saved.channels[1]).toBe(defaultConfig.channels[0]);
    const request = resolveModelRequestConfig(next, next.imageModel);
    expect(request.apiKey).toBe("test-imported-key");
    expect(request.baseUrl).toBe("https://mohang.cc");
    expect(request.model).toBe("image-a");
});

test("connecting without a default appends once and subsequent refreshes update the same provider", () => {
    const channel = { ...config.channels[0], id: "mohang-first", mohangKeyId: 1, name: "MoHang API", apiKey: "test-first-key" };
    const next = applyMohangChannel(config, channel);
    expect(next.channels).toEqual([config.channels[0], channel]);
    const refreshed = applyMohangChannel(next, { ...channel, id: "fresh-request-id", apiKey: "test-second-key", models: [{ name: "video-b", capability: "video" }] });
    expect(refreshed.channels).toHaveLength(2);
    expect(refreshed.channels[0]).toBe(config.channels[0]);
    expect(refreshed.channels[1].apiKey).toBe("test-second-key");
    expect(refreshed.imageModel).toBe("");
    expect(refreshed.channels[1].id).toBe("mohang-first");
    expect(ready(refreshed, "mohang-first::image-a")).toBe(false);
    expect(refreshed.videoModel).toBe("mohang-first::video-b");
    expect(ready(refreshed, refreshed.videoModel)).toBe(true);
});

test("a model refresh preserves a still available selection on the connected provider", () => {
    const channel = { ...config.channels[0], id: "default", mohangKeyId: 1, apiKey: "test-key" };
    const next = applyMohangChannel({ ...defaultConfig, videoModel: "default::video-a" }, channel);
    expect(next.videoModel).toBe("default::video-a");
});

test("switching keys appends a provider and returning to a key refreshes only its provider", () => {
    const first = { ...config.channels[0], id: "first-request", mohangKeyId: 1, apiKey: "test-first-key" };
    const connected = applyMohangChannel(defaultConfig, first);
    const second = { ...first, id: "second-request", mohangKeyId: 2, apiKey: "test-second-key" };
    const switched = applyMohangChannel(connected, second);
    expect(switched.channels).toHaveLength(2);
    expect(switched.channels[0]).toBe(connected.channels[0]);
    expect(switched.channels[0].id).toBe("default");
    expect(switched.channels[1]).toEqual(second);
    expect(resolveModelRequestConfig(switched, "default::video-a").apiKey).toBe("test-first-key");
    expect(resolveModelRequestConfig(switched, switched.videoModel).apiKey).toBe("test-second-key");
    const refreshed = applyMohangChannel(switched, { ...first, id: "third-request", apiKey: "test-rotated-key" });
    expect(refreshed.channels).toHaveLength(2);
    expect(refreshed.channels[0].id).toBe("default");
    expect(refreshed.channels[0].apiKey).toBe("test-rotated-key");
    expect(refreshed.channels[1]).toBe(switched.channels[1]);
    expect(refreshed.videoModel).toBe("default::video-b");
});

test("reconnecting a disconnected key reuses its provider while new keys append", () => {
    const disconnected = { ...defaultConfig.channels[0], mohangKeyId: 1, apiKey: "" };
    const saved = { ...defaultConfig, channels: [disconnected, config.channels[0]] };
    const second = { ...config.channels[0], id: "second-request", mohangKeyId: 2 };
    const next = applyMohangChannel(saved, second);
    expect(next.channels).toEqual([disconnected, config.channels[0], second]);
    const reconnected = applyMohangChannel(next, { ...second, id: "first-request", mohangKeyId: 1 });
    expect(reconnected.channels).toHaveLength(3);
    expect(reconnected.channels[0].id).toBe("default");
    expect(reconnected.channels[0].apiKey).toBe(second.apiKey);
    expect(reconnected.channels[2]).toBe(next.channels[2]);
});

test("connected provider credentials are saved and restored with local channel configuration", async () => {
    const saved = useConfigStore.getState().config;
    try {
        const channel = { ...config.channels[0], id: "default", mohangKeyId: 123, apiKey: "test-local-channel-key" };
        useConfigStore.setState({ config: applyMohangChannel(saved, channel) });
        await useConfigStore.persist.rehydrate();
        expect(useConfigStore.getState().config.channels.find((item) => item.id === "default")?.apiKey).toBe("test-local-channel-key");
        expect(useConfigStore.getState().config.channels.find((item) => item.id === "default")?.mohangKeyId).toBe(123);
        expect(resolveModelRequestConfig(useConfigStore.getState().config, "default::image-a").apiKey).toBe("test-local-channel-key");
    } finally {
        useConfigStore.setState({ config: saved, hostedChannel: null });
    }
});

test("saved default provider URLs migrate to MoHang without changing keys or models", async () => {
    const migrate = useConfigStore.persist.getOptions().migrate!;
    for (const baseUrl of ["https://api.openai.com", "https://api.openai.com/", "https://api.openai.com/v1/"]) {
        const channel = { ...defaultConfig.channels[0], baseUrl, apiKey: "test-saved-key" };
        const saved = { config: { ...defaultConfig, baseUrl, channels: [channel, config.channels[0]] } };
        const migrated = (await migrate(saved, 0)) as typeof saved;
        expect(migrated.config.baseUrl).toBe("https://mohang.cc");
        expect(migrated.config.channels[0]).toEqual({ ...channel, baseUrl: "https://mohang.cc" });
        expect(migrated.config.channels[1]).toBe(config.channels[0]);
        expect(saved.config.channels[0].baseUrl).toBe(baseUrl);
    }
});

test("custom default URLs and later manual OpenAI selections are preserved", async () => {
    const migrate = useConfigStore.persist.getOptions().migrate!;
    const custom = { config: { ...defaultConfig, baseUrl: "https://example.com", channels: [{ ...defaultConfig.channels[0], baseUrl: "https://example.com" }] } };
    expect(await migrate(custom, 0)).toEqual(custom);
    const manual = { config: { ...defaultConfig, baseUrl: "https://api.openai.com", channels: [{ ...defaultConfig.channels[0], baseUrl: "https://api.openai.com" }] } };
    expect(await migrate(manual, 1)).toBe(manual);
});
