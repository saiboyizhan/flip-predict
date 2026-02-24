import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { Brain, Save, Trash2, ToggleLeft, ToggleRight, Activity } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  getAgentLlmConfig,
  setAgentLlmConfig,
  deleteAgentLlmConfig,
  toggleAgentLlm,
} from "@/app/services/api";
import type { AgentLlmConfig } from "@/app/services/api";

const PROVIDER_MODELS: Record<string, { label: string; models: string[] }> = {
  openai: { label: "providerOpenai", models: ["gpt-4o", "gpt-4o-mini"] },
  anthropic: { label: "providerAnthropic", models: ["claude-sonnet-4-5-20250929", "claude-haiku-4-5-20251001"] },
  google: { label: "providerGoogle", models: ["gemini-2.0-flash"] },
  deepseek: { label: "providerDeepseek", models: ["deepseek-chat", "deepseek-reasoner"] },
  zhipu: { label: "providerZhipu", models: ["glm-4-flash", "glm-4"] },
  custom: { label: "providerCustom", models: [] },
};

interface LlmConfigPanelProps {
  agentId: string;
}

export function LlmConfigPanel({ agentId }: LlmConfigPanelProps) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<AgentLlmConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("gpt-4o");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1024);

  useEffect(() => {
    loadConfig();
  }, [agentId]);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const data = await getAgentLlmConfig(agentId);
      setConfig(data);
      if (data) {
        setProvider(data.provider);
        setModel(data.model);
        setBaseUrl(data.baseUrl || "");
        setSystemPrompt(data.systemPrompt || "");
        setTemperature(data.temperature);
        setMaxTokens(data.maxTokens);
      }
    } catch {
      // No config yet
    } finally {
      setLoading(false);
    }
  };

  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider);
    const models = PROVIDER_MODELS[newProvider]?.models || [];
    if (models.length > 0) {
      setModel(models[0]);
    } else {
      setModel("");
    }
  };

  const handleSave = async () => {
    if (!apiKey && !config) {
      toast.error(t("agentDetail.llmConfig.apiKeyPlaceholder"));
      return;
    }

    setSaving(true);
    try {
      await setAgentLlmConfig(agentId, {
        provider,
        model,
        apiKey: apiKey || "KEEP_EXISTING",
        baseUrl: provider === "custom" ? baseUrl : undefined,
        systemPrompt: systemPrompt || undefined,
        temperature,
        maxTokens,
      });
      toast.success(t("agentDetail.llmConfig.saveSuccess"));
      setApiKey("");
      await loadConfig();
    } catch (err: any) {
      toast.error(err.message || t("agentDetail.llmConfig.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteAgentLlmConfig(agentId);
      setConfig(null);
      setProvider("openai");
      setModel("gpt-4o");
      setApiKey("");
      setBaseUrl("");
      setSystemPrompt("");
      setTemperature(0.7);
      setMaxTokens(1024);
      toast.success(t("agentDetail.llmConfig.deleteSuccess"));
    } catch (err: any) {
      toast.error(err.message || t("agentDetail.llmConfig.deleteFailed"));
    } finally {
      setDeleting(false);
    }
  };

  const handleToggle = async () => {
    if (!config) return;
    try {
      const newEnabled = !config.enabled;
      await toggleAgentLlm(agentId, newEnabled);
      setConfig((prev) => prev ? { ...prev, enabled: newEnabled ? 1 : 0 } : prev);
      toast.success(t("agentDetail.llmConfig.toggleSuccess"));
    } catch (err: any) {
      toast.error(err.message || t("agentDetail.llmConfig.toggleFailed"));
    }
  };

  if (loading) {
    return (
      <div className="bg-secondary border border-border p-6">
        <div className="text-muted-foreground text-sm">{t("common.loading")}</div>
      </div>
    );
  }

  const providerModels = PROVIDER_MODELS[provider]?.models || [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-secondary border border-border p-6 space-y-5"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold flex items-center gap-2">
          <Brain className="w-5 h-5 text-blue-400" />
          {t("agentDetail.llmConfig.title")}
        </h3>
        {config && (
          <button
            onClick={handleToggle}
            className="flex items-center gap-2 text-sm"
          >
            {config.enabled ? (
              <>
                <ToggleRight className="w-5 h-5 text-emerald-400" />
                <span className="text-emerald-400">{t("agentDetail.llmConfig.enabled")}</span>
              </>
            ) : (
              <>
                <ToggleLeft className="w-5 h-5 text-muted-foreground" />
                <span className="text-muted-foreground">{t("agentDetail.llmConfig.disabled")}</span>
              </>
            )}
          </button>
        )}
      </div>

      <p className="text-muted-foreground text-sm">
        {config ? `${t(`agentDetail.llmConfig.${PROVIDER_MODELS[config.provider]?.label || 'providerCustom'}`)} / ${config.model}` : t("agentDetail.llmConfig.notConfigured")}
      </p>

      {/* Provider Select */}
      <div className="space-y-1">
        <label className="text-sm text-muted-foreground">{t("agentDetail.llmConfig.provider")}</label>
        <select
          value={provider}
          onChange={(e) => handleProviderChange(e.target.value)}
          className="w-full bg-input-background border border-border text-foreground text-sm py-2 px-3 focus:outline-none focus:border-blue-500/50"
        >
          {Object.entries(PROVIDER_MODELS).map(([key, val]) => (
            <option key={key} value={key}>
              {t(`agentDetail.llmConfig.${val.label}`)}
            </option>
          ))}
        </select>
      </div>

      {/* Model Select or Input */}
      <div className="space-y-1">
        <label className="text-sm text-muted-foreground">{t("agentDetail.llmConfig.model")}</label>
        {providerModels.length > 0 ? (
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full bg-input-background border border-border text-foreground text-sm py-2 px-3 focus:outline-none focus:border-blue-500/50"
          >
            {providerModels.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={t("agentDetail.llmConfig.customModel")}
            className="w-full bg-input-background border border-border text-foreground text-sm py-2 px-3 focus:outline-none focus:border-blue-500/50"
          />
        )}
      </div>

      {/* API Key */}
      <div className="space-y-1">
        <label className="text-sm text-muted-foreground">{t("agentDetail.llmConfig.apiKey")}</label>
        {config && (
          <div className="text-xs text-muted-foreground font-mono mb-1">
            {t("agentDetail.llmConfig.apiKeyMasked")}: {config.apiKeyMasked}
          </div>
        )}
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={config ? t("agentDetail.llmConfig.updateKeyPlaceholder", { defaultValue: "Enter new key to update..." }) : t("agentDetail.llmConfig.apiKeyPlaceholder")}
          className="w-full bg-input-background border border-border text-foreground text-sm py-2 px-3 focus:outline-none focus:border-blue-500/50"
        />
      </div>

      {/* Base URL (custom only) */}
      {provider === "custom" && (
        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">{t("agentDetail.llmConfig.baseUrl")}</label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={t("agentDetail.llmConfig.baseUrlPlaceholder")}
            className="w-full bg-input-background border border-border text-foreground text-sm py-2 px-3 focus:outline-none focus:border-blue-500/50"
          />
        </div>
      )}

      {/* System Prompt */}
      <div className="space-y-1">
        <label className="text-sm text-muted-foreground">{t("agentDetail.llmConfig.systemPrompt")}</label>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder={t("agentDetail.llmConfig.systemPromptPlaceholder")}
          rows={3}
          className="w-full bg-input-background border border-border text-foreground text-sm py-2 px-3 focus:outline-none focus:border-blue-500/50 resize-none"
        />
      </div>

      {/* Temperature */}
      <div className="space-y-1">
        <label className="text-sm text-muted-foreground">
          {t("agentDetail.llmConfig.temperature")}: {temperature.toFixed(1)}
        </label>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{t("agentDetail.llmConfig.temperatureLow")}</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={temperature}
            onChange={(e) => setTemperature(Number(e.target.value))}
            className="flex-1 accent-blue-500"
          />
          <span className="text-xs text-muted-foreground">{t("agentDetail.llmConfig.temperatureHigh")}</span>
        </div>
      </div>

      {/* Max Tokens */}
      <div className="space-y-1">
        <label className="text-sm text-muted-foreground">{t("agentDetail.llmConfig.maxTokens")}</label>
        <input
          type="number"
          min={64}
          max={4096}
          value={maxTokens}
          onChange={(e) => setMaxTokens(Number(e.target.value))}
          className="w-full bg-input-background border border-border text-foreground text-sm py-2 px-3 focus:outline-none focus:border-blue-500/50"
        />
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={saving || (!apiKey && !config)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-black text-sm font-semibold transition-colors"
        >
          <Save className="w-4 h-4" />
          {saving ? t("agentDetail.llmConfig.saving") : t("agentDetail.llmConfig.save")}
        </button>
        {config && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="flex items-center gap-2 px-4 py-2 border border-red-500/30 hover:border-red-500 text-red-400 text-sm transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            {deleting ? t("agentDetail.llmConfig.deleting") : t("agentDetail.llmConfig.delete")}
          </button>
        )}
      </div>

      {/* Stats */}
      {config && (
        <div className="border-t border-border pt-4">
          <h4 className="text-sm font-semibold flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-blue-400" />
            {t("agentDetail.llmConfig.stats")}
          </h4>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-muted-foreground">{t("agentDetail.llmConfig.totalCalls")}</div>
              <div className="text-lg font-mono font-bold text-foreground">{config.totalCalls}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t("agentDetail.llmConfig.totalErrors")}</div>
              <div className="text-lg font-mono font-bold text-red-400">{config.totalErrors}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t("agentDetail.llmConfig.lastUsed")}</div>
              <div className="text-sm font-mono text-foreground">
                {config.lastUsedAt
                  ? new Date(config.lastUsedAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })
                  : t("agentDetail.llmConfig.never")}
              </div>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
