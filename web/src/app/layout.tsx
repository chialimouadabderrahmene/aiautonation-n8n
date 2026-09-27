import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Eki AI Automation Control Center",
  description: "Operator console for the Eki n8n automation system and AI video pipeline.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
