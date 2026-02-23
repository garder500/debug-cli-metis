import type { ItineraryGroup } from "../types/SABRE";
import { type SabreMaps, buildDirections } from "../utils/sabreUtils";
import Table from 'cli-table3';

export function displayOfferDetails(
    targetOfferId: string,
    itineraryGroups: ItineraryGroup[],
    maps: SabreMaps
) {
    const { scheduleMap, legMap, fareComponentMap, baggageMap, baggageChargeMap, priceClassMap } = maps;

    console.log(`--- Details for Offer ID: ${targetOfferId} ---`);

    for (const group of itineraryGroups || []) {
        const itineraries = group.itineraries || [];

        for (const itinerary of itineraries) {

            // We only need to build directions if we find the offer, 
            // BUT we need to find the offer inside the pricingInfos first.
            // Optimization: Find offer first, then build directions.

            const pricingInfos = itinerary.pricingInformation || [];

            for (let i = 0; i < pricingInfos.length; i++) {
                const info = pricingInfos[i];
                const currentOfferId = info.offer?.offerId || `GDS-ITIN-${itinerary.id}-P${i}`;

                if (currentOfferId === targetOfferId) {
                    // Found the offer! Now build directions.
                    const { structuredDirections } = buildDirections(itinerary, group.groupDescription, legMap, scheduleMap);

                    const offer = info.offer;
                    const fare = info.fare;

                    if (!fare) {
                         console.log("Error: Fare information missing for this offer.");
                         continue;
                    }

                    if (offer) {
                        console.log(`\nOffer Found: ${offer.offerId}`);
                    } else {
                        console.log(`\nOffer Found: ${currentOfferId} (Generated ID)`);
                    }
                    console.log(`Validating Carrier: ${fare.validatingCarrierCode}`);

                    if (fare.totalFare) {
                        console.log(`
--- Price Details ---`);
                        console.log(`Total: ${fare.totalFare.totalPrice} ${fare.totalFare.currency}`);
                        console.log(`Base:  ${fare.totalFare.baseFareAmount} ${fare.totalFare.baseFareCurrency}`);
                        console.log(`Taxes: ${fare.totalFare.totalTaxAmount} ${fare.totalFare.currency}`);
                    }

                    console.log(`
--- Itinerary ---`);
                    const table = new Table({
                        head: ['Date', 'Route', 'Flights'],
                        colWidths: [15, 20, 40],
                        wordWrap: true
                    });

                    for (const dir of structuredDirections) {
                        const route = `${dir.from} -> ${dir.to}`;
                        const flights = dir.segments.map(s => `${s.marketingCarrier}${s.marketingFlightNumber} (${s.from} -> ${s.to})`).join('\n');
                        table.push([dir.date, route, flights]);
                    }
                    console.log(table.toString());

                    console.log(`
--- Passenger & Tariff Conditions ---`);

                    const paxTable = new Table({
                        head: ['Pax', 'Route', 'Baggage', 'Fare Details', 'Penalties'],
                        colWidths: [10, 15, 20, 40, 25],
                        wordWrap: true
                    });

                    for (const paxInfo of fare.passengerInfoList || []) {
                        const pInfo = paxInfo.passengerInfo;
                        if (!pInfo) continue;

                        const paxCount = pInfo.passengers ? pInfo.passengers.length : 0;
                        const paxStr = `${pInfo.passengerType} (x${paxCount})`;

                        let globalSegmentIndex = 0;

                        for (const dir of structuredDirections) {
                            const routeStr = `${dir.from} -> ${dir.to}`;

                            // Calculate segment indices for this direction (for GDS baggage matching)
                            const dirSegmentIndices = new Set<number>();
                            for (let i = 0; i < dir.segments.length; i++) {
                                dirSegmentIndices.add(globalSegmentIndex + i);
                            }
                            globalSegmentIndex += dir.segments.length;

                            // 1. Find Fare Component for this Route
                            const fareComponent = pInfo.fareComponents?.find(fc =>
                                fc.beginAirport === dir.from && fc.endAirport === dir.to
                            );

                            let fareDetails = "N/A";
                            let penaltiesStr = "N/A";

                            if (fareComponent) {
                                const desc = fareComponentMap.get(fareComponent.ref);
                                if (desc) {
                                    const fareLines: string[] = [];
                                    let header = `[Basis: ${desc.fareBasisCode}]`;
                                    if (desc.brand) {
                                        header += `\nBrand: ${desc.brand.brandName} (${desc.brand.code})`;
                                    }
                                    fareLines.push(header);

                                    // Cabin info
                                    for (const seg of fareComponent.segments) {
                                        fareLines.push(`Cabin: ${seg.segment.cabinCode} (Cls: ${seg.segment.bookingCode})`);
                                    }

                                    // Services
                                    if (desc.brand) {
                                        const priceClass = priceClassMap.get(desc.brand.priceClassDescriptionRef);
                                        if (priceClass && priceClass.descriptions) {
                                            fareLines.push(`Services:`);
                                            for (const d of priceClass.descriptions) {
                                                fareLines.push(`- ${d.text}`);
                                            }
                                        }
                                    }
                                    fareDetails = fareLines.join('\n');
                                }

                                // Penalties linked to this Fare Component
                                const penaltyLines: string[] = [];
                                const linkedPenaltyIds = new Set(fareComponent.applicablePenalties?.penalties?.map(p => p.id) || []);

                                if (pInfo.penaltiesInfo) {
                                    const allPenalties = pInfo.penaltiesInfo.penalties || [];
                                    
                                    // If we have linked penalties, show only those.
                                    // If NOT (common in GDS), show all penalties found in penaltiesInfo.
                                    const penaltiesToShow = linkedPenaltyIds.size > 0 
                                        ? allPenalties.filter(p => p.id && linkedPenaltyIds.has(p.id))
                                        : allPenalties;

                                    for (const pen of penaltiesToShow) {
                                        let amount = pen.amount ? `${pen.amount} ${pen.currency}` : "N/A";

                                        // "Free" logic: if allowed but no amount
                                        if ((pen.changeable || pen.refundable) && !pen.amount) {
                                            amount = "Free";
                                        }
                                        // "Not Allowed" logic: if explicitly forbidden
                                        else if (pen.type === 'Exchange' && pen.changeable === false) {
                                            amount = "Not Allowed";
                                        }
                                        else if (pen.type === 'Refund' && pen.refundable === false) {
                                            amount = "Not Allowed";
                                        }

                                        let app = "";
                                        if (pen.applicability) {
                                            app = ` (${pen.applicability})`;
                                        } else if (pen.type === 'Exchange' || pen.type === 'Refund') {
                                            // Only add (Before & After) if applicability is missing, 
                                            // though usually GDS provides "Before" / "After" entries separately.
                                            // If it's a generic entry without applicability, we leave it as is.
                                        }

                                        penaltyLines.push(`${pen.type}${app}: ${amount}`);
                                    }
                                }
                                if (penaltyLines.length > 0) {
                                    penaltiesStr = penaltyLines.join('\n');
                                } else {
                                    penaltiesStr = "None";
                                }
                            }

                            // 2. Find Baggage for this Route
                            const baggageLines: string[] = [];
                            if (pInfo.baggageInformation) {
                                const dirSegmentRefIds = new Set(dir.segmentRefs);
                                
                                for (const bag of pInfo.baggageInformation) {
                                    // Check if baggage applies to any segment in this direction
                                    const appliesToRoute = bag.segments?.some(s => 
                                        dirSegmentRefIds.has(s.id) || dirSegmentIndices.has(s.id)
                                    );

                                    if (appliesToRoute) {
                                        const typeMap: Record<string, string> = {
                                            'A': 'Checked',
                                            'C': 'Carry-on',
                                            'B': 'Baggage',
                                            'P': 'Pre-paid'
                                        };
                                        const typeLabel = typeMap[bag.provisionType] || `Prov ${bag.provisionType}`;

                                        if (bag.allowance) {
                                            const allowance = baggageMap.get(bag.allowance.ref);
                                            if (allowance) {
                                                let details = `${allowance.pieceCount} PC`;
                                                if (allowance.weight) {
                                                    details = `${allowance.weight} ${allowance.unit}`;
                                                }
                                                // Handle "UP TO" descriptions
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
                                                // Handle descriptions for charges
                                                if (charge.description1) details += ` (${charge.description1})`;
                                                if (charge.description2) details += ` ${charge.description2}`;

                                                baggageLines.push(`${typeLabel} (Charge): ${details}`);
                                            }
                                        }
                                    }
                                }
                            }
                            const baggageStr = baggageLines.length > 0 ? baggageLines.join('\n') : "N/A";

                            paxTable.push([paxStr, routeStr, baggageStr, fareDetails, penaltiesStr]);
                        }
                    }
                    console.log(paxTable.toString());

                    return; // Found and printed, exit function.
                }
            }
        }
    }
    console.log(`
Offer ID ${targetOfferId} not found.`);
}
