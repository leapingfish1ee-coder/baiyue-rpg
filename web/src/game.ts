import "./game.css";
import { Camera } from "./camera.ts";
import { ChunkManager } from "./chunk-manager.ts";
import { GameplayClient } from "./gameplay-client.ts";
import type { ActivityReason, GameplayReadModelV1, WorldPoint } from "./gameplay/contracts.ts";
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

let readModel: GameplayReadModelV1 | null = null;
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
    case "storage_write_failed": return "保存失败，探索已暂停";
    case "incompatible_save": return "存档版本不兼容";
    case "active_in_other_tab": return "世界已在另一个标签页运行";
    case "undefined_failure": return "探索已暂停";
  }
}

function activityLabel(model: GameplayReadModelV1): string {
  switch (model.activity.state) {
    case "idle": return "空闲";
    case "planning": return "规划路线";
    case "moving": return "探索中";
    case "waiting": return reasonLabel(model.activity.reason) ?? "等待中";
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

function tileOf(point: WorldPoint): Readonly<{ x: bigint; y: bigint }> {
  const divisor = NAV_UNITS_PER_TILE;
  const floor = (value: bigint): bigint => {
    const quotient = value / divisor;
    return value % divisor < 0n ? quotient - 1n : quotient;
  };
  return { x: floor(BigInt(point.x)), y: floor(BigInt(point.y)) };
}

function syncProductUi(model: GameplayReadModelV1): void {
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
    hpLabel.textContent = `${model.player!.hp.current} / ${model.player!.hp.max}`;
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

  const saveLabels: Record<GameplayReadModelV1["save"]["state"], string> = {
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
      offlineSummary.textContent = `获得 ${model.offlineReport.xpGained} XP，揭露 ${model.offlineReport.revealedTiles} 格。${discarded > 0n ? `超过 168 小时的 ${formatDuration(discarded.toString())} 未计入。` : ""}`;
    }
  }
}

client.subscribe(syncProductUi);

function setBusy(busy: boolean): void {
  commandBusy = busy;
  for (const button of [createButton, continuousButton, destinationModeButton, cancelButton, destinationConfirm, exportButton, importButton, resetButton]) {
    button.disabled = busy;
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

  if (model.activity.route.length > 0) {
    context.save();
    context.strokeStyle = "rgba(247, 209, 137, .82)";
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
