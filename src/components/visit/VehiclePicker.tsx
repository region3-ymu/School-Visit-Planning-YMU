"use client";

import { Car, Truck } from "lucide-react";

export type VehicleType = "PERSONAL" | "YMU_VAN";

/**
 * Whose vehicle the driving was done in.
 *
 * Only ever asked for an in-person visit — there is nothing to drive otherwise.
 * The van's miles are still measured and stored; what the choice decides is
 * whether they reach the reimbursable total, since YMU already bought that fuel.
 */
export default function VehiclePicker({
  value,
  onChange,
}: {
  value: VehicleType;
  onChange: (value: VehicleType) => void;
}) {
  const options: { value: VehicleType; label: string; icon: typeof Car }[] = [
    { value: "PERSONAL", label: "My own car", icon: Car },
    { value: "YMU_VAN", label: "YMU van", icon: Truck },
  ];

  return (
    <div>
      <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">What did you drive?</p>
      <div className="flex gap-2">
        {options.map(({ value: v, label, icon: Icon }) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
              value === v
                ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
                : "border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-gray-400"
            }`}
          >
            <Icon size={14} className="shrink-0" />
            {label}
          </button>
        ))}
      </div>
      {value === "YMU_VAN" && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          Recorded against the van, not reimbursed to you.
        </p>
      )}
    </div>
  );
}
