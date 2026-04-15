import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import type { Root } from "../src/types/SABRE";
import { createLookupMaps, buildDirections } from "../src/utils/sabreUtils";
import type { SabreMaps } from "../src/utils/sabreUtils";

const app = new Hono();

app.use("/*", cors());

interface OfferJson {
    offerId: string;
    price: string;
    priceAmount: number;
    currency: string;
    company: string;
    fareBasis: string;
    brand: string;
    directions: { label: string; segments: string[] }[];
    departureTime: string;
    departureTimesByDirection: string[];
}

interface OfferDetailJson {
    offerId: string;
    validatingCarrier: string;
    totalPrice: string;
    baseFare: string;
    taxes: string;
    currency: string;
    itinerary: {
        date: string;
        route: string;
        flights: string;
    }[];
    passengers: {
        paxType: string;
        paxCount: number;
        route: string;
        baggage: string[];
        fareDetails: {
            fareBasisCode: string;
            brandName: string;
            brandCode: string;
            cabinCode: string;
            bookingCode: string;
            services: string[];
        } | null;
        penalties: {
            type: string;
            applicability: string;
            amount: string;
        }[];
    }[];
}

function collectOffers(
    content: Root,
    options: { flightFilter?: string; brandFilter?: string; sortBy?: string }
): OfferJson[] {
    if (!content.groupedItineraryResponse) {
        throw new Error("Invalid JSON format: missing groupedItineraryResponse");
    }

    const { groupedItineraryResponse } = content;
    const maps = createLookupMaps(groupedItineraryResponse);
    const { scheduleMap, legMap, fareComponentMap } = maps;

    const offers: OfferJson[] = [];
    const filterCode = options.flightFilter?.toUpperCase() || null;
    const brandFilter = options.brandFilter?.toLowerCase() || null;

    for (const group of groupedItineraryResponse.itineraryGroups || []) {
        for (const itinerary of group.itineraries || []) {
            const { directions, itineraryFlights, structuredDirections } = buildDirections(
                itinerary,
                group.groupDescription,
                legMap,
                scheduleMap
            );

            if (filterCode && !itineraryFlights.has(filterCode)) continue;

            for (let i = 0; i < (itinerary.pricingInformation || []).length; i++) {
                const info = itinerary.pricingInformation![i];
                if (!info.fare) continue;

                const offer = info.offer;
                const fare = info.fare;
                const offerId = offer?.offerId || `GDS-ITIN-${itinerary.id}-P${i}`;
                const priceAmount = fare.totalFare?.totalPrice ?? 0;
                const currency = fare.totalFare?.currency || "N/A";
                const price = fare.totalFare ? `${priceAmount} ${currency}` : "N/A";
                const company = fare.validatingCarrierCode || "N/A";

                const fareBasisCodes = new Set<string>();
                const brandNames = new Set<string>();

                for (const paxInfo of fare.passengerInfoList || []) {
                    for (const fc of paxInfo.passengerInfo?.fareComponents || []) {
                        const desc = fareComponentMap.get(fc.ref);
                        if (desc) {
                            fareBasisCodes.add(desc.fareBasisCode);
                            if (desc.brand?.brandName) brandNames.add(desc.brand.brandName);
                        }
                    }
                }

                const fareBasis = Array.from(fareBasisCodes).join(", ");
                const brand = Array.from(brandNames).join(", ");

                if (brandFilter && !brand.toLowerCase().includes(brandFilter)) continue;

                const departureTimesByDirection = structuredDirections.map(
                    (dir) => dir.departureTime || "N/A"
                );

                offers.push({
                    offerId,
                    price,
                    priceAmount,
                    currency,
                    company,
                    fareBasis,
                    brand,
                    directions,
                    departureTime: departureTimesByDirection[0] || "N/A",
                    departureTimesByDirection,
                });
            }
        }
    }

    if (options.sortBy === "departureTime") {
        offers.sort((a, b) => {
            if (a.departureTime === "N/A") return 1;
            if (b.departureTime === "N/A") return -1;
            return a.departureTime.localeCompare(b.departureTime);
        });
    }

    return offers;
}

function getOfferDetails(content: Root, targetOfferId: string): OfferDetailJson | null {
    if (!content.groupedItineraryResponse) return null;

    const { groupedItineraryResponse } = content;
    const maps = createLookupMaps(groupedItineraryResponse);
    const { scheduleMap, legMap, fareComponentMap, baggageMap, baggageChargeMap, priceClassMap } = maps;

    for (const group of groupedItineraryResponse.itineraryGroups || []) {
        for (const itinerary of group.itineraries || []) {
            for (let i = 0; i < (itinerary.pricingInformation || []).length; i++) {
                const info = itinerary.pricingInformation![i];
                const currentOfferId = info.offer?.offerId || `GDS-ITIN-${itinerary.id}-P${i}`;

                if (currentOfferId !== targetOfferId) continue;

                const { structuredDirections } = buildDirections(
                    itinerary,
                    group.groupDescription,
                    legMap,
                    scheduleMap
                );

                const fare = info.fare;
                if (!fare) continue;

                const itineraryRows = structuredDirections.map((dir) => ({
                    date: dir.date,
                    route: `${dir.from} → ${dir.to}`,
                    flights: dir.segments
                        .map((s) => `${s.marketingCarrier}${s.marketingFlightNumber} (${s.from} → ${s.to})`)
                        .join(", "),
                }));

                const passengers: OfferDetailJson["passengers"] = [];

                for (const paxInfo of fare.passengerInfoList || []) {
                    const pInfo = paxInfo.passengerInfo;
                    if (!pInfo) continue;

                    const paxCount = pInfo.passengers?.length ?? 0;
                    let globalSegmentIndex = 0;

                    for (const dir of structuredDirections) {
                        const dirSegmentIndices = new Set<number>();
                        for (let si = 0; si < dir.segments.length; si++) {
                            dirSegmentIndices.add(globalSegmentIndex + si);
                        }
                        globalSegmentIndex += dir.segments.length;

                        const fareComponent = pInfo.fareComponents?.find(
                            (fc) => fc.beginAirport === dir.from && fc.endAirport === dir.to
                        );

                        let fareDetails: OfferDetailJson["passengers"][0]["fareDetails"] = null;
                        const penalties: OfferDetailJson["passengers"][0]["penalties"] = [];

                        if (fareComponent) {
                            const desc = fareComponentMap.get(fareComponent.ref);
                            if (desc) {
                                const services: string[] = [];
                                if (desc.brand) {
                                    const priceClass = priceClassMap.get(desc.brand.priceClassDescriptionRef);
                                    if (priceClass?.descriptions) {
                                        for (const d of priceClass.descriptions) {
                                            services.push(d.text);
                                        }
                                    }
                                }

                                fareDetails = {
                                    fareBasisCode: desc.fareBasisCode,
                                    brandName: desc.brand?.brandName || "N/A",
                                    brandCode: desc.brand?.code || "N/A",
                                    cabinCode: fareComponent.segments?.[0]?.segment?.cabinCode || "N/A",
                                    bookingCode: fareComponent.segments?.[0]?.segment?.bookingCode || "N/A",
                                    services,
                                };
                            }

                            const linkedPenaltyIds = new Set(
                                fareComponent.applicablePenalties?.penalties?.map((p) => p.id) || []
                            );

                            if (pInfo.penaltiesInfo) {
                                const allPenalties = pInfo.penaltiesInfo.penalties || [];
                                const penaltiesToShow =
                                    linkedPenaltyIds.size > 0
                                        ? allPenalties.filter((p) => p.id && linkedPenaltyIds.has(p.id))
                                        : allPenalties;

                                for (const pen of penaltiesToShow) {
                                    let amount = pen.amount ? `${pen.amount} ${pen.currency}` : "N/A";

                                    if ((pen.changeable || pen.refundable) && !pen.amount) {
                                        amount = "Free";
                                    } else if (pen.type === "Exchange" && pen.changeable === false) {
                                        amount = "Not Allowed";
                                    } else if (pen.type === "Refund" && pen.refundable === false) {
                                        amount = "Not Allowed";
                                    }

                                    penalties.push({
                                        type: pen.type || "N/A",
                                        applicability: pen.applicability || "",
                                        amount,
                                    });
                                }
                            }
                        }

                        // Baggage
                        const baggageLines: string[] = [];
                        if (pInfo.baggageInformation) {
                            const dirSegmentRefIds = new Set(dir.segmentRefs);

                            for (const bag of pInfo.baggageInformation) {
                                const appliesToRoute = bag.segments?.some(
                                    (s) => dirSegmentRefIds.has(s.id) || dirSegmentIndices.has(s.id)
                                );

                                if (appliesToRoute) {
                                    const typeMap: Record<string, string> = {
                                        A: "Checked",
                                        C: "Carry-on",
                                        B: "Baggage",
                                        P: "Pre-paid",
                                    };
                                    const typeLabel = typeMap[bag.provisionType] || `Prov ${bag.provisionType}`;

                                    if (bag.allowance) {
                                        const allowance = baggageMap.get(bag.allowance.ref);
                                        if (allowance) {
                                            let details = `${allowance.pieceCount} PC`;
                                            if (allowance.weight) details = `${allowance.weight} ${allowance.unit}`;
                                            if (allowance.description1) details += ` (${allowance.description1})`;
                                            baggageLines.push(`${typeLabel}: ${details}`);
                                        }
                                    } else if (bag.charge) {
                                        const charge = baggageChargeMap.get(bag.charge.ref);
                                        if (charge) {
                                            let details = "";
                                            if (charge.equivalentAmount) {
                                                details = `${charge.equivalentAmount} ${charge.equivalentCurrency}`;
                                            }
                                            if (charge.description1) details += ` (${charge.description1})`;
                                            if (charge.description2) details += ` ${charge.description2}`;
                                            baggageLines.push(`${typeLabel} (Charge): ${details}`);
                                        }
                                    }
                                }
                            }
                        }

                        passengers.push({
                            paxType: pInfo.passengerType || "N/A",
                            paxCount,
                            route: `${dir.from} → ${dir.to}`,
                            baggage: baggageLines.length > 0 ? baggageLines : ["N/A"],
                            fareDetails,
                            penalties: penalties.length > 0 ? penalties : [{ type: "None", applicability: "", amount: "" }],
                        });
                    }
                }

                return {
                    offerId: targetOfferId,
                    validatingCarrier: fare.validatingCarrierCode || "N/A",
                    totalPrice: fare.totalFare ? `${fare.totalFare.totalPrice} ${fare.totalFare.currency}` : "N/A",
                    baseFare: fare.totalFare ? `${fare.totalFare.baseFareAmount} ${fare.totalFare.baseFareCurrency}` : "N/A",
                    taxes: fare.totalFare ? `${fare.totalFare.totalTaxAmount} ${fare.totalFare.currency}` : "N/A",
                    currency: fare.totalFare?.currency || "N/A",
                    itinerary: itineraryRows,
                    passengers,
                };
            }
        }
    }

    return null;
}

// Store uploaded file content in memory (per session, simple approach)
let lastUploadedContent: Root | null = null;

app.post("/api/sabre/upload", async (c) => {
    const body = await c.req.parseBody();
    const file = body["file"];

    if (!file || !(file instanceof File)) {
        return c.json({ error: "No file uploaded" }, 400);
    }

    const text = await file.text();
    const content = JSON.parse(text) as Root;

    if (!content.groupedItineraryResponse) {
        return c.json({ error: "Invalid JSON: missing groupedItineraryResponse" }, 400);
    }

    lastUploadedContent = content;
    return c.json({ success: true, message: "File uploaded successfully" });
});

app.get("/api/sabre/offers", (c) => {
    if (!lastUploadedContent) {
        return c.json({ error: "No file uploaded yet" }, 400);
    }

    const flightFilter = c.req.query("flight") || undefined;
    const brandFilter = c.req.query("brand") || undefined;
    const sortBy = c.req.query("sort") || undefined;

    const offers = collectOffers(lastUploadedContent, { flightFilter, brandFilter, sortBy });
    return c.json({ offers, total: offers.length });
});

app.get("/api/sabre/offers/:offerId", (c) => {
    if (!lastUploadedContent) {
        return c.json({ error: "No file uploaded yet" }, 400);
    }

    const offerId = c.req.param("offerId");
    const details = getOfferDetails(lastUploadedContent, offerId);

    if (!details) {
        return c.json({ error: `Offer ${offerId} not found` }, 404);
    }

    return c.json(details);
});

const port = 3001;
console.log(`Metis Web Server running on http://localhost:${port}`);

export default {
    port,
    fetch: app.fetch,
};
