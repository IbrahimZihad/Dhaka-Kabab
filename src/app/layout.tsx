import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { env } from "@/lib/env";
import { siteIdentity } from "@/server/http/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Titles come from the restaurant's own settings rather than from this file, so
 * the owner's rename is what a guest's browser tab and search results show.
 */
export async function generateMetadata(): Promise<Metadata> {
  const identity = await siteIdentity();
  const suffix = identity.city ? `${identity.city}, Bangladesh` : "Bangladesh";

  return {
    metadataBase: new URL(env.appUrl),
    title: {
      default: `${identity.name} — grill house${identity.city ? ` in ${identity.city}` : ""}`,
      template: `%s · ${identity.name}`,
    },
    description: `${identity.name}${suffix ? ` in ${suffix}` : ""}. Our menu, table bookings and order tracking.`,
    openGraph: {
      title: identity.name,
      description: `${identity.name}. Menu, table bookings and order tracking.`,
      type: "website",
      siteName: identity.name,
    },
    robots: { index: true, follow: true },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#b8471f",
};

/**
 * Only the document shell lives here. Guests get the site header, cart and chat
 * from the (public) layout; staff screens have their own frame, so a kitchen
 * display never shows a shopping cart or a chat bubble over the queue.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
