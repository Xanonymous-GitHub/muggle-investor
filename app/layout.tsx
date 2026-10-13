import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import { SettingsProvider } from "@/ui/device/settings-provider";
import { THEME_INIT_SCRIPT } from "@/ui/theme/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Muggle Investor",
  applicationName: "Muggle Investor",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-Hant" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a build-time constant, no user input */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <SettingsProvider>{children}</SettingsProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
