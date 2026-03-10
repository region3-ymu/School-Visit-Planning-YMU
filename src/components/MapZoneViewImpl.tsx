"use client";

import { useEffect, useState } from "react";
import { getSchools } from "@/app/actions";
import { usePlannerStore } from "@/store/plannerStore";
import { MapContainer, TileLayer, Marker, Popup, Polyline } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { Layers } from "lucide-react";
import { format } from "date-fns";

// Fix for default marker icons in Next.js/Leaflet
const DefaultIcon = L.icon({
    iconUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png",
    iconRetinaUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png",
    shadowUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png",
    iconSize: [25, 41],
    iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;



export default function MapZoneViewImpl() {
    const [schools, setSchools] = useState<any[]>([]);
    const { plannedVisits } = usePlannerStore();

    useEffect(() => {
        getSchools().then(setSchools);
    }, []);

    // Group by zipCode implicitly representing 'Zones'
    const zones = schools.reduce((acc, school) => {
        if (!acc[school.zipCode]) acc[school.zipCode] = [];
        acc[school.zipCode].push(school);
        return acc;
    }, {} as Record<string, any[]>);

    return (
        <div className="p-6">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Zone Clustering (Map Overlay)</h2>
            </div>

            <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm flex flex-col items-center justify-center text-center relative h-[400px] w-full z-0">
                <MapContainer center={[25.7617, -80.1918]} zoom={11} scrollWheelZoom={false} className="h-full w-full">
                    <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />

                    {schools.map((school) => {
                        const coords = [school.lat || 25.7617, school.lng || -80.1918];
                        // Add slight jitter so markets in same location don't totally obscure each other
                        const jitteredCoords: [number, number] = [
                            coords[0] + (Math.random() - 0.5) * 0.002,
                            coords[1] + (Math.random() - 0.5) * 0.002
                        ];

                        return (
                            <Marker key={school.id} position={jitteredCoords}>
                                <Popup>
                                    <h3 className="font-bold text-sm">{school.name}</h3>
                                    <p className="text-xs text-gray-600">Zip: {school.zipCode}</p>
                                    <span className="inline-block mt-1 px-2 py-0.5 text-[10px] uppercase rounded-full bg-indigo-100 text-indigo-700">
                                        {school.frequencyTarget}
                                    </span>
                                </Popup>
                            </Marker>
                        );
                    })}

                    {/* Draw Routing Lines connecting scheduled visits for each day */}
                    {Object.entries(
                        plannedVisits.reduce((acc, visit) => {
                            const d = format(new Date(visit.date), "yyyy-MM-dd");
                            if (!acc[d]) acc[d] = [];
                            const s = schools.find(sch => sch.id === visit.schoolId);
                            if (s && s.lat && s.lng) {
                                acc[d].push([s.lat, s.lng]);
                            }
                            return acc;
                        }, {} as Record<string, [number, number][]>)
                    ).map(([date, coords], idx) => {
                        const colors = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
                        return coords.length > 1 ? (
                            <Polyline
                                key={date}
                                positions={coords}
                                color={colors[idx % colors.length]}
                                weight={4}
                                opacity={0.6}
                                dashArray="5, 8"
                            />
                        ) : null;
                    })}
                </MapContainer>
            </div>

            <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {(Object.entries(zones) as [string, any[]][]).map(([zipCode, zoneSchools]) => (
                    <div key={zipCode} className="bg-white dark:bg-zinc-900 border border-dashed border-indigo-200 dark:border-indigo-900/50 p-4 rounded-xl">
                        <div className="flex items-center text-indigo-700 dark:text-indigo-400 mb-3 space-x-2 font-bold uppercase text-sm">
                            <Layers size={16} /> <span>Zone: {zipCode}</span>
                        </div>
                        <ul className="space-y-2">
                            {zoneSchools.map((s: any) => (
                                <li key={s.id} className="text-sm text-gray-600 dark:text-gray-300 flex items-center before:content-[''] before:w-1.5 before:h-1.5 before:bg-indigo-400 before:rounded-full before:mr-2">
                                    {s.name}
                                </li>
                            ))}
                        </ul>
                    </div>
                ))}
            </div>
        </div>
    );
}
