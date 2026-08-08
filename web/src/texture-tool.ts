import {
  BASE_TERRAIN_COUNT,
  LAND_TERRAIN_ID,
  Renderer,
  SOURCE_TILE_PIXELS,
  TERRAIN_BASE_COLORS,
  TEXTURE_SLOT_NAMES,
} from "./renderer";

const STORAGE_KEY = "baiyue-rpg:terrain-sheet:v2";
const MAX_STORED_DATA_URL_LENGTH = 1_500_000;
const MAX_IMAGE_DIMENSION = 4096;

export interface TextureToolElements {
  toggleButton: HTMLButtonElement;
  panel: HTMLElement;
  closeButton: HTMLButtonElement;
  fileInput: HTMLInputElement;
  resetButton: HTMLButtonElement;
  status: HTMLElement;
  preview: HTMLElement;
}

export class TextureTool {
  private readonly previewCanvases: HTMLCanvasElement[] = [];

  constructor(
    private readonly renderer: Renderer,
    private readonly elements: TextureToolElements,
  ) {
    this.buildPreviewSlots();
    this.renderPreviews();

    elements.toggleButton.addEventListener("click", () => this.setOpen(Boolean(elements.panel.hidden)));
    elements.closeButton.addEventListener("click", () => this.setOpen(false));
    elements.fileInput.addEventListener("change", () => {
      const file = elements.fileInput.files?.[0];
      if (file) void this.applyFile(file);
    });
    elements.resetButton.addEventListener("click", () => this.reset());
    window.addEventListener("keydown", (event) => {
      if (event.code === "Escape" && !this.elements.panel.hidden) this.setOpen(false);
    });
  }

  async restoreStoredSheet(): Promise<void> {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    try {
      await this.applyDataUrl(stored, "已恢复浏览器内保存的纹理", false);
    } catch (error: unknown) {
      localStorage.removeItem(STORAGE_KEY);
      this.setStatus(`保存的纹理无法读取：${this.errorMessage(error)}`, true);
    }
  }

  private setOpen(open: boolean): void {
    this.elements.panel.hidden = !open;
    this.elements.toggleButton.setAttribute("aria-expanded", String(open));
  }

  private async applyFile(file: File): Promise<void> {
    this.setStatus(`读取 ${file.name}…`);
    try {
      const dataUrl = await this.readFileAsDataUrl(file);
      await this.applyDataUrl(dataUrl, file.name, true);
    } catch (error: unknown) {
      this.setStatus(`纹理读取失败：${this.errorMessage(error)}`, true);
    } finally {
      this.elements.fileInput.value = "";
    }
  }

  private async applyDataUrl(dataUrl: string, label: string, persist: boolean): Promise<void> {
    const image = await this.loadImage(dataUrl);
    if (image.naturalWidth > MAX_IMAGE_DIMENSION || image.naturalHeight > MAX_IMAGE_DIMENSION) {
      throw new Error(`图像最大支持 ${MAX_IMAGE_DIMENSION}×${MAX_IMAGE_DIMENSION}px`);
    }

    const columns = Math.floor(image.naturalWidth / SOURCE_TILE_PIXELS);
    const rows = Math.floor(image.naturalHeight / SOURCE_TILE_PIXELS);
    if (columns < 1 || rows < 1) {
      throw new Error(`图像必须至少为 ${SOURCE_TILE_PIXELS}×${SOURCE_TILE_PIXELS}px`);
    }

    const masks = this.extractMasks(image, columns, rows);
    const visibleCount = masks.reduce((count, mask) => count + (this.isMaskVisible(mask) ? 1 : 0), 0);
    this.renderer.setTerrainMasks(masks);
    this.renderPreviews();

    let persistenceNote = "";
    if (persist) {
      try {
        if (dataUrl.length <= MAX_STORED_DATA_URL_LENGTH) {
          localStorage.setItem(STORAGE_KEY, dataUrl);
          persistenceNote = " · 已保存在当前浏览器";
        } else {
          localStorage.removeItem(STORAGE_KEY);
          persistenceNote = " · 文件较大，本次仅临时应用";
        }
      } catch {
        persistenceNote = " · 已应用，但浏览器拒绝持久化";
      }
    }

    this.setStatus(
      `${label} · ${image.naturalWidth}×${image.naturalHeight}px · 固定顺序读取 8 格，${visibleCount} 格非空${persistenceNote}`,
    );
  }

  private extractMasks(image: HTMLImageElement, columns: number, rows: number): HTMLCanvasElement[] {
    const availableCount = columns * rows;
    const masks: HTMLCanvasElement[] = [];

    for (let index = 0; index < TEXTURE_SLOT_NAMES.length; index += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = SOURCE_TILE_PIXELS;
      canvas.height = SOURCE_TILE_PIXELS;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("2D canvas context is unavailable.");
      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, SOURCE_TILE_PIXELS, SOURCE_TILE_PIXELS);

      if (index < availableCount) {
        const sourceX = (index % columns) * SOURCE_TILE_PIXELS;
        const sourceY = Math.floor(index / columns) * SOURCE_TILE_PIXELS;
        context.drawImage(
          image,
          sourceX,
          sourceY,
          SOURCE_TILE_PIXELS,
          SOURCE_TILE_PIXELS,
          0,
          0,
          SOURCE_TILE_PIXELS,
          SOURCE_TILE_PIXELS,
        );
        this.normalizeMask(context);
      }
      masks.push(canvas);
    }

    return masks;
  }

  private normalizeMask(context: CanvasRenderingContext2D): void {
    const image = context.getImageData(0, 0, SOURCE_TILE_PIXELS, SOURCE_TILE_PIXELS);
    let hasTransparency = false;
    for (let offset = 3; offset < image.data.length; offset += 4) {
      if ((image.data[offset] ?? 255) < 250) {
        hasTransparency = true;
        break;
      }
    }

    for (let offset = 0; offset < image.data.length; offset += 4) {
      const red = image.data[offset] ?? 0;
      const green = image.data[offset + 1] ?? 0;
      const blue = image.data[offset + 2] ?? 0;
      const alpha = image.data[offset + 3] ?? 0;
      const maskAlpha = hasTransparency ? alpha : Math.max(red, green, blue);
      image.data[offset] = 255;
      image.data[offset + 1] = 255;
      image.data[offset + 2] = 255;
      image.data[offset + 3] = maskAlpha;
    }
    context.putImageData(image, 0, 0);
  }

  private isMaskVisible(mask: HTMLCanvasElement): boolean {
    const context = mask.getContext("2d", { willReadFrequently: true });
    if (!context) return false;
    const data = context.getImageData(0, 0, mask.width, mask.height).data;
    for (let offset = 3; offset < data.length; offset += 4) {
      if ((data[offset] ?? 0) > 0) return true;
    }
    return false;
  }

  private buildPreviewSlots(): void {
    this.elements.preview.replaceChildren();
    for (let index = 0; index < TEXTURE_SLOT_NAMES.length; index += 1) {
      const item = document.createElement("div");
      item.className = "texture-preview-item";

      const canvas = document.createElement("canvas");
      canvas.width = SOURCE_TILE_PIXELS;
      canvas.height = SOURCE_TILE_PIXELS;
      canvas.className = "texture-preview-canvas";
      canvas.setAttribute("aria-label", `${TEXTURE_SLOT_NAMES[index]}纹理预览`);
      this.previewCanvases.push(canvas);

      const label = document.createElement("span");
      const layer = index < BASE_TERRAIN_COUNT ? "基础" : "修饰";
      label.textContent = `${layer} ${index} ${TEXTURE_SLOT_NAMES[index]}`;
      item.append(canvas, label);
      this.elements.preview.append(item);
    }
  }

  private renderPreviews(): void {
    const sprites = this.renderer.getTerrainSprites();
    for (let index = 0; index < this.previewCanvases.length; index += 1) {
      const canvas = this.previewCanvases[index];
      if (!canvas) continue;
      const context = canvas.getContext("2d");
      if (!context) continue;
      const baseIndex = index < BASE_TERRAIN_COUNT ? index : LAND_TERRAIN_ID;
      const baseColor = TERRAIN_BASE_COLORS[baseIndex] ?? [24, 24, 24];
      context.imageSmoothingEnabled = false;
      context.fillStyle = `rgb(${baseColor[0]} ${baseColor[1]} ${baseColor[2]})`;
      context.fillRect(0, 0, canvas.width, canvas.height);
      const sprite = sprites[index];
      if (sprite) context.drawImage(sprite, 0, 0);
    }
  }

  private reset(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.renderer.resetTerrainTextures();
    this.renderPreviews();
    this.setStatus("已恢复项目默认纹理：深水、草地、树林槽位有默认图案，其余槽位为空");
  }

  private setStatus(message: string, isError = false): void {
    this.elements.status.textContent = message;
    this.elements.status.dataset.state = isError ? "error" : "ok";
  }

  private loadImage(source: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("浏览器无法解码该图像格式"));
      image.src = source;
    });
  }

  private readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") resolve(reader.result);
        else reject(new Error("文件读取结果无效"));
      };
      reader.onerror = () => reject(reader.error ?? new Error("文件读取失败"));
      reader.readAsDataURL(file);
    });
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
