import type { Metadata, Viewport } from "next";
import { Archivo, Martian_Mono } from "next/font/google";
import { brand } from "@/brand";
import "./globals.css";

// A grotesk with a width axis for the board's headlines, and a wide mono for its times.
const sans = Archivo({ subsets: ["latin"], variable: "--font-sans", axes: ["wdth"] });
const mono = Martian_Mono({ subsets: ["latin"], variable: "--font-mono", axes: ["wdth"] });

export const metadata: Metadata = { title: brand.name, description: brand.tagline };

export const viewport: Viewport = { themeColor: "#f6c915" };

// The yellow board unless the person chose the night one (src/ui/Theme.tsx), applied
// before the first paint so the page never flashes the other.
const THEME = `try{if(localStorage.getItem("theme")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
