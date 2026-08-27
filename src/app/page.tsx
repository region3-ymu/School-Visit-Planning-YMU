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
import MileageGapBanner from "@/components/MileageGapBanner";
import { canFilterByRegion, tabsForRole } from "@/lib/permissions";
import {
  Compass, CalendarDays, Users, Map as MapIcon, History, LogOut, ChevronDown, BarChart3, Menu, X,
} from "lucide-react";

function HomeInner() {
  const { activeTab, setActiveTab } = usePlannerStore();
  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  const role = session?.user?.role;
  // Any role that sees every region gets the region picker — the oversight
  // roles and the Afterschool Manager, not only ADMIN.
  const canPickRegion = role ? canFilterByRegion(role) : false;
  const isRM = role === "REGIONAL_MANAGER";

  const [regions, setRegions] = useState<{ id: string; name: string; code: string }[]>([]);
  const selectedRegionId = searchParams.get("region") ?? "";
  // Below md the sidebar is a drawer. On a 375pt phone a permanently visible
  // 16rem rail left 7rem for the app itself, which is what "se ven muy mal las
  // dimensiones en celular" was.
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (canPickRegion) {
      getRegions().then(setRegions);
    }
  }, [canPickRegion]);

  const handleRegionChange = (regionId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (regionId) {
      params.set("region", regionId);
    } else {
      params.delete("region");
    }
    router.push(`?${params.toString()}`);
  };

  const TABS = {
    dashboard: { label: "Dashboard", icon: Compass },
    planner: { label: "Weekly Planner", icon: CalendarDays },
    history: { label: "Visit History", icon: History },
    profiles: { label: "Schools", icon: Users },
    map: { label: "Zone Map", icon: MapIcon },
    reports: { label: "Reports", icon: BarChart3 },
  } as const;

  // Which tabs this role gets, and in what order — src/lib/permissions.ts
  // decides, so the nav and the server agree about who may do what. Oversight
  // roles have no Weekly Planner and no Zone Map: those two screens exist to
  // decide and drive somebody's week.
  const allowedTabs = role ? tabsForRole(role) : ["dashboard" as const];
  const navItems = allowedTabs.map((id) => ({ id, ...TABS[id] }));

  // activeTab is persisted in localStorage, so somebody who was an RM last week
  // — or who simply shares a browser — can arrive with a tab their role no
  // longer has. Without this they would land on a blank pane.
  const currentTab = allowedTabs.includes(activeTab as (typeof allowedTabs)[number])
    ? activeTab
    : allowedTabs[0];

  return (
    // h-dvh, not h-screen: on mobile Safari 100vh is the viewport with the URL
    // bar HIDDEN, so a full-height app is taller than what you can see and its
    // bottom row sits behind the browser chrome. dvh is the height that is
    // actually visible, and in the installed PWA the two are identical anyway.
    <div className="flex h-dvh bg-gray-50 dark:bg-[#0a0a0a] overflow-hidden text-gray-900 dark:text-gray-100">

      {/* Scrim behind the drawer. Tapping anywhere off the menu closes it —
          the gesture everyone tries first, and cheaper than reaching for the X. */}
      {navOpen && (
        <div
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm md:hidden"
          aria-hidden
        />
      )}

      {/* Sidebar — a slide-over drawer below md, the static rail from md up.
          One set of markup for both: two copies drift, and the nav is the one
          thing that must be identical on every screen. */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw] flex-col bg-white dark:bg-zinc-900 border-r border-gray-100 dark:border-zinc-800 shadow-sm transition-transform duration-200 ease-out pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] md:static md:z-10 md:w-64 md:max-w-none md:translate-x-0 md:pt-0 md:pb-0 ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <button
          type="button"
          onClick={() => setNavOpen(false)}
          aria-label="Close menu"
          className="absolute right-2 top-2 z-10 rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800 md:hidden"
        >
          <X size={20} />
        </button>
        <div className="p-6 border-b border-gray-100 dark:border-zinc-800">
          <h1 className="text-lg font-black tracking-tight text-indigo-600 dark:text-indigo-400 leading-tight">
            Regional School<br />Visit Planner
          </h1>

          {/* Region selector / label */}
          {canPickRegion && regions.length > 0 ? (
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

        <nav className="flex-1 overflow-y-auto p-4 space-y-2">
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  setNavOpen(false);
                }}
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

      {/* min-w-0 is load-bearing: without it a wide child (the week grid, a
          report table) stretches this flex column past the viewport and the
          whole page scrolls sideways instead of the table scrolling inside it. */}
      <div className="flex min-w-0 flex-1 flex-col">

        {/* Mobile top bar. Replaces the rail below md and carries the only two
            things you need before opening the menu: where you are, and how to
            get out of it. */}
        <header className="flex shrink-0 items-center gap-2 border-b border-gray-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2 py-2 pt-[calc(0.5rem+env(safe-area-inset-top))] md:hidden">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open menu"
            aria-expanded={navOpen}
            className="rounded-lg p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-800"
          >
            <Menu size={22} />
          </button>
          <span className="truncate text-sm font-black tracking-tight text-indigo-600 dark:text-indigo-400">
            Visit Planner
          </span>
          {isRM && session?.user?.regionName && (
            <span className="ml-auto shrink-0 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
              {session.user.regionName}
            </span>
          )}
        </header>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto w-full relative pb-[env(safe-area-inset-bottom)]">
          <div className={currentTab === "map" ? "w-full min-h-full lg:h-full" : "max-w-7xl mx-auto w-full min-h-full"}>
          {/* Above every tab, not tucked inside the reports one: miles go
              missing at confirm time, and the RM who needs to know is the one
              planning their week, not the one already opening a report. */}
          <MileageGapBanner />
          {currentTab === "dashboard" && <Dashboard regionFilter={selectedRegionId || null} />}
          {currentTab === "planner" && <WeeklyPlanner regionFilter={selectedRegionId || null} />}
          {currentTab === "history" && <VisitHistory regionFilter={selectedRegionId || null} />}
          {currentTab === "profiles" && <SchoolProfiles regionFilter={selectedRegionId || null} />}
          {currentTab === "map" && <MapZoneView />}
          {currentTab === "reports" && <MileageReports regionFilter={selectedRegionId || null} />}
          </div>
        </main>
      </div>

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
