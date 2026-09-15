"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { currentUser } from "@/lib/client";
import type { Role } from "@/lib/types";
import { Spinner } from "@/components/ui";

export default function RoleGuard({
  role,
  children,
}: {
  role: Role;
  children: ReactNode;
}) {
  const router = useRouter();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    const user = currentUser();
    if (!user) {
      router.replace("/");
      return;
    }
    if (role === "management" && user.role !== "management") {
      router.replace("/queue");
      return;
    }
    if (role === "rider" && user.role !== "rider") {
      router.replace("/pos");
      return;
    }
    setOk(true);
  }, [role, router]);

  if (!ok) {
    return (
      <main className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-500">
        <Spinner />
        <span className="ml-3">Checking access…</span>
      </main>
    );
  }

  return <>{children}</>;
}