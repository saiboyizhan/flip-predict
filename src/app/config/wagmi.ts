import { http, fallback } from "wagmi";
import { defineChain, parseGwei } from "viem";
import { createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";

const bscTestnet = defineChain({
  id: 97,
  name: "BNB Smart Chain Testnet",
  nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
        "https://data-seed-prebsc-2-s1.bnbchain.org:8545",
        "https://data-seed-prebsc-1-s2.bnbchain.org:8545",
      ],
    },
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

const chains = [bscTestnet] as const;

const wagmiAdapter = new WagmiAdapter({
  projectId,
  networks: chains,
  transports: {
    [bscTestnet.id]: fallback([
      http("https://data-seed-prebsc-1-s1.bnbchain.org:8545"),
      http("https://data-seed-prebsc-2-s1.bnbchain.org:8545"),
      http("https://data-seed-prebsc-1-s2.bnbchain.org:8545"),
    ]),
  },
});

createAppKit({
  adapters: [wagmiAdapter],
  networks: chains,
  defaultNetwork: bscTestnet,
  projectId,
  allowUnsupportedChain: true,
  enableEIP6963: true,
  enableInjected: true,
  enableWalletConnect: false,
  metadata: {
    name: "Flip Prediction Market",
    description: "AI-Powered Prediction Market on BSC",
    url: typeof window !== "undefined" ? window.location.origin : "https://flippredict.net",
    icons: [],
  },
  features: {
    analytics: false,
    email: false,
    socials: false,
  },
  themeMode: "dark",
  themeVariables: {
    "--w3m-accent": "#3B82F6",
  },
});

export const config = wagmiAdapter.wagmiConfig;
