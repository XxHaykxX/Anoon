import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import PWARegister from "@/components/PWARegister";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Anoon — анонимная чат-рулётка",
  description:
    "Анонимный чат с новым человеком в один тап. Без имён и фото — профиль виден, только если оба захотели открыться.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "anoon",
  },
  icons: {
    icon: "/icons/icon.svg",
    apple: "/icons/icon.svg",
  },
};

export const viewport: Viewport = {
  // The colour the browser paints AROUND the app — address bar, PWA status bar,
  // task switcher card. The brand yellow put a bright band above a black app,
  // which reads as a rendering fault rather than as branding; the app's own
  // background makes the chrome disappear instead (#38, owner's call). Keep it
  // byte-equal to `--background` in globals.css — the seam is only invisible
  // while the two match.
  themeColor: "#000000",
  // Extend under the notch/home-bar so env(safe-area-inset-*) resolves — the
  // anoon app route relies on it to look native as a full-screen PWA.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <PWARegister />
      </body>
    </html>
  );
}
