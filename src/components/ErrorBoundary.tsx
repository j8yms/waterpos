"use client";

import { useEffect, useState } from "react";

export default function ClientErrorBoundary({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      console.error("Global error caught:", event.error);
      setHasError(true);
    };
    const handleRejection = (event: PromiseRejectionEvent) => {
      console.error("Unhandled rejection:", event.reason);
      setHasError(true);
    };
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  function hardReset() {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}
    window.location.reload();
  }

  if (hasError) {
    return fallback || (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto w-20 h-20 rounded-2xl bg-rose-500/20 flex items-center justify-center text-4xl font-black text-rose-400">
            ⚠️
          </div>
          <h1 className="mt-4 text-xl font-black tracking-wide text-rose-300">
            Application Crashed
          </h1>
          <p className="text-sm text-slate-400 mt-2 mb-6">
            The app encountered an unexpected error during startup. This is usually caused by
            corrupted local data. Use the button below to perform a full storage wipe and reload.
          </p>
          <button
            onClick={hardReset}
            className="w-full h-14 rounded-xl bg-gradient-to-r from-rose-600 to-amber-600 text-white font-black text-lg transition active:scale-[0.98] shadow-lg shadow-rose-900/40"
          >
            ⚠️ HARD RESET RECOVERY: CLEAR APP STORAGE & RELOAD
          </button>
          <p className="mt-4 text-xs text-slate-500">
            This will delete all cached data (auth tokens, staff list, orders queue) and reload the page.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}