import type { Metadata, Viewport } from "next";
import { Chakra_Petch, IBM_Plex_Mono, Barlow } from "next/font/google";
import "./globals.css";

// Display / instrument labels — squared, technical, avionics-panel feel.
const display = Chakra_Petch({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

// Numeric readouts — the cockpit "digits".
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

// Body / UI copy.
const body = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PREFLIGHT · Risk Briefing",
  description:
    "Offline meteo, airspace and automated FRAT risk briefings for a flight route.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#070a10",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable} ${body.variable}`}>
      <body className="hud-bg min-h-screen font-body text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
