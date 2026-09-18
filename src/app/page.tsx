"use client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

import PinLogin from "@/components/PinLogin";

export default function Home() {
  return <PinLogin />;
}