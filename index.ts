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
import {
  DEFAULT_REMOTE_ORDER_CREATE_BASE_URL,
  runRemoteOrderCreate,
} from "./src/commands/remoteOrderCreate";
import { runRemoteDossierOpti } from "./src/commands/remoteDossierOpti";
import { runRemoteProfilSearch } from "./src/commands/remoteProfilSearch";
import { readJsonFile } from "./src/utils/fileReader";
import { encrypteDossierId } from "./src/utils/folderUtils";
import { DEFAULT_AERIAL_BASE_URL, getDashboardBaseUrl } from "./src/utils/baseUrl";

const DEFAULT_SAMPLE_FILE =
  "SABRE_IMPACT-Parrot_PAX1_NA_AIRSHOPPING_RS_2026-02-02_14-39-27-156.json";
const DEFAULT_AMADEUS_TOKEN_BRIDGE_URL = `${DEFAULT_AERIAL_BASE_URL}/amadeus/token/get`;
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

function applyOraToPayload(payload: unknown, ora: string): { payload: unknown; updatedOras: number } {
  if (!isRecord(payload)) {
    return { payload, updatedOras: 0 };
  }

  const clonedPayload = structuredClone(payload) as unknown;
  if (!isRecord(clonedPayload)) {
    return { payload, updatedOras: 0 };
  }

  const normalizedOra = ora.trim().toUpperCase();
  if (!normalizedOra) {
    return { payload: clonedPayload, updatedOras: 0 };
  }

  clonedPayload.oras = [normalizedOra];
  if (Array.isArray(clonedPayload.selectedAirline)) {
    clonedPayload.selectedAirline = [normalizedOra];
  }

  return { payload: clonedPayload, updatedOras: 1 };
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function randomInt(min: number, max: number): number {
  const minValue = Math.ceil(min);
  const maxValue = Math.floor(max);
  return Math.floor(Math.random() * (maxValue - minValue + 1)) + minValue;
}

function getRandomTripDates(): { outbound: string; inbound: string } {
  const today = new Date();
  const outboundOffset = randomInt(7, 120);
  const inboundOffset = outboundOffset + randomInt(3, 14);
  const outbound = formatDateOnly(addDays(today, outboundOffset));
  const inbound = formatDateOnly(addDays(today, inboundOffset));
  return { outbound, inbound };
}

function getDefaultFlightDates(payload: unknown): { outbound?: string; inbound?: string } {
  if (!isRecord(payload)) {
    return {};
  }

  const flights = Array.isArray(payload.flights) ? payload.flights : [];
  const firstFlight = isRecord(flights[0]) ? flights[0] : undefined;
  const dates = Array.isArray(firstFlight?.dates) ? firstFlight?.dates : [];
  const outbound = readString(dates[0]);
  const inbound = readString(dates[1]);
  return { outbound, inbound };
}

function applyDatesToPayload(
  payload: unknown,
  dates: { outbound?: string; inbound?: string }
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
    const flightDates = Array.isArray(flight.dates) ? flight.dates : [];
    if (dates.outbound) {
      flightDates[0] = dates.outbound;
    }
    if (dates.inbound) {
      flightDates[1] = dates.inbound;
    }
    flight.dates = flightDates;
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
  const originalOras = Array.isArray(shoppingPayloadRecord.oras)
    ? structuredClone(shoppingPayloadRecord.oras)
    : [];
  const paxs = Array.isArray(shoppingPayloadRecord.paxs)
    ? structuredClone(shoppingPayloadRecord.paxs)
    : [];
  const agenceInfo = isRecord(shoppingPayloadRecord.agenceInfo)
    ? structuredClone(shoppingPayloadRecord.agenceInfo)
    : {};
  const fallbackAirlineCode = readString(originalOras[0]) ?? "";
  const resolvedAirlineDesigCode = candidate.airlineDesigCode || fallbackAirlineCode;
  const oras = resolvedAirlineDesigCode ? [resolvedAirlineDesigCode] : [];

  const payload: Record<string, unknown> = {
    OfferID: candidate.offerId,
    AirlineDesigCode: resolvedAirlineDesigCode,
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

function normalizeOrderCreatePax(
  pax: unknown,
  ora: string,
  index: number,
  profile?: Record<string, unknown>
): unknown {
  if (!isRecord(pax)) {
    return pax;
  }

  const clonedPax = structuredClone(pax) as Record<string, unknown>;
  const paxId = readFirstString(clonedPax.paxId, clonedPax.id, clonedPax.PaxID) ?? "";
  if (paxId) {
    clonedPax.paxId = paxId;
    clonedPax.idDataPax = clonedPax.idDataPax ?? paxId;
    clonedPax.id = clonedPax.id ?? paxId;
  }

  clonedPax.fidelityCard = Array.isArray(clonedPax.fidelityCard)
    ? clonedPax.fidelityCard
    : [];
  clonedPax.cartesFidelities = Array.isArray(clonedPax.cartesFidelities)
    ? clonedPax.cartesFidelities
    : [];
  clonedPax.cartesSubscriptions = Array.isArray(clonedPax.cartesSubscriptions)
    ? clonedPax.cartesSubscriptions
    : [];
  clonedPax.remarques = Array.isArray(clonedPax.remarques)
    ? clonedPax.remarques
    : [];

  if (!clonedPax._other) {
    clonedPax._other = {
      PaxID: paxId || undefined,
      PTC: readFirstString(clonedPax.ptc, clonedPax.PTC),
      __index: typeof clonedPax.__index === "number" ? clonedPax.__index : index,
      LoyaltyProgramAccount: [],
      PaxIDList: paxId
        ? [
          {
            ora,
            PaxID: paxId,
          },
        ]
        : [],
      isInf: false,
    };
  }

  if (profile) {
    const physical = asRecord(profile.physical) ?? {};
    const legal = asRecord(profile.legal) ?? {};
    const emails = asArray(profile.email);
    const phones = asArray(profile.phone);
    const documents = asArray(profile.document);
    const firstEmail = asRecord(emails[0]);
    const firstPhone = asRecord(phones[0]);
    const firstDoc = asRecord(documents[0]);

    clonedPax.profileId = profile.id ?? clonedPax.profileId;
    clonedPax.individualInfo = {
      titleName: readFirstString(physical.civility, clonedPax.individualInfo?.titleName),
      surname: readFirstString(physical.last_name, clonedPax.individualInfo?.surname),
      givenName: readFirstString(physical.first_name, clonedPax.individualInfo?.givenName),
      birthdate: readFirstString(physical.birthday, clonedPax.individualInfo?.birthdate),
      entreprise: readFirstString(physical.entreprise, legal.name, clonedPax.individualInfo?.entreprise),
    };

    if (documents.length > 0) {
      clonedPax.docsList = structuredClone(documents);
    }

    if (firstDoc) {
      clonedPax.docs = {
        id: firstDoc.id,
        type: readString(firstDoc.type) ?? null,
        document_number: readString(firstDoc.document_number) ?? null,
        expire_date: readString(firstDoc.expire_date) ?? null,
        country: readString(firstDoc.country) ?? null,
        date_emission: readString(firstDoc.date_emission) ?? null,
        nationalities: readString(firstDoc.nationalities) ?? null,
        residenceCountryCode: readString(firstDoc.residenceCountryCode) ?? "",
      };
    }

    clonedPax.contactInfo = {
      emailAddress: readFirstString(firstEmail?.email) ?? "",
      phoneNumber: readFirstString(firstPhone?.number) ?? "",
    };

    if (profile.accessibility) {
      clonedPax.accessibility = structuredClone(profile.accessibility);
    }

    clonedPax.profilInfo = {
      facturation: profile.facturation ?? null,
      remarque: profile.remarque ?? null,
      mod_before_sale: profile.mod_before_sale ?? false,
      sent_facturation: profile.sent_facturation ?? false,
      sent_suppliers: profile.sent_suppliers ?? false,
      see_checkout: profile.see_checkout ?? false,
      cost_center: profile.cost_center ?? null,
      department: profile.department ?? null,
      project_number: profile.project_number ?? null,
      job_title: profile.job_title ?? null,
      id_legal: profile.id_legal ?? null,
      id_agence: profile.id_agence ?? null,
      GuidTripstack: profile.GuidTripstack ?? null,
      language: profile.language ?? null,
    };

    if (Array.isArray(profile.remarques)) {
      clonedPax.remarques = structuredClone(profile.remarques);
    }
  }

  if (Array.isArray(clonedPax.remarques)) {
    const hasCanal = clonedPax.remarques.some(
      (entry) => isRecord(entry) && readString(entry.type) === "CANAL"
    );
    if (!hasCanal) {
      clonedPax.remarques.unshift({ type: "CANAL", remarque: "OFFLINE", service: "ALL" });
    }
  }

  const contactInfo = asRecord(clonedPax.contactInfo);
  if (contactInfo) {
    const emailAddressValue = contactInfo.emailAddress;
    if (Array.isArray(emailAddressValue)) {
      const firstEmail = asRecord(emailAddressValue[0]);
      const email = readFirstString(firstEmail?.email, firstEmail?.Email);
      if (email) {
        contactInfo.emailAddress = email;
      }
    }

    const phoneNumberValue = contactInfo.phoneNumber;
    if (Array.isArray(phoneNumberValue)) {
      const firstPhone = asRecord(phoneNumberValue[0]);
      const phone = readFirstString(firstPhone?.number, firstPhone?.Number);
      if (phone) {
        contactInfo.phoneNumber = phone;
      }
    }

    clonedPax.contactInfo = contactInfo;
  } else {
    clonedPax.contactInfo = clonedPax.contactInfo ?? { emailAddress: "", phoneNumber: "" };
  }

  const docs = asRecord(clonedPax.docs);
  if (!docs) {
    const docsList = asArray(clonedPax.docsList);
    const firstDoc = asRecord(docsList[0]);
    if (firstDoc) {
      clonedPax.docs = {
        id: firstDoc.id,
        type: readString(firstDoc.type) ?? null,
        document_number: readString(firstDoc.document_number) ?? null,
        expire_date: readString(firstDoc.expire_date) ?? null,
        country: readString(firstDoc.country) ?? null,
        date_emission: readString(firstDoc.date_emission) ?? null,
        nationalities: readString(firstDoc.nationalities) ?? null,
        residenceCountryCode: readString(firstDoc.residenceCountryCode) ?? "",
      };
    } else if (docs) {
      clonedPax.docs = docs;
    }
  }

  return clonedPax;
}

function buildOrderCreateConditions(orderItems: unknown[]): Record<string, unknown> {
  const conditions: Record<string, unknown> = {};

  const fares = orderItems.flatMap((orderItem) => {
    const item = asRecord(orderItem) ?? {};
    return [...asArray(item.Fare), ...asArray(item.fare)];
  });

  for (const fare of fares) {
    const fareRecord = asRecord(fare);
    if (!fareRecord) {
      continue;
    }

    const fareRule = asRecord(fareRecord.FareRule) ?? asRecord(fareRecord.fareRule) ?? {};
    const penalties = [...asArray(fareRule.Penalty), ...asArray(fareRule.penalties)];

    for (const penalty of penalties) {
      const penaltyRecord = asRecord(penalty);
      if (!penaltyRecord) {
        continue;
      }

      const typeCode = readFirstString(penaltyRecord.TypeCode, penaltyRecord.typeCode);
      const appCode = readFirstString(penaltyRecord.AppCode, penaltyRecord.appCode);
      if (!typeCode || !appCode) {
        continue;
      }

      const penaltyAmount = readFirstNumber(penaltyRecord.PenaltyAmount, penaltyRecord.amount);
      const changeFeeIndRaw = readFirstString(penaltyRecord.ChangeFeeInd, penaltyRecord.changeFeeInd);
      const changeFeeInd = changeFeeIndRaw === "true";

      conditions[`${typeCode}${appCode}`] = {
        title: typeCode,
        available: penaltyAmount !== null || changeFeeInd,
        cancel: null,
        change: changeFeeInd ? true : null,
        date: appCode,
        price: penaltyAmount,
      };
    }
  }

  return conditions;
}

function buildOrderCreatePeriods(offerPriceValue: Record<string, unknown>): Array<Record<string, unknown>> {
  const dataLists = asRecord(offerPriceValue.DataLists) ?? {};
  const segments = [...asArray(dataLists.PaxSegmentList), ...asArray(dataLists.PaxSegment)];
  const orderItems = asArray(offerPriceValue.OrderItems);
  const conditions = buildOrderCreateConditions(orderItems);

  const groupedByDate = new Map<string, Array<{ segDep: string; segArv: string }>>();
  for (const segment of segments) {
    const segmentRecord = asRecord(segment);
    if (!segmentRecord) {
      continue;
    }

    const dep = asRecord(segmentRecord.Dep) ?? {};
    const arrival = asRecord(segmentRecord.Arrival) ?? {};
    const segDep = readString(dep.IATALocationCode);
    const segArv = readString(arrival.IATALocationCode);
    const depDateTime = readString(dep.AircraftScheduledDateTime);
    const depDate = depDateTime ? depDateTime.slice(0, 10) : "N/A";

    if (!segDep || !segArv) {
      continue;
    }

    const existing = groupedByDate.get(depDate) ?? [];
    existing.push({ segDep, segArv });
    groupedByDate.set(depDate, existing);
  }

  if (groupedByDate.size === 0) {
    return [];
  }

  const periods: Array<Record<string, unknown>> = [];
  for (const [, routes] of groupedByDate) {
    const firstRoute = routes[0];
    const lastRoute = routes[routes.length - 1];
    periods.push({
      segDep: firstRoute.segDep,
      segArv: lastRoute.segArv,
      salePeriod: "",
      travelPeriod: "",
      conditions: structuredClone(conditions),
    });
  }

  return periods;
}

function resolveOrderCreateProvider(ora: string): string {
  const normalizedOra = ora.trim().toUpperCase();
  if (normalizedOra === "IB") {
    return "IBERIA";
  }
  return normalizedOra || "IBERIA";
}

function buildOrderCreateUrl(ora: string, baseUrl: string = DEFAULT_REMOTE_ORDER_CREATE_BASE_URL): string {
  const provider = resolveOrderCreateProvider(ora);
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  return `${normalizedBaseUrl}/${provider}/order/orderCreateRQ`;
}

function extractFolderIdFromOrderCreateResponse(response: unknown): number | null {
  if (!isRecord(response)) {
    return null;
  }

  const value = asRecord(response.value) ?? {};
  const folderIdString = readFirstString(value.folderId, value.FolderID, value.folderID);
  if (folderIdString) {
    return Number(folderIdString);
  }

  const folderIdNumber = readFirstNumber(value.folderId, value.FolderID, value.folderID);
  if (folderIdNumber !== null) {
    return Number(folderIdNumber);
  }

  return null;
}

function buildOrderCreateRequestPayload(
  candidate: OfferPriceCandidate,
  shoppingPayload: unknown,
  offerPriceResponse: unknown,
  profile?: Record<string, unknown>
): Record<string, unknown> {
  if (!isRecord(offerPriceResponse)) {
    throw new Error("Reponse offerPrice invalide pour construire orderCreateRQ.");
  }

  const offerPriceValue = extractOfferPriceValue(offerPriceResponse);
  const shoppingPayloadRecord = isRecord(shoppingPayload) ? shoppingPayload : {};
  const shoppingOras = asArray(shoppingPayloadRecord.oras);
  const fallbackOra = readString(shoppingOras[0]) ?? "";
  const ora = (candidate.airlineDesigCode || fallbackOra).trim().toUpperCase();
  if (!ora) {
    throw new Error("Impossible de determiner la compagnie (ora) pour orderCreateRQ.");
  }

  const offerId = readFirstString(offerPriceValue.OfferID, candidate.offerId);
  if (!offerId) {
    throw new Error("OfferID manquant pour orderCreateRQ.");
  }

  const orderCreateOfferIdList = candidate.offerIdList.map((item) => ({
    OfferItemRefID: item.OfferItemRefID,
    PaxRefID: structuredClone(item.PaxRefID),
  }));

  const paxs = asArray(shoppingPayloadRecord.paxs).map((pax, paxIndex) =>
    normalizeOrderCreatePax(pax, ora, paxIndex, profile)
  );
  const agenceInfo = isRecord(shoppingPayloadRecord.agenceInfo)
    ? structuredClone(shoppingPayloadRecord.agenceInfo)
    : {};

  const payload: Record<string, unknown> = {
    circuitData: {},
    onlineMarkup: {
      TYPE: "EUROS",
      VALUE: 0,
    },
    ora,
    reasons: [],
    paxs,
    OfferIdList: orderCreateOfferIdList,
    OfferID: offerId,
    payment: {
      paymentMethod: "Cash",
    },
    period: buildOrderCreatePeriods(offerPriceValue),
    agenceInfo,
    accessibilityServices: [],
    responseId:
      readFirstString(offerPriceValue.ResponseID, offerPriceValue.responseId, candidate.responseId) ?? "",
  };

  const serviceOfferId = readFirstString(offerPriceValue.serviceOfferId, offerPriceValue.ServiceOfferId);
  if (serviceOfferId) {
    payload.serviceOfferId = serviceOfferId;
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readFirstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = readNumber(value);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

function readFirstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const parsed = readString(value);
    if (parsed) {
      return parsed;
    }
  }
  return undefined;
}

function extractOfferPriceValue(response: Record<string, unknown>): Record<string, unknown> {
  const responseValue = asRecord(response.value);
  if (responseValue) {
    return responseValue;
  }

  const dataValue = asRecord(response.data);
  if (dataValue) {
    return dataValue;
  }

  const offerPriceValue = asRecord(response.OfferPriceRS) ?? asRecord(response.offerPriceRS);
  if (offerPriceValue) {
    return offerPriceValue;
  }

  return response;
}

function buildBaggageDetails(baggage: Record<string, unknown>): string {
  const directDescription = readFirstString(baggage.descriptif, baggage.description, baggage.Details);
  if (directDescription) {
    return directDescription;
  }

  const weightAllowance = asRecord(asArray(baggage.WeightAllowance)[0]);
  const maximumWeightMeasure = asRecord(weightAllowance?.MaximumWeightMeasure);
  const maximumWeight = readFirstNumber(maximumWeightMeasure?.MaximumWeight, maximumWeightMeasure?.Value);
  const weightUnit = readFirstString(maximumWeightMeasure?.UnitCode, maximumWeightMeasure?.Unit);

  const dimensionAllowance = asRecord(asArray(baggage.DimensionAllowance)[0]);
  const maxMeasure = readFirstNumber(dimensionAllowance?.MaxMeasure, dimensionAllowance?.MaximumValue);
  const dimensionUnit = readFirstString(dimensionAllowance?.UnitCode, dimensionAllowance?.Unit);
  const dimensionCategory = readFirstString(dimensionAllowance?.BaggageDimensionCategory);

  const parts: string[] = [];
  if (maximumWeight !== null) {
    parts.push(`${maximumWeight}${weightUnit ? ` ${weightUnit}` : ""}`);
  }
  if (maxMeasure !== null) {
    const categoryLabel = dimensionCategory ? `${dimensionCategory} ` : "";
    parts.push(`${categoryLabel}${maxMeasure}${dimensionUnit ? ` ${dimensionUnit}` : ""}`.trim());
  }

  return parts.join(" - ");
}

function displayOfferPriceInfo(response: unknown) {
  if (!isRecord(response)) {
    console.log("Reponse offerPrice non exploitable.");
    return;
  }

  const value = extractOfferPriceValue(response);
  const offerId = readFirstString(value.OfferID, value.offerId, value.id) ?? "N/A";
  const responseId =
    readFirstString(value.ResponseID, value.responseId, value.reponseId, response.ResponseID, response.responseId) ??
    "N/A";
  const offerExpirationDateTime = formatDateTime(value.OfferExpirationDateTime);
  const paymentTimeLimitDateTime = formatDateTime(value.PaymentTimeLimitDateTime);

  const orderItems = asArray(value.OrderItems);
  const firstOrderItem = asRecord(orderItems[0]) ?? {};
  const priceNode = asRecord(firstOrderItem.Price) ?? {};
  const lowerPriceNode = asRecord(firstOrderItem.price) ?? {};
  const farePriceType = asRecord(firstOrderItem.FarePriceType) ?? {};
  const farePriceTypePrice = asRecord(farePriceType.Price) ?? {};
  const farePriceTotalAmount = asRecord(farePriceTypePrice.TotalAmount) ?? {};
  const farePriceTaxes = asRecord(farePriceTypePrice.Taxs) ?? {};

  const totalAmount = readFirstNumber(
    priceNode.TotalAmount,
    asRecord(priceNode.Amount)?.Amount,
    lowerPriceNode.TotalAmount,
    asRecord(lowerPriceNode.Amount)?.Amount,
    farePriceTotalAmount.price,
    value.totalPrice,
    value.TotalPrice
  );

  const totalTaxAmount = readFirstNumber(
    priceNode.TotalTaxAmount,
    lowerPriceNode.TotalTaxAmount,
    farePriceTaxes.TotalTaxAmount
  );

  const taxRows = [
    ...asArray(priceNode.Taxes),
    ...asArray(lowerPriceNode.Taxes),
    ...asArray(firstOrderItem.Taxes),
  ];

  const firstTax = asRecord(taxRows[0]) ?? {};
  const firstTaxAmount = asRecord(firstTax.Amount) ?? {};
  const currency =
    readFirstString(
      value.conditionCurrency,
      asRecord(priceNode.Amount)?.Currency,
      asRecord(lowerPriceNode.Amount)?.Currency,
      firstTaxAmount.currency,
      firstTaxAmount.Currency
    ) ?? "";

  console.log("");
  console.log("===== Offer Price =====");
  console.log(`OfferID: ${offerId}`);
  console.log(`ResponseID: ${responseId}`);
  console.log(`Expiration: ${offerExpirationDateTime}`);
  console.log(`Time limit paiement: ${paymentTimeLimitDateTime}`);
  console.log(`Prix total: ${formatMoney(totalAmount, currency)}`);
  console.log(`Taxes total: ${formatMoney(totalTaxAmount, currency)}`);

  const dataLists = asRecord(value.DataLists) ?? {};
  const paxSegments = [...asArray(dataLists.PaxSegmentList), ...asArray(dataLists.PaxSegment)];
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

  const baggageList = [
    ...asArray(value.baggage),
    ...asArray(dataLists.BaggageAllowanceList),
    ...asArray(dataLists.BaggageAllowance),
  ];
  if (baggageList.length > 0) {
    const baggageTable = new Table({
      head: ["Type", "Qt", "Details"],
      wordWrap: true,
    });

    baggageList.forEach((baggage) => {
      const bag = asRecord(baggage) ?? {};
      const pieceAllowance = asRecord(bag.PieceAllowance) ?? {};
      const qty = readNumber(pieceAllowance.TotalQty);
      baggageTable.push([
        readFirstString(bag.TypeCode, bag.BaggageType, bag.BaggageCategory) ?? "N/A",
        qty === null ? "N/A" : String(qty),
        buildBaggageDetails(bag),
      ]);
    });

    console.log("");
    console.log("Bagages:");
    console.log(baggageTable.toString());
  }

  const paymentInfo = asArray(value.PaymentInfo);
  if (paymentInfo.length > 0) {
    const paymentLabels = paymentInfo
      .map((entry) => {
        const paymentRecord = asRecord(entry);
        if (paymentRecord) {
          return readFirstString(paymentRecord.Payment, paymentRecord.payment, paymentRecord.Label);
        }
        return readString(entry);
      })
      .filter((entry): entry is string => Boolean(entry));
    const displayed = paymentLabels.slice(0, 5);
    const suffix = paymentLabels.length > 5 ? ` (+${paymentLabels.length - 5})` : "";
    console.log("");
    console.log(`Paiements: ${displayed.join(", ")}${suffix}`);
  }

  const fareRows = orderItems.flatMap((orderItem) => {
    const item = asRecord(orderItem) ?? {};
    return [...asArray(item.Fare), ...asArray(item.fare)];
  });
  const penalties: Array<{ typeCode: string; appCode: string; detail: string }> = [];
  const seenPenalty = new Set<string>();
  for (const fare of fareRows) {
    const fareRecord = asRecord(fare);
    if (!fareRecord) continue;
    const fareRule = asRecord(fareRecord.FareRule) ?? asRecord(fareRecord.fareRule) ?? {};
    const penaltyRows = [...asArray(fareRule.Penalty), ...asArray(fareRule.penalties)];
    for (const penalty of penaltyRows) {
      const penaltyRecord = asRecord(penalty);
      if (!penaltyRecord) continue;
      const typeCode = readFirstString(penaltyRecord.TypeCode, penaltyRecord.typeCode) ?? "N/A";
      const appCode = readFirstString(penaltyRecord.AppCode, penaltyRecord.appCode) ?? "N/A";
      const penaltyAmount = readFirstNumber(penaltyRecord.PenaltyAmount, penaltyRecord.amount);
      const detail =
        penaltyAmount !== null
          ? formatMoney(penaltyAmount, currency)
          : (readFirstString(penaltyRecord.DescText, penaltyRecord.description) ?? "NAV");
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
      offer.outbound === selectedOffer.outbound &&
      (!selectedOffer.airlineDesigCode || offer.airlineDesigCode === selectedOffer.airlineDesigCode)
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
        case "auto":
          await runRemoteAuto();
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
  let lastUrl = DEFAULT_AERIAL_BASE_URL;
  let lastSearchName = "";
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
          message: "Base URL (ex: http://localhost:3000/aerial)",
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
    const baseUrl = String(answers.url || DEFAULT_AERIAL_BASE_URL).replace(/\/+$/, "");
    const dashboardBaseUrl = getDashboardBaseUrl(baseUrl);
    const requestUrl = `${baseUrl}/global/airShoppingRQ`;
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
    lastUrl = baseUrl;
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
      const defaultDates = getDefaultFlightDates(payload);
      const dateAnswers = await prompts(
        [
          {
            type: "text",
            name: "outbound",
            message: "Date aller (YYYY-MM-DD)",
            initial: defaultDates.outbound ?? "",
          },
          {
            type: "text",
            name: "inbound",
            message: "Date retour (YYYY-MM-DD, optionnel)",
            initial: defaultDates.inbound ?? "",
          },
        ],
        {
          onCancel: () => false,
        }
      );

      const updatedDates = {
        outbound: String(dateAnswers.outbound || "").trim() || undefined,
        inbound: String(dateAnswers.inbound || "").trim() || undefined,
      };

      const payloadRouteUpdate = applyRouteToPayload(payload, {
        departure: selectedDeparture,
        arrival: selectedArrival,
      });
      if (payloadRouteUpdate.updatedFlights === 0) {
        console.warn("Aucun segment flights[] n'a ete mis a jour dans le payload.");
      }

      const payloadDateUpdate = applyDatesToPayload(payloadRouteUpdate.payload, updatedDates);
      if (payloadDateUpdate.updatedFlights === 0) {
        console.warn("Aucun segment flights[].dates n'a ete mis a jour dans le payload.");
      }

      console.log(`Depart selectionne: ${formatDestinationLabel(selectedDeparture)}`);
      console.log(`Arrivee selectionnee: ${formatDestinationLabel(selectedArrival)}`);

      const result = await runRemoteShopping({
        payloadFile,
        url: requestUrl || undefined,
        payloadOverride: payloadDateUpdate.payload,
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
        let currentOrderCreatePayload: Record<string, unknown> | null = null;
        let currentOfferPriceResponse: unknown | null = null;
        let currentProfile: Record<string, unknown> | null = null;
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
            payloadDateUpdate.payload
          );

          try {
            const offerPriceResult = await runRemoteOfferPrice({
              payload: offerPricePayload,
              url: `${baseUrl}/global/offerPriceRQ`,
              requestHeaders: {
                authorization: bearerToken,
              },
            });

            console.log(`OfferPrice response message: ${offerPriceResult.message}`);
            console.log(`OfferPrice output written to: ${offerPriceResult.outputDir}`);
            displayOfferPriceInfo(offerPriceResult.response);
            currentOfferPriceResponse = offerPriceResult.response;

            try {
              currentOrderCreatePayload = buildOrderCreateRequestPayload(
                offerPriceCandidate,
                payloadDateUpdate.payload,
                offerPriceResult.response
              );
            } catch (buildError) {
              currentOrderCreatePayload = null;
              currentOfferPriceResponse = null;
              console.error("Impossible de preparer orderCreateRQ:", buildError);
            }
          } catch (error) {
            currentOrderCreatePayload = null;
            currentOfferPriceResponse = null;
            console.error("Erreur offerPriceRQ:", error);
          }

          const nextAction = await prompts(
            {
              type: "select",
              name: "action",
              message: "Que souhaitez-vous faire ?",
              choices: [
                { title: "Choisir offre retour", value: "return" },
                { title: "Assigner passager", value: "assignPassenger" },
                { title: "Lancer orderCreateRQ", value: "orderCreate" },
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
              currentOrderCreatePayload = null;
              currentOfferPriceResponse = null;
              currentProfile = null;
              continue;
            }
            continue;
          }

          if (nextAction.action === "assignPassenger") {
            const agenceInfo = isRecord(payloadDateUpdate.payload)
              ? (payloadDateUpdate.payload as Record<string, unknown>).agenceInfo
              : undefined;
            const agenceId = readFirstNumber(
              isRecord(agenceInfo) ? agenceInfo.id_agence : undefined,
              isRecord(agenceInfo) ? agenceInfo.id_agency : undefined
            );

            const defaultSearchName = lastSearchName || "";
            const profileAnswers = await prompts(
              [
                {
                  type: "text",
                  name: "searchName",
                  message: "Recherche passager (searchName)",
                  initial: defaultSearchName,
                },
                {
                  type: "text",
                  name: "agenceId",
                  message: "Agence ID",
                  initial: agenceId !== null ? String(agenceId) : "",
                },
              ],
              {
                onCancel: () => false,
              }
            );

            const searchName = String(profileAnswers.searchName || "").trim();
            const agenceIdValue = Number.parseInt(String(profileAnswers.agenceId || ""), 10);
            if (!searchName || !Number.isFinite(agenceIdValue)) {
              console.error("searchName/agenceId invalides.");
              continue;
            }

            lastSearchName = searchName;

            try {
              const profilSearchResult = await runRemoteProfilSearch({
                payload: {
                  searchName,
                  agenceId: agenceIdValue,
                },
                url: `${dashboardBaseUrl}/api/profil/search`,
                requestHeaders: {
                  authorization: bearerToken,
                },
              });

              console.log(`Profil search message: ${profilSearchResult.message}`);
              console.log(`Profil search output written to: ${profilSearchResult.outputDir}`);

              const responseRecord = isRecord(profilSearchResult.response)
                ? (profilSearchResult.response as Record<string, unknown>)
                : {};
              const values = Array.isArray(responseRecord.values) ? responseRecord.values : [];
              if (values.length === 0) {
                console.warn("Aucun profil trouve.");
                continue;
              }

              const choices = values.slice(0, 10).map((entry, idx) => {
                const record = isRecord(entry) ? entry : {};
                const physical = isRecord(record.physical) ? record.physical : {};
                const label = `${readString(physical.first_name) ?? "?"} ${readString(physical.last_name) ?? "?"}`.trim();
                const profileId = readFirstString(record.id, record.profileId) ?? String(idx + 1);
                return { title: `${label} (#${profileId})`, value: idx };
              });

              const pick = await prompts(
                {
                  type: "select",
                  name: "value",
                  message: "Choisir un profil",
                  choices,
                  initial: 0,
                },
                {
                  onCancel: () => false,
                }
              );

              const pickedIndex = Number.parseInt(String(pick.value), 10);
              if (Number.isNaN(pickedIndex) || pickedIndex < 0 || pickedIndex >= values.length) {
                console.error("Selection profil invalide.");
                continue;
              }

              currentProfile = isRecord(values[pickedIndex])
                ? (values[pickedIndex] as Record<string, unknown>)
                : null;
              console.log("Passager assigne.");
              currentOrderCreatePayload = null;
            } catch (error) {
              console.error("Erreur profil search:", error);
            }
            continue;
          }

          if (nextAction.action === "orderCreate") {
            if (!currentOfferPriceResponse) {
              console.error("orderCreateRQ indisponible: lancer offerPrice avec succes d'abord.");
              continue;
            }

            if (!currentProfile) {
              console.error("Passager non assigne: utilisez 'Assigner passager' avant orderCreate.");
              continue;
            }

            try {
              const orderCreatePayload = buildOrderCreateRequestPayload(
                offerPriceCandidate,
                payloadDateUpdate.payload,
                currentOfferPriceResponse,
                currentProfile
              );
              const orderCreateOra = readString(orderCreatePayload.ora) ?? "IB";

              const orderCreateResult = await runRemoteOrderCreate({
                payload: orderCreatePayload,
                url: buildOrderCreateUrl(orderCreateOra, baseUrl),
                requestHeaders: {
                  authorization: bearerToken,
                },
              });

              console.log(`OrderCreate response message: ${orderCreateResult.message}`);
              console.log(`OrderCreate output written to: ${orderCreateResult.outputDir}`);

              const folderId = extractFolderIdFromOrderCreateResponse(orderCreateResult.response);
              if (!folderId) {
                console.warn("folderId absent de orderCreateRS, appel dossier opti ignore.");
                continue;
              }

              try {
                const encryptedFolderId = encrypteDossierId(folderId);
                const dossierOptiResult = await runRemoteDossierOpti({
                  folderId,
                  encryptedFolderId,
                  url: `${baseUrl}/dossier/dossiers/opti`,
                  requestHeaders: {
                    authorization: bearerToken,
                  },
                });

                console.log(`Dossier opti response message: ${dossierOptiResult.message}`);
                console.log(`Dossier opti output written to: ${dossierOptiResult.outputDir}`);
                console.log(`Dossier opti request URL: ${dossierOptiResult.url}`);
              } catch (error) {
                console.error("Erreur dossier opti:", error);
              }
            } catch (error) {
              console.error("Erreur orderCreateRQ:", error);
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

async function runRemoteAuto() {
  console.log("Metis - Remote Shopping (mode auto)");

  const answers = await prompts(
    [
      {
        type: "text",
        name: "payload",
        message: "Chemin du payload JSON",
        initial: "examples/remote-shopping-payload.sample.json",
      },
      {
        type: "text",
        name: "url",
        message: "Base URL (ex: http://localhost:3000/aerial)",
        initial: DEFAULT_AERIAL_BASE_URL,
      },
      {
        type: "text",
        name: "ora",
        message: "ORA desire (ex: IB)",
        initial: "IB",
      },
      {
        type: "text",
        name: "departure",
        message: "Depart (IATA, ex: LIS)",
      },
      {
        type: "text",
        name: "arrival",
        message: "Arrivee (IATA, ex: CDG)",
      },
      {
        type: "text",
        name: "searchName",
        message: "Passager a rechercher (searchName)",
      },
      {
        type: "text",
        name: "agenceId",
        message: "Agence ID",
      },
      {
        type: "text",
        name: "count",
        message: "Nombre d'executions",
        initial: "1",
      },
      {
        type: "text",
        name: "token",
        message: "Token utilisateur (Bearer ...)",
        initial: "Bearer ",
      },
    ],
    {
      onCancel: () => false,
    }
  );

  const payloadFile = String(answers.payload || "").trim();
  const baseUrl = String(answers.url || DEFAULT_AERIAL_BASE_URL).replace(/\/+$/, "");
  const dashboardBaseUrl = getDashboardBaseUrl(baseUrl);
  const ora = String(answers.ora || "").trim().toUpperCase();
  const departureCode = String(answers.departure || "").trim().toUpperCase();
  const arrivalCode = String(answers.arrival || "").trim().toUpperCase();
  const searchName = String(answers.searchName || "").trim();
  const agenceIdValue = Number.parseInt(String(answers.agenceId || ""), 10);
  const count = Number.parseInt(String(answers.count || "1"), 10);

  if (!payloadFile || !ora || !departureCode || !arrivalCode || !searchName || !Number.isFinite(agenceIdValue)) {
    console.error("Parametres invalides pour le mode auto.");
    return;
  }

  if (!Number.isFinite(count) || count <= 0) {
    console.error("Le nombre d'executions doit etre un entier positif.");
    return;
  }

  let bearerToken: string;
  try {
    bearerToken = normalizeBearerToken(String(answers.token || ""));
  } catch (error) {
    console.error("Erreur:", error);
    return;
  }

  let profile: Record<string, unknown> | null = null;
  try {
    const profilSearchResult = await runRemoteProfilSearch({
      payload: {
        searchName,
        agenceId: agenceIdValue,
      },
      url: `${dashboardBaseUrl}/api/profil/search`,
      requestHeaders: {
        authorization: bearerToken,
      },
    });

    console.log(`Profil search message: ${profilSearchResult.message}`);
    console.log(`Profil search output written to: ${profilSearchResult.outputDir}`);

    const responseRecord = isRecord(profilSearchResult.response)
      ? (profilSearchResult.response as Record<string, unknown>)
      : {};
    const values = Array.isArray(responseRecord.values) ? responseRecord.values : [];
    if (values.length === 0) {
      console.error("Aucun profil trouve pour le passager.");
      return;
    }
    profile = isRecord(values[0]) ? (values[0] as Record<string, unknown>) : null;
  } catch (error) {
    console.error("Erreur profil search:", error);
    return;
  }

  const departure = buildFallbackDestinationFromKeyword(departureCode);
  const arrival = buildFallbackDestinationFromKeyword(arrivalCode);
  if (!departure || !arrival) {
    console.error("Codes IATA invalides pour depart/arrivee.");
    return;
  }

  for (let runIndex = 0; runIndex < count; runIndex += 1) {
    console.log(`\n--- Execution auto ${runIndex + 1}/${count} ---`);
    let payload: unknown;
    try {
      payload = await readJsonFile<unknown>(payloadFile);
    } catch (error) {
      console.error("Erreur lecture payload:", error);
      return;
    }

    const randomDates = getRandomTripDates();
    const payloadRouteUpdate = applyRouteToPayload(payload, { departure, arrival });
    const payloadDateUpdate = applyDatesToPayload(payloadRouteUpdate.payload, randomDates);
    const payloadOraUpdate = applyOraToPayload(payloadDateUpdate.payload, ora);

    const requestUrl = `${baseUrl}/global/airShoppingRQ`;
    let shoppingResult: Awaited<ReturnType<typeof runRemoteShopping>> | null = null;
    try {
      shoppingResult = await runRemoteShopping({
        payloadFile,
        url: requestUrl,
        payloadOverride: payloadOraUpdate.payload,
        requestHeaders: {
          authorization: bearerToken,
        },
      });
    } catch (error) {
      console.error("Erreur airShoppingRQ:", error);
      continue;
    }

    console.log(`Offers found: ${shoppingResult.rows.length}`);
    if (shoppingResult.rows.length === 0) {
      console.warn("Aucune offre disponible.");
      continue;
    }

    const filteredOffers = shoppingResult.rows.filter(
      (row) => !ora || row.airlineDesigCode === ora
    );
    const selectedOffer = filteredOffers[0] ?? shoppingResult.rows[0];
    const returnOffers = getReturnOffers(shoppingResult.rows, selectedOffer);
    const finalOffer = returnOffers[0] ?? selectedOffer;

    const offerPriceCandidate = shoppingResult.offerPriceCandidates[finalOffer.offerId];
    if (!offerPriceCandidate || offerPriceCandidate.offerIdList.length === 0) {
      console.error("Offre selectionnee invalide pour offerPriceRQ.");
      continue;
    }

    let offerPriceResponse: unknown;
    try {
      const offerPricePayload = buildOfferPriceRequestPayload(
        offerPriceCandidate,
        payloadOraUpdate.payload
      );
      const offerPriceResult = await runRemoteOfferPrice({
        payload: offerPricePayload,
        url: `${baseUrl}/global/offerPriceRQ`,
        requestHeaders: {
          authorization: bearerToken,
        },
      });
      offerPriceResponse = offerPriceResult.response;
    } catch (error) {
      console.error("Erreur offerPriceRQ:", error);
      continue;
    }

    try {
      const orderCreatePayload = buildOrderCreateRequestPayload(
        offerPriceCandidate,
        payloadOraUpdate.payload,
        offerPriceResponse,
        profile
      );
      const orderCreateOra = readString(orderCreatePayload.ora) ?? ora;
      const orderCreateResult = await runRemoteOrderCreate({
        payload: orderCreatePayload,
        url: buildOrderCreateUrl(orderCreateOra, baseUrl),
        requestHeaders: {
          authorization: bearerToken,
        },
      });

      console.log(`OrderCreate response message: ${orderCreateResult.message}`);
      console.log(`OrderCreate output written to: ${orderCreateResult.outputDir}`);

      const folderId = extractFolderIdFromOrderCreateResponse(orderCreateResult.response);
      if (!folderId) {
        console.warn("folderId absent de orderCreateRS, appel dossier opti ignore.");
        continue;
      }

      try {
        const encryptedFolderId = encrypteDossierId(folderId);
        const dossierOptiResult = await runRemoteDossierOpti({
          folderId,
          encryptedFolderId,
          url: `${baseUrl}/dossier/dossiers/opti`,
          requestHeaders: {
            authorization: bearerToken,
          },
        });

        console.log(`Dossier opti response message: ${dossierOptiResult.message}`);
        console.log(`Dossier opti output written to: ${dossierOptiResult.outputDir}`);
      } catch (error) {
        console.error("Erreur dossier opti:", error);
      }
    } catch (error) {
      console.error("Erreur orderCreateRQ:", error);
    }
  }
}

function printUsage() {
  console.error("Usage: metis-db <command> <subcommand> [options]");
  console.error("Commands:");
  console.error("  sabre shopping --file <filename> [--flight <code] [--brand <name>] [--offer <id>] [--sort <field>]");
  console.error("  remote shopping --payload <filename> [--url <http-url>] [--max <count>]");
  console.error("  remote interactive");
  console.error("  remote auto");
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
