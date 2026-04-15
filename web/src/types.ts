export interface Offer {
    offerId: string;
    price: string;
    priceAmount: number;
    currency: string;
    company: string;
    fareBasis: string;
    cabin: string;
    brand: string;
    directions: { label: string; segments: string[] }[];
    departureTime: string;
    departureTimesByDirection: string[];
}

export interface OfferDetailData {
    offerId: string;
    validatingCarrier: string;
    totalPrice: string;
    baseFare: string;
    taxes: string;
    currency: string;
    itinerary: {
        date: string;
        route: string;
        flights: string;
    }[];
    passengers: {
        paxType: string;
        paxCount: number;
        route: string;
        baggage: string[];
        fareDetails: {
            fareBasisCode: string;
            brandName: string;
            brandCode: string;
            cabinCode: string;
            bookingCode: string;
            services: string[];
        } | null;
        penalties: {
            type: string;
            applicability: string;
            amount: string;
        }[];
    }[];
}

export interface FilterState {
    flight: string;
    cabin: string;
    brand: string;
    sort: string;
}

export type PayloadMode = "sabre" | "metis";
