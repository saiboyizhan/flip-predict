import { useState, useRef, useCallback } from "react";
import { motion } from "motion/react";
import { useTransitionNavigate } from "@/app/hooks/useTransitionNavigate";
import { Sparkles, Check, Loader2, ImagePlus, Upload, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { mintAgent } from "@/app/services/api";
import { useAgentStore } from "@/app/stores/useAgentStore";
import { PRESET_AVATARS, MAX_AGENTS_PER_ADDRESS } from "@/app/config/avatars";
import { NFA_ABI, NFA_CONTRACT_ADDRESS } from "@/app/config/nfaContracts";
import type { Agent } from "@/app/services/api";
import { AgentCard } from "./AgentCard";
import { useAccount, useChainId, usePublicClient, useWriteContract } from "wagmi";
import { zeroAddress, zeroHash } from "viem";
import { getBscScanUrl } from "@/app/hooks/useContracts";

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const AVATAR_SIZE = 256;

function resizeImage(file: File, size: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      const min = Math.min(img.width, img.height);
      const sx = (img.width - min) / 2;
      const sy = (img.height - min) / 2;
      ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
      resolve(canvas.toDataURL("image/webp", 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to load image")); };
    img.src = url;
  });
}

export function MintAgent() {
  const { t } = useTranslation();
  const { navigate } = useTransitionNavigate();
  const chainId = useChainId();
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { agentCount, addAgent } = useAgentStore();
  const [name, setName] = useState("");
  const [persona, setPersona] = useState("");
  const [selectedAvatar, setSelectedAvatar] = useState<number | null>(null);
  const [uploadedAvatar, setUploadedAvatar] = useState<string | null>(null);
  const [strategy, setStrategy] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const avatarSrc = uploadedAvatar ?? (selectedAvatar !== null ? PRESET_AVATARS[selectedAvatar].src : null);

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error(t("agent.invalidImageType", "Please upload an image file"));
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error(t("agent.imageTooLarge", "Image must be under 2MB"));
      return;
    }
    try {
      const dataUrl = await resizeImage(file, AVATAR_SIZE);
      setUploadedAvatar(dataUrl);
      setSelectedAvatar(null); // deselect preset
    } catch {
      toast.error(t("agent.imageLoadFailed", "Failed to process image"));
    }
  }, [t]);

  const remaining = MAX_AGENTS_PER_ADDRESS - agentCount;

  const STRATEGIES = [
    { id: "conservative", name: t("agent.strategies.conservative"), desc: t("agent.strategies.conservativeDesc") },
    { id: "aggressive", name: t("agent.strategies.aggressive"), desc: t("agent.strategies.aggressiveDesc") },
    { id: "contrarian", name: t("agent.strategies.contrarian"), desc: t("agent.strategies.contrarianDesc") },
    { id: "momentum", name: t("agent.strategies.momentum"), desc: t("agent.strategies.momentumDesc") },
    { id: "random", name: t("agent.strategies.random"), desc: t("agent.strategies.randomDesc") },
  ];

  const previewAgent: Agent = {
    id: "preview",
    name: name || "My Agent",
    owner_address: "0x0000000000000000000000000000000000000000",
    avatar: avatarSrc,
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
    vault_uri: null,
    vault_hash: null,
    created_at: new Date().toISOString(),
    last_trade_at: null,
  };

  const handleMint = async () => {
    if (!name.trim()) {
      toast.error(t("agent.enterName"));
      return;
    }
    if (!avatarSrc) {
      toast.error(t("agent.selectAvatar"));
      return;
    }
    if (!strategy) {
      toast.error(t("agent.selectStrategy"));
      return;
    }
    if (remaining <= 0) {
      toast.error(t("agent.maxAgentsReached"));
      return;
    }
    if (!isConnected || !address) {
      toast.error(t("auth.pleaseConnectWallet", "Please connect wallet first"));
      return;
    }
    if (!publicClient) {
      toast.error("Wallet client unavailable");
      return;
    }
    if (NFA_CONTRACT_ADDRESS === "0x0000000000000000000000000000000000000000") {
      toast.error("NFA contract address is not configured");
      return;
    }

    setLoading(true);
    try {
      const avatarId = selectedAvatar != null && selectedAvatar >= 0 && selectedAvatar <= 255 ? selectedAvatar : 0;
      const txHash = await writeContractAsync({
        address: NFA_CONTRACT_ADDRESS as `0x${string}`,
        abi: NFA_ABI,
        functionName: "mint",
        args: [{
          name: name.trim(),
          persona: persona.trim(),
          voiceHash: zeroHash,
          animationURI: "",
          vaultURI: "",
          vaultHash: zeroHash,
          avatarId,
        }],
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      if (receipt.status === "reverted") {
        throw new Error("Mint transaction reverted on-chain");
      }

      const TRANSFER_SIG = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
      let tokenId: bigint | null = null;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== NFA_CONTRACT_ADDRESS.toLowerCase()) continue;
        if (log.topics[0] !== TRANSFER_SIG || log.topics.length < 4) continue;
        const from = ("0x" + log.topics[1].slice(26)).toLowerCase();
        const to = ("0x" + log.topics[2].slice(26)).toLowerCase();
        if (from === zeroAddress && to === address.toLowerCase()) {
          tokenId = BigInt(log.topics[3]);
          break;
        }
      }

      if (tokenId == null) {
        throw new Error(`Mint tx confirmed but Transfer event not found. Receipt logs: ${receipt.logs.length}. Check: ${NFA_CONTRACT_ADDRESS}`);
      }

      const agent = await mintAgent({
        name: name.trim(),
        strategy,
        description: description.trim(),
        persona: persona.trim(),
        avatar: avatarSrc!,
        tokenId: tokenId.toString(),
        mintTxHash: txHash,
      });
      addAgent(agent);
      toast.success(`${t("agent.mintSuccess")} #${tokenId.toString()}`);
      const scanUrl = getBscScanUrl(chainId);
      window.open(`${scanUrl}/tx/${txHash}`, "_blank");
      navigate("/agents");
    } catch (err: any) {
      toast.error(err.message || t("agent.mintFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 sm:p-6">
      <div className="max-w-4xl mx-auto">
        {/* Title */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 sm:mb-5"
        >
          <div className="flex items-center gap-2 mb-1.5">
            <Sparkles className="w-4 h-4 text-blue-400" />
            <h1 className="text-base sm:text-lg font-bold">{t("agent.mintTitle")}</h1>
          </div>
          <p className="text-muted-foreground text-xs">
            {t("agent.mintSubtitle")}
          </p>
          {remaining <= 0 && (
            <div className="mt-2 p-2 bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
              {t("agent.maxAgentsReached")}
            </div>
          )}
          {remaining > 0 && (
            <div className="mt-1.5 text-xs text-muted-foreground">
              {t("agent.remainingSlots", { count: remaining })}
            </div>
          )}
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
          {/* Form */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="lg:col-span-2 space-y-4"
          >
            {/* Name Input */}
            <div>
              <label className="block text-xs text-muted-foreground mb-1">{t("agent.agentName")}</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("agent.agentNamePlaceholder")}
                maxLength={30}
                className="w-full bg-input-background border border-border text-foreground text-sm py-2 px-3 focus:outline-none focus:border-blue-500/50 transition-colors placeholder:text-muted-foreground"
              />
              <div className="text-[10px] text-muted-foreground mt-0.5">{name.length}/30</div>
            </div>

            {/* Persona Input */}
            <div>
              <label className="block text-xs text-muted-foreground mb-1">{t("agent.persona")}</label>
              <textarea
                value={persona}
                onChange={(e) => setPersona(e.target.value)}
                placeholder={t("agent.personaPlaceholder")}
                rows={2}
                className="w-full bg-input-background border border-border text-foreground text-sm py-2 px-3 focus:outline-none focus:border-blue-500/50 transition-colors placeholder:text-muted-foreground resize-none"
              />
            </div>

            {/* Avatar Selection (Preset + Upload) */}
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">{t("agent.selectAvatar")}</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                  e.target.value = "";
                }}
              />
              <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
                {/* Upload button as first tile */}
                {uploadedAvatar ? (
                  <div className="relative aspect-square border-2 border-blue-500 ring-2 ring-blue-500/30 overflow-hidden group">
                    <img src={uploadedAvatar} alt="uploaded" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-blue-500/20 flex items-center justify-center">
                      <Check className="w-5 h-5 text-blue-400" />
                    </div>
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="p-1.5 bg-white/10 hover:bg-white/20 transition-colors"
                        title={t("agent.changeImage", "Change")}
                      >
                        <Upload className="w-3.5 h-3.5 text-white" />
                      </button>
                      <button
                        onClick={() => setUploadedAvatar(null)}
                        className="p-1.5 bg-white/10 hover:bg-red-500/40 transition-colors"
                        title={t("agent.removeImage", "Remove")}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-white" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="relative aspect-square border-2 border-dashed border-border hover:border-blue-500/50 overflow-hidden transition-all hover:bg-white/[0.02] flex flex-col items-center justify-center gap-1"
                  >
                    <ImagePlus className="w-6 h-6 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground">{t("agent.uploadAvatar", "Upload")}</span>
                  </button>
                )}

                {/* Preset avatars */}
                {PRESET_AVATARS.map((av) => (
                  <button
                    key={av.id}
                    onClick={() => { setSelectedAvatar(av.id); setUploadedAvatar(null); }}
                    className={`relative aspect-square border-2 overflow-hidden transition-all hover:scale-105 ${
                      selectedAvatar === av.id && !uploadedAvatar
                        ? "border-blue-500 ring-2 ring-blue-500/30"
                        : "border-border hover:border-border"
                    }`}
                  >
                    <img
                      src={av.src}
                      alt={av.label}
                      className="w-full h-full object-cover bg-secondary"
                    />
                    {selectedAvatar === av.id && !uploadedAvatar && (
                      <div className="absolute inset-0 bg-blue-500/20 flex items-center justify-center">
                        <Check className="w-5 h-5 text-blue-400" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Strategy Selection */}
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">{t("agent.stylePreference")}</label>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                {STRATEGIES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setStrategy(s.id)}
                    className={`text-left p-2.5 border transition-colors ${
                      strategy === s.id
                        ? "border-blue-500 bg-blue-500/10"
                        : "border-border bg-secondary hover:border-border"
                    }`}
                  >
                    <div className="text-foreground font-semibold mb-0.5 text-xs">{s.name}</div>
                    <div className="text-muted-foreground text-[10px] leading-tight">{s.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs text-muted-foreground mb-1">{t("agent.description")}</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("agent.descriptionPlaceholder")}
                rows={2}
                className="w-full bg-input-background border border-border text-foreground text-sm py-2 px-3 focus:outline-none focus:border-blue-500/50 transition-colors placeholder:text-muted-foreground resize-none"
              />
            </div>

            {/* Mint Fee */}
            <div className="flex items-center justify-end text-xs px-1">
              <span className="text-emerald-400 font-semibold">
                {t("agent.mintFee")}
              </span>
            </div>

            {/* Mint Button */}
            <button
              onClick={handleMint}
              disabled={loading || remaining <= 0}
              className="w-full py-2.5 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-black font-bold text-sm transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t("agent.minting")}
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  {t("agent.mintFree")}
                </>
              )}
            </button>

            <p className="text-muted-foreground text-[10px] text-center">
              {t("agent.initialInfo")}
            </p>
          </motion.div>

          {/* Preview */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <div className="text-xs text-muted-foreground mb-2">{t("agent.preview")}</div>
            <AgentCard agent={previewAgent} />
          </motion.div>
        </div>
      </div>
    </div>
  );
}
