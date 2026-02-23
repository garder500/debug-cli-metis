import Table from "cli-table3";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readJsonFile } from "../utils/fileReader";
import { DEFAULT_AERIAL_BASE_URL } from "../utils/baseUrl";

export const DEFAULT_REMOTE_SHOPPING_URL = `${DEFAULT_AERIAL_BASE_URL}/global/airShoppingRQ`;

export interface RemoteShoppingOptions {
  payloadFile: string;
  url?: string;
  payloadOverride?: unknown;
  requestHeaders?: Record<string, string>;
}

interface AirShoppingResponse {
  message?: string;
  value?: {
    DataLists?: {
      PaxJourney?: unknown[];
      PaxSegment?: unknown[];
      BaggageAllowance?: unknown[];
    };
    OriginListFlights?: unknown[];
  };
}

export interface OfferSummaryRow {
  offerId: string;
  outbound: string;
  inbound: string;
  price: number | null;
  currency: string;
  cabinType: string;
  baggage: string;
  airlineDesigCode: string;
}

export type OfferIdListItem = Record<string, unknown> & {
  OfferItemRefID: string;
  PaxRefID: string[];
};

export interface OfferPriceCandidate {
  offerId: string;
  airlineDesigCode: string;
  offerIdList: OfferIdListItem[];
  responseId?: string;
  totalPrice?: unknown;
}

export interface RemoteShoppingResult {
  message: string;
  outputDir: string;
  rows: OfferSummaryRow[];
  offerPriceCandidates: Record<string, OfferPriceCandidate>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = { ...headers };
  if (sanitized.authorization) {
    sanitized.authorization = "<redacted>";
  }
  return sanitized;
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

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => readString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function parseOfferIdListItem(value: unknown): OfferIdListItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const offerItemRefId = readString(value.OfferItemRefID);
  if (!offerItemRefId) {
    return null;
  }

  const paxRefId = readStringArray(value.PaxRefID);
  const clonedItem = structuredClone(value) as Record<string, unknown>;
  return {
    ...clonedItem,
    OfferItemRefID: offerItemRefId,
    PaxRefID: paxRefId,
  };
}

function buildOfferPriceCandidate(
  offer: Record<string, unknown>,
  defaultResponseId?: string
): OfferPriceCandidate | null {
  const offerId = readString(offer.OfferID);
  if (!offerId) {
    return null;
  }

  const airlineDesigCode = readString(offer.OwnerCode) ?? "";
  const offerIdListRaw = Array.isArray(offer.OfferIdList) ? offer.OfferIdList : [];
  const offerIdList = offerIdListRaw
    .map((item) => parseOfferIdListItem(item))
    .filter((item): item is OfferIdListItem => item !== null);
  const responseId =
    readString(offer.responseId) ??
    readString(offer.reponseId) ??
    readString(offer.ResponseID) ??
    defaultResponseId;
  const totalPrice = isRecord(offer.TotalPrice) ? structuredClone(offer.TotalPrice) : undefined;

  return {
    offerId,
    airlineDesigCode,
    offerIdList,
    responseId,
    totalPrice,
  };
}

function extractJourneyLabel(
  journey: unknown,
  segmentById: Map<string, unknown>
): { journeyId?: string; label?: string } {
  if (!isRecord(journey)) {
    return {};
  }

  const journeyId = readString(journey.PaxJourneyID);
  const segmentRefs = Array.isArray(journey.PaxSegmentRefID) ? journey.PaxSegmentRefID : [];
  const firstSegmentRef = readString(segmentRefs[0]);
  if (!firstSegmentRef) {
    return { journeyId, label: journeyId };
  }

  const segment = segmentById.get(firstSegmentRef);
  if (!isRecord(segment)) {
    return { journeyId, label: firstSegmentRef };
  }

  const marketing = isRecord(segment.MarketingCarrierInfo)
    ? segment.MarketingCarrierInfo
    : undefined;
  const dep = isRecord(segment.Dep) ? segment.Dep : undefined;
  const arrival = isRecord(segment.Arrival) ? segment.Arrival : undefined;

  const carrier = readString(marketing?.CarrierDesigCode) ?? "";
  const flightNumber = readString(marketing?.MarketingCarrierFlightNumberText) ?? firstSegmentRef;
  const from = readString(dep?.IATALocationCode) ?? "?";
  const to = readString(arrival?.IATALocationCode) ?? "?";
  const depDateTime = readString(dep?.AircraftScheduledDateTime);

  const parts = [`${carrier}${flightNumber}`.trim(), `${from}-${to}`];
  if (depDateTime) {
    parts.push(depDateTime);
  }

  return { journeyId, label: parts.join(" ") };
}

function buildLookupMaps(response: AirShoppingResponse) {
  const value = response.value;
  const dataLists = isRecord(value?.DataLists) ? value?.DataLists : undefined;

  const paxSegments = Array.isArray(dataLists?.PaxSegment) ? dataLists?.PaxSegment : [];
  const segmentById = new Map<string, unknown>();
  for (const paxSegment of paxSegments) {
    if (!isRecord(paxSegment)) continue;
    const paxSegmentId = readString(paxSegment.PaxSegmentID);
    if (paxSegmentId) {
      segmentById.set(paxSegmentId, paxSegment);
    }
  }

  const paxJourneys = Array.isArray(dataLists?.PaxJourney) ? dataLists?.PaxJourney : [];
  const journeyById = new Map<string, string>();
  for (const paxJourney of paxJourneys) {
    const { journeyId, label } = extractJourneyLabel(paxJourney, segmentById);
    if (journeyId && label) {
      journeyById.set(journeyId, label);
    }
  }

  const bagById = new Map<string, string>();
  const bagList = Array.isArray(dataLists?.BaggageAllowance) ? dataLists?.BaggageAllowance : [];
  for (const bag of bagList) {
    if (!isRecord(bag)) continue;
    const bagId = readString(bag.BaggageAllowanceID);
    const pieceAllowance = isRecord(bag.PieceAllowance) ? bag.PieceAllowance : undefined;
    const totalQtyRaw = readString(pieceAllowance?.TotalQty);
    const totalQty = totalQtyRaw ?? "0";
    if (bagId) {
      bagById.set(bagId, `${totalQty}pc`);
    }
  }

  return { journeyById, bagById };
}

function collectOfferRows(response: AirShoppingResponse): {
  rows: OfferSummaryRow[];
  offerPriceCandidates: Record<string, OfferPriceCandidate>;
} {
  const value = response.value;
  const responseRecord = isRecord(value) ? value : {};
  const defaultResponseId =
    readString(responseRecord.responseId) ??
    readString(responseRecord.reponseId) ??
    readString(responseRecord.ResponseID);
  const originList = Array.isArray(value?.OriginListFlights) ? value?.OriginListFlights : [];
  const { journeyById, bagById } = buildLookupMaps(response);
  const offersById = new Map<string, OfferSummaryRow>();
  const offerPriceCandidatesById = new Map<string, OfferPriceCandidate>();

  for (const origin of originList) {
    if (!isRecord(origin)) continue;
    const flights = Array.isArray(origin.flights) ? origin.flights : [];

    for (const flight of flights) {
      if (!isRecord(flight)) continue;
      const offerList = Array.isArray(flight.offertList) ? flight.offertList : [];

      for (const offer of offerList) {
        if (!isRecord(offer)) continue;
        const offerId = readString(offer.OfferID);
        if (!offerId) continue;

        const journeyRefs = Array.isArray(offer.PaxJourneyRefID) ? offer.PaxJourneyRefID : [];
        const outRef = readString(journeyRefs[0]);
        const inRef = readString(journeyRefs[1]);
        const outbound = outRef ? journeyById.get(outRef) ?? outRef : "N/A";
        const inbound = inRef ? journeyById.get(inRef) ?? inRef : "-";

        const totalPrice = isRecord(offer.TotalPrice) ? offer.TotalPrice : undefined;
        const priceNode = isRecord(totalPrice?.Price) ? totalPrice?.Price : undefined;
        const amountNode = isRecord(priceNode?.Amount) ? priceNode?.Amount : undefined;
        const price = readNumber(amountNode?.Amount);
        const currency = readString(amountNode?.Currency) ?? "";

        const cabin = isRecord(offer.cabin) ? offer.cabin : undefined;
        const cabinType = readString(cabin?.cabinType) ?? "N/A";

        const baggageNode = isRecord(offer.baggage) ? offer.baggage : undefined;
        const baggageRef = readString(baggageNode?.BaggageAllowanceRefID);
        const baggage = baggageRef ? bagById.get(baggageRef) ?? baggageRef : "N/A";

        const airlineDesigCode = readString(offer.OwnerCode) ?? "";

        const row: OfferSummaryRow = {
          offerId,
          outbound,
          inbound,
          price,
          currency,
          cabinType,
          baggage,
          airlineDesigCode,
        };
        const offerPriceCandidate = buildOfferPriceCandidate(offer, defaultResponseId);

        const existing = offersById.get(offerId);
        if (!existing) {
          offersById.set(offerId, row);
          if (offerPriceCandidate) {
            offerPriceCandidatesById.set(offerId, offerPriceCandidate);
          }
          continue;
        }

        const existingPrice = existing.price;
        if (price !== null && (existingPrice === null || price < existingPrice)) {
          offersById.set(offerId, row);
          if (offerPriceCandidate) {
            offerPriceCandidatesById.set(offerId, offerPriceCandidate);
          }
        }
      }
    }
  }

  const rows = Array.from(offersById.values());
  rows.sort((a, b) => {
    if (a.price === null && b.price === null) return a.offerId.localeCompare(b.offerId);
    if (a.price === null) return 1;
    if (b.price === null) return -1;
    if (a.price === b.price) return a.offerId.localeCompare(b.offerId);
    return a.price - b.price;
  });
  return {
    rows,
    offerPriceCandidates: Object.fromEntries(offerPriceCandidatesById.entries()),
  };
}

export function renderRemoteOffersTable(
  rows: OfferSummaryRow[],
  offset = 0
) {
  const table = new Table({
    head: ["#", "Offer ID", "Outbound", "Inbound", "Price", "Cabin", "Bag"],
    wordWrap: true,
  });

  rows.forEach((row, index) => {
    const price = row.price === null ? "N/A" : `${row.price.toFixed(2)} ${row.currency}`.trim();
    table.push([
      offset + index + 1,
      row.offerId,
      row.outbound,
      row.inbound,
      price,
      row.cabinType,
      row.baggage,
    ]);
  });

  return table.toString();
}

function getOutputFolderName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function runRemoteShopping(
  options: RemoteShoppingOptions
): Promise<RemoteShoppingResult> {
  const payload = options.payloadOverride ?? (await readJsonFile<unknown>(options.payloadFile));
  const url = options.url ?? DEFAULT_REMOTE_SHOPPING_URL;

  const timestampFolder = getOutputFolderName();
  const outputDir = join(process.cwd(), "out", "remote-shopping", timestampFolder);
  await mkdir(outputDir, { recursive: true });

  await writeFile(join(outputDir, "shoppingRequest.json"), JSON.stringify(payload, null, 2), "utf8");

  console.log(`Sending remote shopping request to ${url}`);
  const requestHeaders: Record<string, string> = {
    "content-type": "application/json",
    ...(options.requestHeaders ?? {}),
  };
  const payloadJson = JSON.stringify(payload);

  console.log(
    "airShoppingRQ debug:",
    JSON.stringify(
      {
        method: "POST",
        url,
        headers: sanitizeHeaders(requestHeaders),
        payloadBytes: Buffer.byteLength(payloadJson, "utf8"),
        payloadSource: options.payloadOverride ? "override" : options.payloadFile,
      },
      null,
      2
    )
  );

  const httpResponse = await fetch(url, {
    method: "POST",
    headers: requestHeaders,
    body: payloadJson,
  });

  const responseText = await httpResponse.text();
  let parsedResponse: unknown = responseText;
  try {
    parsedResponse = JSON.parse(responseText);
  } catch {
    // Keep raw text if response is not JSON.
  }

  await writeFile(
    join(outputDir, "shoppingResponse.json"),
    typeof parsedResponse === "string" ? parsedResponse : JSON.stringify(parsedResponse, null, 2),
    "utf8"
  );

  if (!httpResponse.ok) {
    throw new Error(
      `Remote shopping failed (${httpResponse.status} ${httpResponse.statusText}). Response saved to ${outputDir}`
    );
  }

  const response = parsedResponse as AirShoppingResponse;
  const { rows, offerPriceCandidates } = collectOfferRows(response);
  const message = readString(response.message) ?? "N/A";

  return { message, outputDir, rows, offerPriceCandidates };
}

export async function handleRemoteShopping(
  options: RemoteShoppingOptions & { maxRows?: number }
) {
  const maxRows = options.maxRows ?? 25;
  const result = await runRemoteShopping(options);

  console.log(`Response message: ${result.message}`);
  console.log(`Offers found: ${result.rows.length}`);
  console.log(`Output written to: ${result.outputDir}`);

  if (result.rows.length === 0) {
    console.log("No offers found in response.value.OriginListFlights.");
    return;
  }

  console.log(renderRemoteOffersTable(result.rows.slice(0, maxRows)));
  if (result.rows.length > maxRows) {
    console.log(`Showing first ${maxRows} offers sorted by ascending price.`);
  }
}
