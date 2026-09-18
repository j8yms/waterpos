import type { Metadata, Viewport } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "MIST POS",
  description: "Mist Water and Gas Distributors POS",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>MIST POS</title>
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}