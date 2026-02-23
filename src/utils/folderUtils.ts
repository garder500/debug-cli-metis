const ENCRYPTION_KEY = "everbloo";

export function encrypteDossierId(dossierId: any) {
    const encryptionKey = ENCRYPTION_KEY;
    const encryptedId = btoa(JSON.stringify(dossierId));

    function stringToHex(str: string) {
        return str
            .split("")
            .map((char) => char.charCodeAt(0).toString(16).padStart(2, "0"))
            .join("");
    }

    let encrypted = "";
    for (let i = 0; i < encryptedId.length; i++) {
        encrypted += String.fromCharCode(
            encryptedId.charCodeAt(i) ^
            encryptionKey.charCodeAt(i % encryptionKey.length)
        );
    }
    return stringToHex(encrypted);
}