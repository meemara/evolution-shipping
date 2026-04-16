import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Evolution Shipping Tracker",
  description: "Track orders and shipments for Evolution",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
