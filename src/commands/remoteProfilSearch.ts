import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_DASHBOARD_BASE_URL } from "../utils/baseUrl";

export const DEFAULT_REMOTE_PROFIL_SEARCH_URL = `${DEFAULT_DASHBOARD_BASE_URL}/api/profil/search`;

export interface RemoteProfilSearchOptions {
    payload: unknown;
    url?: string;
    requestHeaders?: Record<string, string>;
}

export interface RemoteProfilSearchResult {
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

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    const sanitized: Record<string, string> = { ...headers };
    if (sanitized.authorization) {
        sanitized.authorization = "<redacted>";
    }
    return sanitized;
}

function extractProfilSearchMessage(response: unknown): string {
    if (!isRecord(response)) {
        return "N/A";
    }

    const rootMessage = readString(response.message);
    if (rootMessage) {
        return rootMessage;
    }

    const value = isRecord(response.value) ? response.value : undefined;
    const nestedMessage = readString(value?.message);
    if (nestedMessage) {
        return nestedMessage;
    }

    const status = readString(response.status) ?? readString(value?.status);
    if (status) {
        return status;
    }

    return "N/A";
}

function getOutputFolderName() {
    return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function runRemoteProfilSearch(
    options: RemoteProfilSearchOptions
): Promise<RemoteProfilSearchResult> {
    const url = options.url ?? DEFAULT_REMOTE_PROFIL_SEARCH_URL;
    const timestampFolder = getOutputFolderName();
    const outputDir = join(process.cwd(), "out", "remote-profil-search", timestampFolder);
    await mkdir(outputDir, { recursive: true });

    await writeFile(
        join(outputDir, "profilSearchRequest.json"),
        JSON.stringify(options.payload, null, 2),
        "utf8"
    );

    const requestHeaders: Record<string, string> = {
        "content-type": "application/json",
        ...(options.requestHeaders ?? {}),
    };
    const payloadJson = JSON.stringify(options.payload);

    console.log(
        "profilSearch debug:",
        JSON.stringify(
            {
                method: "POST",
                url,
                headers: sanitizeHeaders(requestHeaders),
                payloadBytes: Buffer.byteLength(payloadJson, "utf8"),
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
        join(outputDir, "profilSearchResponse.json"),
        typeof parsedResponse === "string" ? parsedResponse : JSON.stringify(parsedResponse, null, 2),
        "utf8"
    );

    if (!httpResponse.ok) {
        throw new Error(
            `Remote profil search failed (${httpResponse.status} ${httpResponse.statusText}). Response saved to ${outputDir}`
        );
    }

    const message = extractProfilSearchMessage(parsedResponse);
    return { message, outputDir, response: parsedResponse };
}
