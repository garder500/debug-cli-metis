import { useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { PayloadMode } from "@/types";

interface FileUploadProps {
    onUploaded: () => void;
    mode: PayloadMode;
}

export function FileUpload({ onUploaded, mode }: FileUploadProps) {
    const [dragging, setDragging] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [fileName, setFileName] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const uploadFile = useCallback(
        async (file: File) => {
            setUploading(true);
            setError(null);
            try {
                const formData = new FormData();
                formData.append("file", file);
                const res = await fetch(`/api/${mode}/upload`, {
                    method: "POST",
                    body: formData,
                });
                const data = await res.json();
                if (!res.ok) {
                    setError(data.error || "Upload failed");
                    return;
                }
                setFileName(file.name);
                onUploaded();
            } catch {
                setError("Network error");
            } finally {
                setUploading(false);
            }
        },
        [onUploaded, mode]
    );

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) uploadFile(file);
        },
        [uploadFile]
    );

    const handleFileInput = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (file) uploadFile(file);
        },
        [uploadFile]
    );

    const label = mode === "sabre" ? "SABRE Shopping" : "Metis NDC Shopping";

    return (
        <Card>
            <CardContent className="pt-6">
                <div
                    className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${dragging
                        ? "border-primary bg-primary/5"
                        : "border-muted-foreground/25 hover:border-primary/50"
                        }`}
                    onDragOver={(e) => {
                        e.preventDefault();
                        setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={handleDrop}
                >
                    <div className="space-y-3">
                        <div className="text-4xl">📂</div>
                        <div>
                            <p className="font-medium">
                                {fileName
                                    ? `Fichier chargé : ${fileName}`
                                    : `Glissez un fichier JSON ${label} ici`}
                            </p>
                            <p className="text-sm text-muted-foreground mt-1">
                                ou cliquez pour sélectionner
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            disabled={uploading}
                            onClick={() =>
                                document.getElementById("file-input")?.click()
                            }
                        >
                            {uploading ? "Chargement..." : "Choisir un fichier"}
                        </Button>
                        <input
                            id="file-input"
                            type="file"
                            accept=".json"
                            className="hidden"
                            onChange={handleFileInput}
                        />
                    </div>
                    {error && (
                        <p className="text-destructive text-sm mt-3">{error}</p>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
