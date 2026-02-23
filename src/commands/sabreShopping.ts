import { readJsonFile } from "../utils/fileReader";
import type { Root } from "../types/SABRE";
import { createLookupMaps, buildDirections, Direction, SabreMaps } from "../utils/sabreUtils";
import { displayOfferDetails } from "./sabreOfferDetails";

export interface OfferInfo {
  offerId: string;
  price: string;
  company: string;
  fareBasis: string;
  brand: string;
  directions: Direction[];
  departureTime: string;
  departureTimesByDirection: string[];
}

export interface SabreShoppingOptions {
  flightFilter?: string;
  brandFilter?: string;
  sortBy?: string;
}

export interface SabreShoppingResult {
  offers: OfferInfo[];
  maps: SabreMaps;
  groupedItineraryResponse: NonNullable<Root["groupedItineraryResponse"]>;
}

export async function collectSabreOffers(
  filename: string,
  options: SabreShoppingOptions = {}
): Promise<SabreShoppingResult> {
  const content = await readJsonFile<Root>(filename);

  if (!content.groupedItineraryResponse) {
    throw new Error("Invalid JSON format: missing groupedItineraryResponse");
  }

  const { groupedItineraryResponse } = content;
  const maps = createLookupMaps(groupedItineraryResponse);
  const { scheduleMap, legMap, fareComponentMap } = maps;

  const foundOffers: OfferInfo[] = [];
  const filterCode = options.flightFilter ? options.flightFilter.toUpperCase() : null;
  const brandFilter = options.brandFilter ? options.brandFilter.toLowerCase() : null;

  for (const group of groupedItineraryResponse.itineraryGroups || []) {
    const itineraries = group.itineraries || [];

    for (const itinerary of itineraries) {
      const { directions, itineraryFlights, structuredDirections } = buildDirections(
        itinerary,
        group.groupDescription,
        legMap,
        scheduleMap
      );

      if (filterCode && !itineraryFlights.has(filterCode)) {
        continue;
      }

      const pricingInfos = itinerary.pricingInformation || [];
      for (let i = 0; i < pricingInfos.length; i++) {
        const info = pricingInfos[i];
        if (!info.fare) {
          continue;
        }

        const offer = info.offer;
        const fare = info.fare;
        const offerId = offer?.offerId || `GDS-ITIN-${itinerary.id}-P${i}`;
        const price = fare.totalFare
          ? `${fare.totalFare.totalPrice} ${fare.totalFare.currency}`
          : "N/A";
        const company = fare.validatingCarrierCode || "N/A";

        const fareBasisCodes = new Set<string>();
        const brandNames = new Set<string>();

        const passengerInfos = fare.passengerInfoList || [];
        for (const paxInfo of passengerInfos) {
          const fareComponents = paxInfo.passengerInfo?.fareComponents || [];
          for (const fc of fareComponents) {
            const desc = fareComponentMap.get(fc.ref);
            if (desc) {
              fareBasisCodes.add(desc.fareBasisCode);
              if (desc.brand && desc.brand.brandName) {
                brandNames.add(desc.brand.brandName);
              }
            }
          }
        }

        const fareBasis = Array.from(fareBasisCodes).join(", ");
        const brand = Array.from(brandNames).join(", ");

        if (brandFilter && !brand.toLowerCase().includes(brandFilter)) {
          continue;
        }

        const departureTimesByDirection = structuredDirections.map(
          (dir) => dir.departureTime || "N/A"
        );
        const departureTime =
          departureTimesByDirection.length > 0 ? departureTimesByDirection[0] : "N/A";

        foundOffers.push({
          offerId,
          price,
          company,
          fareBasis,
          brand,
          directions,
          departureTime,
          departureTimesByDirection,
        });
      }
    }
  }

  if (options.sortBy === "departureTime") {
    foundOffers.sort((a, b) => {
      if (a.departureTime === "N/A") return 1;
      if (b.departureTime === "N/A") return -1;
      return a.departureTime.localeCompare(b.departureTime);
    });
  }

  return { offers: foundOffers, maps, groupedItineraryResponse };
}

export async function handleSabreShopping(
  filename: string,
  options: { flightFilter?: string; brandFilter?: string; offerId?: string; sortBy?: string } = {}
) {
  try {
    const { offers: foundOffers, maps, groupedItineraryResponse } = await collectSabreOffers(
      filename,
      {
        flightFilter: options.flightFilter,
        brandFilter: options.brandFilter,
        sortBy: options.sortBy,
      }
    );

    if (options.offerId) {
      displayOfferDetails(options.offerId, groupedItineraryResponse.itineraryGroups, maps);
      return;
    }

    // --- LIST MODE ---
    console.log("--- Available Offers ---");

    // Display offers
    for (const offer of foundOffers) {
        console.log(`Offer ID: ${offer.offerId}`);
        console.log(`  Departures: ${offer.departureTimesByDirection.join(" | ")}`);
        console.log(`  Price:      ${offer.price}`);
        console.log(`  Company:    ${offer.company}`);
        console.log(`  Fare Basis: ${offer.fareBasis}`);
        console.log(`  Brand:      ${offer.brand}`);
        console.log(`  Route:`);
        for (const dir of offer.directions) {
            console.log(`    [ ${dir.label} ]`);
            for (const seg of dir.segments) {
                console.log(`      - ${seg}`);
            }
        }
        console.log("---------------------------------------------------");
    }


    console.log(`
Total Offers Found: ${foundOffers.length}`);

  } catch (error) {
    console.error("Error processing file:", error);
  }
}
