import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import type { FilterState } from "@/types";

interface FiltersProps {
    filters: FilterState;
    onChange: (filters: FilterState) => void;
}

export function Filters({ filters, onChange }: FiltersProps) {
    return (
        <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
                <label className="text-sm font-medium">Vol</label>
                <Input
                    placeholder="ex: AF123"
                    value={filters.flight}
                    onChange={(e) =>
                        onChange({ ...filters, flight: e.target.value })
                    }
                    className="w-36"
                />
            </div>
            <div className="space-y-1">
                <label className="text-sm font-medium">Cabine</label>
                <Input
                    placeholder="ex: Premium"
                    value={filters.cabin}
                    onChange={(e) =>
                        onChange({ ...filters, cabin: e.target.value })
                    }
                    className="w-40"
                />
            </div>
            <div className="space-y-1">
                <label className="text-sm font-medium">Brand</label>
                <Input
                    placeholder="ex: Flex"
                    value={filters.brand}
                    onChange={(e) =>
                        onChange({ ...filters, brand: e.target.value })
                    }
                    className="w-40"
                />
            </div>
            <div className="space-y-1">
                <label className="text-sm font-medium">Tri</label>
                <Select
                    value={filters.sort || "none"}
                    onValueChange={(v) =>
                        onChange({ ...filters, sort: v === "none" ? "" : v })
                    }
                >
                    <SelectTrigger className="w-44">
                        <SelectValue placeholder="Aucun" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="none">Aucun</SelectItem>
                        <SelectItem value="departureTime">Heure de départ</SelectItem>
                    </SelectContent>
                </Select>
            </div>
        </div>
    );
}
