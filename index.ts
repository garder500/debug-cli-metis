import prompts from "prompts";
import Table from "cli-table3";
import ansiEscapes from "ansi-escapes";
import { collectSabreOffers, handleSabreShopping, OfferInfo } from "./src/commands/sabreShopping";
import { displayOfferDetails } from "./src/commands/sabreOfferDetails";
import {
  DEFAULT_REMOTE_SHOPPING_URL,
  handleRemoteShopping,
  OfferPriceCandidate,
  OfferSummaryRow,
  renderRemoteOffersTable,
  runRemoteShopping,
} from "./src/commands/remoteShopping";
import {
  DEFAULT_REMOTE_OFFER_PRICE_URL,
  runRemoteOfferPrice,
} from "./src/commands/remoteOfferPrice";
import { readJsonFile } from "./src/utils/fileReader";

const DEFAULT_SAMPLE_FILE =
  "SABRE_IMPACT-Parrot_PAX1_NA_AIRSHOPPING_RS_2026-02-02_14-39-27-156.json";
const DEFAULT_AMADEUS_TOKEN_BRIDGE_URL = "http://localhost:3000/aerial/amadeus/token/get";
const DEFAULT_AMADEUS_LOCATIONS_URL = "https://api.amadeus.com/v1/reference-data/locations";

interface DestinationOption {
  id: string;
  subType: string;
  name: string;
  detailedName?: string;
  iataCode: string;
  cityName?: string;
  countryName?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function normalizeBearerToken(tokenInput: string): string {
  const raw = tokenInput.trim();
  const tokenValue = raw.replace(/^Bearer\s*:?\s*/i, "").trim();
  if (!tokenValue) {
    throw new Error("Le token utilisateur (Bearer) est obligatoire.");
  }
  return `Bearer ${tokenValue}`;
}

function formatDestinationLabel(destination: DestinationOption): string {
  const country = destination.countryName ?? "N/A";
  return `${destination.name} (${destination.iataCode}) - ${destination.subType} - ${country}`;
}

function buildFallbackDestinationFromKeyword(keyword: string): DestinationOption | null {
  const normalized = keyword.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    return null;
  }

  return {
    id: `MANUAL-${normalized}`,
    subType: "AIRPORT",
    name: normalized,
    detailedName: `${normalized} (saisie manuelle)`,
    iataCode: normalized,
    cityName: normalized,
    countryName: "N/A",
  };
}

function rankDestination(destination: DestinationOption, keyword: string): number {
  const normalizedKeyword = keyword.trim().toUpperCase();
  const iata = destination.iataCode.toUpperCase();
  const name = destination.name.toUpperCase();
  const city = (destination.cityName ?? "").toUpperCase();

  if (iata === normalizedKeyword) return 0;
  if (iata.startsWith(normalizedKeyword)) return 1;
  if (city.startsWith(normalizedKeyword)) return 2;
  if (name.startsWith(normalizedKeyword)) return 3;
  return 10;
}

async function getAmadeusAccessToken(userBearerToken: string): Promise<string> {
  const response = await fetch(DEFAULT_AMADEUS_TOKEN_BRIDGE_URL, {
    method: "GET",
    headers: {
      authorization: userBearerToken,
    },
  });

  const responseText = await response.text();
  let parsedBody: unknown = responseText;
  try {
    parsedBody = JSON.parse(responseText);
  } catch {
    // Keep raw response text if JSON parsing fails.
  }

  if (!response.ok) {
    const message = isRecord(parsedBody) ? readString(parsedBody.message) : undefined;
    throw new Error(
      `Echec recuperation token Amadeus (${response.status} ${response.statusText})${message ? `: ${message}` : ""}`
    );
  }

  if (!isRecord(parsedBody)) {
    throw new Error("Reponse inattendue pour /aerial/amadeus/token/get");
  }

  const accessToken = readString(parsedBody.value);
  if (!accessToken) {
    throw new Error("Le champ value du token Amadeus est vide.");
  }
  return accessToken;
}

async function searchAmadeusDestinations(
  amadeusAccessToken: string,
  keyword: string
): Promise<DestinationOption[]> {
  const normalizedKeyword = keyword.trim().toUpperCase();
  if (normalizedKeyword.length < 2) {
    return [];
  }

  const queryParams = new URLSearchParams({
    subType: "AIRPORT,CITY",
    keyword: normalizedKeyword,
    "page[limit]": "15",
    "page[offset]": "0",
    sort: "analytics.travelers.score",
    view: "LIGHT",
  });

  const response = await fetch(`${DEFAULT_AMADEUS_LOCATIONS_URL}?${queryParams.toString()}`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${amadeusAccessToken}`,
    },
  });

  const responseText = await response.text();
  let parsedBody: unknown = responseText;
  try {
    parsedBody = JSON.parse(responseText);
  } catch {
    // Keep raw response text if JSON parsing fails.
  }

  if (!response.ok) {
    throw new Error(
      `Recherche destination impossible (${response.status} ${response.statusText})`
    );
  }

  if (!isRecord(parsedBody)) {
    const fallback = buildFallbackDestinationFromKeyword(normalizedKeyword);
    return fallback ? [fallback] : [];
  }
  const rawData = parsedBody.data;
  if (!Array.isArray(rawData)) {
    const fallback = buildFallbackDestinationFromKeyword(normalizedKeyword);
    return fallback ? [fallback] : [];
  }

  const seen = new Set<string>();
  const destinations: DestinationOption[] = [];
  for (const item of rawData) {
    if (!isRecord(item)) continue;

    const id = readString(item.id);
    const subType = readString(item.subType);
    const name = readString(item.name);
    const detailedName = readString(item.detailedName);
    const iataCode = readString(item.iataCode);
    const address = isRecord(item.address) ? item.address : undefined;
    const cityName = readString(address?.cityName);
    const countryName = readString(address?.countryName);

    if (!id || !subType || !name || !iataCode) {
      continue;
    }

    const dedupeKey = `${id}-${subType}-${iataCode}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    destinations.push({
      id,
      subType,
      name,
      detailedName,
      iataCode,
      cityName,
      countryName,
    });
  }

  if (destinations.length === 0) {
    const fallback = buildFallbackDestinationFromKeyword(normalizedKeyword);
    return fallback ? [fallback] : [];
  }

  destinations.sort((a, b) => {
    const rankDelta = rankDestination(a, normalizedKeyword) - rankDestination(b, normalizedKeyword);
    if (rankDelta !== 0) return rankDelta;
    return a.name.localeCompare(b.name);
  });

  return destinations;
}

function applyRouteToPayload(
  payload: unknown,
  route: { departure: DestinationOption; arrival: DestinationOption }
): { payload: unknown; updatedFlights: number } {
  if (!isRecord(payload)) {
    return { payload, updatedFlights: 0 };
  }

  const clonedPayload = structuredClone(payload) as unknown;
  if (!isRecord(clonedPayload)) {
    return { payload, updatedFlights: 0 };
  }

  const flights = Array.isArray(clonedPayload.flights) ? clonedPayload.flights : [];
  let updatedFlights = 0;
  for (const flight of flights) {
    if (!isRecord(flight)) continue;
    flight.locationCodeDep = route.departure.iataCode;
    flight.locationCodeArv = route.arrival.iataCode;
    if (Array.isArray(flight.depCity)) {
      flight.depCity = [route.departure.iataCode];
    }
    if (Array.isArray(flight.arvCity)) {
      flight.arvCity = [route.arrival.iataCode];
    }
    updatedFlights += 1;
  }

  return { payload: clonedPayload, updatedFlights };
}

async function suggestLocationChoices(
  amadeusAccessToken: string,
  destinationCache: Map<string, DestinationOption[]>,
  input: string
): Promise<Array<{ title: string; description: string; value: DestinationOption }>> {
  const normalizedInput = String(input || "").trim().toUpperCase();
  if (normalizedInput.length < 2) {
    return [];
  }

  const cached = destinationCache.get(normalizedInput);
  let destinations = cached;
  if (!destinations) {
    try {
      destinations = await searchAmadeusDestinations(amadeusAccessToken, normalizedInput);
    } catch {
      const fallback = buildFallbackDestinationFromKeyword(normalizedInput);
      destinations = fallback ? [fallback] : [];
    }
    destinationCache.set(normalizedInput, destinations);
  }

  const resolvedDestinations = destinations ?? [];
  return resolvedDestinations.map((destination) => ({
    title: formatDestinationLabel(destination),
    description: destination.detailedName ?? destination.cityName ?? "",
    value: destination,
  }));
}

function buildOfferPriceRequestPayload(
  candidate: OfferPriceCandidate,
  shoppingPayload: unknown
): Record<string, unknown> {
  const shoppingPayloadRecord = isRecord(shoppingPayload) ? shoppingPayload : {};
  const oras = Array.isArray(shoppingPayloadRecord.oras)
    ? structuredClone(shoppingPayloadRecord.oras)
    : [];
  const paxs = Array.isArray(shoppingPayloadRecord.paxs)
    ? structuredClone(shoppingPayloadRecord.paxs)
    : [];
  const agenceInfo = isRecord(shoppingPayloadRecord.agenceInfo)
    ? structuredClone(shoppingPayloadRecord.agenceInfo)
    : {};
  const fallbackAirlineCode = readString(oras[0]) ?? "";

  const payload: Record<string, unknown> = {
    OfferID: candidate.offerId,
    AirlineDesigCode: candidate.airlineDesigCode || fallbackAirlineCode,
    OfferIdList: structuredClone(candidate.offerIdList),
    oras,
    responseId: candidate.responseId ?? "",
    paxs,
    agenceInfo,
    indexOffer: 0,
  };

  if (candidate.totalPrice !== undefined) {
    payload.TotalPrice = structuredClone(candidate.totalPrice);
  }

  return payload;
}

type RemoteOffersPaginationAction =
  | { action: "search" }
  | { action: "exit" }
  | { action: "select"; offer: OfferSummaryRow };

function formatDateTime(value: unknown): string {
  const dateTime = readString(value);
  return dateTime ?? "N/A";
}

function formatMoney(amount: number | null, currency?: string): string {
  if (amount === null) {
    return "N/A";
  }
  const normalizedCurrency = (currency ?? "").trim();
  return normalizedCurrency ? `${amount.toFixed(2)} ${normalizedCurrency}` : `${amount.toFixed(2)}`;
}

function displayOfferPriceInfo(response: unknown) {
  if (!isRecord(response)) {
    console.log("Reponse offerPrice non exploitable.");
    return;
  }

  const value = isRecord(response.value) ? response.value : {};
  const offerId = readString(value.OfferID) ?? "N/A";
  const responseId = readString(value.ResponseID) ?? "N/A";
  const offerExpirationDateTime = formatDateTime(value.OfferExpirationDateTime);
  const paymentTimeLimitDateTime = formatDateTime(value.PaymentTimeLimitDateTime);

  const orderItems = Array.isArray(value.OrderItems) ? value.OrderItems : [];
  const firstOrderItem = isRecord(orderItems[0]) ? orderItems[0] : {};
  const priceNode = isRecord(firstOrderItem.Price) ? firstOrderItem.Price : {};
  const totalAmount = readNumber(priceNode.TotalAmount);
  const totalTaxAmount = readNumber(priceNode.TotalTaxAmount);
  const taxRows = Array.isArray(priceNode.Taxes) ? priceNode.Taxes : [];
  const firstTax = isRecord(taxRows[0]) ? taxRows[0] : {};
  const firstTaxAmount = isRecord(firstTax.Amount) ? firstTax.Amount : {};
  const currency = readString(firstTaxAmount.currency);

  console.log("");
  console.log("===== Offer Price =====");
  console.log(`OfferID: ${offerId}`);
  console.log(`ResponseID: ${responseId}`);
  console.log(`Expiration: ${offerExpirationDateTime}`);
  console.log(`Time limit paiement: ${paymentTimeLimitDateTime}`);
  console.log(`Prix total: ${formatMoney(totalAmount, currency)}`);
  console.log(`Taxes total: ${formatMoney(totalTaxAmount, currency)}`);

  const dataLists = isRecord(value.DataLists) ? value.DataLists : {};
  const paxSegments = Array.isArray(dataLists.PaxSegmentList) ? dataLists.PaxSegmentList : [];
  if (paxSegments.length > 0) {
    const segmentsTable = new Table({
      head: ["#", "Vol", "Dep", "Arr", "Cabin"],
      wordWrap: true,
    });

    paxSegments.forEach((segment, index) => {
      const row = isRecord(segment) ? segment : {};
      const marketing = isRecord(row.MarketingCarrierInfo) ? row.MarketingCarrierInfo : {};
      const dep = isRecord(row.Dep) ? row.Dep : {};
      const arrival = isRecord(row.Arrival) ? row.Arrival : {};
      const cabin = isRecord(row.CabinType) ? row.CabinType : {};
      const carrier = readString(marketing.CarrierDesigCode) ?? "";
      const flightNumber = readString(marketing.MarketingCarrierFlightNumberText) ?? "";
      const flightLabel = `${carrier}${flightNumber}`.trim() || "N/A";
      const depCode = readString(dep.IATALocationCode) ?? "?";
      const depDateTime = formatDateTime(dep.AircraftScheduledDateTime);
      const arrCode = readString(arrival.IATALocationCode) ?? "?";
      const arrDateTime = formatDateTime(arrival.AircraftScheduledDateTime);
      const cabinLabel = readString(cabin.CabinTypeName) ?? "N/A";

      segmentsTable.push([
        index + 1,
        flightLabel,
        `${depCode} ${depDateTime}`,
        `${arrCode} ${arrDateTime}`,
        cabinLabel,
      ]);
    });

    console.log("");
    console.log("Segments:");
    console.log(segmentsTable.toString());
  }

  const baggageList = Array.isArray(value.baggage) ? value.baggage : [];
  if (baggageList.length > 0) {
    const baggageTable = new Table({
      head: ["Type", "Qt", "Details"],
      wordWrap: true,
    });

    baggageList.forEach((baggage) => {
      const bag = isRecord(baggage) ? baggage : {};
      const pieceAllowance = isRecord(bag.PieceAllowance) ? bag.PieceAllowance : {};
      const qty = readNumber(pieceAllowance.TotalQty);
      baggageTable.push([
        readString(bag.TypeCode) ?? "N/A",
        qty === null ? "N/A" : String(qty),
        readString(bag.descriptif) ?? "",
      ]);
    });

    console.log("");
    console.log("Bagages:");
    console.log(baggageTable.toString());
  }

  const paymentInfo = Array.isArray(value.PaymentInfo) ? value.PaymentInfo : [];
  if (paymentInfo.length > 0) {
    const paymentLabels = paymentInfo
      .map((entry) => (isRecord(entry) ? readString(entry.Payment) : undefined))
      .filter((entry): entry is string => Boolean(entry));
    const displayed = paymentLabels.slice(0, 5);
    const suffix = paymentLabels.length > 5 ? ` (+${paymentLabels.length - 5})` : "";
    console.log("");
    console.log(`Paiements: ${displayed.join(", ")}${suffix}`);
  }

  const fareRows = Array.isArray(firstOrderItem.Fare) ? firstOrderItem.Fare : [];
  const penalties: Array<{ typeCode: string; appCode: string; detail: string }> = [];
  const seenPenalty = new Set<string>();
  for (const fare of fareRows) {
    if (!isRecord(fare)) continue;
    const fareRule = isRecord(fare.FareRule) ? fare.FareRule : {};
    const penaltyRows = Array.isArray(fareRule.Penalty) ? fareRule.Penalty : [];
    for (const penalty of penaltyRows) {
      if (!isRecord(penalty)) continue;
      const typeCode = readString(penalty.TypeCode) ?? "N/A";
      const appCode = readString(penalty.AppCode) ?? "N/A";
      const penaltyAmount = readNumber(penalty.PenaltyAmount);
      const detail = penaltyAmount !== null ? formatMoney(penaltyAmount, currency) : (readString(penalty.DescText) ?? "NAV");
      const dedupeKey = `${typeCode}-${appCode}-${detail}`;
      if (seenPenalty.has(dedupeKey)) {
        continue;
      }
      seenPenalty.add(dedupeKey);
      penalties.push({ typeCode, appCode, detail });
    }
  }

  if (penalties.length > 0) {
    const penaltyTable = new Table({
      head: ["Type", "App", "Details"],
      wordWrap: true,
    });
    penalties.forEach((penalty) => {
      penaltyTable.push([penalty.typeCode, penalty.appCode, penalty.detail]);
    });
    console.log("");
    console.log("Penalites:");
    console.log(penaltyTable.toString());
  }
}

function getReturnOffers(
  offers: OfferSummaryRow[],
  selectedOffer: OfferSummaryRow
): OfferSummaryRow[] {
  return offers.filter(
    (offer) =>
      offer.offerId !== selectedOffer.offerId &&
      offer.outbound === selectedOffer.outbound
  );
}

async function pickReturnOffer(
  offers: OfferSummaryRow[],
  selectedOffer: OfferSummaryRow
): Promise<OfferSummaryRow | null> {
  const returnOffers = getReturnOffers(offers, selectedOffer);
  if (returnOffers.length === 0) {
    console.log("Aucune offre retour disponible pour cet aller.");
    return null;
  }

  console.log("");
  console.log(`Offres retour disponibles pour l'aller: ${selectedOffer.outbound}`);
  console.log(renderRemoteOffersTable(returnOffers));

  const pick = await prompts(
    {
      type: "text",
      name: "value",
      message: "Numero d'offre retour (#)",
    },
    {
      onCancel: () => false,
    }
  );

  const index = Number.parseInt(String(pick.value || ""), 10);
  if (Number.isNaN(index) || index < 1 || index > returnOffers.length) {
    console.log("Numero invalide.");
    return null;
  }

  return returnOffers[index - 1];
}

async function main() {
  const args = Bun.argv.slice(2);

  if (args.length === 0) {
    await runInteractive();
    return;
  }
  if (args[0] === "interactive") {
    if (args[1] === "remote") {
      await runRemoteInteractive();
    } else {
      await runInteractive();
    }
    return;
  }

  const [command, subcommand, ...rest] = args;

  switch (command) {
    case "sabre":
      switch (subcommand) {
        case "shopping":
          const fileIndex = rest.indexOf("--file");
          if (fileIndex === -1 || fileIndex + 1 >= rest.length) {
            console.error("Error: --file argument missing or incomplete");
            return;
          }
          const filename = rest[fileIndex + 1];

          const flightIndex = rest.indexOf("--flight");
          let flightFilter: string | undefined;
          if (flightIndex !== -1 && flightIndex + 1 < rest.length) {
            flightFilter = rest[flightIndex + 1];
          }

          const brandIndex = rest.indexOf("--brand");
          let brandFilter: string | undefined;
          if (brandIndex !== -1 && brandIndex + 1 < rest.length) {
            brandFilter = rest[brandIndex + 1];
          }

          const offerIndex = rest.indexOf("--offer");
          let offerId: string | undefined;
          if (offerIndex !== -1 && offerIndex + 1 < rest.length) {
            offerId = rest[offerIndex + 1];
          }

          const sortIndex = rest.indexOf("--sort");
          let sortBy: string | undefined;
          if (sortIndex !== -1 && sortIndex + 1 < rest.length) {
            sortBy = rest[sortIndex + 1];
          }

          await handleSabreShopping(filename, { flightFilter, brandFilter, offerId, sortBy });
          break;
        default:
          printUsage();
          break;
      }
      break;
    case "remote":
      switch (subcommand) {
        case "shopping": {
          const payloadFile = getOptionValue(rest, "--payload");
          if (!payloadFile) {
            console.error("Error: --payload argument missing or incomplete");
            return;
          }

          const url = getOptionValue(rest, "--url");
          const maxRaw = getOptionValue(rest, "--max");
          const parsedMaxRows = maxRaw ? Number.parseInt(maxRaw, 10) : null;

          if (maxRaw && (parsedMaxRows === null || !Number.isFinite(parsedMaxRows) || parsedMaxRows <= 0)) {
            console.error("Error: --max must be a positive integer");
            return;
          }

          await handleRemoteShopping({
            payloadFile,
            url,
            maxRows: parsedMaxRows ?? undefined,
          });
          break;
        }
        case "interactive":
          await runRemoteInteractive();
          break;
        default:
          printUsage();
          break;
      }
      break;
    default:
      printUsage();
      break;
  }
}

function getOptionValue(args: string[], option: string): string | undefined {
  const optionIndex = args.indexOf(option);
  if (optionIndex === -1 || optionIndex + 1 >= args.length) {
    return undefined;
  }
  return args[optionIndex + 1];
}

async function paginateRemoteOffers(
  offers: OfferSummaryRow[]
): Promise<RemoteOffersPaginationAction> {
  const pageSize = 25;
  let page = 0;

  while (true) {
    const totalPages = Math.max(1, Math.ceil(offers.length / pageSize));
    if (page < 0) page = 0;
    if (page >= totalPages) page = totalPages - 1;

    const start = page * pageSize;
    const end = Math.min(start + pageSize, offers.length);
    const pageSlice = offers.slice(start, end);

    clearScreen();
    console.log(`Results ${start + 1}-${end} / ${offers.length} (page ${page + 1}/${totalPages})`);
    console.log(renderRemoteOffersTable(pageSlice, start));

    const action = await prompts(
      {
        type: "select",
        name: "action",
        message: "Actions",
        choices: [
          { title: "Page suivante", value: "next", disabled: page >= totalPages - 1 },
          { title: "Page precedente", value: "prev", disabled: page <= 0 },
          { title: "Choisir une offre (#)", value: "selectOffer" },
          { title: "Nouvelle recherche", value: "search" },
          { title: "Quitter", value: "exit" },
        ],
        initial: 0,
      },
      {
        onCancel: () => false,
      }
    );

    if (action.action === "next") {
      page += 1;
      continue;
    }
    if (action.action === "prev") {
      page -= 1;
      continue;
    }
    if (action.action === "selectOffer") {
      const pick = await prompts(
        {
          type: "text",
          name: "value",
          message: "Numero d'offre (#)",
        },
        {
          onCancel: () => false,
        }
      );

      const index = Number.parseInt(String(pick.value || ""), 10);
      if (!Number.isNaN(index) && index >= 1 && index <= offers.length) {
        return { action: "select", offer: offers[index - 1] };
      }
      console.log("Numero invalide.");
      continue;
    }
    if (action.action === "search") {
      return { action: "search" };
    }
    if (action.action === "exit") {
      return { action: "exit" };
    }
  }
}

function renderOffersTable(offers: OfferInfo[], offset: number) {
  const table = new Table({
    head: ["#", "Offer ID", "Départs", "Route", "Prix", "Cie", "Brand"],
    wordWrap: true,
  });

  offers.forEach((offer, index) => {
    const route = offer.directions.map((dir) => dir.label).join(" | ");
    const departures = offer.departureTimesByDirection.join(" | ");
    table.push([
      offset + index + 1,
      offer.offerId,
      departures,
      route,
      offer.price,
      offer.company,
      offer.brand || "N/A",
    ]);
  });

  return table.toString();
}

function clearScreen() {
  if (process.stdout.isTTY) {
    process.stdout.write(ansiEscapes.clearScreen);
  }
}

async function paginateOffers(
  offers: OfferInfo[],
  groupedItineraryResponse: { itineraryGroups?: unknown[] },
  maps: Parameters<typeof displayOfferDetails>[2]
): Promise<"search" | "exit"> {
  const pageSize = 25;
  let page = 0;

  while (true) {
    const totalPages = Math.max(1, Math.ceil(offers.length / pageSize));
    if (page < 0) page = 0;
    if (page >= totalPages) page = totalPages - 1;

    const start = page * pageSize;
    const end = Math.min(start + pageSize, offers.length);
    const pageSlice = offers.slice(start, end);

    clearScreen();
    console.log(`Résultats ${start + 1}-${end} / ${offers.length} (page ${page + 1}/${totalPages})`);
    console.log(renderOffersTable(pageSlice, start));

    const action = await prompts(
      {
        type: "select",
        name: "action",
        message: "Actions",
        choices: [
          { title: "Page suivante", value: "next", disabled: page >= totalPages - 1 },
          { title: "Page précédente", value: "prev", disabled: page <= 0 },
          { title: "Voir détail par numéro (#)", value: "detailNumber" },
          { title: "Voir détail par ID", value: "detailId" },
          { title: "Nouvelle recherche", value: "search" },
          { title: "Quitter", value: "exit" },
        ],
        initial: 0,
      },
      {
        onCancel: () => false,
      }
    );

    if (action.action === "next") {
      page += 1;
      continue;
    }
    if (action.action === "prev") {
      page -= 1;
      continue;
    }
    if (action.action === "detailNumber") {
      const pick = await prompts(
        {
          type: "text",
          name: "value",
          message: "Numéro d'offre (#)",
        },
        {
          onCancel: () => false,
        }
      );

      const index = Number.parseInt(String(pick.value || ""), 10);
      if (!Number.isNaN(index) && index >= 1 && index <= offers.length) {
        const offer = offers[index - 1];
        displayOfferDetails(
          offer.offerId,
          groupedItineraryResponse.itineraryGroups,
          maps
        );
        await prompts({
          type: "text",
          name: "continue",
          message: "Appuie sur Entrée pour revenir à la liste",
        });
      } else {
        console.log("Numéro invalide.");
      }
      continue;
    }
    if (action.action === "detailId") {
      const pick = await prompts(
        {
          type: "text",
          name: "value",
          message: "ID d'offre",
        },
        {
          onCancel: () => false,
        }
      );
      if (pick.value) {
        displayOfferDetails(
          pick.value,
          groupedItineraryResponse.itineraryGroups,
          maps
        );
        await prompts({
          type: "text",
          name: "continue",
          message: "Appuie sur Entrée pour revenir à la liste",
        });
      }
      continue;
    }
    if (action.action === "search") {
      return "search";
    }
    if (action.action === "exit") {
      return "exit";
    }
  }
}

async function runInteractive() {
  console.log("Metis - Sabre Shopping (mode interactif)");

  let continueSearch = true;
  let lastFile = DEFAULT_SAMPLE_FILE;
  let lastFlight = "";
  let lastBrand = "";
  let lastSort: "departureTime" | "" = "";

  while (continueSearch) {
    const answers = await prompts(
      [
        {
          type: "text",
          name: "file",
          message: "Chemin du fichier JSON Sabre",
          initial: lastFile,
        },
        {
          type: "text",
          name: "flight",
          message: "Filtre numéro de vol (ex: AF123) - optionnel",
          initial: lastFlight,
        },
        {
          type: "text",
          name: "brand",
          message: "Filtre brand - optionnel",
          initial: lastBrand,
        },
        {
          type: "select",
          name: "sort",
          message: "Tri des résultats",
          choices: [
            { title: "Aucun", value: "" },
            { title: "Heure de départ", value: "departureTime" },
          ],
          initial: lastSort === "departureTime" ? 1 : 0,
        },
      ],
      {
        onCancel: () => {
          continueSearch = false;
          return false;
        },
      }
    );

    if (!continueSearch || !answers.file) {
      break;
    }

    lastFile = answers.file;
    lastFlight = answers.flight || "";
    lastBrand = answers.brand || "";
    lastSort = answers.sort || "";

    try {
      const { offers, maps, groupedItineraryResponse } = await collectSabreOffers(answers.file, {
        flightFilter: answers.flight || undefined,
        brandFilter: answers.brand || undefined,
        sortBy: answers.sort || undefined,
      });

      if (offers.length === 0) {
        console.log("Aucune offre trouvée avec ces filtres.");
        const nextAction = await prompts(
          {
            type: "select",
            name: "action",
            message: "Que souhaitez-vous faire ?",
            choices: [
              { title: "Nouvelle recherche", value: "search" },
              { title: "Quitter", value: "exit" },
            ],
            initial: 0,
          },
          {
            onCancel: () => {
              continueSearch = false;
              return false;
            },
          }
        );

        if (nextAction.action === "exit") {
          continueSearch = false;
        }
      } else {
        const paginationAction = await paginateOffers(
          offers,
          groupedItineraryResponse,
          maps
        );

        if (paginationAction === "exit") {
          continueSearch = false;
        }
      }
    } catch (error) {
      console.error("Erreur:", error);
      continueSearch = false;
    }
  }
}

async function runRemoteInteractive() {
  console.log("Metis - Remote Shopping (mode interactif)");

  let continueSearch = true;
  let lastPayload = "examples/remote-shopping-payload.sample.json";
  let lastUrl = DEFAULT_REMOTE_SHOPPING_URL;
  let lastMax = "25";
  let lastTokenInput = "Bearer ";

  while (continueSearch) {
    const answers = await prompts(
      [
        {
          type: "text",
          name: "payload",
          message: "Chemin du payload JSON",
          initial: lastPayload,
        },
        {
          type: "text",
          name: "url",
          message: "URL airShoppingRQ",
          initial: lastUrl,
        },
        {
          type: "text",
          name: "max",
          message: "Nombre max d'offres a afficher",
          initial: lastMax,
        },
        {
          type: "text",
          name: "token",
          message: "Token utilisateur (Bearer ...)",
          initial: lastTokenInput,
        },
      ],
      {
        onCancel: () => {
          continueSearch = false;
          return false;
        },
      }
    );

    if (!continueSearch || !answers.payload) {
      break;
    }

    const payloadFile = String(answers.payload);
    const requestUrl = String(answers.url || DEFAULT_REMOTE_SHOPPING_URL);
    const parsedMax = Number.parseInt(String(answers.max || "25"), 10);
    if (!Number.isFinite(parsedMax) || parsedMax <= 0) {
      console.error("Valeur invalide pour le max. Entrez un entier positif.");
      continue;
    }

    let bearerToken: string;
    try {
      bearerToken = normalizeBearerToken(String(answers.token || ""));
    } catch (error) {
      console.error("Erreur:", error);
      continue;
    }

    lastPayload = payloadFile;
    lastUrl = requestUrl;
    lastMax = String(parsedMax);
    lastTokenInput = bearerToken;

    let amadeusAccessToken: string;
    try {
      console.log("Recuperation du token Amadeus...");
      amadeusAccessToken = await getAmadeusAccessToken(bearerToken);
    } catch (error) {
      console.error("Erreur:", error);
      continue;
    }

    const destinationCache = new Map<string, DestinationOption[]>();
    const departureAnswer = await prompts(
      {
        type: "autocomplete",
        name: "departure",
        message: "Depart (recherche temps reel, min 2 caracteres)",
        limit: 10,
        choices: [],
        suggest: (input: string) =>
          suggestLocationChoices(amadeusAccessToken, destinationCache, input),
      },
      {
        onCancel: () => {
          continueSearch = false;
          return false;
        },
      }
    );

    if (!continueSearch) {
      break;
    }

    const selectedDeparture = departureAnswer.departure as DestinationOption | undefined;
    if (!selectedDeparture) {
      console.error("Aucun depart selectionne.");
      continue;
    }

    const arrivalAnswer = await prompts(
      {
        type: "autocomplete",
        name: "arrival",
        message: "Arrivee (recherche temps reel, min 2 caracteres)",
        limit: 10,
        choices: [],
        suggest: (input: string) =>
          suggestLocationChoices(amadeusAccessToken, destinationCache, input),
      },
      {
        onCancel: () => {
          continueSearch = false;
          return false;
        },
      }
    );

    if (!continueSearch) {
      break;
    }

    const selectedArrival = arrivalAnswer.arrival as DestinationOption | undefined;
    if (!selectedArrival) {
      console.error("Aucune arrivee selectionnee.");
      continue;
    }

    try {
      const payload = await readJsonFile<unknown>(payloadFile);
      const payloadUpdate = applyRouteToPayload(payload, {
        departure: selectedDeparture,
        arrival: selectedArrival,
      });
      if (payloadUpdate.updatedFlights === 0) {
        console.warn("Aucun segment flights[] n'a ete mis a jour dans le payload.");
      }

      console.log(`Depart selectionne: ${formatDestinationLabel(selectedDeparture)}`);
      console.log(`Arrivee selectionnee: ${formatDestinationLabel(selectedArrival)}`);

      const result = await runRemoteShopping({
        payloadFile,
        url: requestUrl || undefined,
        payloadOverride: payloadUpdate.payload,
        requestHeaders: {
          authorization: bearerToken,
        },
      });

      console.log(`Response message: ${result.message}`);
      console.log(`Offers found: ${result.rows.length}`);
      console.log(`Output written to: ${result.outputDir}`);

      if (result.rows.length === 0) {
        const nextAction = await prompts(
          {
            type: "select",
            name: "action",
            message: "Aucune offre trouvee. Que souhaitez-vous faire ?",
            choices: [
              { title: "Nouvelle recherche", value: "search" },
              { title: "Quitter", value: "exit" },
            ],
            initial: 0,
          },
          {
            onCancel: () => {
              continueSearch = false;
              return false;
            },
          }
        );

        if (nextAction.action === "exit") {
          continueSearch = false;
        }
        continue;
      }

      const remoteOffers = result.rows.slice(0, parsedMax);
      if (result.rows.length > parsedMax) {
        console.log(`Showing first ${parsedMax} offers sorted by ascending price.`);
      }

      let chooseAnotherOffer = true;
      while (chooseAnotherOffer && continueSearch) {
        const paginationAction = await paginateRemoteOffers(remoteOffers);
        if (paginationAction.action === "exit") {
          continueSearch = false;
          break;
        }
        if (paginationAction.action === "search") {
          chooseAnotherOffer = false;
          break;
        }

        let currentOffer: OfferSummaryRow | null = paginationAction.offer;
        while (currentOffer && continueSearch) {
          const offerPriceCandidate = result.offerPriceCandidates[currentOffer.offerId];
          if (!offerPriceCandidate) {
            console.error(`Offre ${currentOffer.offerId} introuvable pour offerPriceRQ.`);
            break;
          }
          if (offerPriceCandidate.offerIdList.length === 0) {
            console.error(
              `Offre ${currentOffer.offerId} invalide pour offerPriceRQ (OfferIdList vide).`
            );
            break;
          }

          const offerPricePayload = buildOfferPriceRequestPayload(
            offerPriceCandidate,
            payloadUpdate.payload
          );

          try {
            const offerPriceResult = await runRemoteOfferPrice({
              payload: offerPricePayload,
              url: DEFAULT_REMOTE_OFFER_PRICE_URL,
              requestHeaders: {
                authorization: bearerToken,
              },
            });

            console.log(`OfferPrice response message: ${offerPriceResult.message}`);
            console.log(`OfferPrice output written to: ${offerPriceResult.outputDir}`);
            displayOfferPriceInfo(offerPriceResult.response);
          } catch (error) {
            console.error("Erreur offerPriceRQ:", error);
          }

          const nextAction = await prompts(
            {
              type: "select",
              name: "action",
              message: "Que souhaitez-vous faire ?",
              choices: [
                { title: "Choisir offre retour", value: "return" },
                { title: "Choisir une autre offre", value: "select" },
                { title: "Nouvelle recherche", value: "search" },
                { title: "Quitter", value: "exit" },
              ],
              initial: 0,
            },
            {
              onCancel: () => {
                continueSearch = false;
                return false;
              },
            }
          );

          if (nextAction.action === "return") {
            const pickedReturnOffer = await pickReturnOffer(remoteOffers, currentOffer);
            if (pickedReturnOffer) {
              currentOffer = pickedReturnOffer;
              continue;
            }
            continue;
          }

          if (nextAction.action === "select") {
            currentOffer = null;
            continue;
          }

          if (nextAction.action === "search") {
            chooseAnotherOffer = false;
            currentOffer = null;
          }
          if (nextAction.action === "exit") {
            continueSearch = false;
            chooseAnotherOffer = false;
            currentOffer = null;
          }
        }
      }
    } catch (error) {
      console.error("Erreur:", error);
    }
  }
}

function printUsage() {
  console.error("Usage: metis-db <command> <subcommand> [options]");
  console.error("Commands:");
  console.error("  sabre shopping --file <filename> [--flight <code] [--brand <name>] [--offer <id>] [--sort <field>]");
  console.error("  remote shopping --payload <filename> [--url <http-url>] [--max <count>]");
  console.error("  remote interactive");
  console.error("  interactive");
  console.error("  interactive remote");
  console.error("    --flight: Filter by flight number (e.g. AF123)");
  console.error("    --brand:  Filter by brand name (e.g. Standard)");
  console.error("    --offer:  Show detailed tariff conditions for a specific Offer ID");
  console.error("    --sort:   Sort results. Currently only 'departureTime' is supported.");
  console.error("    --payload: JSON payload file to post to /aerial/global/airShoppingRQ");
  console.error("    --url:     Remote shopping endpoint (default: http://localhost:3000/aerial/global/airShoppingRQ)");
  console.error("    --max:     Maximum offers displayed in table output (default: 25)");
}

main();
