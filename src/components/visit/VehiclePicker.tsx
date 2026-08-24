"use client";

import { Truck } from "lucide-react";

export type VehicleType = "PERSONAL" | "YMU_VAN";

/**
 * Whether the YMU van was used instead of the RM's own car.
 *
 * Deliberately a single opt-in checkbox rather than a two-way choice: nearly
 * every visit is driven in the RM's own car, and making them affirm that on
 * every single form is friction for the rare case. Unticked means own car.
 *
 * Only ever shown for an in-person visit — there is nothing to drive otherwise.
 * The van's miles are still measured and stored; what the tick decides is
 * whether they reach the reimbursable total, since YMU already bought that fuel.
 */
export default function VehiclePicker({
  value,
  onChange,
}: {
  value: VehicleType;
  onChange: (value: VehicleType) => void;
}) {
  const isVan = value === "YMU_VAN";

  return (
    <div className="rounded-lg border border-gray-200 dark:border-zinc-700 p-3">
      <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
        <input
          type="checkbox"
          checked={isVan}
          onChange={(e) => onChange(e.target.checked ? "YMU_VAN" : "PERSONAL")}
        />
        <Truck size={14} className="shrink-0" />
        I drove the YMU van
      </label>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 ml-6">
        {isVan
          ? "Recorded against the van, not reimbursed to you."
          : "Leave unticked if you drove your own car."}
      </p>
    </div>
  );
}
