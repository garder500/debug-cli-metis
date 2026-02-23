import type { components } from "./shopping";

export type GroupedItineraryResponse = components["schemas"]["GroupedItineraryResponse"]["groupedItineraryResponse"];
// The generated file has GroupedItineraryResponse containing groupedItineraryResponse property.
// But the JSON root object matches components["schemas"]["GroupedItineraryResponse"].
// Wait. "groupedItineraryResponse": { ... }
// If I readJsonFile<Root>, Root should be components["schemas"]["GroupedItineraryResponse"].
// And then I access content.groupedItineraryResponse.

export type Root = components["schemas"]["GroupedItineraryResponse"];

export type ScheduleDesc = components["schemas"]["ScheduleDescType"];
export type LegDesc = components["schemas"]["LegType"];
export type FareComponentDesc = components["schemas"]["FareComponentType"];
export type BaggageAllowanceDesc = components["schemas"]["BaggageAllowanceType"];
export type BaggageChargeDesc = components["schemas"]["BaggageChargeType"];
export type PriceClassDescription = components["schemas"]["PriceClassDescriptionsType"];
export type Itinerary = components["schemas"]["ItineraryType"];
export type GroupDescription = components["schemas"]["GroupDescription"];
export type ItineraryGroup = components["schemas"]["ItineraryGroupType"];
export type Offer = components["schemas"]["Offer"];
export type TotalFare = components["schemas"]["TotalFareType"];
export type PricingInformation = components["schemas"]["PricingInformationType"];
export type PassengerInfoListElement = components["schemas"]["PassengerInfoListElementType"];