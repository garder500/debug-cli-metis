import { useState } from "react";
import { FileUpload } from "@/components/FileUpload";
import { OffersTable } from "@/components/OffersTable";
import { OfferDetail } from "@/components/OfferDetail";
import { Filters } from "@/components/Filters";
import type { Offer, OfferDetailData, FilterState } from "@/types";

function App() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [totalOffers, setTotalOffers] = useState(0);
  const [selectedOffer, setSelectedOffer] = useState<OfferDetailData | null>(
    null
  );
  const [fileUploaded, setFileUploaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<FilterState>({
    flight: "",
    brand: "",
    sort: "",
  });

  const handleFileUploaded = async () => {
    setFileUploaded(true);
    setSelectedOffer(null);
    await fetchOffers(filters);
  };

  const fetchOffers = async (f: FilterState) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (f.flight) params.set("flight", f.flight);
      if (f.brand) params.set("brand", f.brand);
      if (f.sort) params.set("sort", f.sort);
      const res = await fetch(`/api/sabre/offers?${params}`);
      const data = await res.json();
      setOffers(data.offers || []);
      setTotalOffers(data.total || 0);
    } finally {
      setLoading(false);
    }
  };

  const handleFiltersChange = async (f: FilterState) => {
    setFilters(f);
    if (fileUploaded) await fetchOffers(f);
  };

  const handleSelectOffer = async (offerId: string) => {
    const res = await fetch(
      `/api/sabre/offers/${encodeURIComponent(offerId)}`
    );
    if (res.ok) {
      const data = await res.json();
      setSelectedOffer(data);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-6 py-4">
          <h1 className="text-2xl font-bold tracking-tight">Metis</h1>
          <p className="text-sm text-muted-foreground">
            SABRE Shopping Debug
          </p>
        </div>
      </header>

      <main className="container mx-auto px-6 py-6 space-y-6">
        <FileUpload onUploaded={handleFileUploaded} />

        {fileUploaded && (
          <>
            <Filters filters={filters} onChange={handleFiltersChange} />
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {totalOffers} offre{totalOffers !== 1 ? "s" : ""} trouvée
                {totalOffers !== 1 ? "s" : ""}
              </p>
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : (
              <OffersTable
                offers={offers}
                onSelectOffer={handleSelectOffer}
                selectedOfferId={selectedOffer?.offerId}
              />
            )}
            {selectedOffer && (
              <OfferDetail
                detail={selectedOffer}
                onClose={() => setSelectedOffer(null)}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
