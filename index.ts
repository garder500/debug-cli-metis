import prompts from "prompts";
import Table from "cli-table3";
import ansiEscapes from "ansi-escapes";
import { collectSabreOffers, handleSabreShopping, OfferInfo } from "./src/commands/sabreShopping";
import { displayOfferDetails } from "./src/commands/sabreOfferDetails";

const DEFAULT_SAMPLE_FILE =
  "SABRE_IMPACT-Parrot_PAX1_NA_AIRSHOPPING_RS_2026-02-02_14-39-27-156.json";

async function main() {
  const args = Bun.argv.slice(2);

  if (args.length === 0 || args[0] === "interactive") {
    await runInteractive();
    return;
  }

  const [command, subcommand, ...rest] = args;

  switch (command) {
    case "sabre":
      switch (subcommand) {
        case "shopping":
          const fileIndex = rest.indexOf("--file");
          if (fileIndex === -1 || fileIndex + 1 >= rest.length) {
            console.error("Error: --file argument missing or incomplete");
            return;
          }
          const filename = rest[fileIndex + 1];

          const flightIndex = rest.indexOf("--flight");
          let flightFilter: string | undefined;
          if (flightIndex !== -1 && flightIndex + 1 < rest.length) {
            flightFilter = rest[flightIndex + 1];
          }

          const brandIndex = rest.indexOf("--brand");
          let brandFilter: string | undefined;
          if (brandIndex !== -1 && brandIndex + 1 < rest.length) {
            brandFilter = rest[brandIndex + 1];
          }

          const offerIndex = rest.indexOf("--offer");
          let offerId: string | undefined;
          if (offerIndex !== -1 && offerIndex + 1 < rest.length) {
            offerId = rest[offerIndex + 1];
          }

          const sortIndex = rest.indexOf("--sort");
          let sortBy: string | undefined;
          if (sortIndex !== -1 && sortIndex + 1 < rest.length) {
            sortBy = rest[sortIndex + 1];
          }

          await handleSabreShopping(filename, { flightFilter, brandFilter, offerId, sortBy });
          break;
        default:
          printUsage();
          break;
      }
      break;
    default:
      printUsage();
      break;
  }
}

function renderOffersTable(offers: OfferInfo[], offset: number) {
  const table = new Table({
    head: ["#", "Offer ID", "Départs", "Route", "Prix", "Cie", "Brand"],
    wordWrap: true,
  });

  offers.forEach((offer, index) => {
    const route = offer.directions.map((dir) => dir.label).join(" | ");
    const departures = offer.departureTimesByDirection.join(" | ");
    table.push([
      offset + index + 1,
      offer.offerId,
      departures,
      route,
      offer.price,
      offer.company,
      offer.brand || "N/A",
    ]);
  });

  return table.toString();
}

function clearScreen() {
  if (process.stdout.isTTY) {
    process.stdout.write(ansiEscapes.clearScreen);
  }
}

async function paginateOffers(
  offers: OfferInfo[],
  groupedItineraryResponse: { itineraryGroups?: unknown[] },
  maps: Parameters<typeof displayOfferDetails>[2]
): Promise<"search" | "exit"> {
  const pageSize = 25;
  let page = 0;

  while (true) {
    const totalPages = Math.max(1, Math.ceil(offers.length / pageSize));
    if (page < 0) page = 0;
    if (page >= totalPages) page = totalPages - 1;

    const start = page * pageSize;
    const end = Math.min(start + pageSize, offers.length);
    const pageSlice = offers.slice(start, end);

    clearScreen();
    console.log(`Résultats ${start + 1}-${end} / ${offers.length} (page ${page + 1}/${totalPages})`);
    console.log(renderOffersTable(pageSlice, start));

    const action = await prompts(
      {
        type: "select",
        name: "action",
        message: "Actions",
        choices: [
          { title: "Page suivante", value: "next", disabled: page >= totalPages - 1 },
          { title: "Page précédente", value: "prev", disabled: page <= 0 },
          { title: "Voir détail par numéro (#)", value: "detailNumber" },
          { title: "Voir détail par ID", value: "detailId" },
          { title: "Nouvelle recherche", value: "search" },
          { title: "Quitter", value: "exit" },
        ],
        initial: 0,
      },
      {
        onCancel: () => false,
      }
    );

    if (action.action === "next") {
      page += 1;
      continue;
    }
    if (action.action === "prev") {
      page -= 1;
      continue;
    }
    if (action.action === "detailNumber") {
      const pick = await prompts(
        {
          type: "text",
          name: "value",
          message: "Numéro d'offre (#)",
        },
        {
          onCancel: () => false,
        }
      );

      const index = Number.parseInt(String(pick.value || ""), 10);
      if (!Number.isNaN(index) && index >= 1 && index <= offers.length) {
        const offer = offers[index - 1];
        displayOfferDetails(
          offer.offerId,
          groupedItineraryResponse.itineraryGroups,
          maps
        );
        await prompts({
          type: "text",
          name: "continue",
          message: "Appuie sur Entrée pour revenir à la liste",
        });
      } else {
        console.log("Numéro invalide.");
      }
      continue;
    }
    if (action.action === "detailId") {
      const pick = await prompts(
        {
          type: "text",
          name: "value",
          message: "ID d'offre",
        },
        {
          onCancel: () => false,
        }
      );
      if (pick.value) {
        displayOfferDetails(
          pick.value,
          groupedItineraryResponse.itineraryGroups,
          maps
        );
        await prompts({
          type: "text",
          name: "continue",
          message: "Appuie sur Entrée pour revenir à la liste",
        });
      }
      continue;
    }
    if (action.action === "search") {
      return "search";
    }
    if (action.action === "exit") {
      return "exit";
    }
  }
}

async function runInteractive() {
  console.log("Metis - Sabre Shopping (mode interactif)");

  let continueSearch = true;
  let lastFile = DEFAULT_SAMPLE_FILE;
  let lastFlight = "";
  let lastBrand = "";
  let lastSort: "departureTime" | "" = "";

  while (continueSearch) {
    const answers = await prompts(
      [
        {
          type: "text",
          name: "file",
          message: "Chemin du fichier JSON Sabre",
          initial: lastFile,
        },
        {
          type: "text",
          name: "flight",
          message: "Filtre numéro de vol (ex: AF123) - optionnel",
          initial: lastFlight,
        },
        {
          type: "text",
          name: "brand",
          message: "Filtre brand - optionnel",
          initial: lastBrand,
        },
        {
          type: "select",
          name: "sort",
          message: "Tri des résultats",
          choices: [
            { title: "Aucun", value: "" },
            { title: "Heure de départ", value: "departureTime" },
          ],
          initial: lastSort === "departureTime" ? 1 : 0,
        },
      ],
      {
        onCancel: () => {
          continueSearch = false;
          return false;
        },
      }
    );

    if (!continueSearch || !answers.file) {
      break;
    }

    lastFile = answers.file;
    lastFlight = answers.flight || "";
    lastBrand = answers.brand || "";
    lastSort = answers.sort || "";

    try {
      const { offers, maps, groupedItineraryResponse } = await collectSabreOffers(answers.file, {
        flightFilter: answers.flight || undefined,
        brandFilter: answers.brand || undefined,
        sortBy: answers.sort || undefined,
      });

      if (offers.length === 0) {
        console.log("Aucune offre trouvée avec ces filtres.");
        const nextAction = await prompts(
          {
            type: "select",
            name: "action",
            message: "Que souhaitez-vous faire ?",
            choices: [
              { title: "Nouvelle recherche", value: "search" },
              { title: "Quitter", value: "exit" },
            ],
            initial: 0,
          },
          {
            onCancel: () => {
              continueSearch = false;
              return false;
            },
          }
        );

        if (nextAction.action === "exit") {
          continueSearch = false;
        }
      } else {
        const paginationAction = await paginateOffers(
          offers,
          groupedItineraryResponse,
          maps
        );

        if (paginationAction === "exit") {
          continueSearch = false;
        }
      }
    } catch (error) {
      console.error("Erreur:", error);
      continueSearch = false;
    }
  }
}

function printUsage() {
  console.error("Usage: metis-db <command> <subcommand> [options]");
  console.error("Commands:");
  console.error("  sabre shopping --file <filename> [--flight <code] [--brand <name>] [--offer <id>] [--sort <field>]");
  console.error("  interactive");
  console.error("    --flight: Filter by flight number (e.g. AF123)");
  console.error("    --brand:  Filter by brand name (e.g. Standard)");
  console.error("    --offer:  Show detailed tariff conditions for a specific Offer ID");
  console.error("    --sort:   Sort results. Currently only 'departureTime' is supported.");
}

main();
