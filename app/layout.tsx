import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "PropertyPilot — Voice-AI SDR for Indian real estate",
  description:
    "Outbound Voice-AI SDR-as-a-Service for Indian developers. Configure your property once, run multi-language site-visit-booking campaigns at <₹100 cost-per-visit-booked.",
  metadataBase: new URL(process.env.APP_BASE_URL ?? "http://localhost:3000"),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body className={`${inter.variable} font-sans antialiased bg-grid-pattern bg-background min-h-screen flex flex-col`}>
        {children}
      </body>
    </html>
  );
}
