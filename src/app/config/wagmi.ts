import { http, createConfig } from "wagmi";
import { defineChain, parseGwei } from "viem";
import { createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";

const bsc = defineChain({
  id: 56,
  name: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://bsc-dataseed.binance.org/"] },
  },
  blockExplorers: {
    default: { name: "BscScan", url: "https://bscscan.com" },
  },
});

const bscTestnet = defineChain({
  id: 97,
  name: "BNB Smart Chain Testnet",
  nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://bsc-testnet-rpc.publicnode.com"] },
  },
  blockExplorers: {
    default: { name: "BscScan Testnet", url: "https://testnet.bscscan.com" },
  },
  testnet: true,
  fees: {
    async estimateFeesPerGas() {
      return { gasPrice: parseGwei("5") };
    },
  },
});

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "";
if (!projectId || projectId === "YOUR_WALLETCONNECT_PROJECT_ID") {
  console.warn(
    "[wagmi] VITE_WALLETCONNECT_PROJECT_ID is not configured. WalletConnect will not work. Get one at https://cloud.walletconnect.com"
  );
}

const chains = [bscTestnet, bsc] as const;

const wagmiAdapter = new WagmiAdapter({
  projectId,
  networks: chains,
  transports: {
    [bsc.id]: http("https://bsc-dataseed.binance.org/"),
    [bscTestnet.id]: http("https://bsc-testnet-rpc.publicnode.com"),
  },
});

createAppKit({
  adapters: [wagmiAdapter],
  networks: chains,
  projectId,
  metadata: {
    name: "Flip Prediction Market",
    description: "AI-Powered Prediction Market on BSC",
    url: typeof window !== "undefined" ? window.location.origin : "https://flip.market",
    icons: [],
  },
  themeMode: "dark",
  themeVariables: {
    "--w3m-accent": "#3B82F6",
  },
});

export const config = wagmiAdapter.wagmiConfig;
