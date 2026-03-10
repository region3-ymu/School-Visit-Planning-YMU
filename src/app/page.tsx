"use client";

import { useEffect } from "react";
import { usePlannerStore } from "@/store/plannerStore";
import { seedSchoolsMock } from "@/app/actions";
import Dashboard from "@/components/Dashboard";
import WeeklyPlanner from "@/components/WeeklyPlanner";
import SchoolProfiles from "@/components/SchoolProfiles";
import MapZoneView from "@/components/MapZoneView";
import VisitHistory from "@/components/VisitHistory";
import AIChat from "@/components/AIChat";
import { Compass, CalendarDays, Users, Map as MapIcon, History } from "lucide-react";

export default function Home() {
  const { activeTab, setActiveTab } = usePlannerStore();

  useEffect(() => {
    // Seed initial school data if running for the first time
    seedSchoolsMock().then(res => console.log(`Seeded/Verified ${res.count} schools.`));
  }, []);
  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: Compass },
    { id: "planner", label: "Weekly Planner", icon: CalendarDays },
    { id: "history", label: "Visit History", icon: History },
    { id: "profiles", label: "Schools", icon: Users },
    { id: "map", label: "Zone Map", icon: MapIcon },
  ] as const;

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-[#0a0a0a] overflow-hidden text-gray-900 dark:text-gray-100">

      {/* Sidebar */}
      <aside className="w-64 bg-white dark:bg-zinc-900 border-r border-gray-100 dark:border-zinc-800 flex flex-col shadow-sm z-10">
        <div className="p-6 border-b border-gray-100 dark:border-zinc-800">
          <h1 className="text-lg font-black tracking-tight text-indigo-600 dark:text-indigo-400 leading-tight">
            Regional School<br />Visit Planner
          </h1>
          <p className="text-xs text-gray-400 mt-1 uppercase tracking-widest font-semibold flex items-center pr-2">
            Miami-Dade A/B
          </p>
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
            )
          })}
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto w-full relative">
        <div className="max-w-7xl mx-auto w-full min-h-full">
          {activeTab === "dashboard" && <Dashboard />}
          {activeTab === "planner" && <WeeklyPlanner />}
          {activeTab === "history" && <VisitHistory />}
          {activeTab === "profiles" && <SchoolProfiles />}
          {activeTab === "map" && <MapZoneView />}
        </div>
      </main>

      <AIChat />

    </div>
  );
}
