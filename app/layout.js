import "./globals.css";
import { Plus_Jakarta_Sans, IBM_Plex_Sans_Thai } from "next/font/google";
import { DialogProvider } from "@/components/ui/ConfirmDialog";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

const ibmPlexThai = IBM_Plex_Sans_Thai({
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-thai',
  display: 'swap',
});

export const metadata = {
  title: "HR Pro Suite — ระบบบริหารงานบุคคลและปฏิบัติการขนส่ง",
  description: "ระบบ HR และปฏิบัติการขนส่งครบวงจร บริษัท ดีดี เซอร์วิส แอนด์ ทรานสปอร์ต จำกัด",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "HR Pro Suite",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0F2942",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="th"
      suppressHydrationWarning
      className={`${plusJakarta.variable} ${ibmPlexThai.variable}`}
    >
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body>
        <DialogProvider>
          {children}
        </DialogProvider>
      </body>
    </html>
  );
}
