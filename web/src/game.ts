import "./game.css";
import { Camera } from "./camera.ts";
import { ChunkManager } from "./chunk-manager.ts";
import { GameplayClient } from "./gameplay-client.ts";
import type { ActivityReason, GameplayReadModelV2, WorldPoint } from "./gameplay/contracts.ts";
import { RECIPE_DEFINITIONS, RESOURCE_DEFINITIONS, RESOURCE_PROTOTYPE_ORDER, type RecipeId, type ResourcePrototypeId, type ResourceTaskKind, type ToolItemId } from "./gameplay/content.ts";
import { base64ToFogBits } from "./gameplay/fog.ts";
import { Renderer } from "./renderer.ts";
import { NAV_UNITS_PER_TILE, RUNTIME_CHUNK_SIZE } from "./world-contract.ts";

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`Missing product UI element: ${selector}`);
  return element;
}

const app = required<HTMLElement>("#game-app");
const canvas = required<HTMLCanvasElement>("#world");
const maybeContext = canvas.getContext("2d");
if (maybeContext === null) throw new Error("Canvas2D is unavailable");
const context: CanvasRenderingContext2D = maybeContext;

const onboarding = required<HTMLElement>("#onboarding");
const startupMessage = required<HTMLElement>("#startup-message");
const seedInput = required<HTMLInputElement>("#world-seed");
const createButton = required<HTMLButtonElement>("#create-world");
const journeyPanel = required<HTMLElement>("#journey-panel");
const taskBar = required<HTMLElement>("#task-bar");
const playerPosition = required<HTMLElement>("#player-position");
const activityState = required<HTMLElement>("#activity-state");
const levelLabel = required<HTMLElement>("#level-label");
const xpLabel = required<HTMLElement>("#xp-label");
const xpProgress = required<HTMLProgressElement>("#xp-progress");
const hpLabel = required<HTMLElement>("#hp-label");
const revealedCount = required<HTMLElement>("#revealed-count");
const radiusLabel = required<HTMLElement>("#radius-label");
const etaLabel = required<HTMLElement>("#eta-label");
const gatherControls = required<HTMLElement>("#gather-controls");
const gatherUnknown = required<HTMLElement>("#gather-unknown");
const gatherTarget = required<HTMLSelectElement>("#gather-target");
const gatherQuantity = required<HTMLInputElement>("#gather-quantity");
const gatherFiniteButton = required<HTMLButtonElement>("#gather-finite");
const gatherContinuousButton = required<HTMLButtonElement>("#gather-continuous");
const gatherProgress = required<HTMLElement>("#gather-progress");
const huntControls = required<HTMLElement>("#hunt-controls");
const huntUnknown = required<HTMLElement>("#hunt-unknown");
const huntQuantity = required<HTMLInputElement>("#hunt-quantity");
const huntFiniteButton = required<HTMLButtonElement>("#hunt-finite");
const huntContinuousButton = required<HTMLButtonElement>("#hunt-continuous");
const huntProgress = required<HTMLElement>("#hunt-progress");
const produceRecipe = required<HTMLSelectElement>("#produce-recipe");
const produceQuantity = required<HTMLInputElement>("#produce-quantity");
const produceFiniteButton = required<HTMLButtonElement>("#produce-finite");
const produceContinuousButton = required<HTMLButtonElement>("#produce-continuous");
const recipeDetail = required<HTMLElement>("#recipe-detail");
const materialsMissing = required<HTMLElement>("#materials-missing");
const gatheringLevel = required<HTMLElement>("#gathering-level");
const gatheringXp = required<HTMLElement>("#gathering-xp");
const gatheringSpeed = required<HTMLElement>("#gathering-speed");
const woodcuttingLevel = required<HTMLElement>("#woodcutting-level");
const woodcuttingXp = required<HTMLElement>("#woodcutting-xp");
const woodcuttingSpeed = required<HTMLElement>("#woodcutting-speed");
const miningLevel = required<HTMLElement>("#mining-level");
const miningXp = required<HTMLElement>("#mining-xp");
const miningSpeed = required<HTMLElement>("#mining-speed");
const craftingLevel = required<HTMLElement>("#crafting-level");
const craftingXp = required<HTMLElement>("#crafting-xp");
const craftingSpeed = required<HTMLElement>("#crafting-speed");
const meleeLevel = required<HTMLElement>("#melee-level");
const meleeXp = required<HTMLElement>("#melee-xp");
const meleeSpeed = required<HTMLElement>("#melee-speed");
const stealthLevel = required<HTMLElement>("#stealth-level");
const stealthXp = required<HTMLElement>("#stealth-xp");
const stealthSpeed = required<HTMLElement>("#stealth-speed");
const taskWarning = required<HTMLElement>("#task-warning");
const fiberQuantity = required<HTMLElement>("#fiber-quantity");
const materialList = required<HTMLElement>("#material-list");
const toolInventoryList = required<HTMLElement>("#tool-inventory-list");
const axeEquipped = required<HTMLElement>("#axe-equipped");
const pickaxeEquipped = required<HTMLElement>("#pickaxe-equipped");
const axeToggle = required<HTMLButtonElement>("#axe-toggle");
const pickaxeToggle = required<HTMLButtonElement>("#pickaxe-toggle");
const axeChoice = required<HTMLSelectElement>("#axe-choice");
const pickaxeChoice = required<HTMLSelectElement>("#pickaxe-choice");
const axeDetail = required<HTMLElement>("#axe-detail");
const pickaxeDetail = required<HTMLElement>("#pickaxe-detail");
const weaponEquipped = required<HTMLElement>("#weapon-equipped");
const weaponDetail = required<HTMLElement>("#weapon-detail");
const combatPanel = required<HTMLElement>("#combat-panel");
const combatTrigger = required<HTMLElement>("#combat-trigger");
const combatPlayerHp = required<HTMLElement>("#combat-player-hp");
const combatEnemyName = required<HTMLElement>("#combat-enemy-name");
const combatEnemyHp = required<HTMLElement>("#combat-enemy-hp");
const combatDetail = required<HTMLElement>("#combat-detail");
const enemyCount = required<HTMLElement>("#enemy-count");
const enemyList = required<HTMLUListElement>("#enemy-list");
const resourceCount = required<HTMLElement>("#resource-count");
const resourceList = required<HTMLUListElement>("#resource-list");
const bottomIntent = required<HTMLElement>("#bottom-intent");
const bottomPhase = required<HTMLElement>("#bottom-phase");
const bottomRemaining = required<HTMLElement>("#bottom-remaining");
const continuousButton = required<HTMLButtonElement>("#explore-continuous");
const destinationModeButton = required<HTMLButtonElement>("#choose-destination");
const cancelButton = required<HTMLButtonElement>("#cancel-task");
const destinationCard = required<HTMLElement>("#destination-card");
const destinationLabel = required<HTMLElement>("#destination-label");
const destinationX = required<HTMLInputElement>("#destination-x");
const destinationY = required<HTMLInputElement>("#destination-y");
const destinationConfirm = required<HTMLButtonElement>("#destination-confirm");
const destinationClear = required<HTMLButtonElement>("#destination-clear");
const mapHint = required<HTMLElement>("#map-hint");
const saveStateLabel = required<HTMLElement>("#save-state");
const systemToggle = required<HTMLButtonElement>("#system-toggle");
const systemPanel = required<HTMLElement>("#system-panel");
const systemClose = required<HTMLButtonElement>("#system-close");
const saveDetail = required<HTMLElement>("#save-detail");
const systemMessage = required<HTMLElement>("#system-message");
const exportButton = required<HTMLButtonElement>("#export-save");
const importButton = required<HTMLButtonElement>("#import-save");
const importFile = required<HTMLInputElement>("#import-file");
const resetButton = required<HTMLButtonElement>("#reset-save");
const offlinePanel = required<HTMLElement>("#offline-report");
const offlineClose = required<HTMLButtonElement>("#offline-close");
const offlineTitle = required<HTMLElement>("#offline-title");
const offlineSummary = required<HTMLElement>("#offline-summary");
const toast = required<HTMLElement>("#toast");
const debugLink = required<HTMLAnchorElement>("#debug-link");
debugLink.hidden = !import.meta.env.DEV;

const chunks = new ChunkManager();
const renderer = new Renderer();
const camera = new Camera(canvas);
const client = new GameplayClient(chunks);
renderer.setGridVisible(false);

let readModel: GameplayReadModelV2 | null = null;
let selectedDestination: WorldPoint | null = null;
let choosingDestination = false;
let commandBusy = false;
let centeredEpoch = -1;
let followPlayer = true;
let viewportWidth = 1;
let viewportHeight = 1;
let lastFrame = performance.now();
let toastTimer = 0;
let lastOfflineClaim: string | null = null;
let pointerStart: Readonly<{ x: number; y: number }> | null = null;
const fogSurfaces = new Map<string, Readonly<{ encoded: string; canvas: HTMLCanvasElement }>>();

function showToast(message: string, error = false): void {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.style.color = error ? "#ffd0c2" : "";
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 3_600);
}

function reasonLabel(reason: ActivityReason | null): string | null {
  if (reason === null) return null;
  switch (reason.code) {
    case "TaskCompleted": return "已抵达目的地";
    case "NoReachableTargetOrFrontier": return "附近没有可到达的未知区域";
    case "DestinationUnreachable": return "目的地不可到达";
    case "MissingTool": return `缺少${reason.params.slot === "axe" ? "斧" : "镐"}（tier ${reason.params.minimumTier}）`;
    case "MaterialsMissing": return `缺少材料：${reason.params.materials.map((item) => `${item.displayName} ${item.missing}`).join("、")}`;
    case "storage_write_failed": return "保存失败，探索已暂停";
    case "incompatible_save": return "存档版本不兼容";
    case "active_in_other_tab": return "世界已在另一个标签页运行";
    case "integrity/quantity_overflow": return "数量超过安全上限，世界已暂停";
    case "undefined_failure": return "探索已暂停";
  }
}

function activityLabel(model: GameplayReadModelV2): string {
  switch (model.activity.state) {
    case "idle": return "空闲";
    case "planning": return model.activity.phase === "acquiring_target" ? "索取资源节点" : model.activity.phase === "auto_exploring" ? "自动探索" : "规划路线";
    case "moving": return model.activity.phase === "moving_to_target" ? "前往资源" : model.activity.phase === "auto_exploring" ? "自动探索" : "探索中";
    case "acting": {
      const action = model.activity.action;
      if (action === null) return "执行行动";
      if (action.kind === "Produce") return `生产${RECIPE_DEFINITIONS[action.recipeId].displayName} · ${formatDuration(action.remainingMs)}`;
      return `${RESOURCE_DEFINITIONS[action.prototypeId].taskKind === "Woodcut" ? "伐木" : RESOURCE_DEFINITIONS[action.prototypeId].taskKind === "Mine" ? "采矿" : "采集"} · ${formatDuration(action.remainingMs)}`;
    }
    case "waiting": {
      if (model.activity.reason?.code !== "TaskCompleted") return reasonLabel(model.activity.reason) ?? "等待中";
      if (model.task?.kind === "Explore") return model.task.mode === "destination" ? "已抵达目的地" : "探索完成";
      if (model.task?.kind === "Produce") return "生产完成";
      if (model.task?.kind === "Hunt") return "狩猎完成";
      return model.task === null ? "任务完成" : `${resourceTaskLabel(model.task.kind)}完成`;
    }
    case "combat": return `战斗 · ${model.combat?.displayName ?? "敌人"}`;
    case "respawning": return `等待复活 · ${formatDuration(model.respawn?.remainingMs ?? "0")}`;
    case "paused": return "已暂停";
  }
}

function formatDuration(decimalMs: string): string {
  const milliseconds = BigInt(decimalMs);
  if (milliseconds < 1_000n) return `${milliseconds} 毫秒`;
  const seconds = milliseconds / 1_000n;
  if (seconds < 60n) return `${seconds} 秒`;
  const minutes = seconds / 60n;
  if (minutes < 60n) return `${minutes} 分钟`;
  const hours = minutes / 60n;
  if (hours < 48n) return `${hours} 小时`;
  return `${hours / 24n} 天 ${hours % 24n} 小时`;
}

function formatHp(microHp: string): string {
  const value = BigInt(microHp);
  const tenths = (value + 50_000n) / 100_000n;
  return `${tenths / 10n}.${tenths % 10n}`;
}

function tileOf(point: WorldPoint): Readonly<{ x: bigint; y: bigint }> {
  const divisor = NAV_UNITS_PER_TILE;
  const floor = (value: bigint): bigint => {
    const quotient = value / divisor;
    return value % divisor < 0n ? quotient - 1n : quotient;
  };
  return { x: floor(BigInt(point.x)), y: floor(BigInt(point.y)) };
}

function phaseLabel(model: GameplayReadModelV2): string {
  const labels: Record<GameplayReadModelV2["activity"]["phase"], string> = {
    idle: "空闲", exploring: "探索", acquiring_target: "索取最近节点", moving_to_target: "前往采集点",
    resource_action: "资源行动", auto_exploring: "为任务自动探索", waiting: "待机", paused: "暂停",
    production_action: "生产",
    combat: "连续战斗", waiting_respawn: "等待复活",
  };
  return labels[model.activity.phase];
}

function resourceTaskLabel(kind: ResourceTaskKind): string {
  return kind === "Gather" ? "采集" : kind === "Woodcut" ? "伐木" : "采矿";
}

function syncTaskWarning(model: GameplayReadModelV2): void {
  const prototypeId = gatherTarget.value as ResourcePrototypeId;
  const placement = model.map.resourcePlacements.find((candidate) => candidate.prototypeId === prototypeId);
  const requirement = placement?.requiredTool ?? null;
  if (requirement === null || model.equipment?.[requirement.slot] !== null) {
    taskWarning.hidden = true;
    taskWarning.textContent = "";
    return;
  }
  taskWarning.hidden = false;
  taskWarning.textContent = `当前未装备${requirement.slot === "axe" ? "斧" : "镐"}。任务会保留并等待工具。`;
}

function syncSkill(label: string, skill: NonNullable<GameplayReadModelV2["skills"]>["gathering"] | undefined, levelNode: HTMLElement, xpNode: HTMLElement, speedNode: HTMLElement): void {
  if (skill === undefined) return;
  levelNode.textContent = `${label} Lv.${skill.level}`;
  xpNode.textContent = skill.nextLevelXp === null ? `${skill.totalXp.toLocaleString()} XP · 满级`
    : `${skill.currentLevelXp.toLocaleString()} / ${skill.nextLevelXp.toLocaleString()} XP`;
  speedNode.textContent = `${skill.skillSpeedBps} bps`;
}

function inventoryRows(items: NonNullable<GameplayReadModelV2["inventory"]>["items"], empty: string): readonly HTMLElement[] {
  if (items.length === 0) {
    const node = document.createElement("span");
    node.className = "empty-copy";
    node.textContent = empty;
    return [node];
  }
  return items.map((entry) => {
    const row = document.createElement("div");
    row.className = "compact-stat";
    const name = document.createElement("span");
    name.textContent = entry.displayName;
    const quantity = document.createElement("strong");
    quantity.textContent = String(entry.quantity);
    row.append(name, quantity);
    return row;
  });
}

function syncToolChoice(model: GameplayReadModelV2, slot: "axe" | "pickaxe", select: HTMLSelectElement, detail: HTMLElement, button: HTMLButtonElement): void {
  const previous = select.value;
  const candidates = model.toolCandidates.filter((candidate) => candidate.slot === slot && (candidate.inventoryQuantity > 0 || candidate.equipped));
  const options = candidates.map((candidate) => {
    const option = document.createElement("option");
    option.value = candidate.itemId;
    option.disabled = !candidate.canEquip || (!candidate.equipped && candidate.inventoryQuantity === 0);
    option.textContent = `${candidate.displayName} · tier ${candidate.tier} · +${candidate.speedBps} bps${candidate.canEquip ? "" : `（需${candidate.requiredSkillId === "woodcutting" ? "伐木" : "采矿"} ${candidate.requiredLevel}）`}`;
    return option;
  });
  select.replaceChildren(...options);
  const selected = candidates.find((candidate) => candidate.itemId === previous && !select.querySelector<HTMLOptionElement>(`option[value="${candidate.itemId}"]`)?.disabled)
    ?? candidates.find((candidate) => candidate.equipped)
    ?? candidates.find((candidate) => candidate.canEquip && candidate.inventoryQuantity > 0);
  if (selected !== undefined) select.value = selected.itemId;
  select.disabled = selected === undefined;
  const equipped = model.equipment?.[slot] ?? null;
  button.textContent = selected !== undefined && equipped?.itemId === selected.itemId ? "卸下" : "装备";
  button.disabled = commandBusy || selected === undefined || (!selected.canEquip && !selected.equipped);
  detail.textContent = selected === undefined ? "没有可用工具"
    : `tier ${selected.tier} · 速度 +${selected.speedBps} bps · 需${selected.requiredSkillId === "woodcutting" ? "伐木" : "采矿"} ${selected.requiredLevel}`;
}

function syncGatheringUi(model: GameplayReadModelV2): void {
  const previousTarget = gatherTarget.value;
  const summaries = new Map(model.map.resourcePlacements.map((placement) => [placement.prototypeId, placement]));
  const options = RESOURCE_PROTOTYPE_ORDER.filter((prototypeId) => model.knownTargetPrototypeIds.includes(prototypeId)).map((prototypeId) => {
    const definition = RESOURCE_DEFINITIONS[prototypeId];
    const summary = summaries.get(prototypeId);
    const option = document.createElement("option");
    option.value = prototypeId;
    option.disabled = summary?.locked ?? false;
    option.textContent = `${resourceTaskLabel(definition.taskKind)} · ${definition.displayName}${summary?.locked ? `（需${definition.skillId === "mining" ? "采矿" : definition.skillId === "woodcutting" ? "伐木" : "采集"} ${definition.requiredLevel}）` : ""}`;
    return option;
  });
  gatherTarget.replaceChildren(...options);
  if (options.some((option) => option.value === previousTarget && !option.disabled)) gatherTarget.value = previousTarget;
  const known = options.length > 0;
  gatherControls.hidden = !known;
  gatherUnknown.hidden = known;
  if (known) updateResourceButtons();
  const task = model.task;
  const isResourceTask = task !== null && (task.kind === "Gather" || task.kind === "Woodcut" || task.kind === "Mine");
  gatherProgress.textContent = isResourceTask
    ? task.quantity === null ? `${task.completedQuantity} · 持续` : `${task.completedQuantity} / ${task.quantity}`
    : task?.kind === "Produce"
      ? `生产 ${task.requestedQuantity === null ? `${task.completedQuantity} · 持续` : `${task.completedQuantity} / ${task.requestedQuantity}`}`
      : "未设置";

  const huntKnown = model.knownEnemyArchetypeIds.includes("graymane_boar");
  huntControls.hidden = !huntKnown;
  huntUnknown.hidden = huntKnown;
  const huntTask = task?.kind === "Hunt" ? task : null;
  huntProgress.textContent = huntTask === null ? huntKnown ? "可狩猎灰鬃野猪" : "尚未发现目标"
    : huntTask.requestedKills === null ? `${huntTask.completedKills} · 持续`
      : `${huntTask.completedKills} / ${huntTask.requestedKills}`;

  const previousRecipe = produceRecipe.value;
  const recipeOptions = model.recipes.map((recipe) => {
    const option = document.createElement("option");
    option.value = recipe.recipeId;
    option.disabled = recipe.locked;
    option.textContent = `${recipe.displayName}${recipe.locked ? `（需工艺 ${recipe.requiredLevel}）` : ""}`;
    return option;
  });
  produceRecipe.replaceChildren(...recipeOptions);
  if (recipeOptions.some((option) => option.value === previousRecipe && !option.disabled)) produceRecipe.value = previousRecipe;
  else if (task?.kind === "Produce") produceRecipe.value = task.recipeId;
  updateProductionButtons(model);
  const missingReason = model.activity.reason?.code === "MaterialsMissing" ? model.activity.reason : null;
  materialsMissing.hidden = missingReason === null;
  materialsMissing.textContent = missingReason === null ? "" : `材料不足：${missingReason.params.materials.map((item) => `${item.displayName} 缺 ${item.missing}（${item.available}/${item.required}）`).join("；")}`;

  syncSkill("采集", model.skills?.gathering, gatheringLevel, gatheringXp, gatheringSpeed);
  syncSkill("伐木", model.skills?.woodcutting, woodcuttingLevel, woodcuttingXp, woodcuttingSpeed);
  syncSkill("采矿", model.skills?.mining, miningLevel, miningXp, miningSpeed);
  syncSkill("工艺", model.skills?.crafting, craftingLevel, craftingXp, craftingSpeed);
  syncSkill("近战", model.skills?.melee, meleeLevel, meleeXp, meleeSpeed);
  syncSkill("潜行", model.skills?.stealth, stealthLevel, stealthXp, stealthSpeed);
  fiberQuantity.textContent = String(model.inventory?.items.find((item) => item.itemId === "fiber")?.quantity ?? 0);
  const inventoryItems = model.inventory?.items ?? [];
  materialList.replaceChildren(...inventoryRows(inventoryItems.filter((item) => item.category === "material"), "暂无材料"));
  toolInventoryList.replaceChildren(...inventoryRows(inventoryItems.filter((item) => item.category === "equipment"), "工具均已装备"));
  const axe = model.equipment?.axe ?? null;
  const pickaxe = model.equipment?.pickaxe ?? null;
  const weapon = model.equipment?.weapon ?? null;
  weaponEquipped.textContent = weapon?.displayName ?? "—";
  weaponDetail.textContent = weapon === null ? "—"
    : `${weapon.damageMin}–${weapon.damageMax} 伤害 · 命中 +${weapon.accuracyBonus} · ${formatDuration(weapon.attackIntervalMs)}/击`;
  axeEquipped.textContent = axe?.displayName ?? "未装备";
  pickaxeEquipped.textContent = pickaxe?.displayName ?? "未装备";
  syncToolChoice(model, "axe", axeChoice, axeDetail, axeToggle);
  syncToolChoice(model, "pickaxe", pickaxeChoice, pickaxeDetail, pickaxeToggle);

  resourceCount.textContent = String(model.map.resourcePlacements.length);
  resourceList.replaceChildren(...model.map.resourcePlacements.map((placement) => {
    const item = document.createElement("li");
    const state = placement.locked ? `需${placement.skillId === "mining" ? "采矿" : placement.skillId === "woodcutting" ? "伐木" : "采集"} ${placement.requiredLevel}`
      : placement.state === "active" ? "可执行" : placement.state === "depleted" ? "已耗尽" : `重生 ${formatDuration(placement.respawnRemainingMs ?? "0")}`;
    item.dataset.state = placement.state;
    const dot = document.createElement("span");
    dot.style.background = placement.mapColor;
    const body = document.createElement("div");
    const name = document.createElement("strong"); name.textContent = placement.displayName;
    const status = document.createElement("small"); status.textContent = state;
    body.append(name, status); item.append(dot, body);
    return item;
  }));
  syncTaskWarning(model);

  enemyCount.textContent = String(model.map.enemyPlacements.length);
  enemyList.replaceChildren(...model.map.enemyPlacements.map((placement) => {
    const item = document.createElement("li");
    item.dataset.state = placement.state;
    const dot = document.createElement("span");
    const body = document.createElement("div");
    const name = document.createElement("strong"); name.textContent = placement.displayName;
    const status = document.createElement("small");
    status.textContent = placement.state === "active" ? "存活" : placement.state === "dead" ? "已击杀"
      : `重生 ${formatDuration(placement.respawnRemainingMs ?? "0")}`;
    body.append(name, status); item.append(dot, body);
    return item;
  }));

  const combat = model.combat;
  combatPanel.hidden = combat === null;
  if (combat !== null) {
    combatTrigger.textContent = combat.triggeredByHunt ? "定向狩猎" : "自然遭遇";
    combatPlayerHp.textContent = `${formatHp(combat.playerHpMicro)} / ${formatHp(combat.playerMaxHpMicro)}`;
    combatEnemyName.textContent = combat.displayName;
    combatEnemyHp.textContent = `${formatHp(combat.enemyHpMicro)} / ${formatHp(combat.enemyMaxHpMicro)}`;
    const last = combat.lastAttack === null ? "尚未攻击"
      : `${combat.lastAttack.actor === "player" ? "玩家" : combat.displayName}${combat.lastAttack.hit ? `造成 ${combat.lastAttack.damage} 伤害` : "未命中"}`;
    combatDetail.textContent = `玩家下次 ${formatDuration(combat.playerNextAttackRemainingMs)} · 敌人下次 ${formatDuration(combat.enemyNextAttackRemainingMs)} · ${last}`;
  }

  bottomIntent.textContent = task === null ? "无任务" : task.kind === "Produce"
    ? `生产${RECIPE_DEFINITIONS[task.recipeId].displayName} · ${task.requestedQuantity === null ? `${task.completedQuantity} / 持续` : `${task.completedQuantity} / ${task.requestedQuantity}`}`
    : task.kind === "Hunt"
      ? `狩猎灰鬃野猪 · ${task.requestedKills === null ? `${task.completedKills} / 持续` : `${task.completedKills} / ${task.requestedKills}`}`
    : task.kind !== "Explore"
      ? `${resourceTaskLabel(task.kind)}${RESOURCE_DEFINITIONS[task.targetPrototypeId].displayName} · ${task.quantity === null ? `${task.completedQuantity} / 持续` : `${task.completedQuantity} / ${task.quantity}`}`
      : task.mode === "continuous" ? "持续探索" : "目的地探索";
  bottomPhase.textContent = phaseLabel(model);
  bottomRemaining.textContent = model.activity.action !== null
    ? `剩余 ${formatDuration(model.activity.action.remainingMs)} · ${model.activity.action.skillSpeedBps} bps`
    : model.activity.etaMs !== null ? `移动剩余 ${formatDuration(model.activity.etaMs)}` : reasonLabel(model.activity.reason) ?? "—";
}

function syncProductUi(model: GameplayReadModelV2): void {
  readModel = model;
  const playable = model.player !== null;
  onboarding.hidden = playable;
  journeyPanel.hidden = !playable;
  taskBar.hidden = !playable;

  if (!playable) {
    startupMessage.dataset.error = String(model.startup === "active_in_other_tab" || model.startup === "storage_blocked" || model.startup === "incompatible_save");
    startupMessage.textContent = model.startup === "active_in_other_tab"
      ? "这个世界已在另一个标签页运行。关闭它后刷新重试。"
      : model.startup === "incompatible_save"
        ? "存档版本不兼容。可从右上角导出或重置。"
        : model.startup === "storage_blocked" ? "本地存档不可用。" : "可以创建本地世界。";
  } else {
    const position = model.player!.position;
    const tile = tileOf(position);
    playerPosition.textContent = `tile ${tile.x}, ${tile.y}`;
    hpLabel.textContent = `${formatHp(model.player!.hp.currentMicro)} / ${formatHp(model.player!.hp.maxMicro)}`;
    activityState.textContent = activityLabel(model);
    if (centeredEpoch !== model.gameplayEpoch) {
      camera.x = Number(BigInt(position.x)) / Number(NAV_UNITS_PER_TILE) * renderer.tilePixels;
      camera.y = Number(BigInt(position.y)) / Number(NAV_UNITS_PER_TILE) * renderer.tilePixels;
      camera.setZoom(1.15);
      centeredEpoch = model.gameplayEpoch;
      followPlayer = true;
    }
    if (followPlayer && model.activity.state === "moving") {
      camera.x = Number(BigInt(position.x)) / Number(NAV_UNITS_PER_TILE) * renderer.tilePixels;
      camera.y = Number(BigInt(position.y)) / Number(NAV_UNITS_PER_TILE) * renderer.tilePixels;
    }
  }

  const exploration = model.exploration;
  if (exploration !== null) {
    levelLabel.textContent = `探索 Lv.${exploration.level}`;
    const maximum = exploration.nextLevelXp ?? Math.max(1, exploration.currentLevelXp);
    xpProgress.max = maximum;
    xpProgress.value = exploration.currentLevelXp;
    xpLabel.textContent = exploration.nextLevelXp === null
      ? `${exploration.totalXp.toLocaleString()} XP · 满级`
      : `${exploration.currentLevelXp.toLocaleString()} / ${exploration.nextLevelXp.toLocaleString()} XP`;
    revealedCount.textContent = `${exploration.revealedTileCount.toLocaleString()} 格`;
    radiusLabel.textContent = `${exploration.observationRadiusTiles} 格`;
  }
  etaLabel.textContent = model.activity.etaMs === null ? "—" : formatDuration(model.activity.etaMs);
  cancelButton.hidden = model.task === null;
  syncGatheringUi(model);

  const saveLabels: Record<GameplayReadModelV2["save"]["state"], string> = {
    none: "尚未建档", saving: "正在保存", saved: `已保存 · r${model.save.revision}`,
    error: "保存失败", incompatible: "版本不兼容", active_in_other_tab: "其他标签页运行中",
  };
  saveStateLabel.textContent = saveLabels[model.save.state];
  saveStateLabel.dataset.state = model.save.state;
  saveDetail.textContent = model.save.committedWallClockMs === null
    ? "所有进度仅保存在当前浏览器。"
    : `修订 ${model.save.revision} · ${new Date(model.save.committedWallClockMs).toLocaleString()} · 仅本机`;

  if (model.offlineReport !== null && model.offlineReport.claimId !== lastOfflineClaim) {
    lastOfflineClaim = model.offlineReport.claimId;
    offlinePanel.hidden = false;
    if (model.offlineReport.clockSkew === "backward") {
      offlineTitle.textContent = "检测到系统时间倒退";
      offlineSummary.textContent = "本次未增加世界时间，也未发放探索收益。";
    } else {
      offlineTitle.textContent = `旅程继续了 ${formatDuration(model.offlineReport.creditedDurationMs)}`;
      const discarded = BigInt(model.offlineReport.discardedDurationMs);
      const skillGains = model.offlineReport.skillXpGains.map((gain) => `${gain.displayName} XP +${gain.xp}`).join("，");
      const itemDeltas = model.offlineReport.itemDeltas.map((delta) => `${delta.displayName} ${delta.quantity > 0 ? "+" : ""}${delta.quantity}`).join("，");
      const combatSummary = `目标击杀 ${model.offlineReport.targetKills}，其他击杀 ${model.offlineReport.otherKills}，死亡 ${model.offlineReport.deaths}，复活 ${model.offlineReport.respawns}，最终生命 ${formatHp(model.offlineReport.finalHpMicro)}`;
      offlineSummary.textContent = `${[skillGains, itemDeltas, `揭露 ${model.offlineReport.revealedTiles} 格`, combatSummary].filter(Boolean).join("，")}。${discarded > 0n ? `超过 168 小时的 ${formatDuration(discarded.toString())} 未计入。` : ""}`;
    }
  }
}

client.subscribe(syncProductUi);

function setBusy(busy: boolean): void {
  commandBusy = busy;
  for (const button of [createButton, continuousButton, destinationModeButton, gatherFiniteButton, gatherContinuousButton, huntFiniteButton, huntContinuousButton, produceFiniteButton, produceContinuousButton, axeToggle, pickaxeToggle, cancelButton, destinationConfirm, exportButton, importButton, resetButton]) {
    button.disabled = busy;
  }
  if (!busy && readModel !== null) {
    updateProductionButtons(readModel);
    syncToolChoice(readModel, "axe", axeChoice, axeDetail, axeToggle);
    syncToolChoice(readModel, "pickaxe", pickaxeChoice, pickaxeDetail, pickaxeToggle);
  }
}

async function runCommand(action: () => Promise<{ status: "accepted" | "rejected"; error: { code: string } | null }>, success: string): Promise<boolean> {
  if (commandBusy) return false;
  setBusy(true);
  try {
    const result = await action();
    if (result.status === "rejected") {
      showToast(reasonLabel(readModel?.activity.reason ?? null) ?? result.error?.code ?? "操作未完成", true);
      return false;
    }
    showToast(success);
    return true;
  } catch (error: unknown) {
    showToast(error instanceof Error ? error.message : String(error), true);
    return false;
  } finally {
    setBusy(false);
  }
}

createButton.addEventListener("click", () => {
  const seed = seedInput.value.trim();
  void runCommand(() => client.command({ type: "CreateWorld", seed, seedSource: "manual" }), "世界已创建");
});

continuousButton.addEventListener("click", () => {
  choosingDestination = false;
  selectedDestination = null;
  syncDestinationUi();
  void runCommand(() => client.command({ type: "SetTask", task: { kind: "Explore", mode: "continuous", destination: null } }), "已开始持续探索");
});

function requestedGatherQuantity(): number | null {
  const text = gatherQuantity.value.trim();
  if (text === "") return null;
  const quantity = Number(text);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new RangeError("任务数量必须是正安全整数");
  return quantity;
}

function updateResourceButtons(): void {
  const prototypeId = gatherTarget.value as ResourcePrototypeId;
  const definition = RESOURCE_DEFINITIONS[prototypeId];
  const label = resourceTaskLabel(definition.taskKind);
  const text = gatherQuantity.value.trim();
  gatherFiniteButton.textContent = /^\d+$/.test(text) ? `${label} ×${text}` : `设置${label}`;
  gatherContinuousButton.textContent = `持续${label}`;
  if (readModel !== null) syncTaskWarning(readModel);
}

function requestedProductionQuantity(): number | null {
  const text = produceQuantity.value.trim();
  if (text === "") return null;
  const quantity = Number(text);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new RangeError("生产数量必须是正安全整数");
  return quantity;
}

function updateProductionButtons(model = readModel): void {
  const recipe = model?.recipes.find((candidate) => candidate.recipeId === produceRecipe.value);
  const text = produceQuantity.value.trim();
  produceFiniteButton.textContent = /^\d+$/.test(text) ? `生产 ×${text}` : "设置生产";
  produceContinuousButton.textContent = "持续生产";
  if (recipe === undefined) {
    recipeDetail.textContent = "没有可用配方";
    produceFiniteButton.disabled = true;
    produceContinuousButton.disabled = true;
    return;
  }
  const inputs = recipe.inputs.map((input) => `${input.displayName} ${input.required}（现有 ${input.available}）`).join(" + ");
  recipeDetail.textContent = `${inputs} → ${recipe.output.displayName} ${recipe.output.quantity} · 基础 ${formatDuration(recipe.baseDurationMs)} · 实际 ${formatDuration(recipe.durationMs)} · 工艺 XP ${recipe.xp} · 手工`;
  produceFiniteButton.disabled = commandBusy || recipe.locked;
  produceContinuousButton.disabled = commandBusy || recipe.locked;
}

function setSelectedResourceTask(quantity: number | null) {
  const prototypeId = gatherTarget.value as ResourcePrototypeId;
  switch (prototypeId) {
    case "wild_fiber": return client.command({ type: "SetTask", task: { kind: "Gather", targetPrototypeId: prototypeId, quantity } });
    case "softwood_tree": return client.command({ type: "SetTask", task: { kind: "Woodcut", targetPrototypeId: prototypeId, quantity } });
    case "surface_stone":
    case "shallow_copper_deposit": return client.command({ type: "SetTask", task: { kind: "Mine", targetPrototypeId: prototypeId, quantity } });
  }
}

gatherQuantity.addEventListener("input", () => {
  updateResourceButtons();
});
gatherTarget.addEventListener("change", updateResourceButtons);
huntQuantity.addEventListener("input", () => {
  const text = huntQuantity.value.trim();
  huntFiniteButton.textContent = /^\d+$/.test(text) ? `狩猎 ×${text}` : "设置狩猎";
});
produceQuantity.addEventListener("input", () => updateProductionButtons());
produceRecipe.addEventListener("change", () => updateProductionButtons());

gatherFiniteButton.addEventListener("click", () => {
  let quantity: number;
  try {
    const requested = requestedGatherQuantity();
    if (requested === null) throw new RangeError("请输入任务数量，或选择持续执行");
    quantity = requested;
  } catch (error: unknown) {
    showToast(error instanceof Error ? error.message : "任务数量无效", true);
    return;
  }
  void runCommand(
    () => setSelectedResourceTask(quantity),
    `已设置${resourceTaskLabel(RESOURCE_DEFINITIONS[gatherTarget.value as ResourcePrototypeId].taskKind)} ×${quantity}`,
  );
});

gatherContinuousButton.addEventListener("click", () => {
  void runCommand(
    () => setSelectedResourceTask(null),
    `已开始持续${resourceTaskLabel(RESOURCE_DEFINITIONS[gatherTarget.value as ResourcePrototypeId].taskKind)}`,
  );
});

huntFiniteButton.addEventListener("click", () => {
  const requested = Number(huntQuantity.value.trim());
  if (!Number.isSafeInteger(requested) || requested <= 0) {
    showToast("狩猎击杀数必须是正安全整数", true);
    return;
  }
  void runCommand(
    () => client.command({ type: "SetTask", task: { kind: "Hunt", archetypeId: "graymane_boar", requestedKills: requested } }),
    `已设置狩猎灰鬃野猪 ×${requested}`,
  );
});

huntContinuousButton.addEventListener("click", () => {
  void runCommand(
    () => client.command({ type: "SetTask", task: { kind: "Hunt", archetypeId: "graymane_boar", requestedKills: null } }),
    "已开始持续狩猎灰鬃野猪",
  );
});

produceFiniteButton.addEventListener("click", () => {
  let quantity: number;
  try {
    const requested = requestedProductionQuantity();
    if (requested === null) throw new RangeError("请输入生产数量，或选择持续生产");
    quantity = requested;
  } catch (error: unknown) {
    showToast(error instanceof Error ? error.message : "生产数量无效", true);
    return;
  }
  const recipeId = produceRecipe.value as RecipeId;
  void runCommand(
    () => client.command({ type: "SetTask", task: { kind: "Produce", recipeId, requestedQuantity: quantity } }),
    `已设置生产${RECIPE_DEFINITIONS[recipeId].displayName} ×${quantity}`,
  );
});

produceContinuousButton.addEventListener("click", () => {
  const recipeId = produceRecipe.value as RecipeId;
  void runCommand(
    () => client.command({ type: "SetTask", task: { kind: "Produce", recipeId, requestedQuantity: null } }),
    `已开始持续生产${RECIPE_DEFINITIONS[recipeId].displayName}`,
  );
});

axeToggle.addEventListener("click", () => {
  const equipped = readModel?.equipment?.axe ?? null;
  const selected = axeChoice.value as ToolItemId;
  void runCommand(
    () => equipped?.itemId === selected ? client.command({ type: "UnequipSlot", slot: "axe" }) : client.command({ type: "EquipItem", itemId: selected }),
    equipped?.itemId === selected ? `已卸下${equipped.displayName}` : `已装备${readModel?.toolCandidates.find((candidate) => candidate.itemId === selected)?.displayName ?? "斧"}`,
  );
});

pickaxeToggle.addEventListener("click", () => {
  const equipped = readModel?.equipment?.pickaxe ?? null;
  const selected = pickaxeChoice.value as ToolItemId;
  void runCommand(
    () => equipped?.itemId === selected ? client.command({ type: "UnequipSlot", slot: "pickaxe" }) : client.command({ type: "EquipItem", itemId: selected }),
    equipped?.itemId === selected ? `已卸下${equipped.displayName}` : `已装备${readModel?.toolCandidates.find((candidate) => candidate.itemId === selected)?.displayName ?? "镐"}`,
  );
});
axeChoice.addEventListener("change", () => { if (readModel !== null) syncToolChoice(readModel, "axe", axeChoice, axeDetail, axeToggle); });
pickaxeChoice.addEventListener("change", () => { if (readModel !== null) syncToolChoice(readModel, "pickaxe", pickaxeChoice, pickaxeDetail, pickaxeToggle); });

destinationModeButton.addEventListener("click", () => {
  choosingDestination = true;
  followPlayer = false;
  selectedDestination = readModel?.player?.position ?? null;
  syncDestinationUi();
});

cancelButton.addEventListener("click", () => {
  void runCommand(() => client.command({ type: "CancelTask" }), "探索任务已取消");
});

function syncDestinationUi(): void {
  app.classList.toggle("is-choosing", choosingDestination);
  mapHint.hidden = !choosingDestination;
  destinationCard.hidden = selectedDestination === null;
  if (selectedDestination !== null) {
    const tile = tileOf(selectedDestination);
    destinationLabel.textContent = `tile ${tile.x}, ${tile.y}`;
    destinationX.value = tile.x.toString();
    destinationY.value = tile.y.toString();
  }
}

destinationClear.addEventListener("click", () => {
  selectedDestination = null;
  choosingDestination = false;
  syncDestinationUi();
});

destinationConfirm.addEventListener("click", () => {
  let destination: WorldPoint;
  try {
    const tileX = BigInt(destinationX.value.trim());
    const tileY = BigInt(destinationY.value.trim());
    if (tileX < -(1n << 31n) || tileX > (1n << 31n) - 1n || tileY < -(1n << 31n) || tileY > (1n << 31n) - 1n) {
      throw new RangeError("Tile 坐标超出阶段 1 范围");
    }
    destination = {
      x: (tileX * NAV_UNITS_PER_TILE + NAV_UNITS_PER_TILE / 2n).toString(),
      y: (tileY * NAV_UNITS_PER_TILE + NAV_UNITS_PER_TILE / 2n).toString(),
    };
  } catch (error: unknown) {
    showToast(error instanceof Error ? error.message : "请输入有效 Tile 坐标", true);
    return;
  }
  void runCommand(
    () => client.command({ type: "SetTask", task: { kind: "Explore", mode: "destination", destination } }),
    "目的地已确认",
  ).then((accepted) => {
    if (!accepted) return;
    choosingDestination = false;
    selectedDestination = null;
    syncDestinationUi();
  });
});

systemToggle.addEventListener("click", () => {
  systemPanel.hidden = !systemPanel.hidden;
  systemToggle.setAttribute("aria-expanded", String(!systemPanel.hidden));
});
systemClose.addEventListener("click", () => { systemPanel.hidden = true; systemToggle.setAttribute("aria-expanded", "false"); });

exportButton.addEventListener("click", async () => {
  if (commandBusy) return;
  setBusy(true);
  try {
    const result = await client.command({ type: "ExportSave" });
    const url = URL.createObjectURL(new Blob([result.backupUtf8], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    systemMessage.textContent = "备份已导出。";
  } catch (error: unknown) {
    systemMessage.textContent = error instanceof Error ? error.message : String(error);
  } finally { setBusy(false); }
});

importButton.addEventListener("click", () => importFile.click());
importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  importFile.value = "";
  if (file === undefined || !window.confirm("导入会替换当前本地世界。确定继续？")) return;
  const backupUtf8 = await file.arrayBuffer();
  const accepted = await runCommand(() => client.command({ type: "ImportSave", backupUtf8, confirmed: true }), "备份已导入");
  if (accepted) {
    centeredEpoch = -1;
    selectedDestination = null;
    choosingDestination = false;
    fogSurfaces.clear();
    syncDestinationUi();
  }
});

resetButton.addEventListener("click", () => {
  if (!window.confirm("这会删除当前本地世界。请先导出需要保留的备份。")) return;
  void runCommand(() => client.command({ type: "ResetSave", confirmed: true }), "本地世界已重置").then((accepted) => {
    if (accepted) window.location.reload();
  });
});

offlineClose.addEventListener("click", () => { offlinePanel.hidden = true; });

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  viewportWidth = Math.max(1, canvas.clientWidth);
  viewportHeight = Math.max(1, canvas.clientHeight);
  const width = Math.round(viewportWidth * dpr);
  const height = Math.round(viewportHeight * dpr);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function fogSurface(chunkKey: string, encoded: string): HTMLCanvasElement {
  const cached = fogSurfaces.get(chunkKey);
  if (cached?.encoded === encoded) return cached.canvas;
  const surface = document.createElement("canvas");
  surface.width = RUNTIME_CHUNK_SIZE;
  surface.height = RUNTIME_CHUNK_SIZE;
  const fog = surface.getContext("2d");
  if (fog === null) throw new Error("Fog Canvas2D is unavailable");
  fog.fillStyle = "rgba(2, 8, 7, .94)";
  fog.fillRect(0, 0, surface.width, surface.height);
  fog.globalCompositeOperation = "destination-out";
  const bits = base64ToFogBits(encoded);
  for (let index = 0; index < RUNTIME_CHUNK_SIZE * RUNTIME_CHUNK_SIZE; index += 1) {
    if (((bits[index >> 3]! >> (index & 7)) & 1) !== 0) fog.fillRect(index % RUNTIME_CHUNK_SIZE, Math.floor(index / RUNTIME_CHUNK_SIZE), 1, 1);
  }
  fogSurfaces.set(chunkKey, { encoded, canvas: surface });
  return surface;
}

function worldToScreen(worldX: number, worldY: number): Readonly<{ x: number; y: number }> {
  return {
    x: (worldX - camera.x) * camera.zoom + viewportWidth / 2,
    y: (worldY - camera.y) * camera.zoom + viewportHeight / 2,
  };
}

function pointWorldPixels(point: WorldPoint): Readonly<{ x: number; y: number }> {
  return {
    x: Number(BigInt(point.x)) / Number(NAV_UNITS_PER_TILE) * renderer.tilePixels,
    y: Number(BigInt(point.y)) / Number(NAV_UNITS_PER_TILE) * renderer.tilePixels,
  };
}

function drawGameplayOverlay(): void {
  const model = readModel;
  if (model?.player === null || model === null) return;
  const fogByChunk = new Map(model.map.revealedChunks.map((chunk) => [chunk.chunkKey, chunk.revealedBase64]));
  const chunkWorldPixels = chunks.chunkSize * renderer.tilePixels;
  for (const chunk of chunks.getChunks()) {
    const worldX = chunk.x * chunkWorldPixels;
    const worldY = chunk.y * chunkWorldPixels;
    const screen = worldToScreen(worldX, worldY);
    const size = chunkWorldPixels * camera.zoom;
    const encoded = fogByChunk.get(chunk.key);
    if (encoded === undefined) {
      context.fillStyle = "rgba(2, 8, 7, .94)";
      context.fillRect(screen.x, screen.y, size, size);
    } else {
      context.imageSmoothingEnabled = false;
      context.drawImage(fogSurface(chunk.key, encoded), screen.x, screen.y, size, size);
    }
  }

  for (const placement of model.map.resourcePlacements) {
    const world = pointWorldPixels(placement.point);
    const screen = worldToScreen(world.x, world.y);
    const radius = placement.placementId === model.activity.targetPlacementId ? 9 : 6;
    context.save();
    context.fillStyle = placement.state === "active" ? "#85d59a" : placement.state === "depleted" ? "#65736d" : "#d3a85e";
    context.strokeStyle = placement.placementId === model.activity.targetPlacementId ? "#fff0b5" : "rgba(5, 15, 11, .9)";
    context.lineWidth = placement.placementId === model.activity.targetPlacementId ? 3 : 2;
    context.beginPath();
    context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.restore();
  }

  for (const placement of model.map.enemyPlacements) {
    const world = pointWorldPixels(placement.point);
    const screen = worldToScreen(world.x, world.y);
    const targeted = placement.placementId === model.activity.targetPlacementId || placement.placementId === model.combat?.placementId;
    context.save();
    context.fillStyle = placement.state === "active" ? "#d48366" : placement.state === "dead" ? "#65736d" : "#d3a85e";
    context.strokeStyle = targeted ? "#fff0b5" : "rgba(5, 15, 11, .9)";
    context.lineWidth = targeted ? 3 : 2;
    context.beginPath();
    context.moveTo(screen.x, screen.y - 8);
    context.lineTo(screen.x + 8, screen.y + 7);
    context.lineTo(screen.x - 8, screen.y + 7);
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();
  }

  if (model.activity.route.length > 0) {
    context.save();
    context.strokeStyle = model.activity.routePurpose === "task_target" ? "rgba(133, 213, 154, .9)"
      : model.activity.routePurpose === "auto_explore" ? "rgba(111, 188, 191, .9)" : "rgba(247, 209, 137, .82)";
    context.lineWidth = 2;
    context.setLineDash([7, 6]);
    context.beginPath();
    model.activity.route.forEach((point, index) => {
      const world = pointWorldPixels(point);
      const screen = worldToScreen(world.x, world.y);
      if (index === 0) context.moveTo(screen.x, screen.y); else context.lineTo(screen.x, screen.y);
    });
    context.stroke();
    context.restore();
  }

  if (selectedDestination !== null) {
    const world = pointWorldPixels(selectedDestination);
    const screen = worldToScreen(world.x, world.y);
    context.strokeStyle = "#f2c979";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(screen.x, screen.y, 13, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.moveTo(screen.x - 18, screen.y); context.lineTo(screen.x + 18, screen.y);
    context.moveTo(screen.x, screen.y - 18); context.lineTo(screen.x, screen.y + 18);
    context.stroke();
  }

  const playerWorld = pointWorldPixels(model.player.position);
  const playerScreen = worldToScreen(playerWorld.x, playerWorld.y);
  context.save();
  context.shadowColor = "rgba(245, 205, 125, .8)";
  context.shadowBlur = 14;
  context.fillStyle = "#f4d28b";
  context.strokeStyle = "#382711";
  context.lineWidth = 2;
  context.beginPath();
  context.arc(playerScreen.x, playerScreen.y, 7, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.restore();
}

canvas.addEventListener("pointerdown", (event) => {
  pointerStart = { x: event.clientX, y: event.clientY };
  followPlayer = false;
});
canvas.addEventListener("pointerup", (event) => {
  if (!choosingDestination || pointerStart === null) return;
  const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
  pointerStart = null;
  if (moved > 6) return;
  const rect = canvas.getBoundingClientRect();
  const worldX = camera.x + (event.clientX - rect.left - rect.width / 2) / camera.zoom;
  const worldY = camera.y + (event.clientY - rect.top - rect.height / 2) / camera.zoom;
  const tileX = BigInt(Math.floor(worldX / renderer.tilePixels));
  const tileY = BigInt(Math.floor(worldY / renderer.tilePixels));
  selectedDestination = {
    x: (tileX * NAV_UNITS_PER_TILE + NAV_UNITS_PER_TILE / 2n).toString(),
    y: (tileY * NAV_UNITS_PER_TILE + NAV_UNITS_PER_TILE / 2n).toString(),
  };
  syncDestinationUi();
});

function frame(now: number): void {
  const delta = Math.min((now - lastFrame) / 1_000, .05);
  lastFrame = now;
  resize();
  camera.update(delta);
  if (readModel?.player !== null && readModel !== null) {
    chunks.ensureVisible(camera.x, camera.y, viewportWidth, viewportHeight, camera.zoom, renderer.tilePixels);
    renderer.draw(context, viewportWidth, viewportHeight, camera, chunks);
    drawGameplayOverlay();
  } else {
    context.clearRect(0, 0, viewportWidth, viewportHeight);
    const gradient = context.createRadialGradient(viewportWidth * .5, viewportHeight * .44, 0, viewportWidth * .5, viewportHeight * .44, Math.max(viewportWidth, viewportHeight) * .7);
    gradient.addColorStop(0, "#183329");
    gradient.addColorStop(1, "#050b09");
    context.fillStyle = gradient;
    context.fillRect(0, 0, viewportWidth, viewportHeight);
  }
  requestAnimationFrame(frame);
}

window.addEventListener("resize", resize);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") void client.flush().catch(() => undefined);
});
window.addEventListener("pagehide", () => client.dispose(), { once: true });

resize();
requestAnimationFrame(frame);
void client.initialize().catch((error: unknown) => {
  startupMessage.dataset.error = "true";
  startupMessage.textContent = error instanceof Error ? error.message : String(error);
});
