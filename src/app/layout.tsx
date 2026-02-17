import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Header from "./components/Header";
import Footer from "./components/Footer";
import { Analytics } from "@vercel/analytics/react"

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "OpenSuno - Suno AI API",
  description: "Open-source Suno AI API with Chrome Extension bridge for zero-config auth and automatic captcha bypass.",
  keywords: ["suno", "suno api", "suno.ai", "api", "music", "generation", "ai", "mcp"],
  creator: "Paean AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} overflow-y-scroll`} >
        <Header />
        <main className="flex flex-col items-center m-auto w-full">
          {children}
        </main>
        <Footer />
        <Analytics />
      </body>
    </html>
  );
}
