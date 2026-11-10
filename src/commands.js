// The slash commands. The bot adds/updates these with Discord by itself when
// they change (see app.js), so editing this file is all that's needed.
//
// Every name box suggests matches as you type (from the website's search), so
// new vehicles, weapons, maps... show up without changing anything here.

// Works in servers, in DMs with the bot, and anywhere for people who added the
// bot to their own account ("user install")
const EVERYWHERE = { integration_types: [0, 1], contexts: [0, 1, 2] };

const nameOption = (description, required = true, name = "name") => ({
  type: 3, // text
  name,
  description,
  required,
  autocomplete: true,
});

// command name -> which card types its name box searches
export const CARD_COMMANDS = {
  vehicle: ["vehicle"],
  weapon: ["weapon"],
  kit: ["kit"],
  faction: ["faction"],
  map: ["map"],
  layer: ["layer"],
  emplacement: ["emplacement"],
  find: null, // everything
};

// /compare sub-commands -> card type
export const COMPARE_KINDS = { weapons: "weapon", vehicles: "vehicle", factions: "faction" };

const compareSub = (name, what) => ({
  type: 1, // sub-command
  name,
  description: `Compare ${what} side by side`,
  options: [
    nameOption(`First ${what.replace(/s$/, "")}`, true, "first"),
    nameOption(`Second ${what.replace(/s$/, "")}`, true, "second"),
    nameOption(`Third ${what.replace(/s$/, "")} (optional)`, false, "third"),
  ],
});

export const COMMANDS = [
  { name: "vehicle", description: "Stats, weapons and factions for a vehicle", options: [nameOption("Vehicle name, e.g. M1A2")] },
  { name: "weapon", description: "Damage, fire rate and kits for a weapon", options: [nameOption("Weapon name, e.g. AK-74M")] },
  { name: "kit", description: "A kit's loadout and team limit", options: [nameOption("Kit name and faction, e.g. Medic USA")] },
  { name: "faction", description: "A faction setup's vehicles, weapons and kits", options: [nameOption("Unit or faction, e.g. 1st Infantry Division")] },
  { name: "map", description: "A map's minimap and layers", options: [nameOption("Map name, e.g. Narva")] },
  { name: "layer", description: "A layer's minimap, tickets and teams", options: [nameOption("Layer, e.g. Narva RAAS v1")] },
  { name: "emplacement", description: "Build cost and health of a FOB emplacement", options: [nameOption("Emplacement name, e.g. HAB")] },
  { name: "find", description: "Search everything: vehicles, weapons, kits, factions, maps...", options: [nameOption("What are you looking for?", true, "search")] },
  {
    name: "compare",
    description: "Compare weapons, vehicles or factions side by side",
    options: [compareSub("weapons", "weapons"), compareSub("vehicles", "vehicles"), compareSub("factions", "factions")],
  },
  { name: "controls", description: "Squad's keyboard controls" },
  { name: "help", description: "How to use the bot" },
  { name: "info", description: "About the bot, the data version and credits" },
  { name: "ping", description: "Check the bot is awake" },
].map((command) => ({ type: 1, ...command, ...EVERYWHERE }));
