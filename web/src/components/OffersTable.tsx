import { useState, useMemo, Fragment } from "react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OfferDetail } from "@/components/OfferDetail";
import type { Offer, OfferDetailData, OfferPriceData } from "@/types";

const PAGE_SIZE = 25;

type SortKey = "price" | "company" | "cabin" | "brand" | "departure";
type SortDir = "asc" | "desc";
type SortEntry = { key: SortKey; dir: SortDir };

interface OffersTableProps {
    offers: Offer[];
    onSelectOffer: (offerId: string) => void;
    selectedOfferId?: string;
    selectedOfferDetail?: OfferDetailData | null;
    onCloseDetail?: () => void;
    onOfferPrice?: (offerId: string) => void;
    offerPriceData?: OfferPriceData | null;
    offerPriceLoading?: boolean;
}

function SortArrow({ entry, rank }: { entry?: SortEntry; rank?: number }) {
    if (!entry) return <span className="ml-1 text-muted-foreground/40">↕</span>;
    return (
        <span className="ml-1">
            {entry.dir === "asc" ? "↑" : "↓"}
            {rank !== undefined && rank > 0 && (
                <span className="text-[10px] text-muted-foreground ml-0.5">{rank + 1}</span>
            )}
        </span>
    );
}

function compareField(a: Offer, b: Offer, key: SortKey): number {
    switch (key) {
        case "price": return a.priceAmount - b.priceAmount;
        case "company": return a.company.localeCompare(b.company);
        case "cabin": return a.cabin.localeCompare(b.cabin);
        case "brand": return a.brand.localeCompare(b.brand);
        case "departure": return a.departureTime.localeCompare(b.departureTime);
    }
}

export function OffersTable({
    offers,
    onSelectOffer,
    selectedOfferId,
    selectedOfferDetail,
    onCloseDetail,
    onOfferPrice,
    offerPriceData,
    offerPriceLoading,
}: OffersTableProps) {
    const [page, setPage] = useState(0);
    const [sorts, setSorts] = useState<SortEntry[]>([]);

    const handleSort = (key: SortKey, multi: boolean) => {
        setSorts((prev) => {
            const idx = prev.findIndex((s) => s.key === key);
            if (idx >= 0) {
                const entry = prev[idx];
                if (entry.dir === "asc") {
                    const next = [...prev];
                    next[idx] = { key, dir: "desc" };
                    return next;
                }
                // third click: remove this sort
                return prev.filter((_, i) => i !== idx);
            }
            // new column
            if (multi) return [...prev, { key, dir: "asc" }];
            return [{ key, dir: "asc" }];
        });
        setPage(0);
    };

    const sorted = useMemo(() => {
        if (sorts.length === 0) return offers;
        const copy = [...offers];
        copy.sort((a, b) => {
            for (const { key, dir } of sorts) {
                const cmp = compareField(a, b, key);
                if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
            }
            return 0;
        });
        return copy;
    }, [offers, sorts]);

    const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
    const pageOffers = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    if (offers.length === 0) {
        return (
            <div className="text-center py-12 text-muted-foreground">
                Aucune offre trouvée avec ces filtres.
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-12">#</TableHead>
                            <TableHead>Offer ID</TableHead>
                            {(["price", "company", "cabin", "brand", "departure"] as SortKey[]).map((key) => {
                                const labels: Record<SortKey, string> = { price: "Prix", company: "Compagnie", cabin: "Cabine", brand: "Brand", departure: "Départ" };
                                const idx = sorts.findIndex((s) => s.key === key);
                                return (
                                    <TableHead
                                        key={key}
                                        className="cursor-pointer select-none hover:text-foreground"
                                        onClick={(e) => handleSort(key, e.shiftKey)}
                                    >
                                        {labels[key]}
                                        <SortArrow entry={idx >= 0 ? sorts[idx] : undefined} rank={sorts.length > 1 ? idx : undefined} />
                                    </TableHead>
                                );
                            })}
                            <TableHead>Route</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {pageOffers.map((offer, idx) => (
                            <Fragment key={offer.offerId}>
                                <TableRow
                                    className={`cursor-pointer transition-colors ${selectedOfferId === offer.offerId
                                        ? "bg-primary/10"
                                        : "hover:bg-muted/50"
                                        }`}
                                    onClick={() => onSelectOffer(offer.offerId)}
                                >
                                    <TableCell className="font-mono text-xs text-muted-foreground">
                                        {page * PAGE_SIZE + idx + 1}
                                    </TableCell>
                                    <TableCell className="font-mono text-xs max-w-[180px] truncate">
                                        {offer.offerId}
                                    </TableCell>
                                    <TableCell className="font-semibold whitespace-nowrap">
                                        {offer.price}
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="outline">{offer.company}</Badge>
                                    </TableCell>
                                    <TableCell>
                                        {offer.cabin && (
                                            <Badge variant="default">{offer.cabin}</Badge>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        {offer.brand && (
                                            <Badge variant="secondary">{offer.brand}</Badge>
                                        )}
                                    </TableCell>
                                    <TableCell className="whitespace-nowrap text-sm">
                                        {offer.departureTimesByDirection.join(" | ")}
                                    </TableCell>
                                    <TableCell className="text-sm max-w-[300px]">
                                        {offer.directions.map((dir, di) => (
                                            <div key={di} className="text-xs">
                                                <span className="font-medium">{dir.label}</span>
                                            </div>
                                        ))}
                                    </TableCell>
                                </TableRow>
                                {selectedOfferId === offer.offerId && selectedOfferDetail && (
                                    <TableRow key={`${offer.offerId}-detail`}>
                                        <TableCell colSpan={8} className="p-0 border-b-2 border-primary/20">
                                            <OfferDetail
                                                detail={selectedOfferDetail}
                                                onClose={onCloseDetail || (() => { })}
                                                onOfferPrice={onOfferPrice}
                                                offerPriceData={offerPriceData}
                                                offerPriceLoading={offerPriceLoading}
                                                inline
                                            />
                                        </TableCell>
                                    </TableRow>
                                )}
                            </Fragment>
                        ))}
                    </TableBody>
                </Table>
            </div>

            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page === 0}
                        onClick={() => setPage((p) => p - 1)}
                    >
                        ← Précédent
                    </Button>
                    <span className="text-sm text-muted-foreground px-3">
                        Page {page + 1} / {totalPages}
                    </span>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= totalPages - 1}
                        onClick={() => setPage((p) => p + 1)}
                    >
                        Suivant →
                    </Button>
                </div>
            )}
        </div>
    );
}
