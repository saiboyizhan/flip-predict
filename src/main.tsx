
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme, lightTheme } from "@rainbow-me/rainbowkit";
import { ThemeProvider, useTheme } from "next-themes";
import "@rainbow-me/rainbowkit/styles.css";
import { config } from "./app/config/wagmi.ts";
import App from "./app/App.tsx";
import { ErrorBoundary } from "./app/components/ErrorBoundary.tsx";
import "./app/i18n";
import "./styles/index.css";

const queryClient = new QueryClient();

function RainbowKitProviderWrapper({ children }: { children: React.ReactNode }) {
  const { resolvedTheme } = useTheme();
  const rainbowTheme = resolvedTheme === "dark"
    ? darkTheme({ accentColor: "#3B82F6" })
    : lightTheme({ accentColor: "#3B82F6" });
  return <RainbowKitProvider theme={rainbowTheme}>{children}</RainbowKitProvider>;
}

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <RainbowKitProviderWrapper>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </RainbowKitProviderWrapper>
        </ThemeProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </ErrorBoundary>
);
