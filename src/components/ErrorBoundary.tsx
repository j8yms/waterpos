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

  if (hasError) {
    return fallback || (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-rose-500/20 flex items-center justify-center text-3xl font-black text-rose-400">
            ⚠️
          </div>
          <h1 className="mt-4 text-xl font-black tracking-wide text-rose-300">
            Something went wrong
          </h1>
          <p className="text-sm text-slate-400 mt-2">
            The app encountered an unexpected error. Please refresh the page.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 w-full h-12 rounded-xl bg-gradient-to-r from-sky-500 to-emerald-500 text-white font-black text-lg transition active:scale-[0.98]"
          >
            Refresh Page
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}