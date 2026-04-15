import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
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
import { Separator } from "@/components/ui/separator";
import type { OfferDetailData, OfferPriceData } from "@/types";

interface OfferDetailProps {
    detail: OfferDetailData;
    onClose: () => void;
    onOfferPrice?: (offerId: string) => void;
    offerPriceData?: OfferPriceData | null;
    offerPriceLoading?: boolean;
    inline?: boolean;
}

export function OfferDetail({ detail, onClose, onOfferPrice, offerPriceData, offerPriceLoading, inline }: OfferDetailProps) {
    const content = (
        <>
            {/* Header */}
            <div className={`flex items-center justify-between ${inline ? "px-6 py-4" : ""}`}>
                <div>
                    <h3 className="text-lg font-semibold">
                        Détails : {detail.offerId}
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                        Compagnie validante : {detail.validatingCarrier}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {onOfferPrice && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); onOfferPrice(detail.offerId); }}
                            disabled={offerPriceLoading}
                        >
                            {offerPriceLoading ? (
                                <span className="flex items-center gap-2">
                                    <span className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
                                    Chargement…
                                </span>
                            ) : offerPriceData ? (
                                "↻ Rafraîchir OfferPrice"
                            ) : (
                                "💰 Obtenir OfferPrice"
                            )}
                        </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onClose(); }}>
                        ✕
                    </Button>
                </div>
            </div>

            <div className={`space-y-6 ${inline ? "px-6 pb-6" : ""}`}>
                {/* Price Summary */}
                <div className="grid grid-cols-3 gap-4">
                    <div className="rounded-lg border p-4 text-center">
                        <p className="text-sm text-muted-foreground">Total</p>
                        <p className="text-2xl font-bold">{detail.totalPrice}</p>
                    </div>
                    <div className="rounded-lg border p-4 text-center">
                        <p className="text-sm text-muted-foreground">Base</p>
                        <p className="text-lg font-medium">{detail.baseFare}</p>
                    </div>
                    <div className="rounded-lg border p-4 text-center">
                        <p className="text-sm text-muted-foreground">Taxes</p>
                        <p className="text-lg font-medium">{detail.taxes}</p>
                    </div>
                </div>

                <Separator />

                {/* Itinerary */}
                <div>
                    <h3 className="font-semibold mb-3">Itinéraire</h3>
                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Route</TableHead>
                                    <TableHead>Vols</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {detail.itinerary.map((row, i) => (
                                    <TableRow key={i}>
                                        <TableCell className="font-mono text-sm">
                                            {row.date}
                                        </TableCell>
                                        <TableCell className="font-medium">{row.route}</TableCell>
                                        <TableCell className="text-sm">{row.flights}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </div>

                <Separator />

                {/* Passenger Details */}
                <div>
                    <h3 className="font-semibold mb-3">
                        Passagers & Conditions Tarifaires
                    </h3>
                    <div className="space-y-4">
                        {detail.passengers.map((pax, i) => (
                            <div key={i} className="rounded-lg border p-4 space-y-3">
                                <div className="flex items-center gap-3">
                                    <Badge>{pax.paxType}</Badge>
                                    <span className="text-sm text-muted-foreground">
                                        ×{pax.paxCount}
                                    </span>
                                    <span className="text-sm font-medium">{pax.route}</span>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                                    {/* Baggage */}
                                    <div>
                                        <p className="font-medium text-xs uppercase text-muted-foreground mb-1">
                                            Bagages
                                        </p>
                                        {pax.baggage.map((b, bi) => (
                                            <p key={bi}>{b}</p>
                                        ))}
                                    </div>

                                    {/* Fare Details */}
                                    <div>
                                        <p className="font-medium text-xs uppercase text-muted-foreground mb-1">
                                            Tarif
                                        </p>
                                        {pax.fareDetails ? (
                                            <div className="space-y-1">
                                                <p>
                                                    <span className="text-muted-foreground">Basis:</span>{" "}
                                                    {pax.fareDetails.fareBasisCode}
                                                </p>
                                                <p>
                                                    <span className="text-muted-foreground">Brand:</span>{" "}
                                                    {pax.fareDetails.brandName} ({pax.fareDetails.brandCode})
                                                </p>
                                                <p>
                                                    <span className="text-muted-foreground">Cabin:</span>{" "}
                                                    {pax.fareDetails.cabinCode} (Cls:{" "}
                                                    {pax.fareDetails.bookingCode})
                                                </p>
                                                {pax.fareDetails.services.length > 0 && (
                                                    <div className="mt-2">
                                                        <p className="text-muted-foreground text-xs">
                                                            Services :
                                                        </p>
                                                        <ul className="list-disc list-inside text-xs space-y-0.5">
                                                            {pax.fareDetails.services.map((s, si) => (
                                                                <li key={si}>{s}</li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <p className="text-muted-foreground">N/A</p>
                                        )}
                                    </div>

                                    {/* Penalties */}
                                    <div>
                                        <p className="font-medium text-xs uppercase text-muted-foreground mb-1">
                                            Pénalités
                                        </p>
                                        {pax.penalties.map((pen, pi) => (
                                            <p key={pi}>
                                                <span className="font-medium">{pen.type}</span>
                                                {pen.applicability && (
                                                    <span className="text-muted-foreground">
                                                        {" "}
                                                        ({pen.applicability})
                                                    </span>
                                                )}
                                                {pen.amount && (
                                                    <span>
                                                        :{" "}
                                                        <span
                                                            className={
                                                                pen.amount === "Free"
                                                                    ? "text-green-600"
                                                                    : pen.amount === "Not Allowed"
                                                                        ? "text-destructive"
                                                                        : ""
                                                            }
                                                        >
                                                            {pen.amount}
                                                        </span>
                                                    </span>
                                                )}
                                            </p>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* OfferPrice Data */}
                {offerPriceData && (
                    <>
                        <Separator />
                        <div>
                            <h3 className="font-semibold mb-3 text-primary">
                                OfferPrice — Détails complémentaires
                            </h3>

                            {/* Expiration & Payment Limit */}
                            <div className="grid grid-cols-2 gap-4 mb-4">
                                {offerPriceData.offerExpiration && (
                                    <div className="rounded-lg border p-3 text-center">
                                        <p className="text-xs text-muted-foreground uppercase">Expiration offre</p>
                                        <p className="font-medium text-sm">
                                            {new Date(offerPriceData.offerExpiration).toLocaleString("fr-FR")}
                                        </p>
                                    </div>
                                )}
                                {offerPriceData.paymentTimeLimit && (
                                    <div className="rounded-lg border p-3 text-center">
                                        <p className="text-xs text-muted-foreground uppercase">Limite paiement</p>
                                        <p className="font-medium text-sm">
                                            {new Date(offerPriceData.paymentTimeLimit).toLocaleString("fr-FR")}
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* Per-pax pricing from OrderItems */}
                            {offerPriceData.orderItems.length > 0 && (
                                <div className="mb-4">
                                    <p className="font-medium text-xs uppercase text-muted-foreground mb-2">
                                        Tarification par passager
                                    </p>
                                    <div className="rounded-md border">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Passager</TableHead>
                                                    <TableHead>Total</TableHead>
                                                    <TableHead>Taxes</TableHead>
                                                    <TableHead>Base</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {offerPriceData.orderItems.map((item, i) => (
                                                    <TableRow key={i}>
                                                        <TableCell>{item.paxRefId.join(", ")}</TableCell>
                                                        <TableCell className="font-medium">
                                                            {item.totalAmount.toFixed(2)} {offerPriceData.conditionCurrency}
                                                        </TableCell>
                                                        <TableCell>
                                                            {item.totalTaxAmount.toFixed(2)} {offerPriceData.conditionCurrency}
                                                        </TableCell>
                                                        <TableCell>
                                                            {(item.totalAmount - item.totalTaxAmount).toFixed(2)} {offerPriceData.conditionCurrency}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </div>
                            )}

                            {/* Conditions */}
                            {offerPriceData.conditions.length > 0 && (
                                <div className="mb-4">
                                    <p className="font-medium text-xs uppercase text-muted-foreground mb-2">
                                        Conditions ({offerPriceData.conditionCurrency})
                                    </p>
                                    <div className="rounded-md border">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Type</TableHead>
                                                    <TableHead>Période</TableHead>
                                                    <TableHead>Autorisé</TableHead>
                                                    <TableHead>Prix</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {offerPriceData.conditions.map((cond, i) => {
                                                    const dateLabels: Record<string, string> = {
                                                        PDE: "Avant départ",
                                                        ADE: "Après départ",
                                                        NOS: "No-Show",
                                                    };
                                                    return (
                                                        <TableRow key={i}>
                                                            <TableCell className="font-medium">{cond.title}</TableCell>
                                                            <TableCell>{dateLabels[cond.date] || cond.date}</TableCell>
                                                            <TableCell>
                                                                <span className={cond.available ? "text-green-600" : "text-destructive"}>
                                                                    {cond.available ? "Oui" : "Non"}
                                                                </span>
                                                            </TableCell>
                                                            <TableCell>
                                                                {cond.price
                                                                    ? `${cond.price} ${offerPriceData.conditionCurrency}`
                                                                    : cond.available
                                                                        ? "Gratuit"
                                                                        : "—"}
                                                            </TableCell>
                                                        </TableRow>
                                                    );
                                                })}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </div>
                            )}

                            {/* Baggage */}
                            {offerPriceData.baggage.length > 0 && (
                                <div className="mb-4">
                                    <p className="font-medium text-xs uppercase text-muted-foreground mb-2">
                                        Bagages (OfferPrice)
                                    </p>
                                    <div className="flex gap-3 flex-wrap">
                                        {offerPriceData.baggage.map((bag, i) => (
                                            <div key={i} className="rounded-lg border p-3 text-sm">
                                                <p className="font-medium">
                                                    {bag.type === "Checked" ? "Soute" : bag.type === "CarryOn" ? "Cabine" : bag.type}
                                                </p>
                                                <p>{bag.pieces} pièce{bag.pieces !== 1 ? "s" : ""}</p>
                                                {bag.weights.length > 0 && (
                                                    <p className="text-muted-foreground">{bag.weights.join(", ")}</p>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Payment Methods */}
                            {offerPriceData.paymentMethods.length > 0 && (
                                <div className="mb-4">
                                    <p className="font-medium text-xs uppercase text-muted-foreground mb-2">
                                        Moyens de paiement acceptés
                                    </p>
                                    <div className="flex gap-2 flex-wrap">
                                        {offerPriceData.paymentMethods.map((pm, i) => (
                                            <Badge key={i} variant="secondary">{pm}</Badge>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Remarks */}
                            {offerPriceData.remarks.length > 0 && (
                                <div>
                                    <p className="font-medium text-xs uppercase text-muted-foreground mb-2">
                                        Remarques
                                    </p>
                                    <div className="rounded-lg border p-4 text-sm space-y-1 max-h-60 overflow-y-auto">
                                        {offerPriceData.remarks.map((remark, i) => (
                                            <p key={i} className={remark.match(/^\d+\./) ? "font-medium mt-2" : "text-muted-foreground"}>
                                                {remark}
                                            </p>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </>
    );

    if (inline) {
        return <div className="bg-muted/30">{content}</div>;
    }

    return (
        <Card id="offer-detail">
            <CardContent className="pt-6">
                {content}
            </CardContent>
        </Card>
    );
}
