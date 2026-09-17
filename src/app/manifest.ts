import type { MetadataRoute } from "next";

const ICONS: MetadataRoute.Manifest["icons"] = [
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
  { src: "/icons/maskable-any.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
];

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MIST Water And Gas Distributors · POS",
    short_name: "MIST POS",
    description:
      "Water and gas dispatch POS with M-Pesa auto-sync, rider queue and push dispatch alerts.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#020617",
    theme_color: "#020617",
    dir: "ltr",
    lang: "en",
    categories: ["business", "shopping", "productivity"],
    icons: ICONS,
  };
}