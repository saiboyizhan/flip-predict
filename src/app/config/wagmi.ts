import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { defineChain } from "viem";

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
    default: { http: ["https://data-seed-prebsc-1-s1.binance.org:8545/"] },
  },
  blockExplorers: {
    default: { name: "BscScan Testnet", url: "https://testnet.bscscan.com" },
  },
  testnet: true,
});

export const config = getDefaultConfig({
  appName: "链上预测",
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "YOUR_WALLETCONNECT_PROJECT_ID",
  chains: [bsc, bscTestnet],
});
