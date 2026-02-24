import type { Metadata } from "next";
import "./tailwind.css";
import { ThemeProvider } from "./components/ThemeProvider";

export const metadata: Metadata = {
  title: "Lumix — Your organization's knowledge, in conversation",
  description: "A private AI knowledge workspace for teams.",
  icons: { icon: "/logo.svg", shortcut: "/logo.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><ThemeProvider>{children}</ThemeProvider></body>
    </html>
  );
}
