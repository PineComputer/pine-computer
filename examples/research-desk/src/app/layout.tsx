import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Libre_Franklin, Newsreader } from "next/font/google";
import { brand } from "@/brand";
import "./globals.css";

// Newsreader carries the product, at its optical sizes; a quiet sans for controls; mono only for addresses.
const serif = Newsreader({ subsets: ["latin"], style: ["normal", "italic"], axes: ["opsz"], variable: "--font-serif" });
const sans = Libre_Franklin({ subsets: ["latin"], variable: "--font-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: { default: brand.name, template: `%s · ${brand.name}` },
  description: brand.tagline,
};

export const viewport: Viewport = {
  themeColor: "#14264d",
};

// The blue room by default; the ivory one when the person chose it (src/ui/app/Theme.tsx).
// Applied before the first paint so the page never flashes the other ground.
const THEME = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
