import type { 
    GroupedItineraryResponse, 
    ScheduleDesc, 
    LegDesc, 
    FareComponentDesc, 
    BaggageAllowanceDesc, 
    BaggageChargeDesc,
    PriceClassDescription,
    Itinerary,
    GroupDescription
} from "../types/SABRE";

export interface SabreMaps {
    scheduleMap: Map<number, ScheduleDesc>;
    legMap: Map<number, LegDesc>;
    fareComponentMap: Map<number, FareComponentDesc>;
    baggageMap: Map<number, BaggageAllowanceDesc>;
    baggageChargeMap: Map<number, BaggageChargeDesc>;
    priceClassMap: Map<number, PriceClassDescription>;
}

export function createLookupMaps(response: GroupedItineraryResponse): SabreMaps {
    return {
        scheduleMap: new Map<number, ScheduleDesc>(response.scheduleDescs?.map(s => [s.id, s]) || []),
        legMap: new Map<number, LegDesc>(response.legDescs?.map(l => [l.id, l]) || []),
        fareComponentMap: new Map<number, FareComponentDesc>(response.fareComponentDescs?.map(f => [f.id, f]) || []),
        baggageMap: new Map<number, BaggageAllowanceDesc>(response.baggageAllowanceDescs?.map(b => [b.id, b]) || []),
        baggageChargeMap: new Map<number, BaggageChargeDesc>(response.baggageChargeDescs?.map(b => [b.id, b]) || []),
        priceClassMap: new Map<number, PriceClassDescription>(response.priceClassDescriptions?.map(p => [p.id, p]) || [])
    };
}

export interface Direction {
    label: string;
    segments: string[];
}

export interface StructuredSegment {
    from: string;
    to: string;
    marketingCarrier: string;
    marketingFlightNumber: number;
}

export interface StructuredDirection {
    from: string;
    to: string;
    date: string;
    segments: StructuredSegment[];
    segmentRefs: number[];
    departureTime?: string;
}

export function buildDirections(
    itinerary: Itinerary, 
    groupDescription: GroupDescription, 
    legMap: Map<number, LegDesc>, 
    scheduleMap: Map<number, ScheduleDesc>
): { directions: Direction[], itineraryFlights: Set<string>, structuredDirections: StructuredDirection[] } {
    
    const itineraryFlights = new Set<string>();
    const directions: Direction[] = [];
    const structuredDirections: StructuredDirection[] = [];
    const legs = itinerary.legs || [];
    const legDescriptions = groupDescription.legDescriptions || [];

    for (let i = 0; i < legs.length; i++) {
        const legRef = legs[i];
        const legDesc = legMap.get(legRef.ref);
        const legInfo = legDescriptions[i];
        
        const directionLabel = legInfo 
            ? `${legInfo.departureLocation} -> ${legInfo.arrivalLocation} (${legInfo.departureDate})`
            : `Direction ${i + 1}`;
        
        const segments: string[] = [];
        const structSegments: StructuredSegment[] = [];
        const segmentRefs: number[] = [];
        let departureTime: string = "N/A";

        if (legDesc) {
            for (let j = 0; j < legDesc.schedules.length; j++) {
                const scheduleRef = legDesc.schedules[j];
                const schedule = scheduleMap.get(scheduleRef.ref);
                if (schedule) {
                    if (j === 0) { // First schedule of this leg
                        departureTime = schedule.departure.time || "N/A";
                    }
                    const flightCode = `${schedule.carrier.marketing}${schedule.carrier.marketingFlightNumber}`;
                    itineraryFlights.add(flightCode);
                    segments.push(`${schedule.departure.airport} -> ${schedule.arrival.airport} (${flightCode})`);
                    
                    structSegments.push({
                        from: schedule.departure.airport,
                        to: schedule.arrival.airport,
                        marketingCarrier: schedule.carrier.marketing,
                        marketingFlightNumber: schedule.carrier.marketingFlightNumber
                    });
                    segmentRefs.push(scheduleRef.ref);
                }
            }
        }
        directions.push({ label: directionLabel, segments });
        structuredDirections.push({
            from: legInfo?.departureLocation || "N/A",
            to: legInfo?.arrivalLocation || "N/A",
            date: legInfo?.departureDate || "N/A",
            segments: structSegments,
            segmentRefs,
            departureTime
        });
    }

    return { directions, itineraryFlights, structuredDirections };
}
