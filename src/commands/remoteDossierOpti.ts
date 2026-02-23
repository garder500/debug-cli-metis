import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_AERIAL_BASE_URL } from "../utils/baseUrl";

export const DEFAULT_REMOTE_DOSSIER_OPTI_BASE_URL = `${DEFAULT_AERIAL_BASE_URL}/dossier/dossiers/opti`;

export interface RemoteDossierOptiOptions {
    folderId: string;
    encryptedFolderId: string;
    url?: string;
    requestHeaders?: Record<string, string>;
}

export interface RemoteDossierOptiResult {
    message: string;
    outputDir: string;
    response: unknown;
    url: string;
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

function extractDossierOptiMessage(response: unknown): string {
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

export async function runRemoteDossierOpti(
    options: RemoteDossierOptiOptions
): Promise<RemoteDossierOptiResult> {
    const timestampFolder = getOutputFolderName();
    const outputDir = join(process.cwd(), "out", "remote-dossier-opti", timestampFolder);
    await mkdir(outputDir, { recursive: true });

    const encodedEncryptedFolderId = encodeURIComponent(options.encryptedFolderId);
    const baseUrl = options.url ?? DEFAULT_REMOTE_DOSSIER_OPTI_BASE_URL;
    const requestUrl = `${baseUrl}/${encodedEncryptedFolderId}`;

    await writeFile(
        join(outputDir, "dossierOptiRequest.json"),
        JSON.stringify(
            {
                folderId: options.folderId,
                encryptedFolderId: options.encryptedFolderId,
                requestUrl,
            },
            null,
            2
        ),
        "utf8"
    );

    console.log(`Sending remote dossier opti request to ${requestUrl}`);
    const requestHeaders: Record<string, string> = {
        ...(options.requestHeaders ?? {}),
    };

    console.log(
        "dossierOpti debug:",
        JSON.stringify(
            {
                method: "GET",
                url: requestUrl,
                headers: sanitizeHeaders(requestHeaders),
                folderId: options.folderId,
            },
            null,
            2
        )
    );

    const httpResponse = await fetch(requestUrl, {
        method: "GET",
        headers: requestHeaders,
    });

    const responseText = await httpResponse.text();
    let parsedResponse: unknown = responseText;
    try {
        parsedResponse = JSON.parse(responseText);
    } catch {
        // Keep raw text if response is not JSON.
    }

    await writeFile(
        join(outputDir, "dossierOptiResponse.json"),
        typeof parsedResponse === "string" ? parsedResponse : JSON.stringify(parsedResponse, null, 2),
        "utf8"
    );

    if (!httpResponse.ok) {
        throw new Error(
            `Remote dossier opti failed (${httpResponse.status} ${httpResponse.statusText}). Response saved to ${outputDir}`
        );
    }

    const message = extractDossierOptiMessage(parsedResponse);
    return { message, outputDir, response: parsedResponse, url: requestUrl };
}