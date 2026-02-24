import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Sparkles, ChevronRight, ChevronLeft, Check, Loader2, ImagePlus, Upload, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useAgentStore } from "@/app/stores/useAgentStore";
import { mintAgent } from "@/app/services/api";
import { PRESET_AVATARS } from "@/app/config/avatars";
import { NFA_ABI, NFA_CONTRACT_ADDRESS, NFA_MINT_PRICE } from "@/app/config/nfaContracts";
import { useAccount, useChainId, usePublicClient, useWriteContract, useReadContract, useSwitchChain } from "wagmi";
import { zeroAddress, zeroHash, formatEther } from "viem";
import { getBscScanUrl } from "@/app/hooks/useContracts";

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const AVATAR_SIZE = 256; // resize to 256x256

/** Resize image to a square and return as data URL */
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
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}

export function MintAgentModal() {
  const { t } = useTranslation();
  const chainId = useChainId();
  const BSC_CHAIN_ID = 56;
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const { showMintModal, setShowMintModal, addAgent, agentCount } = useAgentStore();
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [persona, setPersona] = useState("");
  const [selectedAvatar, setSelectedAvatar] = useState<number | null>(null);
  const [uploadedAvatar, setUploadedAvatar] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mintInFlightRef = useRef(false);

  // Read MAX_AGENTS_PER_ADDRESS from contract
  const { data: maxAgentsData } = useReadContract({
    address: NFA_CONTRACT_ADDRESS as `0x${string}`,
    abi: NFA_ABI,
    functionName: 'MAX_AGENTS_PER_ADDRESS',
    query: {
      enabled: NFA_CONTRACT_ADDRESS !== '0x0000000000000000000000000000000000000000',
    },
  });
  const MAX_AGENTS_PER_ADDRESS = maxAgentsData ? Number(maxAgentsData) : 3;

  const avatarSrc = uploadedAvatar ?? (selectedAvatar !== null ? PRESET_AVATARS[selectedAvatar].src : null);

  const resetAndClose = () => {
    setStep(1);
    setName("");
    setPersona("");
    setSelectedAvatar(null);
    setUploadedAvatar(null);
    setLoading(false);
    setShowMintModal(false);
  };

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
      setSelectedAvatar(null);
    } catch {
      toast.error(t("agent.imageLoadFailed", "Failed to process image"));
    }
  }, [t]);

  const handleMint = async () => {
    if (mintInFlightRef.current || loading) return;
    if (!name.trim() || !avatarSrc) return;
    if (!isConnected || !address) {
      toast.error(t("auth.pleaseConnectWallet", "Please connect wallet first"));
      return;
    }
    if (chainId !== BSC_CHAIN_ID) {
      try {
        await switchChainAsync({ chainId: BSC_CHAIN_ID });
      } catch {
        toast.error(t("agent.switchChainFailed", { defaultValue: "Please switch to BSC Mainnet" }));
        return;
      }
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
    mintInFlightRef.current = true;
    try {
      const bytecode = await publicClient.getBytecode({
        address: NFA_CONTRACT_ADDRESS as `0x${string}`,
      });
      if (!bytecode || bytecode === "0x") {
        throw new Error(`NFA contract not deployed on chain ${BSC_CHAIN_ID}: ${NFA_CONTRACT_ADDRESS}`);
      }

      const latestNonce = await publicClient.getTransactionCount({
        address,
        blockTag: "latest",
      });
      const pendingNonce = await publicClient.getTransactionCount({
        address,
        blockTag: "pending",
      });
      if (pendingNonce > latestNonce) {
        throw new Error(
          t("agent.pendingTxWarning", "你有待处理的钱包交易。请先在钱包中加速或取消待处理交易，然后重新铸造。")
        );
      }

      // Check BNB balance
      const bnbBalance = await publicClient.getBalance({ address });
      if (bnbBalance < NFA_MINT_PRICE) {
        throw new Error(t("agent.insufficientBNB", {
          required: formatEther(NFA_MINT_PRICE),
          defaultValue: `Insufficient BNB balance. You need ${formatEther(NFA_MINT_PRICE)} BNB to mint.`,
        }));
      }

      const avatarId = selectedAvatar != null && selectedAvatar >= 0 && selectedAvatar <= 255 ? selectedAvatar : 0;
      const mintArgs = [{
        name: name.trim(),
        persona: persona.trim(),
        voiceHash: zeroHash,
        animationURI: "",
        vaultURI: "",
        vaultHash: zeroHash,
        avatarId,
      }] as const;

      // Simulate first
      try {
        await publicClient.simulateContract({
          address: NFA_CONTRACT_ADDRESS as `0x${string}`,
          abi: NFA_ABI,
          functionName: "mint",
          args: mintArgs,
          account: address,
          value: NFA_MINT_PRICE,
        });
      } catch (simErr: any) {
        const reason = simErr?.cause?.reason || simErr?.shortMessage || simErr?.message || "Unknown simulation error";
        throw new Error(`Mint simulation failed: ${reason}`);
      }

      const txHash = await writeContractAsync({
        address: NFA_CONTRACT_ADDRESS as `0x${string}`,
        abi: NFA_ABI,
        functionName: "mint",
        args: mintArgs,
        value: NFA_MINT_PRICE,
      });

      const receipt = await Promise.race([
        publicClient.waitForTransactionReceipt({ hash: txHash }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Transaction confirmation timeout. Your mint may have succeeded — check your wallet or refresh the Agents page.")), 60_000)
        ),
      ]);

      if (receipt.status === "reverted") {
        throw new Error("Mint transaction reverted on-chain");
      }

      // Parse Transfer event to get tokenId
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

      const payload: {
        name: string;
        strategy: string;
        description: string;
        persona: string;
        avatar: string;
        tokenId?: string;
        mintTxHash: string;
      } = {
        name: name.trim(),
        strategy: "random",
        description: "",
        persona: persona.trim(),
        avatar: avatarSrc,
        mintTxHash: txHash,
      };
      if (tokenId != null) {
        payload.tokenId = tokenId.toString();
      }

      let agent;
      try {
        agent = await mintAgent(payload);
      } catch (backendErr: any) {
        // On-chain mint succeeded but backend registration failed — auto-sync will recover
        const scanUrl = getBscScanUrl(chainId);
        toast.error(
          t("agent.backendRegisterFailed", {
            defaultValue: "链上铸造成功但后端注册失败。请刷新页面或前往 Agents 页面，系统会自动同步。",
          }),
          { duration: 10000 }
        );
        window.open(`${scanUrl}/tx/${txHash}`, "_blank");
        resetAndClose();
        return;
      }
      addAgent(agent);
      toast.success(tokenId != null ? `${t("agent.mintSuccess")} #${tokenId.toString()}` : t("agent.mintSuccess"));
      const scanUrl = getBscScanUrl(chainId);
      window.open(`${scanUrl}/tx/${txHash}`, "_blank");
      resetAndClose();
    } catch (err: any) {
      const message = err?.message || t("agent.mintFailed");
      if (
        typeof message === "string" &&
        (message.toLowerCase().includes("replacement transaction underpriced") ||
          message.toLowerCase().includes("nonce too low"))
      ) {
        toast.error(
          t("agent.pendingTxConflict", "检测到待处理交易冲突。请在钱包中加速/取消待处理交易后重试。")
        );
      } else {
        toast.error(message);
      }
    } finally {
      mintInFlightRef.current = false;
      setLoading(false);
    }
  };

  if (!showMintModal) return null;

  const remaining = MAX_AGENTS_PER_ADDRESS - agentCount;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        onClick={(e) => {
          if (e.target === e.currentTarget) resetAndClose();
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-lg bg-card border border-border overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-5 border-b border-border">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-blue-400" />
              <h2 className="text-lg font-bold">{t("agent.mintModalTitle")}</h2>
            </div>
            <button
              onClick={resetAndClose}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Step indicator */}
          <div className="flex items-center gap-2 px-5 pt-4">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex items-center gap-2 flex-1">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                    s === step
                      ? "bg-blue-500 text-white"
                      : s < step
                        ? "bg-emerald-500 text-white"
                        : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {s < step ? <Check className="w-3.5 h-3.5" /> : s}
                </div>
                {s < 3 && (
                  <div className={`flex-1 h-0.5 ${s < step ? "bg-emerald-500" : "bg-border"}`} />
                )}
              </div>
            ))}
          </div>

          {/* Content */}
          <div className="p-5 min-h-[280px]">
            <AnimatePresence mode="wait">
              {/* Step 1: Name + Persona */}
              {step === 1 && (
                <motion.div
                  key="step1"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-4"
                >
                  <div>
                    <h3 className="text-base font-semibold mb-1">{t("agent.nameYourAgent")}</h3>
                    <p className="text-sm text-muted-foreground">{t("agent.nameHint")}</p>
                  </div>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("agent.agentNamePlaceholder")}
                    maxLength={30}
                    autoFocus
                    className="w-full bg-input-background border border-border text-foreground text-sm py-3 px-4 focus:outline-none focus:border-blue-500/50 transition-colors placeholder:text-muted-foreground"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{name.length}/30</span>
                    <span>{t("agent.remainingSlots", { count: remaining })}</span>
                  </div>
                  <div>
                    <label className="block text-sm text-muted-foreground mb-1">{t("agent.persona", "Persona (optional)")}</label>
                    <input
                      type="text"
                      value={persona}
                      onChange={(e) => setPersona(e.target.value)}
                      placeholder={t("agent.personaPlaceholder", "e.g. Aggressive bull trader")}
                      maxLength={100}
                      className="w-full bg-input-background border border-border text-foreground text-sm py-3 px-4 focus:outline-none focus:border-blue-500/50 transition-colors placeholder:text-muted-foreground"
                    />
                  </div>
                </motion.div>
              )}

              {/* Step 2: Avatar (Preset + Upload) */}
              {step === 2 && (
                <motion.div
                  key="step2"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-4"
                >
                  <div>
                    <h3 className="text-base font-semibold mb-1">{t("agent.selectAvatar")}</h3>
                    <p className="text-sm text-muted-foreground">{t("agent.selectAvatarHint")}</p>
                  </div>

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

                  <div className="grid grid-cols-4 gap-3">
                    {/* Upload tile */}
                    {uploadedAvatar ? (
                      <div className="relative aspect-square border-2 border-blue-500 ring-2 ring-blue-500/30 overflow-hidden group">
                        <img src={uploadedAvatar} alt="uploaded" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-blue-500/20 flex items-center justify-center">
                          <Check className="w-5 h-5 text-blue-400" />
                        </div>
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                          <button onClick={() => fileInputRef.current?.click()} className="p-1.5 bg-white/10 hover:bg-white/20 transition-colors">
                            <Upload className="w-3.5 h-3.5 text-white" />
                          </button>
                          <button onClick={() => setUploadedAvatar(null)} className="p-1.5 bg-white/10 hover:bg-red-500/40 transition-colors">
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
                        <img src={av.src} alt={av.label} className="w-full h-full object-cover bg-secondary" />
                        {selectedAvatar === av.id && !uploadedAvatar && (
                          <div className="absolute inset-0 bg-blue-500/20 flex items-center justify-center">
                            <Check className="w-5 h-5 text-blue-400" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Step 3: Confirm */}
              {step === 3 && (
                <motion.div
                  key="step3"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-5"
                >
                  <div>
                    <h3 className="text-base font-semibold mb-1">{t("agent.confirmMint")}</h3>
                    <p className="text-sm text-muted-foreground">{t("agent.confirmMintHint")}</p>
                  </div>

                  {/* Preview card */}
                  <div className="flex items-center gap-4 p-4 bg-secondary/50 border border-border">
                    {avatarSrc && (
                      <div className="w-16 h-16 border border-blue-500/50 overflow-hidden flex-shrink-0">
                        <img
                          src={avatarSrc}
                          alt="avatar"
                          className="w-full h-full object-cover bg-secondary"
                        />
                      </div>
                    )}
                    <div>
                      <div className="font-bold text-lg">{name}</div>
                      {persona && <div className="text-xs text-muted-foreground">{persona}</div>}
                    </div>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("agent.mintCost")}</span>
                      <span className="text-amber-400 font-semibold font-mono">{formatEther(NFA_MINT_PRICE)} BNB</span>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between p-5 border-t border-border">
            {step > 1 ? (
              <button
                onClick={() => setStep(step - 1)}
                className="flex items-center gap-1 px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                {t("common.back")}
              </button>
            ) : (
              <button
                onClick={resetAndClose}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {t("common.cancel")}
              </button>
            )}

            {step < 3 ? (
              <button
                onClick={() => setStep(step + 1)}
                disabled={(step === 1 && !name.trim()) || (step === 2 && !avatarSrc)}
                className="flex items-center gap-1 px-6 py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors"
              >
                {t("common.next")}
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleMint}
                disabled={loading}
                className="flex items-center gap-2 px-6 py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white font-bold text-sm transition-colors"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t("agent.minting")}
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    {t("agent.mintAgentBNB", { cost: formatEther(NFA_MINT_PRICE), defaultValue: `Mint Agent (${formatEther(NFA_MINT_PRICE)} BNB)` })}
                  </>
                )}
              </button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
