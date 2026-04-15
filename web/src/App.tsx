import { useState } from "react";
import { FileUpload } from "@/components/FileUpload";
import { MetisSearchForm } from "@/components/MetisSearchForm";
import { OffersTable } from "@/components/OffersTable";
import { Filters } from "@/components/Filters";
import type { Offer, OfferDetailData, FilterState, PayloadMode, OfferPriceData } from "@/types";

function ModeSelector({ onSelect }: { onSelect: (m: PayloadMode) => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 space-y-8">
      <h2 className="text-3xl font-bold tracking-tight">
        Choisissez le type de payload
      </h2>
      <p className="text-muted-foreground">
        Sélectionnez le format de réponse Shopping à inspecter
      </p>
      <div className="flex gap-6">
        <button
          onClick={() => onSelect("sabre")}
          className="group rounded-xl border-2 border-muted p-8 w-64 text-center hover:border-primary hover:bg-primary/5 transition-all"
        >
          <div className="text-5xl mb-4">🛩️</div>
          <h3 className="text-xl font-semibold group-hover:text-primary">
            SABRE
          </h3>
          <p className="text-sm text-muted-foreground mt-2">
            GDS Shopping Response
          </p>
        </button>
        <button
          onClick={() => onSelect("metis")}
          className="group rounded-xl border-2 border-muted p-8 w-64 text-center hover:border-primary hover:bg-primary/5 transition-all"
        >
          <div className="text-5xl mb-4">✈️</div>
          <h3 className="text-xl font-semibold group-hover:text-primary">
            METIS
          </h3>
          <p className="text-sm text-muted-foreground mt-2">
            NDC Shopping Response
          </p>
        </button>
      </div>
    </div>
  );
}

function App() {
  const [mode, setMode] = useState<PayloadMode | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [totalOffers, setTotalOffers] = useState(0);
  const [selectedOffer, setSelectedOffer] = useState<OfferDetailData | null>(
    null
  );
  const [fileUploaded, setFileUploaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<FilterState>({
    flight: "",
    cabin: "",
    brand: "",
    sort: "",
  });
  const [metisTab, setMetisTab] = useState<"search" | "upload">("search");
  const [offerPriceData, setOfferPriceData] = useState<OfferPriceData | null>(null);
  const [offerPriceLoading, setOfferPriceLoading] = useState(false);

  const resetState = () => {
    setOffers([]);
    setTotalOffers(0);
    setSelectedOffer(null);
    setFileUploaded(false);
    setFilters({ flight: "", cabin: "", brand: "", sort: "" });
    setOfferPriceData(null);
  };

  const handleModeSelect = (m: PayloadMode) => {
    resetState();
    setMode(m);
  };

  const handleFileUploaded = async () => {
    setFileUploaded(true);
    setSelectedOffer(null);
    setOfferPriceData(null);
    await fetchOffers(filters);
  };

  const fetchOffers = async (f: FilterState) => {
    if (!mode) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (f.flight) params.set("flight", f.flight);
      if (f.cabin) params.set("cabin", f.cabin);
      if (f.brand) params.set("brand", f.brand);
      if (f.sort) params.set("sort", f.sort);
      const res = await fetch(`/api/${mode}/offers?${params}`);
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
    if (!mode) return;
    // Toggle: re-click same offer to close
    if (selectedOffer?.offerId === offerId) {
      setSelectedOffer(null);
      setOfferPriceData(null);
      return;
    }
    setOfferPriceData(null);
    const res = await fetch(
      `/api/${mode}/offers/${encodeURIComponent(offerId)}`
    );
    if (res.ok) {
      const data = await res.json();
      setSelectedOffer(data);
    }
  };

  const handleOfferPrice = async (offerId: string) => {
    setOfferPriceLoading(true);
    setOfferPriceData(null);
    try {
      const res = await fetch(
        `/api/metis/offerPrice/${encodeURIComponent(offerId)}`,
        { method: "POST" }
      );
      if (res.ok) {
        const data = await res.json();
        setOfferPriceData(data);
      } else {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        alert(`OfferPrice error: ${err.error}`);
      }
    } catch (e: unknown) {
      alert(`OfferPrice failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setOfferPriceLoading(false);
    }
  };

  const modeLabel = mode === "sabre" ? "SABRE Shopping" : "METIS NDC Shopping";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Metis</h1>
            <p className="text-sm text-muted-foreground">
              {mode ? `${modeLabel} Debug` : "Shopping Debug"}
            </p>
          </div>
          {mode && (
            <button
              onClick={() => {
                resetState();
                setMode(null);
              }}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Changer de mode
            </button>
          )}
        </div>
      </header>

      <main className="container mx-auto px-6 py-6 space-y-6">
        {!mode ? (
          <ModeSelector onSelect={handleModeSelect} />
        ) : (
          <>
            {mode === "metis" ? (
              <div className="space-y-4">
                <div className="flex gap-2">
                  <button
                    onClick={() => setMetisTab("search")}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${metisTab === "search" ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"}`}
                  >
                    🔍 Recherche live
                  </button>
                  <button
                    onClick={() => setMetisTab("upload")}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${metisTab === "upload" ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"}`}
                  >
                    📁 Charger un fichier
                  </button>
                </div>
                {metisTab === "search" ? (
                  <MetisSearchForm onSearchComplete={handleFileUploaded} />
                ) : (
                  <FileUpload onUploaded={handleFileUploaded} mode={mode} />
                )}
              </div>
            ) : (
              <FileUpload onUploaded={handleFileUploaded} mode={mode} />
            )}

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
                    selectedOfferDetail={selectedOffer}
                    onCloseDetail={() => {
                      setSelectedOffer(null);
                      setOfferPriceData(null);
                    }}
                    onOfferPrice={mode === "metis" ? handleOfferPrice : undefined}
                    offerPriceData={offerPriceData}
                    offerPriceLoading={offerPriceLoading}
                  />
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
