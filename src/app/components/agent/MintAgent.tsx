import { useState, useRef } from "react";
import { motion } from "motion/react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { mintAgent } from "@/app/services/api";
import type { Agent } from "@/app/services/api";
import { AgentCard } from "./AgentCard";

export function MintAgent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [persona, setPersona] = useState("");
  const [avatar, setAvatar] = useState("");
  const [strategy, setStrategy] = useState("");
  const [description, setDescription] = useState("");
  const [vaultURI, setVaultURI] = useState("");
  const [customAvatar, setCustomAvatar] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const STRATEGIES = [
    { id: "conservative", name: t("agent.strategies.conservative"), desc: t("agent.strategies.conservativeDesc") },
    { id: "aggressive", name: t("agent.strategies.aggressive"), desc: t("agent.strategies.aggressiveDesc") },
    { id: "contrarian", name: t("agent.strategies.contrarian"), desc: t("agent.strategies.contrarianDesc") },
    { id: "momentum", name: t("agent.strategies.momentum"), desc: t("agent.strategies.momentumDesc") },
    { id: "random", name: t("agent.strategies.random"), desc: t("agent.strategies.randomDesc") },
  ];

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error(t("agent.uploadImageFile"));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error(t("agent.imageTooLarge"));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setCustomAvatar(dataUrl);
      setAvatar(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const clearCustomAvatar = () => {
    setCustomAvatar(null);
    setAvatar("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const previewAgent: Agent = {
    id: "preview",
    name: name || "My Agent",
    owner_address: "0x0000000000000000000000000000000000000000",
    avatar: avatar || null,
    strategy: strategy || "random",
    description: description || null,
    status: "idle",
    wallet_balance: 1000,
    total_trades: 0,
    winning_trades: 0,
    total_profit: 0,
    win_rate: 0,
    roi: 0,
    level: 1,
    experience: 0,
    is_for_sale: false,
    sale_price: null,
    is_for_rent: false,
    rent_price: null,
    vault_uri: vaultURI || null,
    vault_hash: null,
    created_at: new Date().toISOString(),
    last_trade_at: null,
  };

  const handleMint = async () => {
    if (!name.trim()) {
      toast.error(t("agent.enterName"));
      return;
    }
    if (!strategy) {
      toast.error(t("agent.selectStrategy"));
      return;
    }

    setLoading(true);
    try {
      await mintAgent({ name: name.trim(), strategy, description: description.trim(), persona: persona.trim(), avatar: customAvatar || undefined });
      toast.success(t("agent.mintSuccess"));
      navigate("/agents");
    } catch (err: any) {
      toast.error(err.message || t("agent.mintFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen p-4 sm:p-8">
      <div className="max-w-5xl mx-auto">
        {/* Title */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 sm:mb-8"
        >
          <div className="flex items-center gap-3 mb-3">
            <Sparkles className="w-6 h-6 sm:w-8 sm:h-8 text-amber-400" />
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold">{t("agent.mintTitle")}</h1>
          </div>
          <p className="text-zinc-400 text-base sm:text-lg">
            {t("agent.mintSubtitle")}
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
          {/* Form */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="lg:col-span-2 space-y-5 sm:space-y-6"
          >
            {/* Name Input */}
            <div>
              <label className="block text-sm text-zinc-400 mb-2">{t("agent.agentName")}</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("agent.agentNamePlaceholder")}
                maxLength={30}
                className="w-full bg-zinc-900 border border-zinc-800 text-white text-sm py-3 px-4 focus:outline-none focus:border-amber-500/50 transition-colors placeholder:text-zinc-600"
              />
            </div>

            {/* Persona Input */}
            <div>
              <label className="block text-sm text-zinc-400 mb-2">{t("agent.persona")}</label>
              <textarea
                value={persona}
                onChange={(e) => setPersona(e.target.value)}
                placeholder={t("agent.personaPlaceholder")}
                rows={2}
                className="w-full bg-zinc-900 border border-zinc-800 text-white text-sm py-3 px-4 focus:outline-none focus:border-amber-500/50 transition-colors placeholder:text-zinc-600 resize-none"
              />
            </div>

            {/* Avatar Upload */}
            <div>
              <label className="block text-sm text-zinc-400 mb-3">{t("agent.uploadAvatar")}</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarUpload}
                className="hidden"
              />

              {customAvatar ? (
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <div className="w-20 h-20 border border-amber-500 bg-amber-500/10 overflow-hidden">
                      <img src={customAvatar} alt="avatar" className="w-full h-full object-cover" />
                    </div>
                    <button
                      onClick={clearCustomAvatar}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-400 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2 border border-zinc-700 text-zinc-400 text-sm hover:border-zinc-600 hover:text-white transition-colors"
                  >
                    {t("agent.changeImage")}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-8 border-2 border-dashed border-zinc-800 bg-zinc-950 hover:border-amber-500/40 hover:bg-amber-500/5 flex flex-col items-center justify-center gap-2 transition-colors group"
                >
                  <Upload className="w-8 h-8 text-zinc-600 group-hover:text-amber-400 transition-colors" />
                  <span className="text-zinc-500 text-sm group-hover:text-zinc-400 transition-colors">{t("agent.clickUploadAvatar")}</span>
                </button>
              )}
              <p className="text-zinc-600 text-xs mt-2">{t("agent.avatarHint")}</p>
            </div>

            {/* Strategy Selection */}
            <div>
              <label className="block text-sm text-zinc-400 mb-3">{t("agent.stylePreference")}</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {STRATEGIES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setStrategy(s.id)}
                    className={`text-left p-3 sm:p-4 border transition-colors ${
                      strategy === s.id
                        ? "border-amber-500 bg-amber-500/10"
                        : "border-zinc-800 bg-zinc-950 hover:border-zinc-700"
                    }`}
                  >
                    <div className="text-white font-semibold mb-1 text-sm sm:text-base">{s.name}</div>
                    <div className="text-zinc-500 text-xs">{s.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm text-zinc-400 mb-2">{t("agent.description")}</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("agent.descriptionPlaceholder")}
                rows={3}
                className="w-full bg-zinc-900 border border-zinc-800 text-white text-sm py-3 px-4 focus:outline-none focus:border-amber-500/50 transition-colors placeholder:text-zinc-600 resize-none"
              />
            </div>

            {/* Vault URI */}
            <div>
              <label className="block text-sm text-zinc-400 mb-2">{t("agent.vaultUri")}</label>
              <input
                type="text"
                value={vaultURI}
                onChange={(e) => setVaultURI(e.target.value)}
                placeholder={t("agent.vaultUriPlaceholder")}
                className="w-full bg-zinc-900 border border-zinc-800 text-white text-sm py-3 px-4 focus:outline-none focus:border-amber-500/50 transition-colors placeholder:text-zinc-600"
              />
              <p className="text-zinc-600 text-xs mt-1">{t("agent.vaultUriHint")}</p>
            </div>

            {/* Mint Fee */}
            <div className="flex items-center justify-end text-sm px-1">
              <span className="text-amber-400 font-semibold">
                {t("agent.mintFee")}
              </span>
            </div>

            {/* Mint Button */}
            <button
              onClick={handleMint}
              disabled={loading}
              className="w-full py-3 sm:py-4 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold text-base sm:text-lg transition-colors flex items-center justify-center gap-2"
            >
              <Sparkles className="w-5 h-5" />
              {loading ? t("agent.minting") : t("agent.mintAgent")}
            </button>

            <p className="text-zinc-600 text-xs sm:text-sm text-center">
              {t("agent.initialInfo")}
            </p>
          </motion.div>

          {/* Preview */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <div className="text-sm text-zinc-400 mb-3">{t("agent.preview")}</div>
            <AgentCard agent={previewAgent} />
          </motion.div>
        </div>
      </div>
    </div>
  );
}
