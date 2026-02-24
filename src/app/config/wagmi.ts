import { http, fallback } from "wagmi";
import { defineChain, parseGwei } from "viem";
import { createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";

const bscMainnet = defineChain({
  id: 56,
  name: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        "https://bsc-dataseed.bnbchain.org",
        "https://bsc-dataseed1.defibit.io",
        "https://bsc-dataseed1.ninicoin.io",
      ],
    },
  },
  blockExplorers: {
    default: { name: "BscScan", url: "https://bscscan.com" },
  },
  testnet: false,
});

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "";
if (!projectId || projectId === "YOUR_WALLETCONNECT_PROJECT_ID") {
  console.warn(
    "[wagmi] VITE_WALLETCONNECT_PROJECT_ID is not configured. WalletConnect will not work. Get one at https://cloud.walletconnect.com"
  );
}

const chains = [bscMainnet] as const;

const wagmiAdapter = new WagmiAdapter({
  projectId,
  networks: chains,
  transports: {
    [bscMainnet.id]: fallback([
      http("https://bsc-dataseed.bnbchain.org"),
      http("https://bsc-dataseed1.defibit.io"),
      http("https://bsc-dataseed1.ninicoin.io"),
    ]),
  },
});

createAppKit({
  adapters: [wagmiAdapter],
  networks: chains,
  defaultNetwork: bscMainnet,
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
