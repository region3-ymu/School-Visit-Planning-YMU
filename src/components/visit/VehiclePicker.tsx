"use client";

import { Car, Truck, Users } from "lucide-react";

export type VehicleType = "PERSONAL" | "YMU_VAN" | "OTHER_PERSON_CAR";

const OPTIONS: { value: VehicleType; label: string; icon: typeof Car; hint: string }[] = [
  { value: "PERSONAL", label: "My own car", icon: Car, hint: "Reimbursable, minus the commute." },
  { value: "YMU_VAN", label: "YMU van", icon: Truck, hint: "Recorded, not reimbursed — YMU already bought that fuel." },
  {
    value: "OTHER_PERSON_CAR",
    label: "Someone else's car",
    icon: Users,
    hint: "Rode along with someone else. Recorded, not reimbursed to you.",
  },
];

/**
 * Which vehicle carried the RM to an in-person visit.
 *
 * A three-way choice rather than the single "drove the van" checkbox this
 * replaced: a visit made riding along with another RM or the CPO, in their
 * car, is neither the RM's own drive nor YMU's van, and folding it into
 * either misreports who is owed the miles.
 *
 * Only ever shown for an in-person visit — there is nothing to drive
 * otherwise. Miles are still measured for every option, same origin-to-school
 * routing; what this decides is only whether they reach the reimbursable
 * total.
 */
export default function VehiclePicker({
  value,
  onChange,
}: {
  value: VehicleType;
  onChange: (value: VehicleType) => void;
}) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-zinc-700 p-3">
      <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">How did you get here?</p>
      <div className="space-y-1.5">
        {OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const checked = value === opt.value;
          return (
            <label
              key={opt.value}
              className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer"
            >
              <input
                type="radio"
                name="vehicle"
                className="mt-0.5"
                checked={checked}
                onChange={() => onChange(opt.value)}
              />
              <span>
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <Icon size={14} className="shrink-0" />
                  {opt.label}
                </span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">{opt.hint}</span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
