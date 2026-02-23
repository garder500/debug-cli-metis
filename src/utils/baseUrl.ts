export const DEFAULT_AERIAL_BASE_URL = "http://localhost:3000/aerial";
export const DEFAULT_DASHBOARD_BASE_URL = "http://localhost:3000/dashboard";

export function getDashboardBaseUrl(aerialBaseUrl: string): string {
    const normalized = aerialBaseUrl.replace(/\/+$/, "");
    if (normalized.endsWith("/aerial")) {
        return normalized.replace(/\/aerial$/, "/dashboard");
    }
    return `${normalized}/dashboard`;
}
