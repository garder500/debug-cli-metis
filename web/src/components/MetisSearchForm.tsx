import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface MetisSearchFormProps {
    onSearchComplete: () => void;
}

interface FlightLeg {
    locationCodeDep: string;
    locationCodeArv: string;
    dateOut: string;
    dateReturn: string;
}

const DEFAULT_ORAS = ["QF", "AF"];
const CABIN_OPTIONS = ["ECONOMY", "PREMIUM", "BUSINESS", "FIRST"];

export function MetisSearchForm({ onSearchComplete }: MetisSearchFormProps) {
    const [leg, setLeg] = useState<FlightLeg>({
        locationCodeDep: "CDG",
        locationCodeArv: "SYD",
        dateOut: "2026-05-14",
        dateReturn: "2026-05-21",
    });
    const [oras, setOras] = useState<string[]>(DEFAULT_ORAS);
    const [oraInput, setOraInput] = useState("");
    const [cabins, setCabins] = useState<string[]>([...CABIN_OPTIONS]);
    const [searching, setSearching] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const addOra = useCallback(() => {
        const code = oraInput.trim().toUpperCase();
        if (code && code.length >= 2 && !oras.includes(code)) {
            setOras((prev) => [...prev, code]);
        }
        setOraInput("");
    }, [oraInput, oras]);

    const removeOra = useCallback((code: string) => {
        setOras((prev) => prev.filter((o) => o !== code));
    }, []);

    const toggleCabin = useCallback((cabin: string) => {
        setCabins((prev) =>
            prev.includes(cabin)
                ? prev.filter((c) => c !== cabin)
                : [...prev, cabin]
        );
    }, []);

    const handleSearch = useCallback(async () => {
        setSearching(true);
        setError(null);

        const payload = {
            option: {
                directFlight: false,
                refundable: false,
                modifiable: false,
                lowest: false,
                strictSearch: false,
            },
            shoppingCriteria: {
                includeUpsell: true,
                cabinTypes: {},
                cabinType: cabins,
                fareType: [],
            },
            selectedAirline: [],
            oras,
            flights: [
                {
                    dates: [leg.dateOut, leg.dateReturn],
                    locationCodeDep: leg.locationCodeDep.toUpperCase(),
                    locationCodeArv: leg.locationCodeArv.toUpperCase(),
                    times: [],
                    flexibility: {
                        [leg.dateOut]: 0,
                        [leg.dateReturn]: 0,
                    },
                },
            ],
            paxs: [
                {
                    __index: 0,
                    id: "PAX1",
                    ptc: "ADT",
                    individualInfo: {
                        titleName: "MR",
                        surname: "TEST",
                        givenName: "User",
                        birthdate: "1990-01-01",
                        entreprise: "",
                    },
                },
            ],
        };

        try {
            const res = await fetch("/api/metis/search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data.error || `Erreur ${res.status}`);
                return;
            }
            onSearchComplete();
        } catch {
            setError("Impossible de joindre le serveur");
        } finally {
            setSearching(false);
        }
    }, [leg, oras, cabins, onSearchComplete]);

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">Recherche de vols Metis</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
                {/* Route */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="space-y-1">
                        <label className="text-sm font-medium">Départ</label>
                        <Input
                            value={leg.locationCodeDep}
                            onChange={(e) =>
                                setLeg({ ...leg, locationCodeDep: e.target.value })
                            }
                            placeholder="CDG"
                            maxLength={3}
                            className="uppercase"
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-sm font-medium">Arrivée</label>
                        <Input
                            value={leg.locationCodeArv}
                            onChange={(e) =>
                                setLeg({ ...leg, locationCodeArv: e.target.value })
                            }
                            placeholder="SYD"
                            maxLength={3}
                            className="uppercase"
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-sm font-medium">Date aller</label>
                        <Input
                            type="date"
                            value={leg.dateOut}
                            onChange={(e) =>
                                setLeg({ ...leg, dateOut: e.target.value })
                            }
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-sm font-medium">Date retour</label>
                        <Input
                            type="date"
                            value={leg.dateReturn}
                            onChange={(e) =>
                                setLeg({ ...leg, dateReturn: e.target.value })
                            }
                        />
                    </div>
                </div>

                {/* ORAs (Airlines) */}
                <div className="space-y-2">
                    <label className="text-sm font-medium">
                        Compagnies (ORAs)
                    </label>
                    <div className="flex flex-wrap gap-2 items-center">
                        {oras.map((code) => (
                            <Badge
                                key={code}
                                variant="secondary"
                                className="cursor-pointer hover:bg-destructive/20"
                                onClick={() => removeOra(code)}
                            >
                                {code} ✕
                            </Badge>
                        ))}
                        <div className="flex gap-1">
                            <Input
                                value={oraInput}
                                onChange={(e) => setOraInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        addOra();
                                    }
                                }}
                                placeholder="ex: LH"
                                className="w-20 h-8 text-sm uppercase"
                                maxLength={3}
                            />
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={addOra}
                                className="h-8"
                            >
                                +
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Cabin types */}
                <div className="space-y-2">
                    <label className="text-sm font-medium">Cabines</label>
                    <div className="flex flex-wrap gap-2">
                        {CABIN_OPTIONS.map((cabin) => (
                            <Badge
                                key={cabin}
                                variant={
                                    cabins.includes(cabin)
                                        ? "default"
                                        : "outline"
                                }
                                className="cursor-pointer"
                                onClick={() => toggleCabin(cabin)}
                            >
                                {cabin}
                            </Badge>
                        ))}
                    </div>
                </div>

                {/* Search button */}
                <div className="flex items-center gap-4">
                    <Button
                        onClick={handleSearch}
                        disabled={
                            searching ||
                            !leg.locationCodeDep ||
                            !leg.locationCodeArv ||
                            !leg.dateOut ||
                            oras.length === 0
                        }
                        className="px-8"
                    >
                        {searching ? (
                            <span className="flex items-center gap-2">
                                <span className="animate-spin inline-block h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
                                Recherche en cours...
                            </span>
                        ) : (
                            "Rechercher"
                        )}
                    </Button>
                    {error && (
                        <p className="text-destructive text-sm">{error}</p>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
