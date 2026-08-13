import { BASE_TERRAIN_ID, RUNTIME_CHUNK_SIZE, compareChunkKeysNumeric } from "../world-contract.ts";
import { CampAnchorStepper } from "./anchor.ts";
import {
  GuaranteePlacementStepper,
  RESOURCE_DEFINITIONS,
  RESOURCE_PROTOTYPE_ORDER,
  TOOL_DEFINITIONS,
  ambientPlacementCandidates,
  authoritativeResourceDuration,
  contentCellForTile,
  resourceDefinition,
  resolveAmbientPlacementConflicts,
  taskKindMatchesPrototype,
  type MaterialItemId,
  type ResourcePrototypeId,
  type ResourceSkillId,
  type ResourceTaskKind,
  type ToolItemId,
  type ToolSlot,
  type ResourcePlacementDefinition,
} from "./content.ts";
import type { ActivityReason, GameplayReadModelV1, OfflineReport, ResourceTask, SeedDecimal, TaskId, TaskIntent, WorldPoint } from "./contracts.ts";
import { base64ToFogBits, fogBitsToBase64, isRevealed, revealObservation, revealedTiles, type FogMap } from "./fog.ts";
import { floorDiv, levelFromTotalXp, observationRadius, xpAtLevelStart, xpForNextLevel } from "./math.ts";
import { positionAtWeightedCost, rational, routeEventTimeMs } from "./motion.ts";
import { PlannerStepper, TerrainSnapshot, type PlanFinal, type RoutePlan, type SegmentProfile } from "./navigation.ts";

export type EngineTaskInput = Readonly<
  | { kind: "Explore"; mode: "continuous"; destination: null }
  | { kind: "Explore"; mode: "destination"; destination: WorldPoint }
  | { kind: "Gather"; targetPrototypeId: "wild_fiber"; quantity: number | null }
  | { kind: "Woodcut"; targetPrototypeId: "softwood_tree"; quantity: number | null }
  | { kind: "Mine"; targetPrototypeId: "surface_stone" | "shallow_copper_deposit"; quantity: number | null }
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
  fiber: number;
  softwood: number;
  stone: number;
  copperOre: number;
  equipment: Readonly<Record<ToolSlot, ToolItemId | null>>;
  revealedTileCount: number;
  revealedChunks: readonly Readonly<{ chunkKey: string; revealedBase64: string }>[];
  task: TaskIntent | null;
  activityState: "idle" | "planning" | "moving" | "acting" | "waiting" | "paused";
  route: readonly WorldPoint[];
  routeIndex: number;
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
  fiber: number;
  softwood: number;
  stone: number;
  copperOre: number;
  wornAxe: number;
  wornPickaxe: number;
  equipment: Readonly<Record<ToolSlot, ToolItemId | null>>;
  task: TaskIntent | null;
  execution: Readonly<{
    state: "idle" | "planning" | "moving" | "acting" | "waiting" | "paused";
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
      actionId: string;
      placementId: string;
      prototypeId: ResourcePrototypeId;
      startWorldTimeMs: string;
      endWorldTimeMs: string;
      durationMs: string;
      skillSpeedBps: number;
      toolSpeedBps: number;
      totalSpeedBps: number;
    }> | null;
    waitingReason: ActivityReason | null;
  }>;
  worldChunks: readonly Readonly<{
    chunkKey: string;
    revealedBase64: string;
    knownPlacements: readonly KnownResourcePlacement[];
  }>[];
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
  fiber: number;
  softwood: number;
  stone: number;
  copperOre: number;
  wornAxe: number;
  wornPickaxe: number;
  equipment: Readonly<Record<ToolSlot, ToolItemId | null>>;
  task: TaskIntent | null;
  executionState: "idle" | "planning" | "moving" | "acting" | "waiting" | "paused";
  routePurpose: "explore" | "task_target" | "auto_explore" | null;
  targetPlacementId: string | null;
  action: Readonly<{
    actionId: string;
    placementId: string;
    prototypeId: ResourcePrototypeId;
    startWorldTimeMs: string;
    endWorldTimeMs: string;
    durationMs: string;
    skillSpeedBps: number;
    toolSpeedBps: number;
    totalSpeedBps: number;
  }> | null;
  waitingReason: ActivityReason | null;
  worldChunks: readonly Readonly<{ chunkKey: string; revealedBase64: string; knownPlacements: readonly KnownResourcePlacement[] }>[];
  nextEventOrdinal: string;
}>;

export type EngineReadModelOptions = Readonly<{
  saveState?: GameplayReadModelV1["save"];
  offlineReport?: OfflineReport | null;
  startup?: GameplayReadModelV1["startup"];
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

type ResourceAction = {
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

type ResourcePlanning = {
  candidates: readonly KnownResourcePlacement[];
  index: number;
  planner: PlannerStepper | null;
  best: Readonly<{ placement: KnownResourcePlacement; plan: RoutePlan }> | null;
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

export class ItemUnavailableError extends Error {
  readonly code = "command/item_unavailable" as const;
}

export class InvalidEquipmentError extends Error {
  readonly code = "command/invalid_equipment" as const;
}

export class QuantityOverflowError extends Error {
  readonly code = "integrity/quantity_overflow" as const;
}

function taskIdFromCommandId(commandId: string): TaskId {
  if (!commandId.startsWith("cmd:")) throw new TypeError("validated command ID required");
  return `task:${commandId.slice(4)}`;
}

function clonePoint(point: WorldPoint): WorldPoint { return { x: point.x, y: point.y }; }
function isResourceTask(task: TaskIntent | null): task is ResourceTask {
  return task !== null && (task.kind === "Gather" || task.kind === "Woodcut" || task.kind === "Mine");
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
  private fiber = 0;
  private softwood = 0;
  private stone = 0;
  private copperOre = 0;
  private wornAxe = 0;
  private wornPickaxe = 0;
  private equipment: Record<ToolSlot, ToolItemId | null> = { axe: "worn_axe", pickaxe: "worn_pickaxe" };
  private revealedTileCount = 0;
  private task: TaskIntent | null = null;
  private activityState: "idle" | "planning" | "moving" | "acting" | "waiting" | "paused" = "idle";
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
  private anchor: CampAnchorStepper | null = null;
  private guaranteeStepper: GuaranteePlacementStepper | null = null;
  private guaranteePlacements: readonly ResourcePlacementDefinition[] = [];
  private readonly knownPlacements = new Map<string, KnownResourcePlacement>();
  private readonly unreachablePlacementIds = new Set<string>();
  private readonly pendingContentCells = new Set<string>();
  private activeContentCell: string | null = null;
  private currentTargetPlacementId: string | null = null;
  private action: ResourceAction | null = null;
  private nextEventOrdinal = 0n;
  private immediateCommitPending = false;
  private pendingTerrain: PendingTerrain | null = null;
  private startup: GameplayReadModelV1["startup"] = "new_world";

  constructor(generatorVersion: number) { this.generatorVersion = generatorVersion; }

  get epoch(): number { return this.gameplayEpoch; }
  get revision(): number { return this.readModelRevision; }
  get worldSeed(): SeedDecimal | null { return this.seed; }
  get hasPendingWork(): boolean {
    return this.pendingTerrain !== null || this.anchor !== null || this.guaranteeStepper !== null
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
      fiber: this.fiber,
      softwood: this.softwood,
      stone: this.stone,
      copperOre: this.copperOre,
      equipment: { ...this.equipment },
      revealedTileCount: this.revealedTileCount,
      revealedChunks: [...this.fog.entries()]
        .sort(([left], [right]) => compareChunkKeysNumeric(left, right))
        .map(([chunkKey, bits]) => ({ chunkKey, revealedBase64: fogBitsToBase64(bits) })),
      task: this.task,
      activityState: this.activityState,
      route: this.route.map(clonePoint),
      routeIndex: this.routeIndex,
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
      fiber: this.fiber,
      softwood: this.softwood,
      stone: this.stone,
      copperOre: this.copperOre,
      wornAxe: this.wornAxe,
      wornPickaxe: this.wornPickaxe,
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
        action: this.action === null ? null : {
          actionId: this.action.actionId,
          placementId: this.action.placementId,
          prototypeId: this.action.prototypeId,
          startWorldTimeMs: this.action.startWorldTimeMs.toString(),
          endWorldTimeMs: this.action.endWorldTimeMs.toString(),
          durationMs: this.action.durationMs.toString(),
          skillSpeedBps: this.action.skillSpeedBps,
          toolSpeedBps: this.action.toolSpeedBps,
          totalSpeedBps: this.action.totalSpeedBps,
        },
        waitingReason: this.reason,
      },
      worldChunks: this.persistedWorldChunks(),
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
    this.fiber = state.fiber;
    this.softwood = state.softwood;
    this.stone = state.stone;
    this.copperOre = state.copperOre;
    this.wornAxe = state.wornAxe;
    this.wornPickaxe = state.wornPickaxe;
    this.equipment = { ...state.equipment };
    this.task = state.task === null ? null : structuredClone(state.task);
    this.anchor = null;
    this.pendingTerrain = null;
    this.terrain.clear();
    this.fog.clear();
    this.knownPlacements.clear();
    this.unreachablePlacementIds.clear();
    for (const chunk of state.worldChunks) {
      this.fog.set(chunk.chunkKey, base64ToFogBits(chunk.revealedBase64));
      for (const placement of chunk.knownPlacements) this.knownPlacements.set(placement.placementId, structuredClone(placement));
    }
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
    this.action = state.action === null ? null : {
      actionId: state.action.actionId,
      placementId: state.action.placementId,
      prototypeId: state.action.prototypeId,
      startWorldTimeMs: BigInt(state.action.startWorldTimeMs),
      endWorldTimeMs: BigInt(state.action.endWorldTimeMs),
      durationMs: BigInt(state.action.durationMs),
      skillSpeedBps: state.action.skillSpeedBps,
      toolSpeedBps: state.action.toolSpeedBps,
      totalSpeedBps: state.action.totalSpeedBps,
    };
    this.reason = null;
    if (this.task === null) {
      this.activityState = "idle";
    } else if (state.executionState === "acting" && this.action !== null) {
      this.activityState = "acting";
    } else if (state.executionState === "waiting" || state.executionState === "paused") {
      this.activityState = state.executionState;
      this.reason = state.waitingReason;
    } else {
      this.beginPlanning();
    }
    this.guaranteeStepper = new GuaranteePlacementStepper(this.seed, this.campAnchor, this.terrain);
    this.guaranteePlacements = [];
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
    this.fiber = 0;
    this.softwood = 0;
    this.stone = 0;
    this.copperOre = 0;
    this.wornAxe = 0;
    this.wornPickaxe = 0;
    this.equipment = { axe: "worn_axe", pickaxe: "worn_pickaxe" };
    this.task = null;
    this.knownPlacements.clear();
    this.unreachablePlacementIds.clear();
    this.guaranteePlacements = [];
    this.guaranteeStepper = null;
    this.pendingContentCells.clear();
    this.activeContentCell = null;
    this.currentTargetPlacementId = null;
    this.action = null;
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
    this.fiber = 0;
    this.softwood = 0;
    this.stone = 0;
    this.copperOre = 0;
    this.wornAxe = 0;
    this.wornPickaxe = 0;
    this.equipment = { axe: "worn_axe", pickaxe: "worn_pickaxe" };
    this.revealedTileCount = 0;
    this.task = null;
    this.anchor = null;
    this.guaranteeStepper = null;
    this.guaranteePlacements = [];
    this.planner = null;
    this.pendingTerrain = null;
    this.terrain.clear();
    this.fog.clear();
    this.knownPlacements.clear();
    this.pendingContentCells.clear();
    this.activeContentCell = null;
    this.currentTargetPlacementId = null;
    this.action = null;
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
    } else {
      this.task = {
        taskId: taskIdFromCommandId(commandId), kind: "Explore", mode: taskInput.mode,
        destination: taskInput.destination === null ? null : clonePoint(taskInput.destination),
        createdWorldTimeMs: this.worldTimeMs.toString(),
      };
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
    const tool = TOOL_DEFINITIONS[itemId];
    if (this.equipment[tool.slot] === itemId) return;
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
      this.fiber = 0;
      this.softwood = 0;
      this.stone = 0;
      this.copperOre = 0;
      this.wornAxe = 0;
      this.wornPickaxe = 0;
      this.equipment = { axe: "worn_axe", pickaxe: "worn_pickaxe" };
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
      const nextActionTime = this.action?.endWorldTimeMs ?? null;
      const nextRespawnTime = this.nextRespawnWorldTime();
      let nextEventTime: bigint | null = null;
      for (const candidate of [nextRespawnTime, nextActionTime, nextMotionTime]) {
        if (candidate !== null && (nextEventTime === null || candidate < nextEventTime)) nextEventTime = candidate;
      }
      if (nextEventTime === null) {
        if (this.worldTimeMs >= target) return 0n;
        this.worldTimeMs = target;
        this.bumpRevision();
        return 0n;
      }
      if (target < nextEventTime) {
        this.worldTimeMs = target;
        if (motion !== null) this.position = this.positionForMotion(motion, target);
        this.bumpRevision();
        return 0n;
      }
      this.worldTimeMs = nextEventTime;
      if (motion !== null) this.position = this.positionForMotion(motion, nextEventTime);

      if (nextRespawnTime === nextEventTime) {
        this.processRespawnsAt(nextEventTime);
        if (motion !== null && this.motion !== motion) {
          this.bumpRevision();
          return target - this.worldTimeMs;
        }
      }
      if (nextActionTime === nextEventTime && this.action !== null) {
        this.completeResourceAction();
        this.bumpRevision();
        return target - this.worldTimeMs;
      }

      if (nextMotionTime !== nextEventTime || motion === null) {
        this.bumpRevision();
        if (this.hasPendingWork) return target - this.worldTimeMs;
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
      if (this.hasPendingWork) return target - this.worldTimeMs;
    }
  }

  toReadModel(saveRevision = 0, committedWallClockMs: number | null = null, options: EngineReadModelOptions = {}): GameplayReadModelV1 {
    const level = levelFromTotalXp(this.totalXp);
    const levelStart = xpAtLevelStart(level);
    const gatheringLevel = levelFromTotalXp(this.gatheringXp);
    const gatheringLevelStart = xpAtLevelStart(gatheringLevel);
    const woodcuttingLevel = levelFromTotalXp(this.woodcuttingXp);
    const woodcuttingLevelStart = xpAtLevelStart(woodcuttingLevel);
    const miningLevel = levelFromTotalXp(this.miningXp);
    const miningLevelStart = xpAtLevelStart(miningLevel);
    const gatheringSpeed = authoritativeResourceDuration("wild_fiber", gatheringLevel).skillSpeedBps;
    const woodcuttingSpeed = authoritativeResourceDuration("softwood_tree", woodcuttingLevel).skillSpeedBps;
    const miningSpeed = authoritativeResourceDuration("surface_stone", miningLevel).skillSpeedBps;
    const remainingEtaMs = this.remainingRouteEtaMs();
    const action = this.action;
    return {
      protocolVersion: 1,
      readModelRevision: this.readModelRevision,
      gameplayEpoch: this.gameplayEpoch,
      startup: options.startup ?? this.startup,
      generatorVersion: this.generatorVersion,
      player: this.position === null ? null : { position: clonePoint(this.position), hp: { current: 100, max: 100 }, combatScope: "not_implemented_phase_2b" },
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
        action: action === null ? null : {
          actionId: action.actionId,
          placementId: action.placementId,
          prototypeId: action.prototypeId,
          baseDurationMs: resourceDefinition(action.prototypeId).baseDurationMs.toString(),
          durationMs: action.durationMs.toString(),
          remainingMs: (action.endWorldTimeMs > this.worldTimeMs ? action.endWorldTimeMs - this.worldTimeMs : 0n).toString(),
          skillSpeedBps: action.skillSpeedBps,
          toolSpeedBps: action.toolSpeedBps,
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
      },
      inventory: this.position === null ? null : {
        items: [
          ...(this.fiber === 0 ? [] : [{ itemId: "fiber", displayName: "纤维", category: "material", quantity: this.fiber }] as const),
          ...(this.softwood === 0 ? [] : [{ itemId: "softwood", displayName: "软木", category: "material", quantity: this.softwood }] as const),
          ...(this.stone === 0 ? [] : [{ itemId: "stone", displayName: "石料", category: "material", quantity: this.stone }] as const),
          ...(this.copperOre === 0 ? [] : [{ itemId: "copper_ore", displayName: "铜矿石", category: "material", quantity: this.copperOre }] as const),
          ...(this.wornAxe === 0 ? [] : [{ itemId: "worn_axe", displayName: "破旧斧", category: "equipment", quantity: this.wornAxe }] as const),
          ...(this.wornPickaxe === 0 ? [] : [{ itemId: "worn_pickaxe", displayName: "破旧镐", category: "equipment", quantity: this.wornPickaxe }] as const),
        ],
      },
      equipment: this.position === null ? null : {
        axe: this.equipment.axe === null ? null : this.toolEquipmentSummary(this.equipment.axe),
        pickaxe: this.equipment.pickaxe === null ? null : this.toolEquipmentSummary(this.equipment.pickaxe),
      },
      knownTargetPrototypeIds: RESOURCE_PROTOTYPE_ORDER.filter((prototypeId) => this.hasKnownPrototype(prototypeId)),
      map: {
        revealedChunks: [...this.fog.entries()].sort(([left], [right]) => compareChunkKeysNumeric(left, right)).map(([chunkKey, bits]) => {
          const [chunkX, chunkY] = chunkKey.split(",") as [string, string];
          return { chunkKey, chunkX, chunkY, revealedBase64: fogBitsToBase64(bits) };
        }),
        resourcePlacements: this.resourcePlacementSummaries(),
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
      if (this.routePurpose === "task_target") this.startResourceAction();
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
    if (this.routePurpose === "task_target") this.startResourceAction();
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

  private actionProgressPermille(action: ResourceAction): number {
    if (this.worldTimeMs <= action.startWorldTimeMs) return 0;
    if (this.worldTimeMs >= action.endWorldTimeMs) return 1000;
    return Number(((this.worldTimeMs - action.startWorldTimeMs) * 1000n) / action.durationMs);
  }

  private activityPhase(): GameplayReadModelV1["activity"]["phase"] {
    if (this.activityState === "paused") return "paused";
    if (this.activityState === "waiting") return "waiting";
    if (this.activityState === "acting") return "resource_action";
    if (this.routePurpose === "auto_explore") return "auto_exploring";
    if (this.routePurpose === "task_target") return this.activityState === "planning" ? "acquiring_target" : "moving_to_target";
    if (isResourceTask(this.task) && this.activityState === "planning") return "acquiring_target";
    if (this.activityState === "idle") return "idle";
    return "exploring";
  }

  private hasKnownPrototype(prototypeId: ResourcePrototypeId): boolean {
    return [...this.knownPlacements.values()].some((placement) => placement.prototypeId === prototypeId);
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
    }
    this.bumpRevision();
    return null;
  }

  private afterContentObservation(): void {
    if (this.pendingContentCells.size > 0) return;
    const task = this.task;
    if (!isResourceTask(task)) return;
    if ((this.routePurpose === "auto_explore" || this.activityState === "waiting")
      && [...this.knownPlacements.values()].some((placement) => placement.prototypeId === task.targetPrototypeId && placement.availability === "active")) {
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
    if (action === null || !isResourceTask(task)) throw new Error("resource completion requires an active action");
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

  private nextRespawnWorldTime(): bigint | null {
    let next: bigint | null = null;
    for (const placement of this.knownPlacements.values()) {
      if (placement.availability !== "depleted" || placement.nextAvailableWorldTimeMs === null) continue;
      const availableAt = BigInt(placement.nextAvailableWorldTimeMs);
      const candidate = availableAt <= this.worldTimeMs ? this.worldTimeMs : availableAt;
      if (next === null || candidate < next) next = candidate;
    }
    return next;
  }

  private processRespawnsAt(worldTimeMs: bigint): void {
    let awakened = false;
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
      awakened = true;
    }
    if (awakened && isResourceTask(this.task) && (this.activityState === "waiting" || this.routePurpose === "auto_explore")) {
      this.materializeCurrentPosition();
      this.clearRoute();
      this.beginPlanning();
    }
  }

  private resourcePlacementSummaries(): GameplayReadModelV1["map"]["resourcePlacements"] {
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
    }
  }

  private setMaterialQuantity(itemId: MaterialItemId, value: number): void {
    switch (itemId) {
      case "fiber": this.fiber = value; return;
      case "softwood": this.softwood = value; return;
      case "stone": this.stone = value; return;
      case "copper_ore": this.copperOre = value; return;
    }
  }

  private toolInventoryQuantity(itemId: ToolItemId): number {
    return itemId === "worn_axe" ? this.wornAxe : this.wornPickaxe;
  }

  private setToolInventoryQuantity(itemId: ToolItemId, value: number): void {
    if (itemId === "worn_axe") this.wornAxe = value;
    else this.wornPickaxe = value;
  }

  private toolEquipmentSummary(itemId: ToolItemId): NonNullable<GameplayReadModelV1["equipment"]>[ToolSlot] {
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
    const chunkSize = BigInt(RUNTIME_CHUNK_SIZE);
    for (const placement of this.knownPlacements.values()) {
      const chunkX = floorDiv(BigInt(placement.tileX), chunkSize);
      const chunkY = floorDiv(BigInt(placement.tileY), chunkSize);
      const key = `${chunkX},${chunkY}`;
      const values = placementsByChunk.get(key) ?? [];
      values.push(structuredClone(placement));
      placementsByChunk.set(key, values);
    }
    const keys = new Set([...this.fog.keys(), ...placementsByChunk.keys()]);
    return [...keys].sort(compareChunkKeysNumeric).map((chunkKey) => ({
      chunkKey,
      revealedBase64: fogBitsToBase64(this.fog.get(chunkKey) ?? new Uint8Array(512)),
      knownPlacements: (placementsByChunk.get(chunkKey) ?? []).sort((left, right) => left.placementId < right.placementId ? -1 : 1),
    }));
  }
}
