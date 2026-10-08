/**
 * Curated game-settings schema. Only keys documented by Funcom or verified in shipped templates are
 * listed with `verified: true`; community-sourced keys are flagged so the UI can label them.
 * Any key present in the actual files but not listed here is still editable (auto-discovered).
 */
export type FieldType = "bool" | "bool01" | "number" | "int" | "string" | "secret" | "enum" | "partitions" | "list" | "boolLower";

export interface FieldDef {
  file: "UserEngine.ini" | "UserGame.ini" | "UserServerCustomSettings.ini";
  section?: string; // omit = find wherever the key lives in the file
  fallbackSection?: string; // where to add the key if the file doesn't contain it yet
  key: string;
  label: string;
  description: string;
  category: Category;
  type: FieldType;
  default: string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  quote?: boolean;
  verified: boolean;
  danger?: boolean;
  clientSide?: boolean;
}

export type Category =
  | "Server"
  | "Progression & XP"
  | "Rates & Economy"
  | "Crafting & Inventory"
  | "Survival"
  | "World & Hazards"
  | "Building"
  | "PvP & Combat"
  | "Guilds & Social"
  | "Admin (experimental)"
  | "Persistence"
  | "Advanced";

export const CATEGORIES: { id: Category; blurb: string }[] = [
  { id: "Server", blurb: "Identity, access and ports" },
  { id: "Progression & XP", blurb: "XP, fame and talent unlock speed" },
  { id: "Rates & Economy", blurb: "Spice and resource harvest multipliers" },
  { id: "Crafting & Inventory", blurb: "Craft speed, carry capacity, durability" },
  { id: "Survival", blurb: "Thirst, health and reconnect rules" },
  { id: "World & Hazards", blurb: "Sandworms, sandstorms and the Coriolis cycle" },
  { id: "Building", blurb: "Land claims, fiefs and building limits" },
  { id: "PvP & Combat", blurb: "PvP rules and damage multipliers" },
  { id: "Guilds & Social", blurb: "Guild sizes and costs" },
  { id: "Persistence", blurb: "Wipes, decay and base backups" },
  { id: "Admin (experimental)", blurb: "In-game admin login, GM commands, BattlEye" },
  { id: "Advanced", blurb: "Every other key found in your files" },
];

const CV = "ConsoleVariables";
const CUSTOM = "/Script/DuneSandbox.UserServerCustomSettings";
const GM = "/Script/DuneSandbox.DuneGameMode";
const PVP = "/Script/DuneSandbox.PvpPveSettings";
const SZ = "/Script/DuneSandbox.SecurityZonesSubsystem";
const BLD = "/Script/DuneSandbox.BuildingSettings";
const WORM = "/Script/DuneSandbox.SandwormSettings";
const STORM = "/Script/DuneSandbox.SandStormConfig";
const ADMIN = "AdminSetting.Global";

export const FIELDS: FieldDef[] = [
  // Server
  { file: "UserEngine.ini", section: CV, key: "Bgd.ServerDisplayName", label: "Server name", description: "Name shown in the in-game server browser (Experimental category).", category: "Server", type: "string", default: "", quote: true, verified: true },
  { file: "UserEngine.ini", section: CV, key: "Bgd.ServerLoginPassword", label: "Join password", description: "Players must enter this to join. Leave disabled for an open server. Always test with a second account.", category: "Server", type: "secret", default: "", quote: true, verified: true },
  { file: "UserEngine.ini", section: "URL", key: "Port", label: "Game port (start)", description: "First UDP game port. Each partition takes the next port. Changing it requires new port forwards.", category: "Server", type: "int", default: "7777", min: 1024, max: 65000, verified: true },
  { file: "UserEngine.ini", section: "URL", key: "IGWPort", label: "Inter-server gateway port (start)", description: "First UDP IGW port used for server-to-server traffic (game port + 111 by default).", category: "Server", type: "int", default: "7888", min: 1024, max: 65000, verified: true },

  // Rates
  { file: "UserEngine.ini", section: CV, key: "Dune.GlobalMiningOutputMultiplier", label: "Mining / gathering output", description: "Multiplier on hand-harvested resources, including spice.", category: "Rates & Economy", type: "number", default: "1.0", min: 0.1, max: 10, step: 0.1, verified: false },
  { file: "UserEngine.ini", section: CV, key: "Dune.GlobalVehicleMiningOutputMultiplier", label: "Vehicle mining output", description: "Multiplier on harvester and vehicle mining yields.", category: "Rates & Economy", type: "number", default: "1.0", min: 0.1, max: 10, step: 0.1, verified: false },
  { file: "UserServerCustomSettings.ini", section: CUSTOM, key: "GatheringAmount", label: "Gathering amount (custom difficulty)", description: "Custom-difficulty gathering multiplier. Needs DifficultyLevel=Custom.", category: "Rates & Economy", type: "number", default: "1.0", min: 0.1, max: 10, step: 0.1, verified: true },

  // World & hazards
  { file: "UserEngine.ini", section: CV, key: "sandworm.dune.Enabled", label: "Sandworms (engine)", description: "Global sandworm spawning switch.", category: "World & Hazards", type: "bool01", default: "1", verified: false },
  { file: "UserServerCustomSettings.ini", section: CUSTOM, key: "bAllowSandworms", label: "Allow sandworms (custom)", description: "Custom-difficulty sandworm toggle.", category: "World & Hazards", type: "bool", default: "True", verified: true },
  { file: "UserEngine.ini", section: CV, key: "Sandstorm.Enabled", label: "Sandstorms (engine)", description: "Global sandstorm toggle.", category: "World & Hazards", type: "bool01", default: "1", verified: false },
  { file: "UserServerCustomSettings.ini", section: CUSTOM, key: "bAllowSandstorms", label: "Allow sandstorms (custom)", description: "Custom-difficulty sandstorm toggle.", category: "World & Hazards", type: "bool", default: "True", verified: true },

  // Building
  { file: "UserGame.ini", key: "m_MaxNumLandclaimSegments", label: "Max land-claim segments", description: "Sub-fief segments per base. Clients must match this value.", category: "Building", type: "int", default: "6", min: 1, max: 50, verified: false, clientSide: true },
  { file: "UserGame.ini", key: "m_bBuildingRestrictionLimitsEnabled", label: "Building restriction limits", description: "Enforce per-base piece limits. Clients must match.", category: "Building", type: "bool", default: "True", verified: false, clientSide: true },
  { file: "UserServerCustomSettings.ini", section: CUSTOM, key: "FiefdomLimit", label: "Fiefdom limit", description: "Fiefs a player can own (0–10).", category: "Building", type: "int", default: "3", min: 0, max: 10, verified: true },
  { file: "UserServerCustomSettings.ini", section: CUSTOM, key: "BaseBackupToolTimeRestriction", label: "Base backup tool window (hours)", description: "Time restriction for the base backup tool.", category: "Building", type: "number", default: "16", min: 0, max: 168, step: 1, verified: true },

  // PvP
  { file: "UserGame.ini", key: "m_PvpEnabledPartitions", fallbackSection: "/Script/DuneSandbox.PvpPveSettings", label: "PvP-enabled partitions", description: "Partition indexes where PvP is allowed (one +m_PvpEnabledPartitions line each).", category: "PvP & Combat", type: "partitions", default: "", verified: false },

  // Guilds
  { file: "UserGame.ini", key: "m_MaxGuildMembersAllowed", fallbackSection: "/Script/DuneSandbox.GuildSettings", label: "Max guild members", description: "Upper bound on guild size.", category: "Guilds & Social", type: "int", default: "32", min: 1, max: 256, verified: false },
  { file: "UserGame.ini", key: "m_GuildCreationCost", fallbackSection: GM, label: "Guild creation cost (Solari)", description: "Cost to found a guild.", category: "Guilds & Social", type: "int", default: "1000", min: 0, max: 1000000, verified: false },

  // Persistence
  { file: "UserGame.ini", key: "m_bIsDbWipeEnabled", fallbackSection: GM, label: "Deep Desert weekly wipe", description: "On: the Deep Desert database resets each Coriolis cycle. Off keeps bases there permanently.", category: "Persistence", type: "bool", default: "True", verified: false, danger: true },
  ...community(),
  { file: "UserServerCustomSettings.ini", section: CUSTOM, key: "DifficultyLevel", label: "Difficulty level", description: "Must stay “Custom” for custom-difficulty keys to apply (fixed in 1.5.3.4+).", category: "Advanced", type: "enum", options: ["Custom"], default: "Custom", verified: true },
];

export const FRIENDLY: Record<string, string> = {
  m_MaxNumLandclaimSegments: "Max land-claim segments",
  m_bBuildingRestrictionLimitsEnabled: "Building restriction limits",
  m_bIsDbWipeEnabled: "Deep Desert DB wipe",
  m_MaxGuildMembersAllowed: "Max guild members",
  m_GuildCreationCost: "Guild creation cost",
  m_PvpEnabledPartitions: "PvP partitions",
};

/** Humanize unknown keys: m_bFooBarEnabled -> "Foo bar enabled". */
export function humanize(key: string): string {
  if (FRIENDLY[key]) return FRIENDLY[key];
  const k = key
    .replace(/^.*\./, "")
    .replace(/^m_/, "")
    .replace(/^b(?=[A-Z])/, "");
  const words = k.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

export interface Preset {
  id: string;
  name: string;
  blurb: string;
  values: Record<string, string>; // key -> value (applied only where the key's file is loaded)
}

export const PRESETS: Preset[] = [
  { id: "vanilla", name: "Vanilla", blurb: "Funcom defaults", values: { m_GlobalXPMultiplier: "1.0", m_GlobalHarvestAmountMultiplier: "1.0", CraftingTimeMultiplier: "1.0", "Dune.GlobalMiningOutputMultiplier": "1.0", "Dune.GlobalVehicleMiningOutputMultiplier": "1.0", GatheringAmount: "1.0", "sandworm.dune.Enabled": "1", "Sandstorm.Enabled": "1", bAllowSandworms: "True", bAllowSandstorms: "True", FiefdomLimit: "3" } },
  { id: "boosted", name: "Boosted 3×", blurb: "3× XP and yields, faster crafting", values: { m_GlobalXPMultiplier: "3.0", m_GlobalHarvestAmountMultiplier: "3.0", CraftingTimeMultiplier: "0.5", "Dune.GlobalMiningOutputMultiplier": "3.0", "Dune.GlobalVehicleMiningOutputMultiplier": "3.0", GatheringAmount: "3.0" } },
  { id: "casual", name: "Casual PvE", blurb: "2× XP and yields, no storms, more fiefs", values: { m_GlobalXPMultiplier: "2.0", m_GlobalHarvestAmountMultiplier: "2.0", m_BuildingDecayRateMultiplier: "0.5", "Dune.GlobalMiningOutputMultiplier": "2.0", "Dune.GlobalVehicleMiningOutputMultiplier": "2.0", GatheringAmount: "2.0", "Sandstorm.Enabled": "0", bAllowSandstorms: "False", FiefdomLimit: "6" } },
  { id: "builder", name: "Builder’s paradise", blurb: "Big bases, no worm stress", values: { m_MaxNumLandclaimSegments: "12", m_bBuildingRestrictionLimitsEnabled: "False", FiefdomLimit: "10", "sandworm.dune.Enabled": "0", bAllowSandworms: "False" } },
  { id: "hardcore", name: "Hardcore survival", blurb: "Scarce resources, faster thirst, everything hostile", values: { m_GlobalHarvestAmountMultiplier: "0.5", m_WaterConsumptionRate: "1.5", m_ItemDurabilityLossMultiplier: "1.5", "Dune.GlobalMiningOutputMultiplier": "0.5", "Dune.GlobalVehicleMiningOutputMultiplier": "0.5", GatheringAmount: "0.5", "sandworm.dune.Enabled": "1", "Sandstorm.Enabled": "1", bAllowSandworms: "True", bAllowSandstorms: "True", FiefdomLimit: "1" } },
];

export const FILES = ["UserEngine.ini", "UserGame.ini", "UserServerCustomSettings.ini"] as const;

/**
 * Community-documented keys (dune.hexaspark.com server-config wiki and CubeCoders reports).
 * Not in Funcom's shipped templates: each one is added under its section on first edit.
 * Verify in-game after a restart; unknown keys are silently ignored by the server.
 */
function community(): FieldDef[] {
  const g = (key: string, label: string, description: string, category: Category, def = "1.0", extra: Partial<FieldDef> = {}): FieldDef => ({
    file: "UserGame.ini",
    section: GM,
    key,
    label,
    description,
    category,
    type: "number",
    default: def,
    min: 0,
    max: 10,
    step: 0.1,
    verified: false,
    ...extra,
  });
  return [
    // Progression
    g("m_GlobalXPMultiplier", "XP multiplier", "Multiplier for all XP gains (combat, gathering, missions).", "Progression & XP"),
    g("m_GlobalFameMultiplier", "Fame multiplier", "Multiplier for fame gain.", "Progression & XP"),
    g("m_GlobalProgressionSpeedMultiplier", "Progression speed", "Journey and talent unlock speed.", "Progression & XP"),

    // Harvest
    g("m_GlobalHarvestAmountMultiplier", "Harvest amount", "Resources gained per strike or extraction (incl. spice nodes).", "Rates & Economy"),
    g("m_GlobalHarvestHealthMultiplier", "Resource node durability", "Node “health”. Lower values mean nodes break faster.", "Rates & Economy"),
    g("SellOrderPricePercentageFee", "Exchange fee (%)", "Market sell-order fee percentage.", "Rates & Economy", "2.0", { min: 0, max: 50, step: 0.5 }),

    // Crafting & inventory
    { file: "UserServerCustomSettings.ini", section: CUSTOM, key: "CraftingTimeMultiplier", label: "Crafting / refining time", description: "Custom difficulty: lower is faster (0.1 = 10× faster). Some hosts report this file isn't read in all builds.", category: "Crafting & Inventory", type: "number", default: "1.0", min: 0.1, max: 5, step: 0.1, verified: false },
    { file: "UserServerCustomSettings.ini", section: CUSTOM, key: "InventoryVolumeMultiplier", label: "Inventory volume", description: "Custom difficulty: backpack volume multiplier.", category: "Crafting & Inventory", type: "number", default: "1.0", min: 0.1, max: 10, step: 0.1, verified: false },
    g("m_InventoryWeightMultiplier", "Carry capacity", "Carry capacity multiplier.", "Crafting & Inventory"),
    g("m_ItemDurabilityLossMultiplier", "Gear durability loss", "How fast gear wears out. 0 disables durability loss.", "Crafting & Inventory"),
    { file: "UserGame.ini", section: "/Script/DuneSandbox.InventorySystemSettings", key: "PlayerInventoryStartingSize", label: "Starting inventory slots", description: "Item slots for new characters.", category: "Crafting & Inventory", type: "int", default: "40", min: 10, max: 200, verified: false },
    { file: "UserGame.ini", section: "/Script/DuneSandbox.InventorySystemSettings", key: "PlayerInventoryStartingVolumeCapacity", label: "Starting volume capacity", description: "Inventory volume for new characters.", category: "Crafting & Inventory", type: "number", default: "225.0", min: 50, max: 2000, step: 5, verified: false },

    // Survival
    g("m_WaterConsumptionRate", "Thirst rate", "Baseline water consumption speed.", "Survival"),
    g("m_WaterConsumptionInStormMultiplier", "Thirst in storms", "Extra thirst multiplier during storms.", "Survival", "4.0"),
    g("m_GlobalHealthMultiplier", "Global health", "Health scaling for all actors.", "Survival"),
    g("m_PlayerStartingWater", "Starting water", "Hydration for new spawns.", "Survival", "100.0", { min: 0, max: 200, step: 5 }),
    g("m_DefaultReconnectGracePeriodSeconds", "Logout body timer (s)", "How long your body stays in the world after disconnecting.", "Survival", "300", { type: "int", min: 0, max: 3600, step: 30, section: "/Script/DuneSandbox.PlayerOnlineStateSettings" }),

    // Combat
    g("m_GlobalDamageToNpcsMultiplier", "Damage to NPCs", "Damage players deal to AI enemies.", "PvP & Combat"),
    g("m_GlobalDamageToPlayersMultiplier", "Damage to players", "Scales damage players take.", "PvP & Combat"),
    g("m_GlobalBuildingDamageMultiplier", "Damage to buildings", "Damage dealt to player structures.", "PvP & Combat"),
    { file: "UserServerCustomSettings.ini", section: CUSTOM, key: "bAllowDynamicBuildingDamage", label: "Dynamic building damage", description: "Custom difficulty: environmental and raid damage to bases.", category: "PvP & Combat", type: "bool", default: "True", verified: false },

    // Building & decay
    g("m_BuildingDecayRateMultiplier", "Building decay rate", "How fast unmaintained bases decay. 0 disables decay.", "Building"),
    { file: "UserGame.ini", section: GM, key: "bEnableBuildingStability", label: "Building stability", description: "Structural stability checks.", category: "Building", type: "bool", default: "True", verified: false },
    { file: "UserGame.ini", section: GM, key: "m_MaxPermissionsPerActor", label: "Permissions per structure", description: "Cap on building / chest permission entries.", category: "Building", type: "int", default: "20", min: 1, max: 200, verified: false },

    // World
    { file: "UserGame.ini", section: GM, key: "m_CycleDurationInDays", label: "Coriolis cycle (days)", description: "Days between Deep Desert resets.", category: "World & Hazards", type: "int", default: "7", min: 1, max: 60, verified: false },
    { file: "UserGame.ini", section: "/Script/DuneSandbox.SandwormSettings", key: "WormDetectionDistance", label: "Worm hearing distance", description: "How far away sandworms can hear you (cm).", category: "World & Hazards", type: "number", default: "5000.0", min: 500, max: 20000, step: 250, verified: false },
    { file: "UserGame.ini", section: "/Script/DuneSandbox.SandwormSettings", key: "m_MinWormSpawnInternal", label: "Min seconds between worms", description: "Minimum time between sandworm spawns.", category: "World & Hazards", type: "number", default: "300.0", min: 0, max: 3600, step: 30, verified: false },
    { file: "UserGame.ini", section: "/Script/DuneSandbox.SandStormConfig", key: "m_StormCycleDuration", label: "Seconds between storms", description: "Sandstorm cycle length.", category: "World & Hazards", type: "int", default: "7200", min: 600, max: 86400, step: 300, verified: false },
    { file: "UserGame.ini", section: "/Script/DuneSandbox.SandStormConfig", key: "m_StormDuration", label: "Storm duration (s)", description: "How long a sandstorm lasts.", category: "World & Hazards", type: "int", default: "600", min: 60, max: 3600, step: 30, verified: false },

    // ---- Keys seen in a working community UserGame.ini / UserEngine.ini (dune-awakening-truenas) ----
    // PvP & security zones
    { file: "UserGame.ini", section: PVP, key: "m_bShouldForceEnablePvpOnAllPartitions", label: "Force PvP on all partitions", description: "Every map becomes PvP regardless of zone.", category: "PvP & Combat", type: "bool", default: "False", verified: false, danger: true },
    { file: "UserGame.ini", section: SZ, key: "m_bAreSecurityZonesEnabled", label: "Security zones", description: "Safe zones where PvP is disabled.", category: "PvP & Combat", type: "bool", default: "True", verified: false },
    { file: "UserGame.ini", section: SZ, key: "m_bSecurityZonesForceEnablePvp", label: "PvP inside security zones", description: "Allow PvP even inside security zones.", category: "PvP & Combat", type: "bool", default: "False", verified: false },
    { file: "UserEngine.ini", section: "ConsoleVariables", key: "SecurityZones.PvpResourceMultiplier", label: "PvP-zone resource bonus", description: "Extra resources in PvP areas.", category: "Rates & Economy", type: "number", default: "2.5", min: 0, max: 10, step: 0.1, verified: false },
    { file: "UserGame.ini", section: "/Script/DuneSandbox.DuneAISettings", key: "m_MaxReinforcementSize", label: "NPC reinforcement budget", description: "Maximum size of NPC reinforcement waves.", category: "PvP & Combat", type: "number", default: "120", min: 0, max: 500, step: 10, verified: false },
    { file: "UserGame.ini", section: "/Script/DuneSandbox.DuneAISettings", key: "m_RandomDBNOChance", label: "NPC downed chance", description: "Chance an NPC goes down-but-not-out instead of dying.", category: "PvP & Combat", type: "number", default: "0.1", min: 0, max: 1, step: 0.05, verified: false },

    // Building
    { file: "UserGame.ini", section: BLD, key: "m_BuildRange", label: "Build range (cm)", description: "How far from you pieces can be placed.", category: "Building", type: "number", default: "1500", min: 300, max: 10000, step: 100, verified: false },
    { file: "UserGame.ini", section: BLD, key: "m_BuildingHeightLimitInM", label: "Height limit (m)", description: "Maximum building height.", category: "Building", type: "number", default: "500", min: 50, max: 5000, step: 50, verified: false },
    { file: "UserGame.ini", section: BLD, key: "m_DefaultRepairCostMultiplier", label: "Repair cost", description: "Multiplier on building repair costs.", category: "Building", type: "number", default: "1.0", min: 0, max: 5, step: 0.05, verified: false },
    { file: "UserGame.ini", section: BLD, key: "m_bEnableDestabilizationSystem", label: "Destabilization system", description: "Unsupported pieces collapse.", category: "Building", type: "bool", default: "True", verified: false },
    { file: "UserGame.ini", section: BLD, key: "m_BuildingBlueprintMaxExtensions", label: "Blueprint max extensions", description: "Extensions allowed on a blueprint.", category: "Building", type: "int", default: "4", min: 0, max: 64, verified: false },
    { file: "UserGame.ini", section: BLD, key: "m_BaseBackupMaxExtensions", label: "Base backup max extensions", description: "Extensions a base backup can hold.", category: "Building", type: "int", default: "8", min: 0, max: 128, verified: false },
    { file: "UserGame.ini", section: BLD, key: "m_BaseBackupToolTimeRestrictionInSeconds", label: "Base backup cooldown (s)", description: "Time between base backups (604800 = 7 days).", category: "Building", type: "int", default: "604800", min: 0, max: 2592000, step: 3600, verified: false },

    // Worms, storms, world
    { file: "UserGame.ini", section: WORM, key: "ThreatScale", label: "Worm threat scale", description: "How quickly your activity attracts sandworms.", category: "World & Hazards", type: "number", default: "1.0", min: 0, max: 5, step: 0.1, verified: false },
    { file: "UserGame.ini", section: WORM, key: "m_bEnableDangerZones", label: "Worm danger zones", description: "Map areas where worms are guaranteed to hunt.", category: "World & Hazards", type: "bool", default: "True", verified: false },
    { file: "UserGame.ini", section: WORM, key: "m_GiantWormSpawningCooldown", label: "Giant worm cooldown (s)", description: "Time between Shai-Hulud spawns.", category: "World & Hazards", type: "number", default: "3600", min: 0, max: 86400, step: 300, verified: false },
    { file: "UserGame.ini", section: STORM, key: "m_bAutoSpawnEnabled", label: "Storms auto-spawn", description: "Sandstorms spawn on their own.", category: "World & Hazards", type: "bool", default: "True", verified: false },
    { file: "UserGame.ini", section: STORM, key: "m_bMitigateAllSandstormDamage", label: "Mitigate storm damage", description: "Shelter fully protects from sandstorm damage.", category: "World & Hazards", type: "bool", default: "False", verified: false },
    { file: "UserGame.ini", section: STORM, key: "m_bCoriolisDoesDamage", label: "Coriolis storm damage", description: "The weekly Coriolis storm damages players and bases.", category: "World & Hazards", type: "bool", default: "False", verified: false },
    { file: "UserGame.ini", section: "/Script/DuneSandbox.TimeOfDaySettings", key: "m_DayLengthMinutes", label: "Day length (minutes)", description: "Real-time length of a full day/night cycle.", category: "World & Hazards", type: "number", default: "30", min: 5, max: 240, step: 5, verified: false },
    { file: "UserEngine.ini", section: "ConsoleVariables", key: "Sandstorm.Treasure.Enabled", label: "Sandstorm treasure", description: "Storms uncover loot.", category: "World & Hazards", type: "bool01", default: "1", verified: false },
    { file: "UserEngine.ini", section: "ConsoleVariables", key: "Sandworm.SandwormDangerZonesEnabled", label: "Worm danger zones (engine)", description: "Engine-level danger-zone switch.", category: "World & Hazards", type: "boolLower", default: "true", verified: false },

    // Vehicles
    { file: "UserEngine.ini", section: "ConsoleVariables", key: "dw.VehicleDurabilityDamageMultiplier", label: "Vehicle durability damage", description: "How fast vehicles wear. 0 disables wear.", category: "Crafting & Inventory", type: "number", default: "1.0", min: 0, max: 10, step: 0.1, verified: false },
    { file: "UserEngine.ini", section: "ConsoleVariables", key: "Vehicle.SandwormInvulnerabilitySecondsOnServerRestart", label: "Vehicle worm immunity after restart (s)", description: "Grace period for parked vehicles after a restart.", category: "World & Hazards", type: "number", default: "7200", min: 0, max: 86400, step: 300, verified: false },
    { file: "UserEngine.ini", section: "ConsoleVariables", key: "Vehicle.SandwormInvulnerabilitySecondsOnExit", label: "Vehicle worm immunity after exit (s)", description: "Grace period after leaving a vehicle.", category: "World & Hazards", type: "number", default: "900", min: 0, max: 86400, step: 60, verified: false },

    // Items, loot, crafting
    { file: "UserGame.ini", section: "/Script/DuneSandbox.ItemDeteriorationSettings", key: "m_ItemDeteriorationUpdateRate", label: "Item deterioration rate", description: "How fast items in storage decay (lower is slower).", category: "Crafting & Inventory", type: "number", default: "1.0", min: 0, max: 10, step: 0.05, verified: false },
    { file: "UserGame.ini", section: "/Script/DuneSandbox.DuneLootSettings", key: "m_bDoubleDifficultyLoot", label: "Double difficulty loot", description: "Loot rolls as if on higher difficulty.", category: "Crafting & Inventory", type: "bool", default: "False", verified: false },
    { file: "UserGame.ini", section: "/Script/DuneSandbox.CraftingSettings", key: "m_RepairCostWeight", label: "Item repair cost", description: "Multiplier on item repair material costs.", category: "Crafting & Inventory", type: "number", default: "1.0", min: 0, max: 5, step: 0.05, verified: false },
    { file: "UserGame.ini", section: "/Script/DuneSandbox.CraftingSettings", key: "m_RecyclerOutputWeight", label: "Recycler output", description: "Share of materials returned when recycling.", category: "Crafting & Inventory", type: "number", default: "0.25", min: 0, max: 1, step: 0.05, verified: false },

    // Survival & QoL
    { file: "UserEngine.ini", section: "ConsoleVariables", key: "Hydration.Enabled", label: "Thirst system", description: "Turn hydration off for a relaxed experience.", category: "Survival", type: "boolLower", default: "true", verified: false },
    { file: "UserGame.ini", section: "/Script/DuneSandbox.PingSystemSettings", key: "m_PingMaximumDistance", label: "Ping max distance (cm)", description: "How far map pings reach.", category: "Survival", type: "number", default: "2000", min: 500, max: 50000, step: 500, verified: false },

    // Admin (experimental): community-tested; Funcom says official admin commands are coming.
    { file: "UserEngine.ini", section: "ConsoleVariables", key: "BattlEye.Enabled", label: "BattlEye anti-cheat", description: "Since 1.5.3.1 BattlEye is optional on self-hosted servers. Disable only for trusted groups.", category: "Admin (experimental)", type: "boolLower", default: "true", verified: false, danger: true },
    { file: "UserGame.ini", section: ADMIN, key: "Password_Admin", label: "Admin login password", description: "Default is the public “sardaukar”. Change it! Used with the console command AdminLogin <password> where the client console is available.", category: "Admin (experimental)", type: "secret", default: "sardaukar", verified: false, danger: true },
    { file: "UserGame.ini", section: ADMIN, key: "Allowed_GM_Commands", label: "Extra allowed GM commands", description: "Adds +Allowed_GM_Commands entries, e.g. AwardXP, SpawnNpc, DestroyAllSandStorms, ServerExec, ResetProgression, CheatScript.", category: "Admin (experimental)", type: "list", default: "", verified: false, danger: true },

    // Guilds
    { file: "UserGame.ini", section: GM, key: "m_MaxGuildsAllowed", label: "Guilds per player", description: "How many guilds a player can join.", category: "Guilds & Social", type: "int", default: "3", min: 1, max: 20, verified: false },
  ];
}
