import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Hebrew, Poppins } from "next/font/google";
import { IconSprite } from "@/components/Icon";
import "./globals.css";

const plex = IBM_Plex_Sans_Hebrew({ subsets: ["hebrew", "latin"], weight: ["400", "500", "600", "700"], variable: "--font-plex", display: "swap" });
const poppins = Poppins({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-poppins", display: "swap" });

export const metadata: Metadata = {
  title: { default: "מיתר", template: "%s · מיתר" },
  description: "מערכת הלידים והשיווק של קבוצת מיתר",
  icons: { icon: "/brand/mark-blue-512.png", apple: "/brand/mark-blue-512.png" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#003278" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={`${plex.variable} ${poppins.variable}`}>
      <body>
        <IconSprite />
        {children}
      </body>
    </html>
  );
}
