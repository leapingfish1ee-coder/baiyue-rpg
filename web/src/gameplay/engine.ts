import { compareChunkKeysNumeric } from "../world-contract.ts";
import { CampAnchorStepper } from "./anchor.ts";
import type { ActivityReason, ExploreTask, GameplayReadModelV1, OfflineReport, SeedDecimal, TaskId, WorldPoint } from "./contracts.ts";
import { base64ToFogBits, fogBitsToBase64, revealObservation, type FogMap } from "./fog.ts";
import { levelFromTotalXp, observationRadius, xpAtLevelStart, xpForNextLevel } from "./math.ts";
import { positionAtWeightedCost, rational, routeEventTimeMs } from "./motion.ts";
import { PlannerStepper, TerrainSnapshot, type PlanFinal, type RoutePlan, type SegmentProfile } from "./navigation.ts";

export type EngineTaskInput = Readonly<
  | { kind: "Explore"; mode: "continuous"; destination: null }
  | { kind: "Explore"; mode: "destination"; destination: WorldPoint }
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
  revealedTileCount: number;
  revealedChunks: readonly Readonly<{ chunkKey: string; revealedBase64: string }>[];
  task: ExploreTask | null;
  activityState: "idle" | "planning" | "moving" | "waiting" | "paused";
  route: readonly WorldPoint[];
  routeIndex: number;
}>;

export type EnginePersistedState = Readonly<{
  seed: SeedDecimal;
  worldTimeMs: string;
  position: WorldPoint;
  totalXp: number;
  task: ExploreTask | null;
  execution: Readonly<{
    state: "idle" | "planning" | "moving" | "waiting" | "paused";
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
    waitingReason: ActivityReason | null;
  }>;
  revealedChunks: readonly Readonly<{ chunkKey: string; revealedBase64: string }>[];
}>;

export type EngineRestoreState = Readonly<{
  seed: SeedDecimal;
  worldTimeMs: string;
  position: WorldPoint;
  totalXp: number;
  task: ExploreTask | null;
  executionState: "idle" | "planning" | "moving" | "waiting" | "paused";
  waitingReason: ActivityReason | null;
  revealedChunks: readonly Readonly<{ chunkKey: string; revealedBase64: string }>[];
}>;

export type EngineReadModelOptions = Readonly<{
  saveState?: GameplayReadModelV1["save"];
  offlineReport?: OfflineReport | null;
  startup?: GameplayReadModelV1["startup"];
}>;

type PendingTerrain = Readonly<{ source: "anchor" | "navigation"; effect: EngineTerrainEffect }>;

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

function taskIdFromCommandId(commandId: string): TaskId {
  if (!commandId.startsWith("cmd:")) throw new TypeError("validated command ID required");
  return `task:${commandId.slice(4)}`;
}

function clonePoint(point: WorldPoint): WorldPoint { return { x: point.x, y: point.y }; }

export class GameplayEngine {
  private readonly generatorVersion: number;
  private readonly fog: FogMap = new Map();
  private readonly terrain = new TerrainSnapshot();
  private seed: SeedDecimal | null = null;
  private worldTimeMs = 0n;
  private position: WorldPoint | null = null;
  private totalXp = 0;
  private revealedTileCount = 0;
  private task: ExploreTask | null = null;
  private activityState: "idle" | "planning" | "moving" | "waiting" | "paused" = "idle";
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
  private anchor: CampAnchorStepper | null = null;
  private pendingTerrain: PendingTerrain | null = null;
  private startup: GameplayReadModelV1["startup"] = "new_world";

  constructor(generatorVersion: number) { this.generatorVersion = generatorVersion; }

  get epoch(): number { return this.gameplayEpoch; }
  get revision(): number { return this.readModelRevision; }
  get worldSeed(): SeedDecimal | null { return this.seed; }

  touchReadModel(): void { this.bumpRevision(); }

  snapshot(): EngineSnapshot {
    return {
      seed: this.seed,
      worldTimeMs: this.worldTimeMs,
      position: this.position === null ? null : clonePoint(this.position),
      totalXp: this.totalXp,
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
      totalXp: this.totalXp,
      task: this.task === null ? null : structuredClone(this.task),
      execution: {
        state: this.activityState,
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
        waitingReason: this.reason,
      },
      revealedChunks: [...this.fog.entries()]
        .sort(([left], [right]) => compareChunkKeysNumeric(left, right))
        .map(([chunkKey, bits]) => ({ chunkKey, revealedBase64: fogBitsToBase64(bits) })),
    };
  }

  restore(state: EngineRestoreState): void {
    this.gameplayEpoch += 1;
    this.plannerGeneration += 1;
    this.seed = state.seed;
    this.worldTimeMs = BigInt(state.worldTimeMs);
    this.position = clonePoint(state.position);
    this.totalXp = state.totalXp;
    this.task = state.task === null ? null : structuredClone(state.task);
    this.anchor = null;
    this.pendingTerrain = null;
    this.terrain.clear();
    this.fog.clear();
    for (const chunk of state.revealedChunks) this.fog.set(chunk.chunkKey, base64ToFogBits(chunk.revealedBase64));
    this.revealedTileCount = 0;
    for (const bits of this.fog.values()) {
      for (const byte of bits) {
        let value = byte;
        while (value !== 0) { this.revealedTileCount += value & 1; value >>>= 1; }
      }
    }
    this.clearRoute();
    this.reason = null;
    if (this.task === null) {
      this.activityState = "idle";
    } else if (state.executionState === "waiting" || state.executionState === "paused") {
      this.activityState = state.executionState;
      this.reason = state.waitingReason;
    } else {
      this.beginPlanning();
    }
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
    this.task = null;
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
    this.totalXp = 0;
    this.revealedTileCount = 0;
    this.task = null;
    this.anchor = null;
    this.planner = null;
    this.pendingTerrain = null;
    this.terrain.clear();
    this.fog.clear();
    this.clearRoute();
    this.activityState = "idle";
    this.reason = null;
    this.startup = "new_world";
    this.bumpRevision();
  }

  setTask(commandId: string, taskInput: EngineTaskInput): void {
    this.requireWorld();
    this.plannerGeneration += 1;
    this.materializeCurrentPosition();
    this.task = {
      taskId: taskIdFromCommandId(commandId), kind: "Explore", mode: taskInput.mode,
      destination: taskInput.destination === null ? null : clonePoint(taskInput.destination),
      createdWorldTimeMs: this.worldTimeMs.toString(),
    };
    this.pendingTerrain = null;
    this.clearRoute();
    this.beginPlanning();
    this.bumpRevision();
  }

  cancelTask(): void {
    this.requireWorld();
    this.plannerGeneration += 1;
    this.materializeCurrentPosition();
    this.pendingTerrain = null;
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
      this.totalXp = 0;
      this.revealedTileCount = 0;
      this.task = null;
      this.activityState = "idle";
      this.clearRoute();
      this.reason = null;
      this.revealAtCurrent(false);
      this.startup = "ready";
      this.bumpRevision();
      return { kind: "settled" };
    }
    if (this.activityState !== "planning" || this.planner === null) return { kind: "settled" };
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
    if (pending.source === "anchor") this.anchor?.provideChunk(effect.chunkX, effect.chunkY, bytes);
    else this.terrain.provideChunk(effect.chunkX, effect.chunkY, bytes);
    this.pendingTerrain = null;
  }

  /** Advances through exact motion events; planning/terrain effects return unconsumed time. */
  advanceBy(deltaMs: bigint): bigint {
    if (deltaMs < 0n) throw new RangeError("world-time delta must be non-negative");
    this.requireWorld();
    const target = this.worldTimeMs + deltaMs;
    while (true) {
      if (this.activityState === "planning" || this.activityState === "paused") return target - this.worldTimeMs;
      const motion = this.motion;
      if (this.activityState !== "moving" || motion === null) {
        if (this.worldTimeMs >= target) return 0n;
        this.worldTimeMs = target;
        this.bumpRevision();
        return 0n;
      }

      const nextBoundaryTime = motion.boundaryWorldTimes[motion.boundaryIndex] ?? null;
      const nextEventTime = nextBoundaryTime !== null && nextBoundaryTime < motion.endWorldTimeMs
        ? nextBoundaryTime : motion.endWorldTimeMs;
      if (target < nextEventTime) {
        this.worldTimeMs = target;
        this.position = this.positionForMotion(motion, target);
        this.bumpRevision();
        return 0n;
      }

      if (this.worldTimeMs === target && nextEventTime > target) {
        this.position = this.positionForMotion(motion, target);
        return 0n;
      }

      this.worldTimeMs = nextEventTime;
      this.position = this.positionForMotion(motion, nextEventTime);
      let observed = false;
      if (nextBoundaryTime === nextEventTime) {
        while (motion.boundaryIndex < motion.boundaryWorldTimes.length
          && motion.boundaryWorldTimes[motion.boundaryIndex] === nextEventTime) motion.boundaryIndex += 1;
        this.revealAtCurrent(true);
        observed = true;
      }
      if (motion.endWorldTimeMs === nextEventTime) {
        this.position = clonePoint(motion.profile.end);
        this.routeIndex = motion.pathIndex + 1;
        this.motion = null;
        if (!observed) this.revealAtCurrent(true);
        if (this.routeIndex + 1 < this.route.length) this.startMotionForCurrentLeg();
        else this.finishRoute();
      }
      this.bumpRevision();
    }
    return 0n;
  }

  toReadModel(saveRevision = 0, committedWallClockMs: number | null = null, options: EngineReadModelOptions = {}): GameplayReadModelV1 {
    const level = levelFromTotalXp(this.totalXp);
    const levelStart = xpAtLevelStart(level);
    const remainingEtaMs = this.remainingRouteEtaMs();
    return {
      protocolVersion: 1,
      readModelRevision: this.readModelRevision,
      gameplayEpoch: this.gameplayEpoch,
      startup: options.startup ?? this.startup,
      generatorVersion: this.generatorVersion,
      player: this.position === null ? null : { position: clonePoint(this.position), hp: { current: 100, max: 100 }, combatScope: "not_implemented_phase_1" },
      task: this.task,
      activity: {
        state: this.activityState, route: this.route.map(clonePoint),
        routeIndex: this.route.length === 0 ? 0 : Math.min(this.routeIndex, this.route.length - 1),
        etaMs: remainingEtaMs === null ? null : remainingEtaMs.toString(),
        progressPermille: this.motion === null ? null : this.motionProgressPermille(this.motion), reason: this.reason,
      },
      exploration: this.position === null ? null : {
        level, totalXp: this.totalXp, currentLevelXp: this.totalXp - levelStart, nextLevelXp: xpForNextLevel(level),
        observationRadiusTiles: observationRadius(level), revealedTileCount: this.revealedTileCount,
      },
      map: {
        revealedChunks: [...this.fog.entries()].sort(([left], [right]) => compareChunkKeysNumeric(left, right)).map(([chunkKey, bits]) => {
          const [chunkX, chunkY] = chunkKey.split(",") as [string, string];
          return { chunkKey, chunkX, chunkY, revealedBase64: fogBitsToBase64(bits) };
        }),
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
    const level = levelFromTotalXp(this.totalXp);
    this.clearRoute();
    this.planner = new PlannerStepper(this.terrain, this.fog, this.position, observationRadius(level), this.task.destination);
    this.activityState = "planning";
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
      if (this.isAtTaskDestination()) { this.activityState = "waiting"; this.reason = TASK_COMPLETED_REASON; }
      else if (revealed === 0) { this.activityState = "waiting"; this.reason = NO_FRONTIER_REASON; }
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
    if (this.isAtTaskDestination()) { this.activityState = "waiting"; this.reason = TASK_COMPLETED_REASON; }
    else this.beginPlanning();
  }

  private isAtTaskDestination(): boolean {
    const task = this.task;
    const position = this.position;
    return task?.mode === "destination" && task.destination !== null && position !== null
      && position.x === task.destination.x && position.y === task.destination.y;
  }

  private clearRoute(): void {
    this.planner = null;
    this.route = [];
    this.legCosts = [];
    this.legProfiles = [];
    this.routeIndex = 0;
    this.routeStartWorldTimeMs = this.worldTimeMs;
    this.routeCumulativeCosts = [];
    this.routeTotalCost = 0n;
    this.motion = null;
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
    return result.newlyRevealed;
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
}
