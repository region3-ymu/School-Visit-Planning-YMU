"use client";

import { Suspense, useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePlannerStore } from "@/store/plannerStore";
import { getRegions } from "@/app/actions";
import Dashboard from "@/components/Dashboard";
import WeeklyPlanner from "@/components/WeeklyPlanner";
import SchoolProfiles from "@/components/SchoolProfiles";
import MapZoneView from "@/components/MapZoneView";
import VisitHistory from "@/components/VisitHistory";
import MileageReports from "@/components/MileageReports";
import AIChat from "@/components/AIChat";
import {
  Compass, CalendarDays, Users, Map as MapIcon, History, LogOut, ChevronDown, BarChart3,
} from "lucide-react";

function HomeInner() {
  const { activeTab, setActiveTab } = usePlannerStore();
  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  const isAdmin = session?.user?.role === "ADMIN";
  const isRM = session?.user?.role === "REGIONAL_MANAGER";

  const [regions, setRegions] = useState<{ id: string; name: string; code: string }[]>([]);
  const selectedRegionId = searchParams.get("region") ?? "";

  useEffect(() => {
    if (isAdmin) {
      getRegions().then(setRegions);
    }
  }, [isAdmin]);

  const handleRegionChange = (regionId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (regionId) {
      params.set("region", regionId);
    } else {
      params.delete("region");
    }
    router.push(`?${params.toString()}`);
  };

  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: Compass },
    { id: "planner", label: "Weekly Planner", icon: CalendarDays },
    { id: "history", label: "Visit History", icon: History },
    { id: "profiles", label: "Schools", icon: Users },
    { id: "map", label: "Zone Map", icon: MapIcon },
    { id: "reports", label: "Reports", icon: BarChart3 },
  ] as const;

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-[#0a0a0a] overflow-hidden text-gray-900 dark:text-gray-100">

      {/* Sidebar */}
      <aside className="w-64 bg-white dark:bg-zinc-900 border-r border-gray-100 dark:border-zinc-800 flex flex-col shadow-sm z-10">
        <div className="p-6 border-b border-gray-100 dark:border-zinc-800">
          <h1 className="text-lg font-black tracking-tight text-indigo-600 dark:text-indigo-400 leading-tight">
            Regional School<br />Visit Planner
          </h1>

          {/* Region selector / label */}
          {isAdmin && regions.length > 0 ? (
            <div className="mt-3 relative">
              <select
                value={selectedRegionId}
                onChange={(e) => handleRegionChange(e.target.value)}
                className="w-full text-xs font-semibold text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-md px-2 py-1.5 pr-6 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">All Regions</option>
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
              <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          ) : isRM ? (
            <p className="text-xs text-gray-400 mt-1 uppercase tracking-widest font-semibold">
              {session?.user?.regionName ?? "YOUR REGION"}
            </p>
          ) : null}
        </div>

        <nav className="flex-1 p-4 space-y-2">
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 ${isActive
                  ? "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
                  : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 hover:text-gray-900 dark:hover:bg-zinc-800/50 dark:hover:text-gray-200"
                  }`}
              >
                <Icon size={18} className={isActive ? "text-indigo-600 dark:text-indigo-400" : "opacity-70"} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* User info + sign out */}
        <div className="p-4 border-t border-gray-100 dark:border-zinc-800">
          {session?.user && (
            <div className="mb-2 px-1">
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 truncate">
                {session.user.name ?? session.user.email}
              </p>
              <p className="text-[10px] text-gray-400 uppercase tracking-wider">
                {session.user.role?.replace(/_/g, " ")}
              </p>
            </div>
          )}
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="w-full flex items-center space-x-2 px-3 py-2 rounded-lg text-sm text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <LogOut size={16} />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto w-full relative">
        <div className={activeTab === "map" ? "w-full min-h-full" : "max-w-7xl mx-auto w-full min-h-full"}>
          {activeTab === "dashboard" && <Dashboard regionFilter={selectedRegionId || null} />}
          {activeTab === "planner" && <WeeklyPlanner regionFilter={selectedRegionId || null} />}
          {activeTab === "history" && <VisitHistory regionFilter={selectedRegionId || null} />}
          {activeTab === "profiles" && <SchoolProfiles regionFilter={selectedRegionId || null} />}
          {activeTab === "map" && <MapZoneView />}
          {activeTab === "reports" && <MileageReports regionFilter={selectedRegionId || null} />}
        </div>
      </main>

      <AIChat />

    </div>
  );
}

export default function Home() {
  return (
    <Suspense>
      <HomeInner />
    </Suspense>
  );
}
