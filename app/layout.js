import "./globals.css";

export const metadata = {
  title: "HR AI Assistant — ระบบตอบข้อมูล HR อัจฉริยะ",
  description: "ระบบ AI Chatbot สำหรับสอบถามข้อมูล HR ขอเอกสาร Template และตรวจสอบข้อมูลพนักงาน",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "HR AI Assistant",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#6366f1",
};

export default function RootLayout({ children }) {
  return (
    <html lang="th" suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body>{children}</body>
    </html>
  );
}
