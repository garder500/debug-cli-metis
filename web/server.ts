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
    cabin: string;
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
    options: { flightFilter?: string; cabinFilter?: string; brandFilter?: string; sortBy?: string }
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
                    cabin: "",
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
    const cabinFilter = c.req.query("cabin") || undefined;
    const brandFilter = c.req.query("brand") || undefined;
    const sortBy = c.req.query("sort") || undefined;

    const offers = collectOffers(lastUploadedContent, { flightFilter, cabinFilter, brandFilter, sortBy });
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

// ============================================================
// Metis NDC Shopping
// ============================================================

interface MetisRoot {
    message: string;
    value: {
        DataLists: {
            BaggageAllowance: {
                BaggageAllowanceID: string;
                PieceAllowance?: { TotalQty: number };
                TypeCode?: string;
            }[];
            OriginDest: {
                OriginDestID: string;
                OriginCode: string;
                DestCode: string;
                PaxJourneyRefID: string[];
            }[];
            PaxJourney: {
                PaxJourneyID: string;
                Duration: string;
                PaxSegmentRefID: string[];
            }[];
            PaxSegment: {
                PaxSegmentID: string;
                Arrival: {
                    AircraftScheduledDateTime: string;
                    IATALocationCode: string;
                    TerminalName?: string;
                };
                Dep: {
                    AircraftScheduledDateTime: string;
                    IATALocationCode: string;
                    TerminalName?: string;
                };
                MarketingCarrierInfo: {
                    CarrierDesigCode: string;
                    MarketingCarrierFlightNumberText: string;
                };
                OperatingCarrierInfo?: {
                    CarrierDesigCode: string;
                };
                DatedOperatingLeg?: {
                    IATAAircraftType?: {
                        IATAAircraftTypeCode?: string;
                    };
                };
            }[];
            PriceClass: {
                PriceClassID: string;
                FareBasisCode: string;
                CabinType?: { CabinTypeName?: string };
                Name?: string;
                Desc?: { DescText?: string };
            }[];
            Pax: {
                PaxID: string;
                PTC: string;
            }[];
        };
        offersPrices?: Record<
            string,
            {
                AppCode?: string;
                TypeCode?: string;
                DescText?: string;
                PenaltyAmount?: number;
                ChangeFeeInd?: string;
                CancelFeeInd?: string;
            }[]
        >;
        OriginListFlights: {
            DestCode: string;
            OriginCode: string;
            OriginDestID: string;
            flights: {
                Duration: string;
                PaxJourneyID: string;
                PaxSegmentRefID: string[];
                offertList: MetisOffer[];
            }[];
        }[];
        currency: string;
        filghtsOwners?: Record<string, unknown[]>;
    };
}

interface MetisOffer {
    OfferID: string;
    OfferExpirationDateTime?: string;
    PaxJourneyRefID: string;
    PaxJourneyRefLinked?: string[];
    OwnerCode: string;
    PriceClassRefID?: string;
    cabin?: { seatIncluded?: boolean; cabinName?: string; cabinType?: string };
    baggage?: {
        BaggageAllowanceRefID: string;
        PaxJourneyRefID: string | string[];
        PaxRefID: string;
    };
    SeatAvailability?: { seatsAvailable: number; segmentRef: number }[];
    PJRefs?: {
        PaxJourneyRefID: string;
        PriceClassRefID: string[];
        isOneWay: string;
        legs: { ref: string }[];
    } | null;
    OfferIdList: {
        OfferItemRefID: string;
        PaxRefID: string[];
        FareTypeCode: string;
        Price?: { Amount: { Amount: number | string; Currency: string } };
        penalty?: {
            AppCode?: string;
            TypeCode?: string;
            DescText?: string;
            PenaltyAmount?: number;
            ChangeFeeInd?: string;
            CancelFeeInd?: string;
        }[];
        FareComponent?: { FareRule?: { Remark?: { RemarkText?: string } } };
    }[];
    TotalPrice: { BaseAmount: number | string; TotalTaxAmount: number | string };
    Service: unknown[] | Record<string, unknown>;
    OrderID?: string[];
}

function cleanCarrierCode(code: string): string {
    return code.replace(/^SabreNDC-/, "");
}

function parseDuration(iso: string): string {
    const m = iso.match(/P(?:\d+Y)?(?:\d+M)?(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/);
    if (!m) return iso;
    const d = parseInt(m[1] || "0");
    const h = parseInt(m[2] || "0");
    const min = parseInt(m[3] || "0");
    const totalH = d * 24 + h;
    return `${totalH}h${min.toString().padStart(2, "0")}`;
}

let lastMetisContent: MetisRoot | null = null;
let metisOfferIndex: Map<string, { od: MetisRoot["value"]["OriginListFlights"][0]; flight: MetisRoot["value"]["OriginListFlights"][0]["flights"][0]; offer: MetisOffer }> = new Map();
let lastSearchPayload: any = null;

function buildMetisLookups(data: MetisRoot) {
    const dl = data.value.DataLists;
    const segmentMap = new Map<string, MetisRoot["value"]["DataLists"]["PaxSegment"][0]>();
    for (const s of dl.PaxSegment) segmentMap.set(s.PaxSegmentID, s);

    const journeyMap = new Map<string, MetisRoot["value"]["DataLists"]["PaxJourney"][0]>();
    for (const j of dl.PaxJourney) journeyMap.set(j.PaxJourneyID, j);

    const priceClassMap = new Map<string, MetisRoot["value"]["DataLists"]["PriceClass"][0]>();
    for (const pc of dl.PriceClass) priceClassMap.set(pc.PriceClassID, pc);

    const baggageMap = new Map<string, MetisRoot["value"]["DataLists"]["BaggageAllowance"][0]>();
    for (const ba of dl.BaggageAllowance) baggageMap.set(ba.BaggageAllowanceID, ba);

    const odMap = new Map<string, MetisRoot["value"]["DataLists"]["OriginDest"][0]>();
    for (const od of dl.OriginDest) odMap.set(od.OriginDestID, od);

    return { segmentMap, journeyMap, priceClassMap, baggageMap, odMap };
}

function collectMetisOffers(
    data: MetisRoot,
    options: { flightFilter?: string; cabinFilter?: string; brandFilter?: string; sortBy?: string }
): OfferJson[] {
    const { segmentMap, journeyMap, priceClassMap } = buildMetisLookups(data);
    const offers: OfferJson[] = [];
    const seenOffers = new Set<string>();
    const filterCode = options.flightFilter?.toUpperCase() || null;
    const cabinFilter = options.cabinFilter?.toLowerCase() || null;
    const brandFilter = options.brandFilter?.toLowerCase() || null;

    metisOfferIndex = new Map();

    for (const od of data.value.OriginListFlights) {
        for (const flight of od.flights) {
            for (const offer of flight.offertList) {
                const offerId = offer.OfferID;
                if (seenOffers.has(offerId)) continue;
                seenOffers.add(offerId);

                // Get primary price (non-749 FareTypeCode)
                const priceItem = offer.OfferIdList.find((item) => item.FareTypeCode !== "749");
                const priceAmount = priceItem?.Price?.Amount
                    ? Number(priceItem.Price.Amount.Amount)
                    : Number(offer.TotalPrice.BaseAmount) + Number(offer.TotalPrice.TotalTaxAmount);
                const currency = priceItem?.Price?.Amount?.Currency || data.value.currency || "EUR";
                const price = `${priceAmount.toFixed(2)} ${currency}`;

                const ownerCode = cleanCarrierCode(offer.OwnerCode);

                // Determine actual carrier: for SABRE NDC, use first segment's marketing carrier
                let company = ownerCode;
                if (offer.OwnerCode.startsWith("SABRE")) {
                    const firstJourney = journeyMap.get(offer.PaxJourneyRefID);
                    const firstSegId = firstJourney?.PaxSegmentRefID?.[0];
                    const firstSeg = firstSegId ? segmentMap.get(firstSegId) : undefined;
                    if (firstSeg) {
                        company = cleanCarrierCode(firstSeg.MarketingCarrierInfo.CarrierDesigCode);
                    }
                }

                // Fare basis, cabin & brand from PriceClass
                const pc = offer.PriceClassRefID ? priceClassMap.get(offer.PriceClassRefID) : undefined;
                const fareBasis = pc?.FareBasisCode || "N/A";
                const rawCabinName = offer.cabin?.cabinName || pc?.CabinType?.CabinTypeName || "";
                const rawCabinType = offer.cabin?.cabinType || pc?.Name || "";

                // Separate cabin class from brand name
                let cabin = rawCabinName || "N/A";
                let brand = rawCabinType || "N/A";

                // For SABRE NDC: cabinType is like "Economy Sale", "Premium Economy Saver" — split it
                if (rawCabinType && rawCabinName) {
                    // cabinName = "Economy"/"Premium", cabinType = "Economy Sale"/"Premium Light"
                    // Extract the brand part by removing the cabin prefix
                    const lower = rawCabinType.toLowerCase();
                    const cabinLower = rawCabinName.toLowerCase();
                    if (lower.startsWith(cabinLower + " ")) {
                        brand = rawCabinType.substring(rawCabinName.length + 1);
                    } else {
                        brand = rawCabinType;
                    }
                    cabin = rawCabinName;
                } else if (rawCabinType && !rawCabinName) {
                    // AF case: cabinType = "Light"/"Standard"/"Flex"/"Premium Light"
                    // cabinName comes from PriceClass CabinTypeName
                    cabin = pc?.CabinType?.CabinTypeName || "N/A";
                    brand = rawCabinType;
                }

                // Normalize cabin name
                cabin = cabin.charAt(0).toUpperCase() + cabin.slice(1).toLowerCase();

                if (brandFilter && !brand.toLowerCase().includes(brandFilter)
                    && !cabin.toLowerCase().includes(brandFilter)) continue;

                if (cabinFilter && !cabin.toLowerCase().includes(cabinFilter)) continue;

                // Build directions = segments for each linked journey
                const linkedJourneys = offer.PaxJourneyRefLinked || [offer.PaxJourneyRefID];
                const directions: { label: string; segments: string[] }[] = [];
                const departureTimesByDirection: string[] = [];
                let matchesFlight = !filterCode;

                for (const jRef of linkedJourneys) {
                    const journey = journeyMap.get(jRef);
                    if (!journey) continue;

                    const segDescriptions: string[] = [];
                    let firstDep = "";
                    let from = "";
                    let to = "";

                    for (const sRef of journey.PaxSegmentRefID) {
                        const seg = segmentMap.get(sRef);
                        if (!seg) continue;
                        const carrier = cleanCarrierCode(seg.MarketingCarrierInfo.CarrierDesigCode);
                        const flightNum = seg.MarketingCarrierInfo.MarketingCarrierFlightNumberText;
                        const flightCode = `${carrier}${flightNum}`;

                        if (filterCode && flightCode.toUpperCase().includes(filterCode)) {
                            matchesFlight = true;
                        }

                        segDescriptions.push(`${carrier}${flightNum} ${seg.Dep.IATALocationCode}→${seg.Arrival.IATALocationCode}`);
                        if (!from) from = seg.Dep.IATALocationCode;
                        to = seg.Arrival.IATALocationCode;
                        if (!firstDep) firstDep = seg.Dep.AircraftScheduledDateTime;
                    }

                    const duration = parseDuration(journey.Duration);
                    directions.push({
                        label: `${from} → ${to} (${duration})`,
                        segments: segDescriptions,
                    });
                    departureTimesByDirection.push(firstDep ? firstDep.substring(11, 16) : "N/A");
                }

                if (!matchesFlight) continue;

                metisOfferIndex.set(offerId, { od, flight, offer });

                offers.push({
                    offerId,
                    price,
                    priceAmount,
                    currency,
                    company,
                    fareBasis,
                    cabin,
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

function getMetisOfferDetails(data: MetisRoot, targetOfferId: string): OfferDetailJson | null {
    const entry = metisOfferIndex.get(targetOfferId);
    if (!entry) return null;

    const { od, offer } = entry;
    const { segmentMap, journeyMap, priceClassMap, baggageMap } = buildMetisLookups(data);

    const ownerCode = cleanCarrierCode(offer.OwnerCode);
    // Derive actual carrier
    let validatingCarrier = ownerCode;
    if (offer.OwnerCode.startsWith("SABRE")) {
        const firstJourney = journeyMap.get(offer.PaxJourneyRefID);
        const firstSegId = firstJourney?.PaxSegmentRefID?.[0];
        const firstSeg = firstSegId ? segmentMap.get(firstSegId) : undefined;
        if (firstSeg) validatingCarrier = cleanCarrierCode(firstSeg.MarketingCarrierInfo.CarrierDesigCode);
    }

    const priceItem = offer.OfferIdList.find((item) => item.FareTypeCode !== "749");
    const totalAmount = priceItem?.Price?.Amount
        ? Number(priceItem.Price.Amount.Amount)
        : Number(offer.TotalPrice.BaseAmount) + Number(offer.TotalPrice.TotalTaxAmount);
    const currency = priceItem?.Price?.Amount?.Currency || data.value.currency || "EUR";

    // Build itinerary from linked journeys
    const linkedJourneys = offer.PaxJourneyRefLinked || [offer.PaxJourneyRefID];
    const itinerary: OfferDetailJson["itinerary"] = [];
    const passengers: OfferDetailJson["passengers"] = [];

    for (const jRef of linkedJourneys) {
        const journey = journeyMap.get(jRef);
        if (!journey) continue;

        const segFlights: string[] = [];
        let from = "";
        let to = "";
        let date = "";

        for (const sRef of journey.PaxSegmentRefID) {
            const seg = segmentMap.get(sRef);
            if (!seg) continue;
            const carrier = cleanCarrierCode(seg.MarketingCarrierInfo.CarrierDesigCode);
            const opCarrier = seg.OperatingCarrierInfo ? cleanCarrierCode(seg.OperatingCarrierInfo.CarrierDesigCode) : carrier;
            const flightNum = seg.MarketingCarrierInfo.MarketingCarrierFlightNumberText;
            const aircraft = seg.DatedOperatingLeg?.IATAAircraftType?.IATAAircraftTypeCode || "";
            const depTime = seg.Dep.AircraftScheduledDateTime.substring(11, 16);
            const arrTime = seg.Arrival.AircraftScheduledDateTime.substring(11, 16);
            const depTerm = seg.Dep.TerminalName ? ` T${seg.Dep.TerminalName}` : "";
            const arrTerm = seg.Arrival.TerminalName ? ` T${seg.Arrival.TerminalName}` : "";

            let flightDesc = `${carrier}${flightNum} (${seg.Dep.IATALocationCode}${depTerm} ${depTime} → ${seg.Arrival.IATALocationCode}${arrTerm} ${arrTime})`;
            if (opCarrier !== carrier) flightDesc += ` op. ${opCarrier}`;
            if (aircraft) flightDesc += ` [${aircraft}]`;

            segFlights.push(flightDesc);
            if (!from) from = seg.Dep.IATALocationCode;
            to = seg.Arrival.IATALocationCode;
            if (!date) date = seg.Dep.AircraftScheduledDateTime.substring(0, 10);
        }

        itinerary.push({
            date,
            route: `${from} → ${to}`,
            flights: segFlights.join(", "),
        });

        // Passenger info per direction
        const pc = offer.PriceClassRefID ? priceClassMap.get(offer.PriceClassRefID) : undefined;
        const cabinName = offer.cabin?.cabinName || pc?.CabinType?.CabinTypeName || "N/A";
        const cabinType = offer.cabin?.cabinType || pc?.Name || "N/A";

        // Baggage
        const baggageLines: string[] = [];
        if (offer.baggage?.BaggageAllowanceRefID) {
            const ba = baggageMap.get(offer.baggage.BaggageAllowanceRefID);
            if (ba) {
                const qty = ba.PieceAllowance?.TotalQty ?? 0;
                const typeLabel = ba.TypeCode === "CarryOn" ? "Cabine" : ba.TypeCode === "Checked" ? "Soute" : (ba.TypeCode || "Bagage");
                baggageLines.push(`${typeLabel}: ${qty} PC`);
            }
        }

        // Penalties
        const penalties: OfferDetailJson["passengers"][0]["penalties"] = [];
        const penaltySource = priceItem?.penalty || [];
        const seenPenalties = new Set<string>();

        for (const pen of penaltySource) {
            const key = `${pen.TypeCode}-${pen.AppCode}-${pen.PenaltyAmount ?? pen.DescText}`;
            if (seenPenalties.has(key)) continue;
            seenPenalties.add(key);

            let amount = "N/A";
            if (pen.PenaltyAmount !== undefined) {
                amount = `${pen.PenaltyAmount} ${currency}`;
            } else if (pen.DescText === "NAV") {
                amount = "Not Available";
            }

            const appLabels: Record<string, string> = { PDE: "Before Dep", ADE: "After Dep", NOS: "No-Show" };
            penalties.push({
                type: pen.TypeCode || "N/A",
                applicability: appLabels[pen.AppCode || ""] || pen.AppCode || "",
                amount,
            });
        }

        // Seat availability
        const seatInfo = offer.SeatAvailability?.map((s) => `${s.seatsAvailable} seats`).join(", ");

        const services: string[] = [];
        if (offer.cabin?.seatIncluded) services.push("Siège inclus");
        if (pc?.Desc?.DescText) services.push(pc.Desc.DescText);
        if (seatInfo) services.push(`Disponibilité: ${seatInfo}`);

        passengers.push({
            paxType: "ADT",
            paxCount: 1,
            route: `${from} → ${to}`,
            baggage: baggageLines.length > 0 ? baggageLines : ["N/A"],
            fareDetails: {
                fareBasisCode: pc?.FareBasisCode || "N/A",
                brandName: cabinType,
                brandCode: cabinName,
                cabinCode: cabinName,
                bookingCode: "N/A",
                services,
            },
            penalties: penalties.length > 0 ? penalties : [{ type: "None", applicability: "", amount: "" }],
        });
    }

    return {
        offerId: targetOfferId,
        validatingCarrier,
        totalPrice: `${totalAmount.toFixed(2)} ${currency}`,
        baseFare: `${Number(offer.TotalPrice.BaseAmount).toFixed(2)} ${currency}`,
        taxes: `${Number(offer.TotalPrice.TotalTaxAmount).toFixed(2)} ${currency}`,
        currency,
        itinerary,
        passengers,
    };
}

// Metis endpoints
app.post("/api/metis/upload", async (c) => {
    const body = await c.req.parseBody();
    const file = body["file"];

    if (!file || !(file instanceof File)) {
        return c.json({ error: "No file uploaded" }, 400);
    }

    const text = await file.text();
    const content = JSON.parse(text) as MetisRoot;

    if (!content.value?.OriginListFlights) {
        return c.json({ error: "Invalid JSON: missing value.OriginListFlights" }, 400);
    }

    lastMetisContent = content;
    metisOfferIndex = new Map();
    return c.json({ success: true, message: "File uploaded successfully" });
});

app.get("/api/metis/offers", (c) => {
    if (!lastMetisContent) {
        return c.json({ error: "No file uploaded yet" }, 400);
    }

    const flightFilter = c.req.query("flight") || undefined;
    const cabinFilter = c.req.query("cabin") || undefined;
    const brandFilter = c.req.query("brand") || undefined;
    const sortBy = c.req.query("sort") || undefined;

    const offers = collectMetisOffers(lastMetisContent, { flightFilter, cabinFilter, brandFilter, sortBy });
    return c.json({ offers, total: offers.length });
});

app.get("/api/metis/offers/:offerId", (c) => {
    if (!lastMetisContent) {
        return c.json({ error: "No file uploaded yet" }, 400);
    }

    const offerId = decodeURIComponent(c.req.param("offerId"));
    const details = getMetisOfferDetails(lastMetisContent, offerId);

    if (!details) {
        return c.json({ error: `Offer ${offerId} not found` }, 404);
    }

    return c.json(details);
});

// Metis Keycloak auth
const KEYCLOAK_TOKEN_URL = "https://login-pp-gcp.metisconnect.com/realms/master/protocol/openid-connect/token";
const KEYCLOAK_CLIENT_ID = "api-dashboard";
const KEYCLOAK_CLIENT_SECRET = "**********";
const KEYCLOAK_USERNAME = "lin";
const KEYCLOAK_PASSWORD = "3110";

let cachedToken: { access_token: string; expires_at: number } | null = null;

async function getMetisToken(): Promise<string> {
    // Reuse token if still valid (with 30s margin)
    if (cachedToken && Date.now() < cachedToken.expires_at - 30_000) {
        return cachedToken.access_token;
    }

    const body = new URLSearchParams({
        client_id: KEYCLOAK_CLIENT_ID,
        client_secret: KEYCLOAK_CLIENT_SECRET,
        grant_type: "password",
        username: KEYCLOAK_USERNAME,
        password: KEYCLOAK_PASSWORD,
    });

    const res = await fetch(KEYCLOAK_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Keycloak auth failed (${res.status}): ${text}`);
    }

    const data = await res.json() as { access_token: string; expires_in: number };
    cachedToken = {
        access_token: data.access_token,
        expires_at: Date.now() + data.expires_in * 1000,
    };
    console.log(`[Auth] Token obtained, expires in ${data.expires_in}s`);
    return data.access_token;
}

// Metis Shopping - Reverse proxy to fetch live flights
const DEFAULT_AGENCE_INFO = {
    aggregatorSurcharge: false,
    gie: "Tourcom",
    id_sales_point: 1,
    id_agence: 1,
    name: "AdenisPDV",
    iata: "20255373",
    office_id: "",
    phone: "0606060609",
};

app.post("/api/metis/search", async (c) => {
    try {
        const payload = await c.req.json();

        // Inject agenceInfo if not provided
        if (!payload.agenceInfo) {
            payload.agenceInfo = { ...DEFAULT_AGENCE_INFO };
        }

        // Store search payload for OfferPrice reuse
        lastSearchPayload = payload;

        // 1. Get bearer token
        let token: string;
        try {
            token = await getMetisToken();
        } catch (err: any) {
            return c.json({ error: `Authentication failed: ${err.message}` }, 401);
        }

        // 2. Call Metis API with token (timeout 2 min — shopping can be slow)
        const targetUrl = "http://localhost:8080/global/airShoppingRQ";
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120_000);
        const response = await fetch(targetUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`,
                "x-source-app": "CHECKOUT",
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            const text = await response.text();
            return c.json({ error: `Metis API error (${response.status}): ${text}` }, response.status as any);
        }

        const content = await response.json() as MetisRoot;

        // Debug: log response structure
        const topKeys = Object.keys(content);
        const valueKeys = content.value ? Object.keys(content.value) : [];
        const hasOriginList = !!content.value?.OriginListFlights;
        const originListLen = content.value?.OriginListFlights?.length ?? 0;
        const hasOffersPrices = !!content.value?.offersPrices;
        const offersPricesKeys = content.value?.offersPrices ? Object.keys(content.value.offersPrices).length : 0;
        const hasDataLists = !!content.value?.DataLists;
        console.log(`[Search] Response keys: ${topKeys.join(", ")}`);
        console.log(`[Search] value keys: ${valueKeys.join(", ")}`);
        console.log(`[Search] OriginListFlights: ${hasOriginList} (${originListLen}), offersPrices: ${hasOffersPrices} (${offersPricesKeys} keys), DataLists: ${hasDataLists}`);

        if (!content.value?.OriginListFlights) {
            return c.json({ error: "Invalid response from Metis API: missing value.OriginListFlights" }, 502);
        }

        lastMetisContent = content;
        metisOfferIndex = new Map();
        return c.json({ success: true, message: "Search completed successfully" });
    } catch (err: any) {
        return c.json({ error: `Failed to reach Metis API: ${err.message}` }, 502);
    }
});

// ============================================================
// Metis OfferPrice
// ============================================================

app.post("/api/metis/offerPrice/:offerId", async (c) => {
    const offerId = decodeURIComponent(c.req.param("offerId"));

    if (!lastMetisContent) {
        return c.json({ error: "No shopping data available" }, 400);
    }

    const entry = metisOfferIndex.get(offerId);
    if (!entry) {
        return c.json({ error: `Offer ${offerId} not found` }, 404);
    }

    const { offer } = entry;
    const { segmentMap, journeyMap, priceClassMap } = buildMetisLookups(lastMetisContent);
    const paxList = lastMetisContent.value.DataLists.Pax;

    // Build OfferID array from OfferIdList
    const offerItemIds = offer.OfferIdList.map((item) => item.OfferItemRefID);

    // Fare basis from PriceClass
    const pc = offer.PriceClassRefID ? priceClassMap.get(offer.PriceClassRefID) : undefined;

    // Determine journeys and one-way status
    const linkedJourneys = offer.PaxJourneyRefLinked || [offer.PaxJourneyRefID];
    const isOneWay = linkedJourneys.length <= 1;

    // Build fares from segments across all journeys
    const fares: {
        flightNumber: number;
        airlineCode: string;
        fromAirportCode: string;
        toAirportCode: string;
        departureDate: string;
        departureTime: string;
        bookingClass: string;
        arrivalDate: string;
        arrivalTime: string;
        flightStatusCode: string;
        source: string;
        isMarriageGroup: boolean;
    }[] = [];

    for (const jRef of linkedJourneys) {
        const journey = journeyMap.get(jRef);
        if (!journey) continue;
        for (const sRef of journey.PaxSegmentRefID) {
            const seg = segmentMap.get(sRef);
            if (!seg) continue;
            const depDt = seg.Dep.AircraftScheduledDateTime;
            const arrDt = seg.Arrival.AircraftScheduledDateTime;
            fares.push({
                flightNumber: parseInt(seg.MarketingCarrierInfo.MarketingCarrierFlightNumberText) || 0,
                airlineCode: cleanCarrierCode(seg.MarketingCarrierInfo.CarrierDesigCode),
                fromAirportCode: seg.Dep.IATALocationCode,
                toAirportCode: seg.Arrival.IATALocationCode,
                departureDate: depDt.substring(0, 10),
                departureTime: depDt.substring(11, 16),
                bookingClass: "",
                arrivalDate: arrDt.substring(0, 10),
                arrivalTime: arrDt.substring(11, 16),
                flightStatusCode: "NN",
                source: "ATPCO",
                isMarriageGroup: false,
            });
        }
    }

    // Build fareBasisCode per passenger
    const fareBasisCodes = paxList.map((pax) => ({
        fareBasis: pc?.FareBasisCode || "",
        passengerType: pax.PTC,
    }));

    // Calculate timeToLive from offer expiration
    const expiry = offer.OfferExpirationDateTime
        ? new Date(offer.OfferExpirationDateTime).getTime()
        : 0;
    const timeToLive = expiry ? Math.max(0, Math.floor((expiry - Date.now()) / 1000)) : 1140;

    // Base64-encode dataID
    const dataID = btoa(
        JSON.stringify({
            orderId: { offerId: offer.OfferID, timeToLive, source: "NDC" },
            offerItemId: offerItemIds,
            fareBasisCode: fareBasisCodes,
            isOneWay,
            fares,
        })
    );

    // Determine ORA source from OwnerCode
    const ora =
        offer.OwnerCode.startsWith("SABRE") || offer.OwnerCode.startsWith("SabreNDC")
            ? "SABRE"
            : cleanCarrierCode(offer.OwnerCode);

    // Build paxs with minimal info
    const paxs = paxList.map((p) => ({
        PaxID: p.PaxID,
        PTC: p.PTC,
        _other: {},
        docsList: [],
        fidelityCard: null,
    }));

    const agenceInfo = lastSearchPayload?.agenceInfo || DEFAULT_AGENCE_INFO;

    const offerPricePayload = {
        oras: [ora],
        OfferID: offerItemIds,
        dataID,
        AirlineDesigCode: ora,
        paxs,
        agenceInfo,
    };

    console.log(`[OfferPrice] Requesting for ${offerId}, ORA=${ora}, items=${offerItemIds.length}`);

    // Get token and call API
    let token: string;
    try {
        token = await getMetisToken();
    } catch (err: any) {
        return c.json({ error: `Authentication failed: ${err.message}` }, 401);
    }

    const targetUrl = "http://localhost:8080/global/offerPriceRQ";
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);

    try {
        const response = await fetch(targetUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
                "x-source-app": "CHECKOUT",
            },
            body: JSON.stringify(offerPricePayload),
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            const text = await response.text();
            return c.json(
                { error: `OfferPrice API error (${response.status}): ${text}` },
                response.status as any
            );
        }

        const result = (await response.json()) as any;

        // OfferPriceRS has nested value.value structure
        const inner = result?.value?.value || result?.value || result;

        // Extract unique payment method names
        const paymentMethods: string[] = [];
        for (const p of inner.PaymentInfo || []) {
            if (p.Payment && !paymentMethods.includes(p.Payment)) {
                paymentMethods.push(p.Payment);
            }
        }

        // Extract baggage details (KG weights only)
        const baggage = (inner.DataLists?.BaggageAllowanceList || []).map((ba: any) => ({
            id: ba.BaggageAllowanceID || "",
            type: ba.TypeCode || "",
            pieces: ba.PieceAllowance?.TotalQty ?? 0,
            weights: (ba.weight || [])
                .filter((w: any) => w.MaximumWeightMeasure?.UnitCode === "KG")
                .map((w: any) => `${w.MaximumWeightMeasure.MaximumWeight} kg`),
        }));

        // Build response
        const offerPriceData = {
            offerId: inner.OfferID || offerId,
            offerExpiration: inner.OfferExpirationDateTime || null,
            paymentTimeLimit: inner.PaymentTimeLimitDateTime || null,
            conditions: inner.conditions || [],
            conditionCurrency: inner.conditionCurrency || "",
            remarks: inner.remarks || [],
            paymentMethods,
            orderItems: (inner.OrderItems || []).map((item: any) => ({
                paxRefId: item.PaxRefID || [],
                offerItemId: item.OfferItemID || "",
                totalAmount: item.Price?.TotalAmount ?? 0,
                totalTaxAmount: item.Price?.TotalTaxAmount ?? 0,
            })),
            baggage,
        };

        console.log(
            `[OfferPrice] Success: ${offerPriceData.conditions.length} conditions, ${offerPriceData.remarks.length} remarks, ${offerPriceData.paymentMethods.length} payment methods`
        );

        return c.json(offerPriceData);
    } catch (err: any) {
        clearTimeout(timeoutId);
        return c.json({ error: `Failed to reach OfferPrice API: ${err.message}` }, 502);
    }
});

const port = 3001;
console.log(`Metis Web Server running on http://localhost:${port}`);

export default {
    port,
    fetch: app.fetch,
};
