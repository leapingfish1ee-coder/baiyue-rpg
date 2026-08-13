import { BASE_TERRAIN_ID, RUNTIME_CHUNK_SIZE, compareChunkKeysNumeric } from "../world-contract.ts";
import { CampAnchorStepper } from "./anchor.ts";
import {
  ENEMY_DEFINITIONS,
  EnemyGuaranteePlacementStepper,
  GuaranteePlacementStepper,
  RECIPE_DEFINITIONS,
  RECIPE_ORDER,
  RESOURCE_DEFINITIONS,
  RESOURCE_PROTOTYPE_ORDER,
  TOOL_DEFINITIONS,
  WEAPON_DEFINITIONS,
  ambientEnemyPlacementCandidate,
  ambientPlacementCandidates,
  authoritativeResourceDuration,
  authoritativeCraftingDuration,
  contentCellForTile,
  resourceDefinition,
  recipeDefinition,
  resolveAmbientPlacementConflicts,
  taskKindMatchesPrototype,
  type ItemId,
  type EnemyArchetypeId,
  type EnemyPlacementDefinition,
  type MaterialItemId,
  type RecipeId,
  type ResourcePrototypeId,
  type ResourceSkillId,
  type ResourceTaskKind,
  type ToolItemId,
  type ToolSlot,
  type ResourcePlacementDefinition,
} from "./content.ts";
import type { ActivityReason, GameplayReadModelV2, HuntTask, OfflineReport, ResourceTask, SeedDecimal, TaskId, TaskIntent, WorldPoint } from "./contracts.ts";
import { applyNaturalRegen, deterministicPpmRoll, deterministicRangeInclusive, finalPhysicalDamage, MICRO_HP_PER_HP, opposedChancePpm } from "./combat.ts";
import { base64ToFogBits, fogBitsToBase64, isRevealed, revealObservation, revealedTiles, type FogMap } from "./fog.ts";
import { sweptSegmentIntersectsCircle } from "./geometry.ts";
import { floorDiv, levelFromTotalXp, observationRadius, xpAtLevelStart, xpForNextLevel } from "./math.ts";
import { positionAtWeightedCost, rational, routeEventTimeMs } from "./motion.ts";
import { PlannerStepper, TerrainSnapshot, type PlanFinal, type RoutePlan, type SegmentProfile } from "./navigation.ts";

export type EngineTaskInput = Readonly<
  | { kind: "Explore"; mode: "continuous"; destination: null }
  | { kind: "Explore"; mode: "destination"; destination: WorldPoint }
  | { kind: "Gather"; targetPrototypeId: "wild_fiber"; quantity: number | null }
  | { kind: "Woodcut"; targetPrototypeId: "softwood_tree"; quantity: number | null }
  | { kind: "Mine"; targetPrototypeId: "surface_stone" | "shallow_copper_deposit"; quantity: number | null }
  | { kind: "Produce"; recipeId: RecipeId; requestedQuantity: number | null }
  | { kind: "Hunt"; archetypeId: "graymane_boar"; requestedKills: number | null }
>;

export type EngineTerrainEffect = Readonly<{
  kind: "terrain-request";
  gameplayEpoch: number;
  seed: SeedDecimal;
  chunkKey: string;
  chunkX: string;
  chunkY: string;
}>;

export type EngineStepResult = EngineTerrainEffect | Readonly<{ kind: "yield" }> | Readonly<{ kind: "settled" }>;

export type EngineSnapshot = Readonly<{
  seed: SeedDecimal | null;
  worldTimeMs: bigint;
  position: WorldPoint | null;
  totalXp: number;
  gatheringXp: number;
  woodcuttingXp: number;
  miningXp: number;
  craftingXp: number;
  meleeXp: number;
  stealthXp: number;
  fiber: number;
  softwood: number;
  stone: number;
  copperOre: number;
  rope: number;
  rawHide: number;
  reinforcedAxe: number;
  reinforcedPickaxe: number;
  equipment: Readonly<Record<ToolSlot, ToolItemId | null>>;
  revealedTileCount: number;
  revealedChunks: readonly Readonly<{ chunkKey: string; revealedBase64: string }>[];
  task: TaskIntent | null;
  activityState: "idle" | "planning" | "moving" | "acting" | "combat" | "respawning" | "waiting" | "paused";
  route: readonly WorldPoint[];
  routeIndex: number;
  playerHpMicro: bigint;
  combat: RuntimeCombatState | null;
  respawn: RuntimeRespawnState | null;
  targetKills: number;
  otherKills: number;
  deaths: number;
  respawns: number;
}>;

export type EnginePersistedState = Readonly<{
  seed: SeedDecimal;
  worldTimeMs: string;
  position: WorldPoint;
  campAnchor: WorldPoint;
  totalXp: number;
  gatheringXp: number;
  woodcuttingXp: number;
  miningXp: number;
  craftingXp: number;
  meleeXp: number;
  stealthXp: number;
  fiber: number;
  softwood: number;
  stone: number;
  copperOre: number;
  rope: number;
  rawHide: number;
  wornAxe: number;
  wornPickaxe: number;
  reinforcedAxe: number;
  reinforcedPickaxe: number;
  equipment: Readonly<Record<ToolSlot, ToolItemId | null>>;
  task: TaskIntent | null;
  execution: Readonly<{
    state: "idle" | "planning" | "moving" | "acting" | "combat" | "respawning" | "waiting" | "paused";
    routePurpose: "explore" | "task_target" | "auto_explore" | null;
    route: readonly WorldPoint[];
    routeIndex: number;
    motion: Readonly<{
      start: WorldPoint;
      end: WorldPoint;
      startWorldTimeMs: string;
      endWorldTimeMs: string;
      accumulatedWeightedCost: string;
      totalWeightedCost: string;
      pathIndex: number;
    }> | null;
    targetPlacementId: string | null;
    action: Readonly<{
      kind: "Resource";
      actionId: string;
      placementId: string;
      prototypeId: ResourcePrototypeId;
      startWorldTimeMs: string;
      endWorldTimeMs: string;
      durationMs: string;
      skillSpeedBps: number;
      toolSpeedBps: number;
      totalSpeedBps: number;
    } | {
      kind: "Produce";
      actionId: string;
      recipeId: RecipeId;
      startWorldTimeMs: string;
      endWorldTimeMs: string;
      durationMs: string;
      skillSpeedBps: number;
      totalSpeedBps: number;
    }> | null;
    waitingReason: ActivityReason | null;
  }>;
  worldChunks: readonly Readonly<{
    chunkKey: string;
    revealedBase64: string;
    knownPlacements: readonly KnownResourcePlacement[];
    knownEnemyPlacements: readonly KnownEnemyPlacement[];
  }>[];
  playerHpMicro: string;
  playerMaxHpMicro: string;
  hpRegenNumerator: string;
  combat: PersistedCombatState | null;
  respawn: PersistedRespawnState | null;
  revivalGraceUntilWorldTimeMs: string | null;
  targetKills: number;
  otherKills: number;
  deaths: number;
  respawns: number;
  nextEventOrdinal: string;
}>;

export type EngineRestoreState = Readonly<{
  seed: SeedDecimal;
  worldTimeMs: string;
  position: WorldPoint;
  campAnchor: WorldPoint;
  totalXp: number;
  gatheringXp: number;
  woodcuttingXp: number;
  miningXp: number;
  craftingXp: number;
  meleeXp: number;
  stealthXp: number;
  fiber: number;
  softwood: number;
  stone: number;
  copperOre: number;
  rope: number;
  rawHide: number;
  wornAxe: number;
  wornPickaxe: number;
  reinforcedAxe: number;
  reinforcedPickaxe: number;
  equipment: Readonly<Record<ToolSlot, ToolItemId | null>>;
  task: TaskIntent | null;
  executionState: "idle" | "planning" | "moving" | "acting" | "combat" | "respawning" | "waiting" | "paused";
  routePurpose: "explore" | "task_target" | "auto_explore" | null;
  targetPlacementId: string | null;
  action: Readonly<{
    kind: "Resource";
    actionId: string;
    placementId: string;
    prototypeId: ResourcePrototypeId;
    startWorldTimeMs: string;
    endWorldTimeMs: string;
    durationMs: string;
    skillSpeedBps: number;
    toolSpeedBps: number;
    totalSpeedBps: number;
  } | {
    kind: "Produce";
    actionId: string;
    recipeId: RecipeId;
    startWorldTimeMs: string;
    endWorldTimeMs: string;
    durationMs: string;
    skillSpeedBps: number;
    totalSpeedBps: number;
  }> | null;
  waitingReason: ActivityReason | null;
  worldChunks: readonly Readonly<{ chunkKey: string; revealedBase64: string; knownPlacements: readonly KnownResourcePlacement[]; knownEnemyPlacements: readonly KnownEnemyPlacement[] }>[];
  playerHpMicro: string;
  playerMaxHpMicro: string;
  hpRegenNumerator: string;
  combat: PersistedCombatState | null;
  respawn: PersistedRespawnState | null;
  revivalGraceUntilWorldTimeMs: string | null;
  targetKills: number;
  otherKills: number;
  deaths: number;
  respawns: number;
  nextEventOrdinal: string;
}>;

export type EngineReadModelOptions = Readonly<{
  saveState?: GameplayReadModelV2["save"];
  offlineReport?: OfflineReport | null;
  startup?: GameplayReadModelV2["startup"];
}>;

type PendingTerrain = Readonly<{ source: "anchor" | "navigation" | "content"; effect: EngineTerrainEffect }>;

export type KnownResourcePlacement = Readonly<{
  placementId: string;
  prototypeId: ResourcePrototypeId;
  source: "ambient" | "guarantee";
  tileX: string;
  tileY: string;
  point: WorldPoint;
  availability: "active" | "depleted";
  spawnCycle: number;
  depletedWorldTimeMs: string | null;
  nextAvailableWorldTimeMs: string | null;
}>;

export type KnownEnemyPlacement = Readonly<{
  placementId: string;
  archetypeId: EnemyArchetypeId;
  source: "ambient" | "guarantee";
  tileX: string;
  tileY: string;
  point: WorldPoint;
  availability: "active" | "dead";
  spawnCycle: number;
  deadWorldTimeMs: string | null;
  nextAvailableWorldTimeMs: string | null;
  encounterChecked: boolean;
  pendingStealthPass: boolean;
  stealthSettled: boolean;
}>;

type PersistedRational = Readonly<{ numerator: string; denominator: string }>;

type PersistedSegmentProfile = Readonly<{
  start: WorldPoint;
  end: WorldPoint;
  runs: readonly Readonly<{
    startParameter: PersistedRational;
    endParameter: PersistedRational;
    terrainFactor: string;
    cost: string;
    cumulativeCostBefore: string;
  }>[];
  boundaryParameters: readonly PersistedRational[];
  cost: string;
}>;

type PersistedPausedMovement = Readonly<{
  route: readonly WorldPoint[];
  legProfiles: readonly PersistedSegmentProfile[];
  routeIndex: number;
  elapsedRouteMs: string;
  boundaryIndex: number;
}>;

export type PersistedPausedExecution = Readonly<{
  taskId: string;
  targetPlacementId: string | null;
  routePurpose: "explore" | "task_target" | "auto_explore" | null;
  movement: PersistedPausedMovement | null;
  action: Readonly<{
    kind: "Resource";
    actionId: string;
    placementId: string;
    prototypeId: ResourcePrototypeId;
    remainingMs: string;
    durationMs: string;
    skillSpeedBps: number;
    toolSpeedBps: number;
    totalSpeedBps: number;
  } | {
    kind: "Produce";
    actionId: string;
    recipeId: RecipeId;
    remainingMs: string;
    durationMs: string;
    skillSpeedBps: number;
    totalSpeedBps: number;
  }> | null;
}>;

export type PersistedCombatState = Readonly<{
  combatId: string;
  encounterInstanceId: string;
  placementId: string;
  archetypeId: EnemyArchetypeId;
  triggeredByHunt: boolean;
  playerAccuracy: number;
  playerEvasion: number;
  playerArmor: number;
  playerDamageMin: number;
  playerDamageMax: number;
  playerAttackIntervalMs: string;
  enemyAccuracy: number;
  enemyEvasion: number;
  enemyArmor: number;
  enemyDamageMin: number;
  enemyDamageMax: number;
  enemyAttackIntervalMs: string;
  enemyHpMicro: string;
  playerNextAttackWorldTimeMs: string;
  enemyNextAttackWorldTimeMs: string;
  eventOrdinal: string;
  lastAttack: Readonly<{ actor: "player" | "enemy"; hit: boolean; damage: number }> | null;
  paused: PersistedPausedExecution | null;
}>;

export type PersistedRespawnState = Readonly<{
  deathPosition: WorldPoint;
  deadlineWorldTimeMs: string;
}>;

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };

type RuntimeCombatState = Omit<Mutable<PersistedCombatState>,
  "playerAttackIntervalMs" | "enemyAttackIntervalMs" | "enemyHpMicro" | "playerNextAttackWorldTimeMs" | "enemyNextAttackWorldTimeMs" | "eventOrdinal"
> & {
  playerAttackIntervalMs: bigint;
  enemyAttackIntervalMs: bigint;
  enemyHpMicro: bigint;
  playerNextAttackWorldTimeMs: bigint;
  enemyNextAttackWorldTimeMs: bigint;
  eventOrdinal: bigint;
};

type RuntimeRespawnState = Readonly<{ deathPosition: WorldPoint; deadlineWorldTimeMs: bigint }>;

type ResourceAction = {
  kind: "Resource";
  actionId: string;
  placementId: string;
  prototypeId: ResourcePrototypeId;
  startWorldTimeMs: bigint;
  endWorldTimeMs: bigint;
  durationMs: bigint;
  skillSpeedBps: number;
  toolSpeedBps: number;
  totalSpeedBps: number;
};

type ProductionAction = {
  kind: "Produce";
  actionId: string;
  recipeId: RecipeId;
  startWorldTimeMs: bigint;
  endWorldTimeMs: bigint;
  durationMs: bigint;
  skillSpeedBps: number;
  totalSpeedBps: number;
};

type NonCombatAction = ResourceAction | ProductionAction;

type ResourcePlanning = {
  candidates: readonly KnownResourcePlacement[];
  index: number;
  planner: PlannerStepper | null;
  best: Readonly<{ placement: KnownResourcePlacement; plan: RoutePlan }> | null;
};

type EnemyPlanning = {
  candidates: readonly KnownEnemyPlacement[];
  index: number;
  planner: PlannerStepper | null;
  best: Readonly<{ placement: KnownEnemyPlacement; plan: RoutePlan }> | null;
};

type MotionLeg = {
  profile: SegmentProfile;
  endWorldTimeMs: bigint;
  pathIndex: number;
  cumulativeCostBefore: bigint;
  boundaryWorldTimes: readonly bigint[];
  boundaryIndex: number;
};

const NO_FRONTIER_REASON: ActivityReason = {
  code: "NoReachableTargetOrFrontier", params: null, allowedActions: ["set_task"], diagnosticId: null,
};
const TASK_COMPLETED_REASON: ActivityReason = {
  code: "TaskCompleted", params: null, allowedActions: ["set_task"], diagnosticId: null,
};

export class InvalidWorldSeedError extends Error {
  readonly code = "command/invalid_seed" as const;
}

export class UnknownTargetPrototypeError extends Error {
  readonly code = "command/unknown_target_prototype" as const;
}

export class SkillLevelTooLowError extends Error {
  readonly code = "command/skill_level_too_low" as const;
  readonly prototypeId: ResourcePrototypeId;
  readonly skillId: ResourceSkillId;
  readonly requiredLevel: number;
  readonly actualLevel: number;
  constructor(
    prototypeId: ResourcePrototypeId,
    skillId: ResourceSkillId,
    requiredLevel: number,
    actualLevel: number,
  ) {
    super(`${skillId} ${actualLevel} does not meet level ${requiredLevel} for ${prototypeId}`);
    this.prototypeId = prototypeId;
    this.skillId = skillId;
    this.requiredLevel = requiredLevel;
    this.actualLevel = actualLevel;
  }
}

export class RecipeLevelTooLowError extends Error {
  readonly code = "command/recipe_level_too_low" as const;
  readonly skillId = "crafting" as const;
  readonly recipeId: RecipeId;
  readonly requiredLevel: number;
  readonly actualLevel: number;
  constructor(
    recipeId: RecipeId,
    requiredLevel: number,
    actualLevel: number,
  ) {
    super(`crafting ${actualLevel} does not meet level ${requiredLevel} for ${recipeId}`);
    this.recipeId = recipeId;
    this.requiredLevel = requiredLevel;
    this.actualLevel = actualLevel;
  }
}

export class EquipmentLevelTooLowError extends Error {
  readonly code = "command/equipment_level_too_low" as const;
  readonly itemId: ToolItemId;
  readonly skillId: ResourceSkillId;
  readonly requiredLevel: number;
  readonly actualLevel: number;
  constructor(
    itemId: ToolItemId,
    skillId: ResourceSkillId,
    requiredLevel: number,
    actualLevel: number,
  ) {
    super(`${skillId} ${actualLevel} does not meet level ${requiredLevel} for ${itemId}`);
    this.itemId = itemId;
    this.skillId = skillId;
    this.requiredLevel = requiredLevel;
    this.actualLevel = actualLevel;
  }
}

export class ItemUnavailableError extends Error {
  readonly code = "command/item_unavailable" as const;
}

export class InvalidEquipmentError extends Error {
  readonly code = "command/invalid_equipment" as const;
}

export class CombatLockedError extends Error {
  readonly code = "command/combat_locked" as const;
}

export class QuantityOverflowError extends Error {
  readonly code = "integrity/quantity_overflow" as const;
}

function taskIdFromCommandId(commandId: string): TaskId {
  if (!commandId.startsWith("cmd:")) throw new TypeError("validated command ID required");
  return `task:${commandId.slice(4)}`;
}

function clonePoint(point: WorldPoint): WorldPoint { return { x: point.x, y: point.y }; }

function serializeRational(value: Readonly<{ numerator: bigint; denominator: bigint }>): PersistedRational {
  return { numerator: value.numerator.toString(), denominator: value.denominator.toString() };
}

function restoreRational(value: PersistedRational): Readonly<{ numerator: bigint; denominator: bigint }> {
  return { numerator: BigInt(value.numerator), denominator: BigInt(value.denominator) };
}

function serializeSegmentProfile(profile: SegmentProfile): PersistedSegmentProfile {
  return {
    start: clonePoint(profile.start),
    end: clonePoint(profile.end),
    runs: profile.runs.map((run) => ({
      startParameter: serializeRational(run.startParameter),
      endParameter: serializeRational(run.endParameter),
      terrainFactor: run.terrainFactor.toString(),
      cost: run.cost.toString(),
      cumulativeCostBefore: run.cumulativeCostBefore.toString(),
    })),
    boundaryParameters: profile.boundaryParameters.map(serializeRational),
    cost: profile.cost.toString(),
  };
}

function restoreSegmentProfile(profile: PersistedSegmentProfile): SegmentProfile {
  return {
    start: clonePoint(profile.start),
    end: clonePoint(profile.end),
    runs: profile.runs.map((run) => ({
      startParameter: restoreRational(run.startParameter),
      endParameter: restoreRational(run.endParameter),
      terrainFactor: BigInt(run.terrainFactor),
      cost: BigInt(run.cost),
      cumulativeCostBefore: BigInt(run.cumulativeCostBefore),
    })),
    boundaryParameters: profile.boundaryParameters.map(restoreRational),
    cost: BigInt(profile.cost),
  };
}
function isResourceTask(task: TaskIntent | null): task is ResourceTask {
  return task !== null && (task.kind === "Gather" || task.kind === "Woodcut" || task.kind === "Mine");
}

function isProduceTask(task: TaskIntent | null): task is Extract<TaskIntent, { kind: "Produce" }> {
  return task?.kind === "Produce";
}

function isHuntTask(task: TaskIntent | null): task is HuntTask {
  return task?.kind === "Hunt";
}

export class GameplayEngine {
  private readonly generatorVersion: number;
  private readonly fog: FogMap = new Map();
  private readonly terrain = new TerrainSnapshot();
  private seed: SeedDecimal | null = null;
  private worldTimeMs = 0n;
  private position: WorldPoint | null = null;
  private campAnchor: WorldPoint | null = null;
  private totalXp = 0;
  private gatheringXp = 0;
  private woodcuttingXp = 0;
  private miningXp = 0;
  private craftingXp = 0;
  private meleeXp = 0;
  private stealthXp = 0;
  private fiber = 0;
  private softwood = 0;
  private stone = 0;
  private copperOre = 0;
  private rope = 0;
  private rawHide = 0;
  private wornAxe = 0;
  private wornPickaxe = 0;
  private reinforcedAxe = 0;
  private reinforcedPickaxe = 0;
  private equipment: Record<ToolSlot, ToolItemId | null> = { axe: "worn_axe", pickaxe: "worn_pickaxe" };
  private revealedTileCount = 0;
  private task: TaskIntent | null = null;
  private activityState: "idle" | "planning" | "moving" | "acting" | "combat" | "respawning" | "waiting" | "paused" = "idle";
  private routePurpose: "explore" | "task_target" | "auto_explore" | null = null;
  private route: readonly WorldPoint[] = [];
  private legCosts: readonly bigint[] = [];
  private legProfiles: readonly SegmentProfile[] = [];
  private routeIndex = 0;
  private routeStartWorldTimeMs = 0n;
  private routeCumulativeCosts: readonly bigint[] = [];
  private routeTotalCost = 0n;
  private motion: MotionLeg | null = null;
  private reason: ActivityReason | null = null;
  private readModelRevision = 0;
  private gameplayEpoch = 0;
  private plannerGeneration = 0;
  private planner: PlannerStepper | null = null;
  private resourcePlanning: ResourcePlanning | null = null;
  private enemyPlanning: EnemyPlanning | null = null;
  private anchor: CampAnchorStepper | null = null;
  private guaranteeStepper: GuaranteePlacementStepper | null = null;
  private enemyGuaranteeStepper: EnemyGuaranteePlacementStepper | null = null;
  private guaranteePlacements: readonly ResourcePlacementDefinition[] = [];
  private enemyGuaranteePlacements: readonly EnemyPlacementDefinition[] = [];
  private readonly knownPlacements = new Map<string, KnownResourcePlacement>();
  private readonly knownEnemyPlacements = new Map<string, KnownEnemyPlacement>();
  private readonly unreachablePlacementIds = new Set<string>();
  private readonly pendingContentCells = new Set<string>();
  private activeContentCell: string | null = null;
  private currentTargetPlacementId: string | null = null;
  private action: NonCombatAction | null = null;
  private playerHpMicro = 100n * MICRO_HP_PER_HP;
  private playerMaxHpMicro = 100n * MICRO_HP_PER_HP;
  private hpRegenNumerator = 0n;
  private combat: RuntimeCombatState | null = null;
  private respawn: RuntimeRespawnState | null = null;
  private revivalGraceUntilWorldTimeMs: bigint | null = null;
  private targetKills = 0;
  private otherKills = 0;
  private deaths = 0;
  private respawns = 0;
  private nextEventOrdinal = 0n;
  private immediateCommitPending = false;
  private pendingTerrain: PendingTerrain | null = null;
  private startup: GameplayReadModelV2["startup"] = "new_world";

  constructor(generatorVersion: number) { this.generatorVersion = generatorVersion; }

  get epoch(): number { return this.gameplayEpoch; }
  get revision(): number { return this.readModelRevision; }
  get worldSeed(): SeedDecimal | null { return this.seed; }
  get hasPendingWork(): boolean {
    return this.pendingTerrain !== null || this.anchor !== null || this.guaranteeStepper !== null || this.enemyGuaranteeStepper !== null
      || this.pendingContentCells.size > 0 || this.activityState === "planning";
  }
  get needsImmediateCommit(): boolean { return this.immediateCommitPending; }

  acknowledgeImmediateCommit(): void { this.immediateCommitPending = false; }

  touchReadModel(): void { this.bumpRevision(); }

  snapshot(): EngineSnapshot {
    return {
      seed: this.seed,
      worldTimeMs: this.worldTimeMs,
      position: this.position === null ? null : clonePoint(this.position),
      totalXp: this.totalXp,
      gatheringXp: this.gatheringXp,
      woodcuttingXp: this.woodcuttingXp,
      miningXp: this.miningXp,
      craftingXp: this.craftingXp,
      meleeXp: this.meleeXp,
      stealthXp: this.stealthXp,
      fiber: this.fiber,
      softwood: this.softwood,
      stone: this.stone,
      copperOre: this.copperOre,
      rope: this.rope,
      rawHide: this.rawHide,
      reinforcedAxe: this.reinforcedAxe,
      reinforcedPickaxe: this.reinforcedPickaxe,
      equipment: { ...this.equipment },
      revealedTileCount: this.revealedTileCount,
      revealedChunks: [...this.fog.entries()]
        .sort(([left], [right]) => compareChunkKeysNumeric(left, right))
        .map(([chunkKey, bits]) => ({ chunkKey, revealedBase64: fogBitsToBase64(bits) })),
      task: this.task,
      activityState: this.activityState,
      route: this.route.map(clonePoint),
      routeIndex: this.routeIndex,
      playerHpMicro: this.playerHpMicro,
      combat: this.combat === null ? null : structuredClone(this.combat),
      respawn: this.respawn === null ? null : structuredClone(this.respawn),
      targetKills: this.targetKills,
      otherKills: this.otherKills,
      deaths: this.deaths,
      respawns: this.respawns,
    };
  }

  persistedState(): EnginePersistedState {
    this.requireWorld();
    const motion = this.motion;
    return {
      seed: this.seed!,
      worldTimeMs: this.worldTimeMs.toString(),
      position: clonePoint(this.position!),
      campAnchor: clonePoint(this.campAnchor!),
      totalXp: this.totalXp,
      gatheringXp: this.gatheringXp,
      woodcuttingXp: this.woodcuttingXp,
      miningXp: this.miningXp,
      craftingXp: this.craftingXp,
      meleeXp: this.meleeXp,
      stealthXp: this.stealthXp,
      fiber: this.fiber,
      softwood: this.softwood,
      stone: this.stone,
      copperOre: this.copperOre,
      rope: this.rope,
      rawHide: this.rawHide,
      wornAxe: this.wornAxe,
      wornPickaxe: this.wornPickaxe,
      reinforcedAxe: this.reinforcedAxe,
      reinforcedPickaxe: this.reinforcedPickaxe,
      equipment: { ...this.equipment },
      task: this.task === null ? null : structuredClone(this.task),
      execution: {
        state: this.activityState,
        routePurpose: this.routePurpose,
        route: this.route.map(clonePoint),
        routeIndex: this.route.length === 0 ? 0 : Math.min(this.routeIndex, this.route.length - 1),
        motion: motion === null ? null : {
          start: clonePoint(motion.profile.start),
          end: clonePoint(motion.profile.end),
          startWorldTimeMs: (this.routeStartWorldTimeMs
            + (motion.cumulativeCostBefore * 1000n + 2047n) / 2048n).toString(),
          endWorldTimeMs: motion.endWorldTimeMs.toString(),
          accumulatedWeightedCost: motion.cumulativeCostBefore.toString(),
          totalWeightedCost: this.routeTotalCost.toString(),
          pathIndex: motion.pathIndex,
        },
        targetPlacementId: this.currentTargetPlacementId,
        action: this.action === null ? null : this.action.kind === "Resource" ? {
          kind: "Resource",
          actionId: this.action.actionId,
          placementId: this.action.placementId,
          prototypeId: this.action.prototypeId,
          startWorldTimeMs: this.action.startWorldTimeMs.toString(),
          endWorldTimeMs: this.action.endWorldTimeMs.toString(),
          durationMs: this.action.durationMs.toString(),
          skillSpeedBps: this.action.skillSpeedBps,
          toolSpeedBps: this.action.toolSpeedBps,
          totalSpeedBps: this.action.totalSpeedBps,
        } : {
          kind: "Produce",
          actionId: this.action.actionId,
          recipeId: this.action.recipeId,
          startWorldTimeMs: this.action.startWorldTimeMs.toString(),
          endWorldTimeMs: this.action.endWorldTimeMs.toString(),
          durationMs: this.action.durationMs.toString(),
          skillSpeedBps: this.action.skillSpeedBps,
          totalSpeedBps: this.action.totalSpeedBps,
        },
        waitingReason: this.reason,
      },
      worldChunks: this.persistedWorldChunks(),
      playerHpMicro: this.playerHpMicro.toString(),
      playerMaxHpMicro: this.playerMaxHpMicro.toString(),
      hpRegenNumerator: this.hpRegenNumerator.toString(),
      combat: this.persistedCombatState(),
      respawn: this.respawn === null ? null : {
        deathPosition: clonePoint(this.respawn.deathPosition),
        deadlineWorldTimeMs: this.respawn.deadlineWorldTimeMs.toString(),
      },
      revivalGraceUntilWorldTimeMs: this.revivalGraceUntilWorldTimeMs?.toString() ?? null,
      targetKills: this.targetKills,
      otherKills: this.otherKills,
      deaths: this.deaths,
      respawns: this.respawns,
      nextEventOrdinal: this.nextEventOrdinal.toString(),
    };
  }

  restore(state: EngineRestoreState): void {
    this.gameplayEpoch += 1;
    this.plannerGeneration += 1;
    this.seed = state.seed;
    this.worldTimeMs = BigInt(state.worldTimeMs);
    this.position = clonePoint(state.position);
    this.campAnchor = clonePoint(state.campAnchor);
    this.totalXp = state.totalXp;
    this.gatheringXp = state.gatheringXp;
    this.woodcuttingXp = state.woodcuttingXp;
    this.miningXp = state.miningXp;
    this.craftingXp = state.craftingXp;
    this.meleeXp = state.meleeXp;
    this.stealthXp = state.stealthXp;
    this.fiber = state.fiber;
    this.softwood = state.softwood;
    this.stone = state.stone;
    this.copperOre = state.copperOre;
    this.rope = state.rope;
    this.rawHide = state.rawHide;
    this.wornAxe = state.wornAxe;
    this.wornPickaxe = state.wornPickaxe;
    this.reinforcedAxe = state.reinforcedAxe;
    this.reinforcedPickaxe = state.reinforcedPickaxe;
    this.equipment = { ...state.equipment };
    this.task = state.task === null ? null : structuredClone(state.task);
    this.anchor = null;
    this.pendingTerrain = null;
    this.terrain.clear();
    this.fog.clear();
    this.knownPlacements.clear();
    this.knownEnemyPlacements.clear();
    this.unreachablePlacementIds.clear();
    for (const chunk of state.worldChunks) {
      this.fog.set(chunk.chunkKey, base64ToFogBits(chunk.revealedBase64));
      for (const placement of chunk.knownPlacements) this.knownPlacements.set(placement.placementId, structuredClone(placement));
      for (const placement of chunk.knownEnemyPlacements) this.knownEnemyPlacements.set(placement.placementId, structuredClone(placement));
    }
    this.playerHpMicro = BigInt(state.playerHpMicro);
    this.playerMaxHpMicro = BigInt(state.playerMaxHpMicro);
    this.hpRegenNumerator = BigInt(state.hpRegenNumerator);
    this.combat = state.combat === null ? null : this.restoreCombatState(state.combat);
    this.respawn = state.respawn === null ? null : {
      deathPosition: clonePoint(state.respawn.deathPosition),
      deadlineWorldTimeMs: BigInt(state.respawn.deadlineWorldTimeMs),
    };
    this.revivalGraceUntilWorldTimeMs = state.revivalGraceUntilWorldTimeMs === null ? null : BigInt(state.revivalGraceUntilWorldTimeMs);
    this.targetKills = state.targetKills;
    this.otherKills = state.otherKills;
    this.deaths = state.deaths;
    this.respawns = state.respawns;
    this.nextEventOrdinal = BigInt(state.nextEventOrdinal);
    this.revealedTileCount = 0;
    for (const bits of this.fog.values()) {
      for (const byte of bits) {
        let value = byte;
        while (value !== 0) { this.revealedTileCount += value & 1; value >>>= 1; }
      }
    }
    this.clearRoute();
    this.routePurpose = state.routePurpose;
    this.currentTargetPlacementId = state.targetPlacementId;
    this.action = state.action === null ? null : state.action.kind === "Resource" ? {
      kind: "Resource",
      actionId: state.action.actionId,
      placementId: state.action.placementId,
      prototypeId: state.action.prototypeId,
      startWorldTimeMs: BigInt(state.action.startWorldTimeMs),
      endWorldTimeMs: BigInt(state.action.endWorldTimeMs),
      durationMs: BigInt(state.action.durationMs),
      skillSpeedBps: state.action.skillSpeedBps,
      toolSpeedBps: state.action.toolSpeedBps,
      totalSpeedBps: state.action.totalSpeedBps,
    } : {
      kind: "Produce",
      actionId: state.action.actionId,
      recipeId: state.action.recipeId,
      startWorldTimeMs: BigInt(state.action.startWorldTimeMs),
      endWorldTimeMs: BigInt(state.action.endWorldTimeMs),
      durationMs: BigInt(state.action.durationMs),
      skillSpeedBps: state.action.skillSpeedBps,
      totalSpeedBps: state.action.totalSpeedBps,
    };
    this.reason = null;
    if (this.combat !== null) {
      this.activityState = "combat";
    } else if (this.respawn !== null) {
      this.activityState = "respawning";
    } else if (this.task === null) {
      this.activityState = "idle";
    } else if (state.executionState === "acting" && this.action !== null) {
      this.activityState = "acting";
    } else if (state.executionState === "waiting" && state.waitingReason?.code === "MaterialsMissing") {
      this.beginPlanning();
    } else if (state.executionState === "waiting" || state.executionState === "paused") {
      this.activityState = state.executionState;
      this.reason = state.waitingReason;
    } else {
      this.beginPlanning();
    }
    this.guaranteeStepper = new GuaranteePlacementStepper(this.seed, this.campAnchor, this.terrain);
    this.enemyGuaranteeStepper = null;
    this.guaranteePlacements = [];
    this.enemyGuaranteePlacements = [];
    this.pendingContentCells.clear();
    this.queueAllRevealedContentCells();
    this.immediateCommitPending = false;
    this.startup = "ready";
    this.bumpRevision();
  }

  beginCreateWorld(seed: SeedDecimal): void {
    this.gameplayEpoch += 1;
    this.plannerGeneration += 1;
    this.seed = seed;
    this.anchor = new CampAnchorStepper();
    this.planner = null;
    this.pendingTerrain = null;
    this.terrain.clear();
    this.fog.clear();
    this.position = null;
    this.campAnchor = null;
    this.totalXp = 0;
    this.gatheringXp = 0;
    this.woodcuttingXp = 0;
    this.miningXp = 0;
    this.craftingXp = 0;
    this.meleeXp = 0;
    this.stealthXp = 0;
    this.fiber = 0;
    this.softwood = 0;
    this.stone = 0;
    this.copperOre = 0;
    this.rope = 0;
    this.rawHide = 0;
    this.wornAxe = 0;
    this.wornPickaxe = 0;
    this.reinforcedAxe = 0;
    this.reinforcedPickaxe = 0;
    this.equipment = { axe: "worn_axe", pickaxe: "worn_pickaxe" };
    this.task = null;
    this.knownPlacements.clear();
    this.knownEnemyPlacements.clear();
    this.unreachablePlacementIds.clear();
    this.guaranteePlacements = [];
    this.guaranteeStepper = null;
    this.enemyGuaranteeStepper = null;
    this.pendingContentCells.clear();
    this.activeContentCell = null;
    this.currentTargetPlacementId = null;
    this.action = null;
    this.resetCombatProgress();
    this.nextEventOrdinal = 0n;
    this.immediateCommitPending = false;
    this.clearRoute();
    this.activityState = "planning";
    this.reason = null;
    this.startup = "new_world";
    this.bumpRevision();
  }

  resetToNewWorld(): void {
    this.gameplayEpoch += 1;
    this.plannerGeneration += 1;
    this.seed = null;
    this.worldTimeMs = 0n;
    this.position = null;
    this.campAnchor = null;
    this.totalXp = 0;
    this.gatheringXp = 0;
    this.woodcuttingXp = 0;
    this.miningXp = 0;
    this.craftingXp = 0;
    this.meleeXp = 0;
    this.stealthXp = 0;
    this.fiber = 0;
    this.softwood = 0;
    this.stone = 0;
    this.copperOre = 0;
    this.rope = 0;
    this.rawHide = 0;
    this.wornAxe = 0;
    this.wornPickaxe = 0;
    this.reinforcedAxe = 0;
    this.reinforcedPickaxe = 0;
    this.equipment = { axe: "worn_axe", pickaxe: "worn_pickaxe" };
    this.revealedTileCount = 0;
    this.task = null;
    this.anchor = null;
    this.guaranteeStepper = null;
    this.enemyGuaranteeStepper = null;
    this.guaranteePlacements = [];
    this.planner = null;
    this.pendingTerrain = null;
    this.terrain.clear();
    this.fog.clear();
    this.knownPlacements.clear();
    this.knownEnemyPlacements.clear();
    this.pendingContentCells.clear();
    this.activeContentCell = null;
    this.currentTargetPlacementId = null;
    this.action = null;
    this.resetCombatProgress();
    this.nextEventOrdinal = 0n;
    this.immediateCommitPending = false;
    this.clearRoute();
    this.activityState = "idle";
    this.reason = null;
    this.startup = "new_world";
    this.bumpRevision();
  }

  setTask(commandId: string, taskInput: EngineTaskInput): void {
    this.requireWorld();
    if (taskInput.kind === "Gather" || taskInput.kind === "Woodcut" || taskInput.kind === "Mine") {
      const definition = resourceDefinition(taskInput.targetPrototypeId);
      if (!taskKindMatchesPrototype(taskInput.kind, taskInput.targetPrototypeId)) {
        throw new UnknownTargetPrototypeError(`${taskInput.kind} cannot target ${taskInput.targetPrototypeId}`);
      }
      if (!this.hasKnownPrototype(taskInput.targetPrototypeId)) {
        throw new UnknownTargetPrototypeError(`${taskInput.targetPrototypeId} is not known in this world`);
      }
      const actualLevel = levelFromTotalXp(this.skillXpFor(definition.skillId));
      if (actualLevel < definition.requiredLevel) {
        throw new SkillLevelTooLowError(definition.prototypeId, definition.skillId, definition.requiredLevel, actualLevel);
      }
    } else if (taskInput.kind === "Produce") {
      const definition = recipeDefinition(taskInput.recipeId);
      const actualLevel = levelFromTotalXp(this.craftingXp);
      if (actualLevel < definition.requiredLevel) {
        throw new RecipeLevelTooLowError(definition.recipeId, definition.requiredLevel, actualLevel);
      }
    } else if (taskInput.kind === "Hunt" && !this.hasKnownEnemyArchetype(taskInput.archetypeId)) {
      throw new UnknownTargetPrototypeError(`${taskInput.archetypeId} is not known in this world`);
    }
    this.plannerGeneration += 1;
    this.materializeCurrentPosition();
    if (taskInput.kind === "Gather" || taskInput.kind === "Woodcut" || taskInput.kind === "Mine") {
      const common = {
        taskId: taskIdFromCommandId(commandId), quantity: taskInput.quantity, completedQuantity: 0,
        createdWorldTimeMs: this.worldTimeMs.toString(),
      };
      if (taskInput.kind === "Gather") this.task = { ...common, kind: "Gather", targetPrototypeId: "wild_fiber" };
      else if (taskInput.kind === "Woodcut") this.task = { ...common, kind: "Woodcut", targetPrototypeId: "softwood_tree" };
      else this.task = { ...common, kind: "Mine", targetPrototypeId: taskInput.targetPrototypeId };
    } else if (taskInput.kind === "Produce") {
      this.task = {
        taskId: taskIdFromCommandId(commandId), kind: "Produce", recipeId: taskInput.recipeId,
        requestedQuantity: taskInput.requestedQuantity, completedQuantity: 0,
        createdWorldTimeMs: this.worldTimeMs.toString(),
      };
    } else if (taskInput.kind === "Hunt") {
      this.task = {
        taskId: taskIdFromCommandId(commandId), kind: "Hunt", archetypeId: taskInput.archetypeId,
        requestedKills: taskInput.requestedKills, completedKills: 0,
        createdWorldTimeMs: this.worldTimeMs.toString(),
      };
    } else {
      this.task = {
        taskId: taskIdFromCommandId(commandId), kind: "Explore", mode: taskInput.mode,
        destination: taskInput.destination === null ? null : clonePoint(taskInput.destination),
        createdWorldTimeMs: this.worldTimeMs.toString(),
      };
    }
    this.invalidatePendingStealthPasses();
    if (this.combat !== null) {
      this.combat = { ...this.combat, paused: null };
      this.activityState = "combat";
      this.reason = null;
      this.bumpRevision();
      return;
    }
    if (this.respawn !== null) {
      this.activityState = "respawning";
      this.reason = null;
      this.bumpRevision();
      return;
    }
    this.pendingTerrain = null;
    this.action = null;
    this.currentTargetPlacementId = null;
    this.clearRoute();
    this.beginPlanning();
    this.bumpRevision();
  }

  equipItem(itemId: ToolItemId): void {
    this.requireWorld();
    if (this.combat !== null) throw new CombatLockedError();
    const tool = TOOL_DEFINITIONS[itemId];
    if (this.equipment[tool.slot] === itemId) return;
    const actualLevel = levelFromTotalXp(this.skillXpFor(tool.requiredSkill));
    if (actualLevel < tool.requiredLevel) {
      throw new EquipmentLevelTooLowError(itemId, tool.requiredSkill, tool.requiredLevel, actualLevel);
    }
    const inventoryQuantity = this.toolInventoryQuantity(itemId);
    if (inventoryQuantity < 1) throw new ItemUnavailableError(`${itemId} is not in inventory`);
    const previous = this.equipment[tool.slot];
    const previousQuantity = previous === null ? 0 : this.toolInventoryQuantity(previous);
    if (previousQuantity + (previous === null ? 0 : 1) > Number.MAX_SAFE_INTEGER) {
      throw new QuantityOverflowError("equipment swap exceeds safe integer storage");
    }
    this.setToolInventoryQuantity(itemId, inventoryQuantity - 1);
    if (previous !== null) this.setToolInventoryQuantity(previous, previousQuantity + 1);
    this.equipment = { ...this.equipment, [tool.slot]: itemId };
    this.restartExecutionAfterEquipmentChange();
  }

  unequipSlot(slot: ToolSlot): void {
    this.requireWorld();
    if (this.combat !== null) throw new CombatLockedError();
    const itemId = this.equipment[slot];
    if (itemId === null) return;
    const nextQuantity = this.toolInventoryQuantity(itemId) + 1;
    if (!Number.isSafeInteger(nextQuantity)) throw new QuantityOverflowError("unequip exceeds safe integer storage");
    this.setToolInventoryQuantity(itemId, nextQuantity);
    this.equipment = { ...this.equipment, [slot]: null };
    this.restartExecutionAfterEquipmentChange();
  }

  cancelTask(): void {
    this.requireWorld();
    this.plannerGeneration += 1;
    this.materializeCurrentPosition();
    this.invalidatePendingStealthPasses();
    if (this.combat !== null) {
      this.combat = { ...this.combat, paused: null };
      this.task = null;
      this.activityState = "combat";
      this.reason = null;
      this.bumpRevision();
      return;
    }
    if (this.respawn !== null) {
      this.task = null;
      this.activityState = "respawning";
      this.reason = null;
      this.bumpRevision();
      return;
    }
    this.pendingTerrain = null;
    this.action = null;
    this.currentTargetPlacementId = null;
    this.task = null;
    this.clearRoute();
    this.activityState = "idle";
    this.reason = null;
    this.bumpRevision();
  }

  pause(reason: ActivityReason): void {
    this.plannerGeneration += 1;
    this.pendingTerrain = null;
    this.planner = null;
    this.activityState = "paused";
    this.reason = reason;
    this.bumpRevision();
  }

  step(maxOperations: number): EngineStepResult {
    if (!Number.isInteger(maxOperations) || maxOperations < 1) throw new RangeError("engine operation budget must be positive");
    if (this.pendingTerrain !== null) return this.pendingTerrain.effect;
    if (this.anchor !== null) {
      const result = this.anchor.step(maxOperations);
      if (result.kind === "terrain-required") return this.setTerrainEffect("anchor", result.chunkX, result.chunkY, result.chunkKey);
      if (result.kind === "yield") return result;
      this.anchor = null;
      if (result.anchor === null) throw new InvalidWorldSeedError(`seed ${this.seed} has no valid phase-1 camp anchor`);
      this.worldTimeMs = 0n;
      this.position = result.anchor.point;
      this.campAnchor = clonePoint(result.anchor.point);
      this.totalXp = 0;
      this.gatheringXp = 0;
      this.woodcuttingXp = 0;
      this.miningXp = 0;
      this.craftingXp = 0;
      this.meleeXp = 0;
      this.stealthXp = 0;
      this.fiber = 0;
      this.softwood = 0;
      this.stone = 0;
      this.copperOre = 0;
      this.rope = 0;
      this.rawHide = 0;
      this.wornAxe = 0;
      this.wornPickaxe = 0;
      this.reinforcedAxe = 0;
      this.reinforcedPickaxe = 0;
      this.equipment = { axe: "worn_axe", pickaxe: "worn_pickaxe" };
      this.resetCombatProgress();
      this.revealedTileCount = 0;
      this.task = null;
      this.activityState = "idle";
      this.clearRoute();
      this.reason = null;
      this.revealAtCurrent(false);
      this.guaranteeStepper = new GuaranteePlacementStepper(this.seed!, this.campAnchor, this.terrain);
      this.bumpRevision();
      return { kind: "yield" };
    }
    if (this.guaranteeStepper !== null) {
      const result = this.guaranteeStepper.step(maxOperations);
      if (result.kind === "terrain-required") return this.setTerrainEffect("content", result.chunkX, result.chunkY, result.chunkKey);
      if (result.kind === "yield") return result;
      this.guaranteeStepper = null;
      this.guaranteePlacements = result.placements.map((placement) => structuredClone(placement));
      for (const placement of this.guaranteePlacements) this.discoverPlacementIfRevealed(placement);
      this.enemyGuaranteeStepper = new EnemyGuaranteePlacementStepper(
        this.seed!,
        this.campAnchor!,
        this.terrain,
        new Set(this.guaranteePlacements.map((placement) => `${placement.tileX},${placement.tileY}`)),
      );
      this.bumpRevision();
      return { kind: "yield" };
    }
    if (this.enemyGuaranteeStepper !== null) {
      const result = this.enemyGuaranteeStepper.step(maxOperations);
      if (result.kind === "terrain-required") return this.setTerrainEffect("content", result.chunkX, result.chunkY, result.chunkKey);
      if (result.kind === "yield") return result;
      this.enemyGuaranteeStepper = null;
      this.enemyGuaranteePlacements = result.placements.map((placement) => structuredClone(placement));
      for (const placement of this.enemyGuaranteePlacements) this.discoverEnemyIfRevealed(placement);
      this.startup = "ready";
      this.bumpRevision();
      return this.pendingContentCells.size > 0 ? { kind: "yield" } : { kind: "settled" };
    }
    if (this.pendingContentCells.size > 0) {
      const result = this.processNextContentCell();
      if (result !== null) return result;
      this.afterContentObservation();
      return this.pendingContentCells.size > 0 ? { kind: "yield" } : { kind: "settled" };
    }
    if (this.activityState !== "planning") return { kind: "settled" };
    if (this.resourcePlanning !== null) return this.stepResourcePlanning(maxOperations);
    if (this.enemyPlanning !== null) return this.stepEnemyPlanning(maxOperations);
    if (this.planner === null) return { kind: "settled" };
    const result = this.planner.step(maxOperations);
    if (result.kind === "terrain-required") return this.setTerrainEffect("navigation", result.chunkX, result.chunkY, result.chunkKey);
    if (result.kind === "yield") return result;
    this.applyPlanResult(result);
    return this.activityState === "planning" ? { kind: "yield" } : { kind: "settled" };
  }

  provideTerrain(effect: EngineTerrainEffect, bytes: Uint8Array): void {
    const pending = this.pendingTerrain;
    if (pending === null || pending.effect.gameplayEpoch !== effect.gameplayEpoch || pending.effect.seed !== effect.seed
      || pending.effect.chunkKey !== effect.chunkKey || pending.effect.chunkX !== effect.chunkX || pending.effect.chunkY !== effect.chunkY) {
      throw new Error("terrain input does not match the active engine effect");
    }
    this.terrain.provideChunk(effect.chunkX, effect.chunkY, bytes);
    if (pending.source === "anchor") this.anchor?.provideChunk(effect.chunkX, effect.chunkY, bytes);
    this.pendingTerrain = null;
  }

  /** Advances through exact motion events; planning/terrain effects return unconsumed time. */
  advanceBy(deltaMs: bigint): bigint {
    if (deltaMs < 0n) throw new RangeError("world-time delta must be non-negative");
    this.requireWorld();
    const target = this.worldTimeMs + deltaMs;
    while (true) {
      if (this.hasPendingWork || this.activityState === "paused" || this.immediateCommitPending) return target - this.worldTimeMs;
      const motion = this.motion;
      const nextBoundaryTime = motion?.boundaryWorldTimes[motion.boundaryIndex] ?? null;
      const nextMotionTime = motion === null ? null : nextBoundaryTime !== null && nextBoundaryTime < motion.endWorldTimeMs
        ? nextBoundaryTime : motion.endWorldTimeMs;
      const nextThreatTime = motion === null || this.combat !== null || this.respawn !== null ? null : this.nextMotionThreatWorldTime(motion);
      const nextActionTime = this.combat === null && this.respawn === null ? this.action?.endWorldTimeMs ?? null : null;
      const nextRespawnTime = this.nextRespawnWorldTime();
      const nextPlayerRespawnTime = this.respawn?.deadlineWorldTimeMs ?? null;
      const nextCombatAttackTime = this.combat === null ? null
        : this.combat.playerNextAttackWorldTimeMs < this.combat.enemyNextAttackWorldTimeMs
          ? this.combat.playerNextAttackWorldTimeMs : this.combat.enemyNextAttackWorldTimeMs;
      const nextGraceExpiry = this.revivalGraceUntilWorldTimeMs !== null && this.revivalGraceUntilWorldTimeMs > this.worldTimeMs
        ? this.revivalGraceUntilWorldTimeMs : null;
      let nextEventTime: bigint | null = null;
      for (const candidate of [nextGraceExpiry, nextPlayerRespawnTime, nextRespawnTime, nextCombatAttackTime, nextActionTime, nextThreatTime, nextMotionTime]) {
        if (candidate !== null && (nextEventTime === null || candidate < nextEventTime)) nextEventTime = candidate;
      }
      if (nextEventTime === null) {
        if (this.worldTimeMs >= target) return 0n;
        this.advanceWorldTimeTo(target);
        this.bumpRevision();
        return 0n;
      }
      if (target < nextEventTime) {
        this.advanceWorldTimeTo(target);
        if (motion !== null) this.position = this.positionForMotion(motion, target);
        this.bumpRevision();
        return 0n;
      }
      this.advanceWorldTimeTo(nextEventTime);
      if (motion !== null) this.position = this.positionForMotion(motion, nextEventTime);

      if (nextGraceExpiry === nextEventTime) {
        this.revivalGraceUntilWorldTimeMs = null;
      }
      if (nextPlayerRespawnTime === nextEventTime && this.respawn !== null) {
        this.completePlayerRespawn();
      }
      if (nextRespawnTime === nextEventTime) {
        this.processRespawnsAt(nextEventTime);
      }
      if (this.combat === null && this.respawn === null && (nextGraceExpiry === nextEventTime || nextRespawnTime === nextEventTime)) {
        this.evaluateEncountersAtCurrent();
      }
      if (nextCombatAttackTime === nextEventTime && this.combat !== null) {
        this.processCombatAttacksAt(nextEventTime);
      }
      if (this.combat === null && this.respawn === null && nextActionTime === nextEventTime && this.action !== null) {
        if (this.action.kind === "Resource") this.completeResourceAction();
        else this.completeProductionAction();
        this.bumpRevision();
        return target - this.worldTimeMs;
      }

      if (motion === null || this.motion !== motion || this.combat !== null || this.respawn !== null) {
        this.bumpRevision();
        if (this.hasPendingWork || this.immediateCommitPending) return target - this.worldTimeMs;
        continue;
      }
      let observed = false;
      if (nextBoundaryTime === nextEventTime) {
        while (motion.boundaryIndex < motion.boundaryWorldTimes.length
          && motion.boundaryWorldTimes[motion.boundaryIndex] === nextEventTime) motion.boundaryIndex += 1;
        this.revealAtCurrent(true);
        observed = true;
        if (this.motion !== motion) {
          this.bumpRevision();
          return target - this.worldTimeMs;
        }
      }
      if (nextThreatTime === nextEventTime || nextBoundaryTime === nextEventTime || nextMotionTime === nextEventTime) {
        this.processMotionThreatsAt(motion, nextEventTime);
        if (this.combat !== null || this.immediateCommitPending || this.motion !== motion) {
          this.bumpRevision();
          return target - this.worldTimeMs;
        }
      }
      if (motion.endWorldTimeMs === nextEventTime) {
        const completedRoutePurpose = this.routePurpose;
        this.position = clonePoint(motion.profile.end);
        this.routeIndex = motion.pathIndex + 1;
        this.motion = null;
        if (!observed) this.revealAtCurrent(true);
        if (this.activityState !== "moving" || this.routePurpose !== completedRoutePurpose) {
          this.bumpRevision();
          return target - this.worldTimeMs;
        }
        if (this.routeIndex + 1 < this.route.length) this.startMotionForCurrentLeg();
        else this.finishRoute();
      }
      this.bumpRevision();
      if (this.hasPendingWork || this.immediateCommitPending) return target - this.worldTimeMs;
    }
  }

  toReadModel(saveRevision = 0, committedWallClockMs: number | null = null, options: EngineReadModelOptions = {}): GameplayReadModelV2 {
    const level = levelFromTotalXp(this.totalXp);
    const levelStart = xpAtLevelStart(level);
    const gatheringLevel = levelFromTotalXp(this.gatheringXp);
    const gatheringLevelStart = xpAtLevelStart(gatheringLevel);
    const woodcuttingLevel = levelFromTotalXp(this.woodcuttingXp);
    const woodcuttingLevelStart = xpAtLevelStart(woodcuttingLevel);
    const miningLevel = levelFromTotalXp(this.miningXp);
    const miningLevelStart = xpAtLevelStart(miningLevel);
    const craftingLevel = levelFromTotalXp(this.craftingXp);
    const craftingLevelStart = xpAtLevelStart(craftingLevel);
    const meleeLevel = levelFromTotalXp(this.meleeXp);
    const meleeLevelStart = xpAtLevelStart(meleeLevel);
    const stealthLevel = levelFromTotalXp(this.stealthXp);
    const stealthLevelStart = xpAtLevelStart(stealthLevel);
    const gatheringSpeed = authoritativeResourceDuration("wild_fiber", gatheringLevel).skillSpeedBps;
    const woodcuttingSpeed = authoritativeResourceDuration("softwood_tree", woodcuttingLevel).skillSpeedBps;
    const miningSpeed = authoritativeResourceDuration("surface_stone", miningLevel).skillSpeedBps;
    const remainingEtaMs = this.remainingRouteEtaMs();
    const action = this.action;
    return {
      protocolVersion: 2,
      readModelRevision: this.readModelRevision,
      gameplayEpoch: this.gameplayEpoch,
      startup: options.startup ?? this.startup,
      generatorVersion: this.generatorVersion,
      player: this.position === null ? null : {
        position: clonePoint(this.position),
        hp: { currentMicro: this.playerHpMicro.toString(), maxMicro: this.playerMaxHpMicro.toString() },
        state: this.respawn !== null ? "dead" : this.combat !== null ? "combat" : "alive",
        naturalRegen: "1% max HP / 10s",
        revivalGraceRemainingMs: this.revivalGraceUntilWorldTimeMs === null ? null
          : (this.revivalGraceUntilWorldTimeMs > this.worldTimeMs ? this.revivalGraceUntilWorldTimeMs - this.worldTimeMs : 0n).toString(),
      },
      task: this.task,
      activity: {
        state: this.activityState,
        phase: this.activityPhase(),
        route: this.route.map(clonePoint), routePurpose: this.routePurpose,
        routeIndex: this.route.length === 0 ? 0 : Math.min(this.routeIndex, this.route.length - 1),
        etaMs: remainingEtaMs === null ? null : remainingEtaMs.toString(),
        progressPermille: action !== null ? this.actionProgressPermille(action)
          : this.motion === null ? null : this.motionProgressPermille(this.motion),
        targetPlacementId: this.currentTargetPlacementId,
        action: action === null ? null : action.kind === "Resource" ? {
          kind: "Resource",
          actionId: action.actionId,
          placementId: action.placementId,
          prototypeId: action.prototypeId,
          baseDurationMs: resourceDefinition(action.prototypeId).baseDurationMs.toString(),
          durationMs: action.durationMs.toString(),
          remainingMs: (action.endWorldTimeMs > this.worldTimeMs ? action.endWorldTimeMs - this.worldTimeMs : 0n).toString(),
          skillSpeedBps: action.skillSpeedBps,
          toolSpeedBps: action.toolSpeedBps,
          totalSpeedBps: action.totalSpeedBps,
        } : {
          kind: "Produce",
          actionId: action.actionId,
          recipeId: action.recipeId,
          baseDurationMs: recipeDefinition(action.recipeId).baseDurationMs.toString(),
          durationMs: action.durationMs.toString(),
          remainingMs: (action.endWorldTimeMs > this.worldTimeMs ? action.endWorldTimeMs - this.worldTimeMs : 0n).toString(),
          skillSpeedBps: action.skillSpeedBps,
          totalSpeedBps: action.totalSpeedBps,
        },
        reason: this.reason,
      },
      exploration: this.position === null ? null : {
        level, totalXp: this.totalXp, currentLevelXp: this.totalXp - levelStart, nextLevelXp: xpForNextLevel(level),
        observationRadiusTiles: observationRadius(level), revealedTileCount: this.revealedTileCount,
      },
      skills: this.position === null ? null : {
        gathering: {
          level: gatheringLevel,
          totalXp: this.gatheringXp,
          currentLevelXp: this.gatheringXp - gatheringLevelStart,
          nextLevelXp: xpForNextLevel(gatheringLevel),
          skillSpeedBps: gatheringSpeed,
        },
        woodcutting: {
          level: woodcuttingLevel,
          totalXp: this.woodcuttingXp,
          currentLevelXp: this.woodcuttingXp - woodcuttingLevelStart,
          nextLevelXp: xpForNextLevel(woodcuttingLevel),
          skillSpeedBps: woodcuttingSpeed,
        },
        mining: {
          level: miningLevel,
          totalXp: this.miningXp,
          currentLevelXp: this.miningXp - miningLevelStart,
          nextLevelXp: xpForNextLevel(miningLevel),
          skillSpeedBps: miningSpeed,
        },
        crafting: {
          level: craftingLevel,
          totalXp: this.craftingXp,
          currentLevelXp: this.craftingXp - craftingLevelStart,
          nextLevelXp: xpForNextLevel(craftingLevel),
          skillSpeedBps: Math.min(Math.max(craftingLevel - 1, 0) * 50, 2_500),
        },
        melee: {
          level: meleeLevel,
          totalXp: this.meleeXp,
          currentLevelXp: this.meleeXp - meleeLevelStart,
          nextLevelXp: xpForNextLevel(meleeLevel),
          skillSpeedBps: 0,
        },
        stealth: {
          level: stealthLevel,
          totalXp: this.stealthXp,
          currentLevelXp: this.stealthXp - stealthLevelStart,
          nextLevelXp: xpForNextLevel(stealthLevel),
          skillSpeedBps: 0,
        },
      },
      inventory: this.position === null ? null : {
        items: [
          ...(this.fiber === 0 ? [] : [{ itemId: "fiber", displayName: "纤维", category: "material", quantity: this.fiber }] as const),
          ...(this.softwood === 0 ? [] : [{ itemId: "softwood", displayName: "软木", category: "material", quantity: this.softwood }] as const),
          ...(this.stone === 0 ? [] : [{ itemId: "stone", displayName: "石料", category: "material", quantity: this.stone }] as const),
          ...(this.copperOre === 0 ? [] : [{ itemId: "copper_ore", displayName: "铜矿石", category: "material", quantity: this.copperOre }] as const),
          ...(this.rope === 0 ? [] : [{ itemId: "rope", displayName: "绳索", category: "material", quantity: this.rope }] as const),
          ...(this.rawHide === 0 ? [] : [{ itemId: "raw_hide", displayName: "生皮", category: "material", quantity: this.rawHide }] as const),
          ...(this.wornAxe === 0 ? [] : [{ itemId: "worn_axe", displayName: "破旧斧", category: "equipment", quantity: this.wornAxe }] as const),
          ...(this.wornPickaxe === 0 ? [] : [{ itemId: "worn_pickaxe", displayName: "破旧镐", category: "equipment", quantity: this.wornPickaxe }] as const),
          ...(this.reinforcedAxe === 0 ? [] : [{ itemId: "reinforced_axe", displayName: "强化斧", category: "equipment", quantity: this.reinforcedAxe }] as const),
          ...(this.reinforcedPickaxe === 0 ? [] : [{ itemId: "reinforced_pickaxe", displayName: "强化镐", category: "equipment", quantity: this.reinforcedPickaxe }] as const),
        ],
      },
      equipment: this.position === null ? null : {
        weapon: {
          itemId: "worn_blade", displayName: "破旧短刃", damageMin: 4, damageMax: 6,
          accuracyBonus: 5, attackIntervalMs: "2500", requiredMeleeLevel: 1,
        },
        axe: this.equipment.axe === null ? null : this.toolEquipmentSummary(this.equipment.axe),
        pickaxe: this.equipment.pickaxe === null ? null : this.toolEquipmentSummary(this.equipment.pickaxe),
      },
      toolCandidates: this.position === null ? [] : (Object.values(TOOL_DEFINITIONS) as typeof TOOL_DEFINITIONS[ToolItemId][]).map((tool) => {
        const actualLevel = levelFromTotalXp(this.skillXpFor(tool.requiredSkill));
        return {
          itemId: tool.itemId, displayName: tool.displayName, slot: tool.slot, tier: tool.tier, speedBps: tool.speedBps,
          requiredSkillId: tool.requiredSkill, requiredLevel: tool.requiredLevel, actualLevel,
          canEquip: actualLevel >= tool.requiredLevel, inventoryQuantity: this.toolInventoryQuantity(tool.itemId),
          equipped: this.equipment[tool.slot] === tool.itemId,
        };
      }),
      recipes: this.position === null ? [] : RECIPE_ORDER.map((recipeId) => {
        const definition = recipeDefinition(recipeId);
        const duration = authoritativeCraftingDuration(recipeId, craftingLevel);
        return {
          recipeId, displayName: definition.displayName, skillId: "crafting" as const,
          requiredLevel: definition.requiredLevel, locked: craftingLevel < definition.requiredLevel,
          inputs: definition.inputs.map((input) => {
            const available = this.itemQuantity(input.itemId);
            return { ...input, required: input.quantity, available, missing: Math.max(input.quantity - available, 0) };
          }).map(({ quantity: _quantity, ...input }) => input),
          output: definition.output, baseDurationMs: definition.baseDurationMs.toString(), durationMs: duration.durationMs.toString(),
          skillSpeedBps: duration.skillSpeedBps, totalSpeedBps: duration.totalSpeedBps, xp: definition.xp, station: "handcraft" as const,
        };
      }),
      knownTargetPrototypeIds: RESOURCE_PROTOTYPE_ORDER.filter((prototypeId) => this.hasKnownPrototype(prototypeId)),
      knownEnemyArchetypeIds: this.hasKnownEnemyArchetype("graymane_boar") ? ["graymane_boar"] : [],
      combat: this.combatSummary(),
      respawn: this.respawn === null ? null : {
        deathPosition: clonePoint(this.respawn.deathPosition),
        remainingMs: (this.respawn.deadlineWorldTimeMs > this.worldTimeMs ? this.respawn.deadlineWorldTimeMs - this.worldTimeMs : 0n).toString(),
      },
      map: {
        revealedChunks: [...this.fog.entries()].sort(([left], [right]) => compareChunkKeysNumeric(left, right)).map(([chunkKey, bits]) => {
          const [chunkX, chunkY] = chunkKey.split(",") as [string, string];
          return { chunkKey, chunkX, chunkY, revealedBase64: fogBitsToBase64(bits) };
        }),
        resourcePlacements: this.resourcePlacementSummaries(),
        enemyPlacements: this.enemyPlacementSummaries(),
        selectedDestination: null,
      },
      save: options.saveState ?? { state: saveRevision === 0 ? "none" : "saved", revision: saveRevision, committedWallClockMs, localOnly: true, evictionWarning: false, lastError: null },
      offlineReport: options.offlineReport ?? null,
    };
  }

  private setTerrainEffect(source: PendingTerrain["source"], chunkX: string, chunkY: string, chunkKey: string): EngineTerrainEffect {
    if (this.seed === null) throw new Error("terrain effect requires a world seed");
    const effect: EngineTerrainEffect = { kind: "terrain-request", gameplayEpoch: this.gameplayEpoch, seed: this.seed, chunkKey, chunkX, chunkY };
    this.pendingTerrain = { source, effect };
    return effect;
  }

  private requireWorld(): void {
    if (this.seed === null || this.position === null) throw new Error("gameplay world has not been created");
  }

  private bumpRevision(): void {
    if (this.readModelRevision >= Number.MAX_SAFE_INTEGER) throw new RangeError("read model revision exhausted");
    this.readModelRevision += 1;
  }

  private beginPlanning(): void {
    if (this.task === null || this.position === null) return;
    if (isProduceTask(this.task)) {
      const task = this.task;
      if (task.requestedQuantity !== null && task.completedQuantity >= task.requestedQuantity) {
        this.clearRoute();
        this.activityState = "waiting";
        this.reason = TASK_COMPLETED_REASON;
        return;
      }
      const definition = recipeDefinition(task.recipeId);
      const missing = definition.inputs.map((input) => {
        const available = this.itemQuantity(input.itemId);
        return { itemId: input.itemId, displayName: input.displayName, required: input.quantity, available, missing: Math.max(input.quantity - available, 0) };
      }).filter((input) => input.missing > 0);
      this.clearRoute();
      this.currentTargetPlacementId = null;
      if (missing.length > 0) {
        this.activityState = "waiting";
        this.reason = {
          code: "MaterialsMissing", params: { recipeId: task.recipeId, materials: missing },
          allowedActions: ["set_task"], diagnosticId: null,
        };
        return;
      }
      this.startProductionAction();
      return;
    }
    if (isResourceTask(this.task)) {
      const task = this.task;
      if (task.quantity !== null && task.completedQuantity >= task.quantity) {
        this.clearRoute();
        this.activityState = "waiting";
        this.reason = TASK_COMPLETED_REASON;
        return;
      }
      const definition = resourceDefinition(task.targetPrototypeId);
      if (!this.hasRequiredTool(definition.prototypeId)) {
        this.clearRoute();
        this.currentTargetPlacementId = null;
        this.activityState = "waiting";
        this.reason = {
          code: "MissingTool",
          params: { slot: definition.requiredTool!.slot, minimumTier: definition.requiredTool!.minimumTier },
          allowedActions: ["equip_item", "set_task"], diagnosticId: null,
        };
        return;
      }
      const candidates = [...this.knownPlacements.values()]
        .filter((placement) => placement.prototypeId === task.targetPrototypeId && placement.availability === "active")
        .sort((left, right) => left.placementId < right.placementId ? -1 : left.placementId > right.placementId ? 1 : 0);
      this.clearRoute();
      this.currentTargetPlacementId = null;
      if (candidates.length === 0) {
        this.beginAutoExplore();
        return;
      }
      this.resourcePlanning = { candidates, index: 0, planner: null, best: null };
      this.activityState = "planning";
      this.routePurpose = "task_target";
      this.reason = null;
      return;
    }
    if (isHuntTask(this.task)) {
      const task = this.task;
      if (task.requestedKills !== null && task.completedKills >= task.requestedKills) {
        this.clearRoute();
        this.activityState = "waiting";
        this.reason = TASK_COMPLETED_REASON;
        return;
      }
      const candidates = [...this.knownEnemyPlacements.values()]
        .filter((placement) => placement.archetypeId === task.archetypeId && placement.availability === "active")
        .sort((left, right) => left.placementId < right.placementId ? -1 : left.placementId > right.placementId ? 1 : 0);
      this.clearRoute();
      this.currentTargetPlacementId = null;
      if (candidates.length === 0) {
        this.beginAutoExplore();
        return;
      }
      this.enemyPlanning = { candidates, index: 0, planner: null, best: null };
      this.activityState = "planning";
      this.routePurpose = "task_target";
      this.reason = null;
      return;
    }
    const level = levelFromTotalXp(this.totalXp);
    this.clearRoute();
    this.planner = new PlannerStepper(this.terrain, this.fog, this.position, observationRadius(level), this.task.destination);
    this.activityState = "planning";
    this.routePurpose = "explore";
    this.reason = null;
  }

  private beginAutoExplore(): void {
    if (this.position === null) return;
    const level = levelFromTotalXp(this.totalXp);
    this.clearRoute();
    this.planner = new PlannerStepper(this.terrain, this.fog, this.position, observationRadius(level), null);
    this.activityState = "planning";
    this.routePurpose = "auto_explore";
    this.reason = null;
  }

  private applyPlanResult(result: PlanFinal): void {
    this.planner = null;
    if (result.kind === "destination-unreachable") {
      this.clearRoute();
      this.activityState = "waiting";
      this.reason = { code: "DestinationUnreachable", params: { destination: result.destination }, allowedActions: ["set_task"], diagnosticId: null };
      this.bumpRevision();
      return;
    }
    if (result.kind === "no-reachable-frontier") {
      this.clearRoute();
      this.activityState = "waiting";
      this.reason = NO_FRONTIER_REASON;
      this.bumpRevision();
      return;
    }
    this.installRoute(result.plan);
  }

  private installRoute(plan: RoutePlan): void {
    this.route = plan.points.map(clonePoint);
    this.legCosts = [...plan.legCosts];
    this.legProfiles = [...plan.legProfiles];
    this.routeStartWorldTimeMs = this.worldTimeMs;
    const cumulativeCosts: bigint[] = [0n];
    for (const cost of this.legCosts) cumulativeCosts.push(cumulativeCosts.at(-1)! + cost);
    this.routeCumulativeCosts = cumulativeCosts;
    this.routeTotalCost = plan.cost;
    this.routeIndex = 0;
    this.motion = null;
    this.reason = null;
    if (this.route.length <= 1 || plan.cost === 0n) {
      const revealed = this.revealAtCurrent(true);
      if (this.routePurpose === "task_target") {
        if (isHuntTask(this.task)) this.startCombatForCurrentTarget(true);
        else this.startResourceAction();
      }
      else if (this.isAtTaskDestination()) { this.activityState = "waiting"; this.reason = TASK_COMPLETED_REASON; }
      else if (revealed === 0 && this.routePurpose !== "auto_explore") { this.activityState = "waiting"; this.reason = NO_FRONTIER_REASON; }
      else this.beginPlanning();
      this.bumpRevision();
      return;
    }
    if (this.legCosts.length !== this.route.length - 1 || this.legProfiles.length !== this.legCosts.length) {
      throw new Error("route profile count does not match route points");
    }
    this.activityState = "moving";
    this.startMotionForCurrentLeg();
    this.bumpRevision();
  }

  private startMotionForCurrentLeg(): void {
    const profile = this.legProfiles[this.routeIndex];
    const cost = this.legCosts[this.routeIndex];
    if (profile === undefined || cost === undefined || cost <= 0n || profile.cost !== cost) throw new Error("invalid route motion leg");
    const cumulativeCostBefore = this.routeCumulativeCosts[this.routeIndex];
    const cumulativeCostAfter = this.routeCumulativeCosts[this.routeIndex + 1];
    if (cumulativeCostBefore === undefined || cumulativeCostAfter === undefined) throw new Error("route cumulative cost is missing");
    this.motion = {
      profile,
      endWorldTimeMs: this.routeStartWorldTimeMs + (cumulativeCostAfter * 1000n + 2047n) / 2048n,
      pathIndex: this.routeIndex,
      cumulativeCostBefore,
      boundaryWorldTimes: profile.boundaryParameters.map((parameter) => this.routeStartWorldTimeMs
        + routeEventTimeMs(cumulativeCostBefore, profile, parameter)),
      boundaryIndex: 0,
    };
    this.activityState = "moving";
  }

  private finishRoute(): void {
    if (this.routePurpose === "task_target") {
      if (isHuntTask(this.task)) this.startCombatForCurrentTarget(true);
      else this.startResourceAction();
    }
    else if (this.isAtTaskDestination()) { this.activityState = "waiting"; this.reason = TASK_COMPLETED_REASON; }
    else this.beginPlanning();
  }

  private isAtTaskDestination(): boolean {
    const task = this.task;
    const position = this.position;
    return task?.kind === "Explore" && task.mode === "destination" && task.destination !== null && position !== null
      && position.x === task.destination.x && position.y === task.destination.y;
  }

  private clearRoute(): void {
    this.planner = null;
    this.resourcePlanning = null;
    this.enemyPlanning = null;
    this.route = [];
    this.legCosts = [];
    this.legProfiles = [];
    this.routeIndex = 0;
    this.routeStartWorldTimeMs = this.worldTimeMs;
    this.routeCumulativeCosts = [];
    this.routeTotalCost = 0n;
    this.motion = null;
    this.routePurpose = null;
  }

  private materializeCurrentPosition(): void {
    const motion = this.motion;
    if (motion !== null) this.position = this.positionForMotion(motion, this.worldTimeMs);
  }

  private positionForMotion(motion: MotionLeg, worldTimeMs: bigint): WorldPoint {
    if (worldTimeMs >= motion.endWorldTimeMs) return clonePoint(motion.profile.end);
    const elapsed = worldTimeMs - this.routeStartWorldTimeMs;
    const relativeNumerator = elapsed * 2048n - motion.cumulativeCostBefore * 1000n;
    return positionAtWeightedCost(motion.profile, rational(relativeNumerator, 1000n));
  }

  private revealAtCurrent(grantXp: boolean): number {
    if (this.position === null) return 0;
    const levelAtStart = levelFromTotalXp(this.totalXp);
    const result = revealObservation(this.fog, BigInt(this.position.x), BigInt(this.position.y), observationRadius(levelAtStart));
    this.revealedTileCount += result.newlyRevealed;
    if (grantXp) {
      if (this.totalXp + result.newlyRevealed > Number.MAX_SAFE_INTEGER) throw new RangeError("exploration XP overflow");
      this.totalXp += result.newlyRevealed;
    }
    for (const placement of this.guaranteePlacements) this.discoverPlacementIfRevealed(placement);
    for (const placement of this.enemyGuaranteePlacements) this.discoverEnemyIfRevealed(placement);
    for (const tile of result.newlyRevealedTiles) {
      const cellKey = `${contentCellForTile(tile.x)},${contentCellForTile(tile.y)}`;
      this.pendingContentCells.add(cellKey);
    }
    this.processLoadedContentCells();
    return result.newlyRevealed;
  }

  private processLoadedContentCells(): void {
    while (this.pendingContentCells.size > 0 && this.pendingTerrain === null) {
      const result = this.processNextContentCell();
      if (result !== null) break;
    }
    if (this.pendingContentCells.size === 0) this.afterContentObservation();
  }

  private remainingRouteEtaMs(): bigint | null {
    if (this.activityState !== "moving" || this.motion === null) return null;
    const finalEventTime = this.routeStartWorldTimeMs + (this.routeTotalCost * 1000n + 2047n) / 2048n;
    return finalEventTime <= this.worldTimeMs ? 0n : finalEventTime - this.worldTimeMs;
  }

  private motionProgressPermille(motion: MotionLeg): number {
    const startCost = motion.cumulativeCostBefore;
    const endCost = startCost + motion.profile.cost;
    const available = ((this.worldTimeMs - this.routeStartWorldTimeMs) * 2048n) / 1000n;
    if (available <= startCost) return 0;
    if (available >= endCost) return 1000;
    return Number(((available - startCost) * 1000n) / motion.profile.cost);
  }

  private actionProgressPermille(action: NonCombatAction): number {
    if (this.worldTimeMs <= action.startWorldTimeMs) return 0;
    if (this.worldTimeMs >= action.endWorldTimeMs) return 1000;
    return Number(((this.worldTimeMs - action.startWorldTimeMs) * 1000n) / action.durationMs);
  }

  private activityPhase(): GameplayReadModelV2["activity"]["phase"] {
    if (this.activityState === "combat") return "combat";
    if (this.activityState === "respawning") return "waiting_respawn";
    if (this.activityState === "paused") return "paused";
    if (this.activityState === "waiting") return "waiting";
    if (this.activityState === "acting") return this.action?.kind === "Produce" ? "production_action" : "resource_action";
    if (this.routePurpose === "auto_explore") return "auto_exploring";
    if (this.routePurpose === "task_target") return this.activityState === "planning" ? "acquiring_target" : "moving_to_target";
    if ((isResourceTask(this.task) || isHuntTask(this.task)) && this.activityState === "planning") return "acquiring_target";
    if (this.activityState === "idle") return "idle";
    return "exploring";
  }

  private hasKnownPrototype(prototypeId: ResourcePrototypeId): boolean {
    return [...this.knownPlacements.values()].some((placement) => placement.prototypeId === prototypeId);
  }

  private hasKnownEnemyArchetype(archetypeId: EnemyArchetypeId): boolean {
    return [...this.knownEnemyPlacements.values()].some((placement) => placement.archetypeId === archetypeId);
  }

  private discoverPlacementIfRevealed(definition: ResourcePlacementDefinition): boolean {
    if (this.knownPlacements.has(definition.placementId)) return false;
    const tileX = BigInt(definition.tileX);
    const tileY = BigInt(definition.tileY);
    if (!isRevealed(this.fog, tileX, tileY)) return false;
    const sameTile = [...this.knownPlacements.values()].find((placement) => placement.tileX === definition.tileX && placement.tileY === definition.tileY);
    if (sameTile !== undefined) {
      if (definition.source === "ambient" || sameTile.source === "guarantee") return false;
      this.knownPlacements.delete(sameTile.placementId);
    }
    this.knownPlacements.set(definition.placementId, {
      ...structuredClone(definition),
      availability: "active",
      spawnCycle: 0,
      depletedWorldTimeMs: null,
      nextAvailableWorldTimeMs: null,
    });
    return true;
  }

  private discoverEnemyIfRevealed(definition: EnemyPlacementDefinition): boolean {
    if (this.knownEnemyPlacements.has(definition.placementId)) return false;
    const tileX = BigInt(definition.tileX);
    const tileY = BigInt(definition.tileY);
    if (!isRevealed(this.fog, tileX, tileY)) return false;
    const resourceConflict = [...this.knownPlacements.values()]
      .some((placement) => placement.tileX === definition.tileX && placement.tileY === definition.tileY);
    if (resourceConflict) return false;
    this.knownEnemyPlacements.set(definition.placementId, {
      ...structuredClone(definition),
      availability: "active",
      spawnCycle: 0,
      deadWorldTimeMs: null,
      nextAvailableWorldTimeMs: null,
      encounterChecked: false,
      pendingStealthPass: false,
      stealthSettled: false,
    });
    return true;
  }

  private queueAllRevealedContentCells(): void {
    for (const tile of revealedTiles(this.fog)) this.pendingContentCells.add(`${contentCellForTile(tile.x)},${contentCellForTile(tile.y)}`);
  }

  private processNextContentCell(): EngineStepResult | null {
    if (this.seed === null || this.campAnchor === null) throw new Error("content placement requires a world and camp anchor");
    const cellKey = this.activeContentCell ?? [...this.pendingContentCells].sort((left, right) => {
      const [leftX, leftY] = left.split(",").map(BigInt) as [bigint, bigint];
      const [rightX, rightY] = right.split(",").map(BigInt) as [bigint, bigint];
      return leftY !== rightY ? leftY < rightY ? -1 : 1 : leftX < rightX ? -1 : leftX > rightX ? 1 : 0;
    })[0];
    if (cellKey === undefined) return null;
    this.activeContentCell = cellKey;
    const [cellXText, cellYText] = cellKey.split(",");
    if (cellXText === undefined || cellYText === undefined) throw new Error("invalid content cell key");
    const definitions = ambientPlacementCandidates(this.seed, this.campAnchor, BigInt(cellXText), BigInt(cellYText));
    const firstDefinition = definitions[0];
    if (firstDefinition === undefined) throw new Error("resource prototype table is empty");
    const tileX = BigInt(firstDefinition.tileX);
    const tileY = BigInt(firstDefinition.tileY);
    const chunkSize = BigInt(RUNTIME_CHUNK_SIZE);
    const chunkX = floorDiv(tileX, chunkSize);
    const chunkY = floorDiv(tileY, chunkSize);
    if (!this.terrain.hasChunk(chunkX, chunkY)) return this.setTerrainEffect("content", chunkX.toString(), chunkY.toString(), `${chunkX},${chunkY}`);
    this.pendingContentCells.delete(cellKey);
    this.activeContentCell = null;
    const occupiedTiles = new Set(this.guaranteePlacements.map((placement) => `${placement.tileX},${placement.tileY}`));
    for (const definition of resolveAmbientPlacementConflicts(definitions, occupiedTiles)) {
      const candidateTileX = BigInt(definition.tileX);
      const candidateTileY = BigInt(definition.tileY);
      if (this.terrain.terrainAtLoaded(candidateTileX, candidateTileY) !== BASE_TERRAIN_ID.Land) continue;
      this.discoverPlacementIfRevealed(definition);
      occupiedTiles.add(`${definition.tileX},${definition.tileY}`);
    }
    for (const placement of this.enemyGuaranteePlacements) occupiedTiles.add(`${placement.tileX},${placement.tileY}`);
    const enemy = ambientEnemyPlacementCandidate(this.seed, this.campAnchor, BigInt(cellXText), BigInt(cellYText));
    if (enemy !== null && !occupiedTiles.has(`${enemy.tileX},${enemy.tileY}`)
      && this.terrain.terrainAtLoaded(BigInt(enemy.tileX), BigInt(enemy.tileY)) === BASE_TERRAIN_ID.Land) {
      this.discoverEnemyIfRevealed(enemy);
    }
    this.bumpRevision();
    return null;
  }

  private afterContentObservation(): void {
    if (this.pendingContentCells.size > 0) return;
    const task = this.task;
    const resourceAvailable = isResourceTask(task) && [...this.knownPlacements.values()]
      .some((placement) => placement.prototypeId === task.targetPrototypeId && placement.availability === "active");
    const enemyAvailable = isHuntTask(task) && [...this.knownEnemyPlacements.values()]
      .some((placement) => placement.archetypeId === task.archetypeId && placement.availability === "active");
    if ((this.routePurpose === "auto_explore" || this.activityState === "waiting") && (resourceAvailable || enemyAvailable)) {
      this.materializeCurrentPosition();
      this.clearRoute();
      this.beginPlanning();
      this.bumpRevision();
    }
  }

  private stepResourcePlanning(maxOperations: number): EngineStepResult {
    const planning = this.resourcePlanning;
    if (planning === null || this.position === null) return { kind: "settled" };
    let operations = 0;
    while (operations < maxOperations && planning.index < planning.candidates.length) {
      const placement = planning.candidates[planning.index]!;
      if (planning.planner === null) {
        planning.planner = new PlannerStepper(this.terrain, this.fog, this.position, observationRadius(levelFromTotalXp(this.totalXp)), placement.point);
      }
      const result = planning.planner.step(Math.max(1, maxOperations - operations));
      if (result.kind === "terrain-required") return this.setTerrainEffect("navigation", result.chunkX, result.chunkY, result.chunkKey);
      if (result.kind === "yield") return result;
      if (result.kind === "route") {
        this.unreachablePlacementIds.delete(placement.placementId);
        const best = planning.best;
        if (best === null || result.plan.cost < best.plan.cost
          || (result.plan.cost === best.plan.cost && placement.placementId < best.placement.placementId)) {
          planning.best = { placement, plan: result.plan };
        }
      } else {
        this.unreachablePlacementIds.add(placement.placementId);
      }
      planning.index += 1;
      planning.planner = null;
      operations += 1;
    }
    if (planning.index < planning.candidates.length) return { kind: "yield" };
    const best = planning.best;
    this.resourcePlanning = null;
    if (best === null) {
      this.beginAutoExplore();
      return { kind: "yield" };
    }
    this.currentTargetPlacementId = best.placement.placementId;
    this.routePurpose = "task_target";
    this.installRoute(best.plan);
    return { kind: "settled" };
  }

  private stepEnemyPlanning(maxOperations: number): EngineStepResult {
    const planning = this.enemyPlanning;
    if (planning === null || this.position === null) return { kind: "settled" };
    let operations = 0;
    while (operations < maxOperations && planning.index < planning.candidates.length) {
      const placement = planning.candidates[planning.index]!;
      if (planning.planner === null) {
        planning.planner = new PlannerStepper(this.terrain, this.fog, this.position, observationRadius(levelFromTotalXp(this.totalXp)), placement.point);
      }
      const result = planning.planner.step(Math.max(1, maxOperations - operations));
      if (result.kind === "terrain-required") return this.setTerrainEffect("navigation", result.chunkX, result.chunkY, result.chunkKey);
      if (result.kind === "yield") return result;
      if (result.kind === "route") {
        this.unreachablePlacementIds.delete(placement.placementId);
        const best = planning.best;
        if (best === null || result.plan.cost < best.plan.cost
          || (result.plan.cost === best.plan.cost && placement.placementId < best.placement.placementId)) {
          planning.best = { placement, plan: result.plan };
        }
      } else {
        this.unreachablePlacementIds.add(placement.placementId);
      }
      planning.index += 1;
      planning.planner = null;
      operations += 1;
    }
    if (planning.index < planning.candidates.length) return { kind: "yield" };
    const best = planning.best;
    this.enemyPlanning = null;
    if (best === null) {
      this.beginAutoExplore();
      return { kind: "yield" };
    }
    this.currentTargetPlacementId = best.placement.placementId;
    this.routePurpose = "task_target";
    this.installRoute(best.plan);
    return { kind: "settled" };
  }

  private startResourceAction(): void {
    const task = this.task;
    const placementId = this.currentTargetPlacementId;
    if (!isResourceTask(task) || placementId === null) throw new Error("resource action requires a resource task and target");
    const placement = this.knownPlacements.get(placementId);
    if (placement === undefined || placement.prototypeId !== task.targetPrototypeId || placement.availability !== "active") {
      this.currentTargetPlacementId = null;
      this.beginPlanning();
      return;
    }
    const definition = resourceDefinition(placement.prototypeId);
    if (!this.hasRequiredTool(placement.prototypeId)) {
      this.currentTargetPlacementId = null;
      this.beginPlanning();
      return;
    }
    const level = levelFromTotalXp(this.skillXpFor(definition.skillId));
    const toolSpeedBps = this.equippedToolSpeedBps(placement.prototypeId);
    const { durationMs, skillSpeedBps, totalSpeedBps } = authoritativeResourceDuration(placement.prototypeId, level, toolSpeedBps);
    const ordinal = this.nextEventOrdinal;
    this.nextEventOrdinal += 1n;
    this.clearRoute();
    this.currentTargetPlacementId = placementId;
    this.action = {
      kind: "Resource",
      actionId: `action:${this.worldTimeMs}:${ordinal}`,
      placementId,
      prototypeId: placement.prototypeId,
      startWorldTimeMs: this.worldTimeMs,
      endWorldTimeMs: this.worldTimeMs + durationMs,
      durationMs,
      skillSpeedBps,
      toolSpeedBps,
      totalSpeedBps,
    };
    this.activityState = "acting";
    this.reason = null;
  }

  private completeResourceAction(): void {
    const action = this.action;
    const task = this.task;
    if (action === null || action.kind !== "Resource" || !isResourceTask(task)) throw new Error("resource completion requires an active action");
    const placement = this.knownPlacements.get(action.placementId);
    if (placement === undefined || placement.prototypeId !== action.prototypeId || placement.prototypeId !== task.targetPrototypeId
      || placement.availability !== "active") throw new Error("resource target became invalid before completion");
    const definition = resourceDefinition(placement.prototypeId);
    const nextItemQuantity = this.materialQuantity(definition.output.itemId) + definition.output.quantity;
    const nextSkillXp = this.skillXpFor(definition.skillId) + definition.xp;
    const nextCompleted = task.completedQuantity + 1;
    if (!Number.isSafeInteger(nextItemQuantity) || !Number.isSafeInteger(nextSkillXp) || !Number.isSafeInteger(nextCompleted)) {
      throw new QuantityOverflowError("resource settlement exceeds safe integer storage");
    }
    const nextAvailable = this.worldTimeMs + definition.respawnDurationMs;
    this.knownPlacements.set(placement.placementId, {
      ...placement,
      availability: "depleted",
      depletedWorldTimeMs: this.worldTimeMs.toString(),
      nextAvailableWorldTimeMs: nextAvailable.toString(),
    });
    this.setMaterialQuantity(definition.output.itemId, nextItemQuantity);
    this.setSkillXp(definition.skillId, nextSkillXp);
    this.task = { ...task, completedQuantity: nextCompleted };
    this.nextEventOrdinal += 1n;
    this.action = null;
    this.currentTargetPlacementId = null;
    this.immediateCommitPending = true;
    if (task.quantity !== null && nextCompleted >= task.quantity) {
      this.clearRoute();
      this.activityState = "waiting";
      this.reason = TASK_COMPLETED_REASON;
    } else {
      this.beginPlanning();
    }
  }

  private startProductionAction(): void {
    const task = this.task;
    if (!isProduceTask(task)) throw new Error("production action requires a production task");
    const definition = recipeDefinition(task.recipeId);
    const level = levelFromTotalXp(this.craftingXp);
    if (level < definition.requiredLevel) throw new RecipeLevelTooLowError(task.recipeId, definition.requiredLevel, level);
    if (definition.inputs.some((input) => this.itemQuantity(input.itemId) < input.quantity)) {
      this.beginPlanning();
      return;
    }
    const { durationMs, skillSpeedBps, totalSpeedBps } = authoritativeCraftingDuration(task.recipeId, level);
    const ordinal = this.nextEventOrdinal;
    this.nextEventOrdinal += 1n;
    this.clearRoute();
    this.action = {
      kind: "Produce",
      actionId: `action:${this.worldTimeMs}:${ordinal}`,
      recipeId: task.recipeId,
      startWorldTimeMs: this.worldTimeMs,
      endWorldTimeMs: this.worldTimeMs + durationMs,
      durationMs,
      skillSpeedBps,
      totalSpeedBps,
    };
    this.activityState = "acting";
    this.reason = null;
  }

  private completeProductionAction(): void {
    const action = this.action;
    const task = this.task;
    if (action === null || action.kind !== "Produce" || !isProduceTask(task) || action.recipeId !== task.recipeId) {
      throw new Error("production completion requires a matching task and action");
    }
    const definition = recipeDefinition(action.recipeId);
    const missing = definition.inputs.some((input) => this.itemQuantity(input.itemId) < input.quantity);
    if (missing) {
      this.action = null;
      this.beginPlanning();
      return;
    }
    const nextQuantities = new Map<ItemId, number>();
    for (const input of definition.inputs) nextQuantities.set(input.itemId, this.itemQuantity(input.itemId) - input.quantity);
    const outputBefore = nextQuantities.get(definition.output.itemId) ?? this.itemQuantity(definition.output.itemId);
    const nextOutput = outputBefore + definition.output.quantity;
    const nextCraftingXp = this.craftingXp + definition.xp;
    const nextCompleted = task.completedQuantity + definition.output.quantity;
    if (!Number.isSafeInteger(nextOutput) || !Number.isSafeInteger(nextCraftingXp) || !Number.isSafeInteger(nextCompleted)) {
      throw new QuantityOverflowError("production settlement exceeds safe integer storage");
    }
    nextQuantities.set(definition.output.itemId, nextOutput);
    for (const [itemId, quantity] of nextQuantities) this.setItemQuantity(itemId, quantity);
    this.craftingXp = nextCraftingXp;
    this.task = { ...task, completedQuantity: nextCompleted };
    this.nextEventOrdinal += 1n;
    this.action = null;
    this.immediateCommitPending = true;
    if (task.requestedQuantity !== null && nextCompleted >= task.requestedQuantity) {
      this.clearRoute();
      this.activityState = "waiting";
      this.reason = TASK_COMPLETED_REASON;
    } else {
      this.beginPlanning();
    }
  }

  private resetCombatProgress(): void {
    this.playerMaxHpMicro = 100n * MICRO_HP_PER_HP;
    this.playerHpMicro = this.playerMaxHpMicro;
    this.hpRegenNumerator = 0n;
    this.combat = null;
    this.respawn = null;
    this.revivalGraceUntilWorldTimeMs = null;
    this.targetKills = 0;
    this.otherKills = 0;
    this.deaths = 0;
    this.respawns = 0;
  }

  private advanceWorldTimeTo(worldTimeMs: bigint): void {
    if (worldTimeMs < this.worldTimeMs) throw new RangeError("world time cannot move backward");
    const elapsed = worldTimeMs - this.worldTimeMs;
    if (elapsed > 0n && this.respawn === null) {
      const recovered = applyNaturalRegen(this.playerHpMicro, this.playerMaxHpMicro, this.hpRegenNumerator, elapsed);
      this.playerHpMicro = recovered.currentHpMicro;
      this.hpRegenNumerator = recovered.regenNumerator;
    }
    this.worldTimeMs = worldTimeMs;
  }

  private persistedCombatState(): PersistedCombatState | null {
    const combat = this.combat;
    if (combat === null) return null;
    return {
      ...combat,
      playerAttackIntervalMs: combat.playerAttackIntervalMs.toString(),
      enemyAttackIntervalMs: combat.enemyAttackIntervalMs.toString(),
      enemyHpMicro: combat.enemyHpMicro.toString(),
      playerNextAttackWorldTimeMs: combat.playerNextAttackWorldTimeMs.toString(),
      enemyNextAttackWorldTimeMs: combat.enemyNextAttackWorldTimeMs.toString(),
      eventOrdinal: combat.eventOrdinal.toString(),
      paused: combat.paused === null ? null : structuredClone(combat.paused),
    };
  }

  private restoreCombatState(combat: PersistedCombatState): RuntimeCombatState {
    return {
      ...structuredClone(combat),
      playerAttackIntervalMs: BigInt(combat.playerAttackIntervalMs),
      enemyAttackIntervalMs: BigInt(combat.enemyAttackIntervalMs),
      enemyHpMicro: BigInt(combat.enemyHpMicro),
      playerNextAttackWorldTimeMs: BigInt(combat.playerNextAttackWorldTimeMs),
      enemyNextAttackWorldTimeMs: BigInt(combat.enemyNextAttackWorldTimeMs),
      eventOrdinal: BigInt(combat.eventOrdinal),
    };
  }

  private combatSummary(): GameplayReadModelV2["combat"] {
    const combat = this.combat;
    if (combat === null) return null;
    const enemy = ENEMY_DEFINITIONS[combat.archetypeId];
    return {
      combatId: combat.combatId,
      encounterInstanceId: combat.encounterInstanceId,
      placementId: combat.placementId,
      archetypeId: combat.archetypeId,
      displayName: enemy.displayName,
      triggeredByHunt: combat.triggeredByHunt,
      playerHpMicro: this.playerHpMicro.toString(),
      playerMaxHpMicro: this.playerMaxHpMicro.toString(),
      enemyHpMicro: combat.enemyHpMicro.toString(),
      enemyMaxHpMicro: (BigInt(enemy.maxHp) * MICRO_HP_PER_HP).toString(),
      playerNextAttackRemainingMs: (combat.playerNextAttackWorldTimeMs > this.worldTimeMs ? combat.playerNextAttackWorldTimeMs - this.worldTimeMs : 0n).toString(),
      enemyNextAttackRemainingMs: (combat.enemyNextAttackWorldTimeMs > this.worldTimeMs ? combat.enemyNextAttackWorldTimeMs - this.worldTimeMs : 0n).toString(),
      playerHitChancePpm: opposedChancePpm(combat.playerAccuracy, combat.enemyEvasion),
      enemyHitChancePpm: opposedChancePpm(combat.enemyAccuracy, combat.playerEvasion),
      lastAttack: combat.lastAttack,
    };
  }

  private encounterInstanceId(placement: KnownEnemyPlacement): string {
    return `${placement.placementId}@${placement.spawnCycle}`;
  }

  private capturePausedExecution(): PersistedPausedExecution | null {
    const task = this.task;
    if (task === null) return null;
    const action = this.action;
    const motion = this.motion;
    return {
      taskId: task.taskId,
      targetPlacementId: this.currentTargetPlacementId,
      routePurpose: this.routePurpose,
      movement: motion === null ? null : {
        route: this.route.map(clonePoint),
        legProfiles: this.legProfiles.map(serializeSegmentProfile),
        routeIndex: this.routeIndex,
        elapsedRouteMs: (this.worldTimeMs - this.routeStartWorldTimeMs).toString(),
        boundaryIndex: motion.boundaryIndex,
      },
      action: action === null ? null : action.kind === "Resource" ? {
        kind: "Resource",
        actionId: action.actionId,
        placementId: action.placementId,
        prototypeId: action.prototypeId,
        remainingMs: (action.endWorldTimeMs > this.worldTimeMs ? action.endWorldTimeMs - this.worldTimeMs : 0n).toString(),
        durationMs: action.durationMs.toString(),
        skillSpeedBps: action.skillSpeedBps,
        toolSpeedBps: action.toolSpeedBps,
        totalSpeedBps: action.totalSpeedBps,
      } : {
        kind: "Produce",
        actionId: action.actionId,
        recipeId: action.recipeId,
        remainingMs: (action.endWorldTimeMs > this.worldTimeMs ? action.endWorldTimeMs - this.worldTimeMs : 0n).toString(),
        durationMs: action.durationMs.toString(),
        skillSpeedBps: action.skillSpeedBps,
        totalSpeedBps: action.totalSpeedBps,
      },
    };
  }

  private startCombatForCurrentTarget(triggeredByHunt: boolean): void {
    const placementId = this.currentTargetPlacementId;
    if (placementId === null) {
      this.beginPlanning();
      return;
    }
    const placement = this.knownEnemyPlacements.get(placementId);
    if (placement === undefined || placement.availability !== "active") {
      this.currentTargetPlacementId = null;
      this.beginPlanning();
      return;
    }
    this.enterCombat(placement, triggeredByHunt);
  }

  private enterCombat(placement: KnownEnemyPlacement, triggeredByHunt: boolean): void {
    if (this.seed === null || this.position === null || this.combat !== null || this.respawn !== null || placement.availability !== "active") return;
    this.materializeCurrentPosition();
    const paused = this.capturePausedExecution();
    const enemy = ENEMY_DEFINITIONS[placement.archetypeId];
    const weapon = WEAPON_DEFINITIONS.worn_blade;
    const meleeLevel = levelFromTotalXp(this.meleeXp);
    const multiplierPercent = 100 + meleeLevel - 1;
    const encounterInstanceId = this.encounterInstanceId(placement);
    this.knownEnemyPlacements.set(placement.placementId, {
      ...placement,
      encounterChecked: true,
      pendingStealthPass: false,
    });
    this.pendingTerrain = null;
    this.action = null;
    this.clearRoute();
    this.currentTargetPlacementId = placement.placementId;
    if (triggeredByHunt) this.revivalGraceUntilWorldTimeMs = null;
    this.combat = {
      combatId: `combat:${encounterInstanceId}:${this.worldTimeMs}`,
      encounterInstanceId,
      placementId: placement.placementId,
      archetypeId: placement.archetypeId,
      triggeredByHunt,
      playerAccuracy: Math.max(1, 10 + 2 * meleeLevel + weapon.accuracyBonus),
      playerEvasion: 10,
      playerArmor: 0,
      playerDamageMin: Math.floor(weapon.damageMin * multiplierPercent / 100),
      playerDamageMax: Math.floor(weapon.damageMax * multiplierPercent / 100),
      playerAttackIntervalMs: weapon.attackIntervalMs,
      enemyAccuracy: enemy.accuracy,
      enemyEvasion: enemy.evasion,
      enemyArmor: enemy.armor,
      enemyDamageMin: enemy.damageMin,
      enemyDamageMax: enemy.damageMax,
      enemyAttackIntervalMs: enemy.attackIntervalMs,
      enemyHpMicro: BigInt(enemy.maxHp) * MICRO_HP_PER_HP,
      playerNextAttackWorldTimeMs: this.worldTimeMs + weapon.attackIntervalMs,
      enemyNextAttackWorldTimeMs: this.worldTimeMs + enemy.attackIntervalMs,
      eventOrdinal: 0n,
      lastAttack: null,
      paused,
    };
    this.activityState = "combat";
    this.reason = null;
  }

  private processCombatAttacksAt(worldTimeMs: bigint): void {
    const combat = this.combat;
    if (combat === null || this.seed === null) return;
    if (combat.playerNextAttackWorldTimeMs === worldTimeMs) {
      const hit = deterministicPpmRoll(this.seed, combat.encounterInstanceId, combat.eventOrdinal, "hit:player")
        < opposedChancePpm(combat.playerAccuracy, combat.enemyEvasion);
      const rawDamage = hit ? deterministicRangeInclusive(
        this.seed, combat.encounterInstanceId, combat.eventOrdinal, "damage:player", combat.playerDamageMin, combat.playerDamageMax,
      ) : 0;
      const damage = hit ? finalPhysicalDamage(rawDamage, combat.enemyArmor) : 0;
      combat.enemyHpMicro = combat.enemyHpMicro > BigInt(damage) * MICRO_HP_PER_HP
        ? combat.enemyHpMicro - BigInt(damage) * MICRO_HP_PER_HP : 0n;
      combat.lastAttack = { actor: "player", hit, damage };
      combat.eventOrdinal += 1n;
      if (combat.enemyHpMicro === 0n) {
        this.settleEnemyKill();
        return;
      }
      combat.playerNextAttackWorldTimeMs = worldTimeMs + combat.playerAttackIntervalMs;
    }
    if (this.combat !== combat || combat.enemyNextAttackWorldTimeMs !== worldTimeMs) return;
    const hit = deterministicPpmRoll(this.seed, combat.encounterInstanceId, combat.eventOrdinal, "hit:enemy")
      < opposedChancePpm(combat.enemyAccuracy, combat.playerEvasion);
    const rawDamage = hit ? deterministicRangeInclusive(
      this.seed, combat.encounterInstanceId, combat.eventOrdinal, "damage:enemy", combat.enemyDamageMin, combat.enemyDamageMax,
    ) : 0;
    const damage = hit ? finalPhysicalDamage(rawDamage, combat.playerArmor) : 0;
    this.playerHpMicro = this.playerHpMicro > BigInt(damage) * MICRO_HP_PER_HP
      ? this.playerHpMicro - BigInt(damage) * MICRO_HP_PER_HP : 0n;
    combat.lastAttack = { actor: "enemy", hit, damage };
    combat.eventOrdinal += 1n;
    if (this.playerHpMicro === 0n) {
      this.enterRespawnState();
      return;
    }
    combat.enemyNextAttackWorldTimeMs = worldTimeMs + combat.enemyAttackIntervalMs;
  }

  private settleEnemyKill(): void {
    const combat = this.combat;
    if (combat === null) return;
    const placement = this.knownEnemyPlacements.get(combat.placementId);
    if (placement === undefined || placement.availability !== "active") throw new Error("combat enemy is not active at kill settlement");
    const enemy = ENEMY_DEFINITIONS[combat.archetypeId];
    const huntTask = isHuntTask(this.task) && this.task.archetypeId === combat.archetypeId ? this.task : null;
    const nextRawHide = this.rawHide + enemy.loot.quantity;
    const nextMeleeXp = this.meleeXp + enemy.meleeXp;
    const nextTaskKills = huntTask === null ? null : huntTask.completedKills + 1;
    const nextTargetKills = this.targetKills + (huntTask === null ? 0 : 1);
    const nextOtherKills = this.otherKills + (huntTask === null ? 1 : 0);
    if (![nextRawHide, nextMeleeXp, nextTaskKills ?? 0, nextTargetKills, nextOtherKills].every(Number.isSafeInteger)) {
      throw new QuantityOverflowError("combat settlement exceeds safe integer storage");
    }
    this.knownEnemyPlacements.set(placement.placementId, {
      ...placement,
      availability: "dead",
      deadWorldTimeMs: this.worldTimeMs.toString(),
      nextAvailableWorldTimeMs: (this.worldTimeMs + enemy.respawnDurationMs).toString(),
      encounterChecked: true,
      pendingStealthPass: false,
      stealthSettled: false,
    });
    this.rawHide = nextRawHide;
    this.meleeXp = nextMeleeXp;
    this.targetKills = nextTargetKills;
    this.otherKills = nextOtherKills;
    if (huntTask !== null && nextTaskKills !== null) this.task = { ...huntTask, completedKills: nextTaskKills };
    const paused = combat.paused;
    this.combat = null;
    this.currentTargetPlacementId = null;
    this.nextEventOrdinal += 1n;
    this.immediateCommitPending = true;
    if (isHuntTask(this.task) && this.task.requestedKills !== null && this.task.completedKills >= this.task.requestedKills) {
      this.activityState = "waiting";
      this.reason = TASK_COMPLETED_REASON;
      return;
    }
    this.resumeAfterCombat(paused);
  }

  private enterRespawnState(): void {
    const combat = this.combat;
    if (combat === null || this.position === null) return;
    const placement = this.knownEnemyPlacements.get(combat.placementId);
    if (placement !== undefined) {
      this.knownEnemyPlacements.set(placement.placementId, {
        ...placement,
        encounterChecked: false,
        pendingStealthPass: false,
        stealthSettled: false,
      });
    }
    this.combat = null;
    this.invalidatePendingStealthPasses();
    this.action = null;
    this.clearRoute();
    this.currentTargetPlacementId = null;
    this.hpRegenNumerator = 0n;
    this.respawn = { deathPosition: clonePoint(this.position), deadlineWorldTimeMs: this.worldTimeMs + 60_000n };
    if (this.deaths >= Number.MAX_SAFE_INTEGER) throw new QuantityOverflowError("death count exceeds safe integer storage");
    this.deaths += 1;
    this.activityState = "respawning";
    this.reason = null;
    this.immediateCommitPending = true;
  }

  private completePlayerRespawn(): void {
    const respawn = this.respawn;
    if (respawn === null) return;
    this.position = clonePoint(respawn.deathPosition);
    this.playerHpMicro = this.playerMaxHpMicro;
    this.hpRegenNumerator = 0n;
    this.respawn = null;
    this.revivalGraceUntilWorldTimeMs = this.worldTimeMs + 5_000n;
    if (this.respawns >= Number.MAX_SAFE_INTEGER) throw new QuantityOverflowError("respawn count exceeds safe integer storage");
    this.respawns += 1;
    if (this.task === null) {
      this.activityState = "idle";
      this.reason = null;
    } else {
      this.beginPlanning();
    }
    this.immediateCommitPending = true;
  }

  private resumeAfterCombat(paused: PersistedPausedExecution | null): void {
    const task = this.task;
    if (task === null) {
      this.activityState = "idle";
      this.reason = null;
      return;
    }
    if (paused?.taskId === task.taskId && paused.movement !== null && this.pausedMovementPrerequisitesRemain(paused)) {
      const movement = paused.movement;
      const profiles = movement.legProfiles.map(restoreSegmentProfile);
      const legCosts = profiles.map((profile) => profile.cost);
      const cumulativeCosts: bigint[] = [0n];
      for (const cost of legCosts) cumulativeCosts.push(cumulativeCosts.at(-1)! + cost);
      const profile = profiles[movement.routeIndex];
      const cumulativeCostBefore = cumulativeCosts[movement.routeIndex];
      if (profile !== undefined && cumulativeCostBefore !== undefined && movement.route.length === profiles.length + 1) {
        this.route = movement.route.map(clonePoint);
        this.legProfiles = profiles;
        this.legCosts = legCosts;
        this.routeCumulativeCosts = cumulativeCosts;
        this.routeTotalCost = cumulativeCosts.at(-1)!;
        this.routeIndex = movement.routeIndex;
        this.routePurpose = paused.routePurpose;
        this.currentTargetPlacementId = paused.targetPlacementId;
        this.routeStartWorldTimeMs = this.worldTimeMs - BigInt(movement.elapsedRouteMs);
        this.motion = {
          profile,
          endWorldTimeMs: this.routeStartWorldTimeMs + ((cumulativeCostBefore + profile.cost) * 1000n + 2047n) / 2048n,
          pathIndex: movement.routeIndex,
          cumulativeCostBefore,
          boundaryWorldTimes: profile.boundaryParameters.map((parameter) => this.routeStartWorldTimeMs
            + routeEventTimeMs(cumulativeCostBefore, profile, parameter)),
          boundaryIndex: movement.boundaryIndex,
        };
        this.action = null;
        this.activityState = "moving";
        this.reason = null;
        return;
      }
    }
    if (paused?.taskId === task.taskId && paused.action !== null) {
      const remainingMs = BigInt(paused.action.remainingMs);
      if (paused.action.kind === "Resource" && isResourceTask(task)
        && task.targetPrototypeId === paused.action.prototypeId && this.hasRequiredTool(paused.action.prototypeId)) {
        const placement = this.knownPlacements.get(paused.action.placementId);
        if (placement?.availability === "active") {
          this.currentTargetPlacementId = placement.placementId;
          this.action = {
            ...paused.action,
            startWorldTimeMs: this.worldTimeMs - (BigInt(paused.action.durationMs) - remainingMs),
            endWorldTimeMs: this.worldTimeMs + remainingMs,
            durationMs: BigInt(paused.action.durationMs),
          };
          this.activityState = "acting";
          this.reason = null;
          return;
        }
      }
      if (paused.action.kind === "Produce" && isProduceTask(task) && task.recipeId === paused.action.recipeId) {
        const definition = recipeDefinition(paused.action.recipeId);
        if (definition.inputs.every((input) => this.itemQuantity(input.itemId) >= input.quantity)) {
          this.action = {
            ...paused.action,
            startWorldTimeMs: this.worldTimeMs - (BigInt(paused.action.durationMs) - remainingMs),
            endWorldTimeMs: this.worldTimeMs + remainingMs,
            durationMs: BigInt(paused.action.durationMs),
          };
          this.activityState = "acting";
          this.reason = null;
          return;
        }
      }
    }
    this.action = null;
    this.currentTargetPlacementId = null;
    this.beginPlanning();
  }

  private pausedMovementPrerequisitesRemain(paused: PersistedPausedExecution): boolean {
    const task = this.task;
    if (task === null) return false;
    if (paused.routePurpose === "explore") return task.kind === "Explore";
    if (paused.routePurpose === "auto_explore") return isResourceTask(task) || isHuntTask(task);
    if (paused.routePurpose !== "task_target" || paused.targetPlacementId === null) return false;
    if (isResourceTask(task)) {
      const placement = this.knownPlacements.get(paused.targetPlacementId);
      return placement?.availability === "active" && placement.prototypeId === task.targetPrototypeId
        && this.hasRequiredTool(task.targetPrototypeId);
    }
    if (isHuntTask(task)) {
      const placement = this.knownEnemyPlacements.get(paused.targetPlacementId);
      return placement?.availability === "active" && placement.archetypeId === task.archetypeId;
    }
    return false;
  }

  private pointInsideEnemy(point: WorldPoint, placement: KnownEnemyPlacement): boolean {
    const enemy = ENEMY_DEFINITIONS[placement.archetypeId];
    const dx = BigInt(point.x) - BigInt(placement.point.x);
    const dy = BigInt(point.y) - BigInt(placement.point.y);
    return dx * dx + dy * dy <= enemy.detectionRadiusNav * enemy.detectionRadiusNav;
  }

  private firstMotionTime(
    motion: MotionLeg,
    predicate: (point: WorldPoint) => boolean,
  ): bigint {
    let low = this.worldTimeMs;
    let high = motion.endWorldTimeMs;
    while (low + 1n < high) {
      const middle = (low + high) >> 1n;
      if (predicate(this.positionForMotion(motion, middle))) high = middle;
      else low = middle;
    }
    return high;
  }

  private nextMotionThreatWorldTime(motion: MotionLeg): bigint | null {
    if (this.position === null) return null;
    let next: bigint | null = null;
    const end = motion.profile.end;
    for (const placement of [...this.knownEnemyPlacements.values()].sort((left, right) => this.encounterInstanceId(left) < this.encounterInstanceId(right) ? -1 : 1)) {
      if (placement.availability !== "active") continue;
      const insideNow = this.pointInsideEnemy(this.position, placement);
      if (placement.pendingStealthPass) {
        if (!insideNow) return this.worldTimeMs;
        if (this.pointInsideEnemy(end, placement)) continue;
        const candidate = this.firstMotionTime(motion, (point) => !this.pointInsideEnemy(point, placement));
        if (next === null || candidate < next) next = candidate;
        continue;
      }
      if (placement.encounterChecked) continue;
      const hunt = isHuntTask(this.task) && this.task.archetypeId === placement.archetypeId;
      if (!hunt && this.revivalGraceUntilWorldTimeMs !== null && this.revivalGraceUntilWorldTimeMs > this.worldTimeMs) continue;
      if (insideNow) return this.worldTimeMs;
      const enemy = ENEMY_DEFINITIONS[placement.archetypeId];
      if (!sweptSegmentIntersectsCircle(
        { x: BigInt(this.position.x), y: BigInt(this.position.y) },
        { x: BigInt(end.x), y: BigInt(end.y) },
        { x: BigInt(placement.point.x), y: BigInt(placement.point.y) },
        enemy.detectionRadiusNav,
      )) continue;
      const candidate = this.firstMotionTime(motion, (point) => sweptSegmentIntersectsCircle(
        { x: BigInt(this.position!.x), y: BigInt(this.position!.y) },
        { x: BigInt(point.x), y: BigInt(point.y) },
        { x: BigInt(placement.point.x), y: BigInt(placement.point.y) },
        enemy.detectionRadiusNav,
      ));
      if (next === null || candidate < next) next = candidate;
    }
    return next;
  }

  private processMotionThreatsAt(motion: MotionLeg, worldTimeMs: bigint): void {
    if (this.position === null) return;
    const previousTime = worldTimeMs > this.routeStartWorldTimeMs ? worldTimeMs - 1n : worldTimeMs;
    const previous = this.positionForMotion(motion, previousTime);
    const current = clonePoint(this.position);
    for (const placement of [...this.knownEnemyPlacements.values()].sort((left, right) => this.encounterInstanceId(left) < this.encounterInstanceId(right) ? -1 : 1)) {
      if (placement.availability !== "active" || !placement.pendingStealthPass || this.pointInsideEnemy(current, placement)) continue;
      this.settleStealthPass(placement);
    }
    const candidates = [...this.knownEnemyPlacements.values()].filter((placement) => {
      if (placement.availability !== "active" || placement.encounterChecked) return false;
      const hunt = isHuntTask(this.task) && this.task.archetypeId === placement.archetypeId;
      if (!hunt && this.revivalGraceUntilWorldTimeMs !== null && this.revivalGraceUntilWorldTimeMs > worldTimeMs) return false;
      const enemy = ENEMY_DEFINITIONS[placement.archetypeId];
      return this.pointInsideEnemy(current, placement) || sweptSegmentIntersectsCircle(
        { x: BigInt(previous.x), y: BigInt(previous.y) },
        { x: BigInt(current.x), y: BigInt(current.y) },
        { x: BigInt(placement.point.x), y: BigInt(placement.point.y) },
        enemy.detectionRadiusNav,
      );
    }).sort((left, right) => this.encounterInstanceId(left) < this.encounterInstanceId(right) ? -1 : 1);
    const selected = candidates[0];
    if (selected !== undefined) this.evaluateEncounter(selected);
  }

  private evaluateEncountersAtCurrent(): void {
    if (this.position === null || this.combat !== null || this.respawn !== null) return;
    const candidates = [...this.knownEnemyPlacements.values()]
      .filter((placement) => placement.availability === "active" && !placement.encounterChecked && this.pointInsideEnemy(this.position!, placement))
      .sort((left, right) => this.encounterInstanceId(left) < this.encounterInstanceId(right) ? -1 : 1);
    const selected = candidates[0];
    if (selected !== undefined) this.evaluateEncounter(selected);
  }

  private evaluateEncounter(placement: KnownEnemyPlacement): void {
    if (this.seed === null) return;
    const hunt = isHuntTask(this.task) && this.task.archetypeId === placement.archetypeId;
    if (hunt) {
      this.enterCombat(placement, true);
      return;
    }
    if (this.revivalGraceUntilWorldTimeMs !== null && this.revivalGraceUntilWorldTimeMs > this.worldTimeMs) return;
    const enemy = ENEMY_DEFINITIONS[placement.archetypeId];
    const stealthRating = Math.max(1, 10 + 2 * levelFromTotalXp(this.stealthXp));
    const detected = deterministicPpmRoll(this.seed, this.encounterInstanceId(placement), 0n, "detect")
      < opposedChancePpm(enemy.perception, stealthRating);
    const updated = { ...placement, encounterChecked: true, pendingStealthPass: !detected };
    this.knownEnemyPlacements.set(placement.placementId, updated);
    if (detected) this.enterCombat(updated, false);
  }

  private settleStealthPass(placement: KnownEnemyPlacement): void {
    if (!placement.pendingStealthPass || placement.stealthSettled) return;
    const nextXp = this.stealthXp + ENEMY_DEFINITIONS[placement.archetypeId].stealthXp;
    if (!Number.isSafeInteger(nextXp)) throw new QuantityOverflowError("stealth XP exceeds safe integer storage");
    this.stealthXp = nextXp;
    this.knownEnemyPlacements.set(placement.placementId, {
      ...placement,
      pendingStealthPass: false,
      stealthSettled: true,
    });
    this.nextEventOrdinal += 1n;
    this.immediateCommitPending = true;
  }

  private invalidatePendingStealthPasses(): void {
    for (const placement of this.knownEnemyPlacements.values()) {
      if (!placement.pendingStealthPass) continue;
      this.knownEnemyPlacements.set(placement.placementId, { ...placement, pendingStealthPass: false });
    }
  }

  private nextRespawnWorldTime(): bigint | null {
    let next: bigint | null = null;
    for (const placement of this.knownPlacements.values()) {
      if (placement.availability !== "depleted" || placement.nextAvailableWorldTimeMs === null) continue;
      const availableAt = BigInt(placement.nextAvailableWorldTimeMs);
      const candidate = availableAt <= this.worldTimeMs ? this.worldTimeMs : availableAt;
      if (next === null || candidate < next) next = candidate;
    }
    for (const placement of this.knownEnemyPlacements.values()) {
      if (placement.availability !== "dead" || placement.nextAvailableWorldTimeMs === null) continue;
      const availableAt = BigInt(placement.nextAvailableWorldTimeMs);
      const candidate = availableAt <= this.worldTimeMs ? this.worldTimeMs : availableAt;
      if (next === null || candidate < next) next = candidate;
    }
    return next;
  }

  private processRespawnsAt(worldTimeMs: bigint): void {
    let resourceAwakened = false;
    let enemyAwakened = false;
    for (const placement of [...this.knownPlacements.values()].sort((left, right) => left.placementId < right.placementId ? -1 : 1)) {
      if (placement.availability !== "depleted" || placement.nextAvailableWorldTimeMs === null
        || BigInt(placement.nextAvailableWorldTimeMs) > worldTimeMs) continue;
      if (placement.spawnCycle >= Number.MAX_SAFE_INTEGER) throw new QuantityOverflowError("resource spawn cycle exceeds safe integer storage");
      this.knownPlacements.set(placement.placementId, {
        ...placement,
        availability: "active",
        spawnCycle: placement.spawnCycle + 1,
        depletedWorldTimeMs: null,
        nextAvailableWorldTimeMs: null,
      });
      resourceAwakened = true;
    }
    for (const placement of [...this.knownEnemyPlacements.values()].sort((left, right) => left.placementId < right.placementId ? -1 : 1)) {
      if (placement.availability !== "dead" || placement.nextAvailableWorldTimeMs === null
        || BigInt(placement.nextAvailableWorldTimeMs) > worldTimeMs) continue;
      if (placement.spawnCycle >= Number.MAX_SAFE_INTEGER) throw new QuantityOverflowError("enemy spawn cycle exceeds safe integer storage");
      this.knownEnemyPlacements.set(placement.placementId, {
        ...placement,
        availability: "active",
        spawnCycle: placement.spawnCycle + 1,
        deadWorldTimeMs: null,
        nextAvailableWorldTimeMs: null,
        encounterChecked: false,
        pendingStealthPass: false,
        stealthSettled: false,
      });
      enemyAwakened = true;
    }
    if (resourceAwakened && isResourceTask(this.task) && (this.activityState === "waiting" || this.routePurpose === "auto_explore")) {
      this.materializeCurrentPosition();
      this.clearRoute();
      this.beginPlanning();
    }
    if (enemyAwakened && isHuntTask(this.task) && (this.activityState === "waiting" || this.routePurpose === "auto_explore")) {
      this.materializeCurrentPosition();
      this.clearRoute();
      this.beginPlanning();
    }
  }

  private resourcePlacementSummaries(): GameplayReadModelV2["map"]["resourcePlacements"] {
    return [...this.knownPlacements.values()].sort((left, right) => left.placementId < right.placementId ? -1 : 1).map((placement) => {
      const definition = resourceDefinition(placement.prototypeId);
      const skillLevel = levelFromTotalXp(this.skillXpFor(definition.skillId));
      const remaining = placement.nextAvailableWorldTimeMs === null ? null
        : BigInt(placement.nextAvailableWorldTimeMs) > this.worldTimeMs ? BigInt(placement.nextAvailableWorldTimeMs) - this.worldTimeMs : 0n;
      const state = placement.availability === "active" ? "active" as const
        : placement.depletedWorldTimeMs === this.worldTimeMs.toString() ? "depleted" as const : "respawning" as const;
      return {
        placementId: placement.placementId,
        prototypeId: placement.prototypeId,
        displayName: definition.displayName,
        taskKind: definition.taskKind,
        skillId: definition.skillId,
        requiredLevel: definition.requiredLevel,
        locked: skillLevel < definition.requiredLevel,
        requiredTool: definition.requiredTool,
        mapColor: definition.mapColor,
        point: clonePoint(placement.point),
        state,
        respawnRemainingMs: remaining?.toString() ?? null,
        reachable: this.unreachablePlacementIds.has(placement.placementId) ? "unreachable" as const
          : this.currentTargetPlacementId === placement.placementId ? "reachable" as const : "unknown" as const,
      };
    });
  }

  private enemyPlacementSummaries(): GameplayReadModelV2["map"]["enemyPlacements"] {
    return [...this.knownEnemyPlacements.values()].sort((left, right) => left.placementId < right.placementId ? -1 : 1).map((placement) => {
      const definition = ENEMY_DEFINITIONS[placement.archetypeId];
      const remaining = placement.nextAvailableWorldTimeMs === null ? null
        : BigInt(placement.nextAvailableWorldTimeMs) > this.worldTimeMs ? BigInt(placement.nextAvailableWorldTimeMs) - this.worldTimeMs : 0n;
      const state = placement.availability === "active" ? "active" as const
        : placement.deadWorldTimeMs === this.worldTimeMs.toString() ? "dead" as const : "respawning" as const;
      return {
        placementId: placement.placementId,
        archetypeId: placement.archetypeId,
        displayName: definition.displayName,
        mapColor: definition.mapColor,
        point: clonePoint(placement.point),
        state,
        respawnRemainingMs: remaining?.toString() ?? null,
        reachable: this.unreachablePlacementIds.has(placement.placementId) ? "unreachable" as const
          : this.currentTargetPlacementId === placement.placementId ? "reachable" as const : "unknown" as const,
      };
    });
  }

  private skillXpFor(skillId: ResourceSkillId): number {
    switch (skillId) {
      case "gathering": return this.gatheringXp;
      case "woodcutting": return this.woodcuttingXp;
      case "mining": return this.miningXp;
    }
  }

  private setSkillXp(skillId: ResourceSkillId, value: number): void {
    switch (skillId) {
      case "gathering": this.gatheringXp = value; return;
      case "woodcutting": this.woodcuttingXp = value; return;
      case "mining": this.miningXp = value; return;
    }
  }

  private materialQuantity(itemId: MaterialItemId): number {
    switch (itemId) {
      case "fiber": return this.fiber;
      case "softwood": return this.softwood;
      case "stone": return this.stone;
      case "copper_ore": return this.copperOre;
      case "rope": return this.rope;
      case "raw_hide": return this.rawHide;
    }
  }

  private setMaterialQuantity(itemId: MaterialItemId, value: number): void {
    switch (itemId) {
      case "fiber": this.fiber = value; return;
      case "softwood": this.softwood = value; return;
      case "stone": this.stone = value; return;
      case "copper_ore": this.copperOre = value; return;
      case "rope": this.rope = value; return;
      case "raw_hide": this.rawHide = value; return;
    }
  }

  private itemQuantity(itemId: ItemId): number {
    if (itemId === "worn_blade") return 0;
    return itemId === "worn_axe" || itemId === "worn_pickaxe" || itemId === "reinforced_axe" || itemId === "reinforced_pickaxe"
      ? this.toolInventoryQuantity(itemId)
      : this.materialQuantity(itemId);
  }

  private setItemQuantity(itemId: ItemId, value: number): void {
    if (itemId === "worn_blade") throw new TypeError("fixed weapon loadout is not inventory-backed");
    if (itemId === "worn_axe" || itemId === "worn_pickaxe" || itemId === "reinforced_axe" || itemId === "reinforced_pickaxe") {
      this.setToolInventoryQuantity(itemId, value);
    } else {
      this.setMaterialQuantity(itemId, value);
    }
  }

  private toolInventoryQuantity(itemId: ToolItemId): number {
    switch (itemId) {
      case "worn_axe": return this.wornAxe;
      case "worn_pickaxe": return this.wornPickaxe;
      case "reinforced_axe": return this.reinforcedAxe;
      case "reinforced_pickaxe": return this.reinforcedPickaxe;
    }
  }

  private setToolInventoryQuantity(itemId: ToolItemId, value: number): void {
    switch (itemId) {
      case "worn_axe": this.wornAxe = value; return;
      case "worn_pickaxe": this.wornPickaxe = value; return;
      case "reinforced_axe": this.reinforcedAxe = value; return;
      case "reinforced_pickaxe": this.reinforcedPickaxe = value; return;
    }
  }

  private toolEquipmentSummary(itemId: ToolItemId): NonNullable<GameplayReadModelV2["equipment"]>[ToolSlot] {
    const tool = TOOL_DEFINITIONS[itemId];
    return { itemId, displayName: tool.displayName, tier: tool.tier, speedBps: tool.speedBps };
  }

  private hasRequiredTool(prototypeId: ResourcePrototypeId): boolean {
    const requirement = resourceDefinition(prototypeId).requiredTool;
    if (requirement === null) return true;
    const equippedItemId = this.equipment[requirement.slot];
    if (equippedItemId === null) return false;
    const tool = TOOL_DEFINITIONS[equippedItemId];
    return tool.slot === requirement.slot && tool.tier >= requirement.minimumTier;
  }

  private equippedToolSpeedBps(prototypeId: ResourcePrototypeId): number {
    const requirement = resourceDefinition(prototypeId).requiredTool;
    if (requirement === null) return 0;
    const equippedItemId = this.equipment[requirement.slot];
    return equippedItemId === null ? 0 : TOOL_DEFINITIONS[equippedItemId].speedBps;
  }

  private restartExecutionAfterEquipmentChange(): void {
    this.plannerGeneration += 1;
    this.materializeCurrentPosition();
    this.pendingTerrain = null;
    this.action = null;
    this.currentTargetPlacementId = null;
    this.clearRoute();
    if (this.task === null) {
      this.activityState = "idle";
      this.reason = null;
    } else {
      this.beginPlanning();
    }
    this.bumpRevision();
  }

  private persistedWorldChunks(): EnginePersistedState["worldChunks"] {
    const placementsByChunk = new Map<string, KnownResourcePlacement[]>();
    const enemiesByChunk = new Map<string, KnownEnemyPlacement[]>();
    const chunkSize = BigInt(RUNTIME_CHUNK_SIZE);
    for (const placement of this.knownPlacements.values()) {
      const chunkX = floorDiv(BigInt(placement.tileX), chunkSize);
      const chunkY = floorDiv(BigInt(placement.tileY), chunkSize);
      const key = `${chunkX},${chunkY}`;
      const values = placementsByChunk.get(key) ?? [];
      values.push(structuredClone(placement));
      placementsByChunk.set(key, values);
    }
    for (const placement of this.knownEnemyPlacements.values()) {
      const chunkX = floorDiv(BigInt(placement.tileX), chunkSize);
      const chunkY = floorDiv(BigInt(placement.tileY), chunkSize);
      const key = `${chunkX},${chunkY}`;
      const values = enemiesByChunk.get(key) ?? [];
      values.push(structuredClone(placement));
      enemiesByChunk.set(key, values);
    }
    const keys = new Set([...this.fog.keys(), ...placementsByChunk.keys(), ...enemiesByChunk.keys()]);
    return [...keys].sort(compareChunkKeysNumeric).map((chunkKey) => ({
      chunkKey,
      revealedBase64: fogBitsToBase64(this.fog.get(chunkKey) ?? new Uint8Array(512)),
      knownPlacements: (placementsByChunk.get(chunkKey) ?? []).sort((left, right) => left.placementId < right.placementId ? -1 : 1),
      knownEnemyPlacements: (enemiesByChunk.get(chunkKey) ?? []).sort((left, right) => left.placementId < right.placementId ? -1 : 1),
    }));
  }
}
