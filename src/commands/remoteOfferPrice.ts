import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const DEFAULT_REMOTE_OFFER_PRICE_URL = "http://localhost:3000/aerial/global/offerPriceRQ";

export interface RemoteOfferPriceOptions {
  payload: unknown;
  url?: string;
  requestHeaders?: Record<string, string>;
}

export interface RemoteOfferPriceResult {
  message: string;
  outputDir: string;
  response: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getOutputFolderName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function runRemoteOfferPrice(
  options: RemoteOfferPriceOptions
): Promise<RemoteOfferPriceResult> {
  const url = options.url ?? DEFAULT_REMOTE_OFFER_PRICE_URL;
  const timestampFolder = getOutputFolderName();
  const outputDir = join(process.cwd(), "out", "remote-offer-price", timestampFolder);
  await mkdir(outputDir, { recursive: true });

  await writeFile(join(outputDir, "offerPriceRequest.json"), JSON.stringify(options.payload, null, 2), "utf8");

  console.log(`Sending remote offerPrice request to ${url}`);
  const requestHeaders: Record<string, string> = {
    "content-type": "application/json",
    ...(options.requestHeaders ?? {}),
  };

  const httpResponse = await fetch(url, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(options.payload),
  });

  const responseText = await httpResponse.text();
  let parsedResponse: unknown = responseText;
  try {
    parsedResponse = JSON.parse(responseText);
  } catch {
    // Keep raw text if response is not JSON.
  }

  await writeFile(
    join(outputDir, "offerPriceResponse.json"),
    typeof parsedResponse === "string" ? parsedResponse : JSON.stringify(parsedResponse, null, 2),
    "utf8"
  );

  if (!httpResponse.ok) {
    throw new Error(
      `Remote offerPrice failed (${httpResponse.status} ${httpResponse.statusText}). Response saved to ${outputDir}`
    );
  }

  const message = isRecord(parsedResponse) ? readString(parsedResponse.message) ?? "N/A" : "N/A";
  return { message, outputDir, response: parsedResponse };
}
