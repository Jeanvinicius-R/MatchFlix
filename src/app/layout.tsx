import type { Metadata } from "next";
import localFont from "next/font/local";
import { Footer } from "@/components/layout/Footer";
import { siteConfig } from "@/config/site.config";
import { THEME_STORAGE_KEY } from "@/constants/theme.constants";
import "./globals.css";

/*
 * Inter and Fraunces are self-hosted (latin subset, variable woff2 from Google
 * Fonts, SIL OFL 1.1 — licenses in ./fonts). next/font/google downloads them
 * at build time, which fails both offline and under Turbopack when the project
 * path contains spaces; local files make the build deterministic.
 */
const inter = localFont({
  src: "./fonts/inter-latin-variable.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
});

const fraunces = localFont({
  src: "./fonts/fraunces-latin-variable.woff2",
  variable: "--font-fraunces",
  weight: "500 600",
  display: "swap",
});

export const metadata: Metadata = {
  title: `${siteConfig.name} — ${siteConfig.tagline}`,
  description: siteConfig.description,
};

/** Runs before first paint so a saved light theme never flashes dark on reload. */
const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${inter.variable} ${fraunces.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="bg-background text-foreground flex min-h-full flex-col">
        {children}
        <Footer />
      </body>
    </html>
  );
}
