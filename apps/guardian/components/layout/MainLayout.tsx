"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";

type MainLayoutProps = {
  children: ReactNode;
};

const SIDEBAR_STORAGE_KEY = "guardian-sidebar-collapsed";

export function MainLayout({ children }: MainLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const storedValue = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
      setCollapsed(storedValue === "true");
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  function toggleSidebar() {
    setCollapsed((current) => {
      const nextValue = !current;
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(nextValue));
      return nextValue;
    });
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-950">
      <Sidebar collapsed={collapsed} onToggle={toggleSidebar} />
      <div
        className={`min-h-screen transition-[margin-left] duration-300 ease-out ${
          collapsed ? "lg:ml-[72px]" : "lg:ml-60"
        }`}
      >
        <Topbar />
        <main className="px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
