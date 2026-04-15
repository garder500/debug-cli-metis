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
import type { OfferDetailData } from "@/types";

interface OfferDetailProps {
    detail: OfferDetailData;
    onClose: () => void;
}

export function OfferDetail({ detail, onClose }: OfferDetailProps) {
    return (
        <Card id="offer-detail">
            <CardHeader className="flex flex-row items-center justify-between">
                <div>
                    <CardTitle className="text-lg">
                        Détails : {detail.offerId}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">
                        Compagnie validante : {detail.validatingCarrier}
                    </p>
                </div>
                <Button variant="ghost" size="sm" onClick={onClose}>
                    ✕
                </Button>
            </CardHeader>
            <CardContent className="space-y-6">
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
            </CardContent>
        </Card>
    );
}
