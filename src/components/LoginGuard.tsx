"use client";

import { useState, useEffect } from "react";

interface LoginGuardProps {
  children: React.ReactNode;
}

export default function LoginGuard({ children }: LoginGuardProps) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-white font-mono">
        <div className="text-center">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-500 to-emerald-600 flex items-center justify-center text-3xl font-black text-white shadow-lg shadow-sky-900/40 mb-4">
            W
          </div>
          <h1 className="text-xl font-black tracking-wide mb-2">MIST WATER AND GAS DISTRIBUTORS</h1>
          <p className="text-sm text-slate-400">Initializing POS Terminal Shell…</p>
          <div className="mt-4 w-48 mx-auto h-2 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-sky-500 to-emerald-500 animate-pulse" style={{ width: "100%" }} />
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}