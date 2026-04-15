import { useState } from "react";
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
import type { Offer } from "@/types";

const PAGE_SIZE = 25;

interface OffersTableProps {
    offers: Offer[];
    onSelectOffer: (offerId: string) => void;
    selectedOfferId?: string;
}

export function OffersTable({
    offers,
    onSelectOffer,
    selectedOfferId,
}: OffersTableProps) {
    const [page, setPage] = useState(0);
    const totalPages = Math.ceil(offers.length / PAGE_SIZE);
    const pageOffers = offers.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

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
                            <TableHead>Prix</TableHead>
                            <TableHead>Compagnie</TableHead>
                            <TableHead>Cabine</TableHead>
                            <TableHead>Brand</TableHead>
                            <TableHead>Départ</TableHead>
                            <TableHead>Route</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {pageOffers.map((offer, idx) => (
                            <TableRow
                                key={offer.offerId}
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
