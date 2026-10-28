import { CartProvider } from "@/components/site/cart-provider";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { ChatMount } from "@/components/site/chat-mount";

/** Everything a guest sees: the restaurant's own header, cart and assistant. */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <CartProvider>
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <ChatMount />
      <SiteFooter />
    </CartProvider>
  );
}
