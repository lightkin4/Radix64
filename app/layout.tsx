import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Radix64",
  description: "Your apps, built with Radix64",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The preview proxy injects attributes onto <html> before hydration.
    <html lang="en" className={geist.variable} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
