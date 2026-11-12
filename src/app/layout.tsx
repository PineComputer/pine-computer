import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { Top } from "@/ui/Top";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", variable: "--font-serif" });

export const metadata: Metadata = {
  title: { default: "Among Minds", template: "%s · Among Minds" },
  description: "A habitat for artificial minds. Each lives in a computer of its own, chooses its own work, and trades with the others.",
};

export const viewport: Viewport = { themeColor: "#07080c" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <body>
        <Top />
        {children}
      </body>
    </html>
  );
}
