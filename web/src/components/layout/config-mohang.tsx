import { Button, Select, Tooltip, theme } from "antd";
import { CheckCircle2, KeyRound, RefreshCw, Sparkles, Unplug } from "lucide-react";
import { useTranslation } from "react-i18next";

import { connectMohang, disconnectMohang, refreshMohangKeys } from "@/services/api/mohang";
import { useConfigStore } from "@/stores/use-config-store";
import { useMohangStore } from "@/stores/use-mohang-store";

export function ConfigMohang() {
    const { t } = useTranslation();
    const { token } = theme.useToken();
    const state = useMohangStore();
    const channels = useConfigStore((store) => store.config.channels);
    if (!state.available) return null;
    const selected = state.keys.find((key) => key.id === state.selectedId);
    const channel = channels.find((item) => state.selectedId !== undefined && item.mohangKeyId === state.selectedId && item.apiKey.trim() && item.baseUrl.trim());
    const connected = Boolean(channel && selected && !selected.unavailableReason);

    return (
        <section className="mb-5 flex gap-3 rounded-lg border p-4" style={{ borderColor: token.colorSuccessBorder, background: token.colorSuccessBg }}>
            <Sparkles className="mt-0.5 size-5 shrink-0" style={{ color: token.colorSuccess }} />
            <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold">{t("mohang.title")}</h2>
                <p className="mt-1 text-xs" style={{ color: token.colorTextSecondary }}>{t("mohang.description")}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Select
                        aria-label={t("mohang.selectKey")}
                        placeholder={t("mohang.selectKey")}
                        className="w-full sm:w-80"
                        loading={state.loading}
                        disabled={state.connecting}
                        value={state.selectedId}
                        showSearch={{ optionFilterProp: "label" }}
                        suffixIcon={<KeyRound className="size-4" />}
                        options={state.keys.map((key) => ({
                            value: key.id,
                            label: [key.name, key.groupName, key.unavailableReason, !key.unavailableReason && channels.some((item) => item.mohangKeyId === key.id && item.apiKey.trim() && item.baseUrl.trim()) ? t("mohang.connectedLabel") : ""].filter(Boolean).join(" · "),
                            disabled: Boolean(key.unavailableReason),
                        }))}
                        onChange={(selectedId) => useMohangStore.setState({ selectedId, error: "" })}
                    />
                    <Button type="primary" icon={connected ? <RefreshCw className="size-4" /> : undefined} loading={state.connecting} disabled={!selected || Boolean(selected.unavailableReason) || state.loading} onClick={() => void connectMohang()}>
                        {t(connected ? "mohang.refreshModels" : "mohang.connect")}
                    </Button>
                    {connected ? <span role="status" className="inline-flex items-center gap-1 text-xs" style={{ color: token.colorSuccessText }}><CheckCircle2 className="size-3.5" />{t("mohang.connectedLabel")}</span> : null}
                    <Tooltip title={t("mohang.refresh")}>
                        <Button aria-label={t("mohang.refresh")} icon={<RefreshCw className="size-4" />} loading={state.loading} disabled={state.connecting} onClick={() => void refreshMohangKeys()} />
                    </Tooltip>
                    {channel || state.connecting ? (
                        <Tooltip title={t("mohang.disconnect")}>
                            <Button aria-label={t("mohang.disconnect")} icon={<Unplug className="size-4" />} onClick={() => disconnectMohang()} />
                        </Tooltip>
                    ) : null}
                    {selected && !selected.imageEnabled ? <span className="text-xs" style={{ color: token.colorWarningText }}>{t("mohang.imageUnavailable")}</span> : null}
                </div>
                {state.error ? <p role="alert" className="mt-2 text-xs" style={{ color: token.colorErrorText }}>{state.error}</p> : null}
                {!state.loading && !state.keys.length && !state.error ? <a className="mt-2 inline-block text-xs underline" href="/keys" target="_blank" rel="noopener noreferrer">{t("mohang.createKey")}</a> : null}
                {connected && channel && selected ? (
                    <p role="status" className="mt-2 break-words text-xs" style={{ color: token.colorSuccessText }}>
                        {t("mohang.connected", { name: selected.name, count: channel.models.length })} · {channel.baseUrl}
                    </p>
                ) : null}
            </div>
        </section>
    );
}
