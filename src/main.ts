/**
 * El Juego de Tobby — src/main.ts
 *
 * Eres un motorizado que huye de Tobby, un perro canela con "silla de montar"
 * negra al que le encanta perseguir motos. Esquiva los carros en una carretera
 * de 3 canales. Si te alcanza… ¡te lame!
 *
 * Controles
 *  - Toque / clic en la mitad izquierda o derecha → cambiar de carril.
 *  - Deslizar ← / → → cambiar de carril.
 *  - Deslizar ↑ / ↓ → acelerar / frenar (Tobby siempre va ganando terreno).
 *  - Teclado: flechas o WASD, Espacio / Enter para empezar o reiniciar.
 *
 * Todo se dibuja con primitivas de Canvas sobre una resolución lógica de
 * 320×480 que se escala a la pantalla manteniendo la proporción 2:3.
 */

// ───────────────────────────── Configuración ─────────────────────────────

const BASE_W = 320;
const BASE_H = 480;

const ROAD_LEFT = 40;
const ROAD_RIGHT = 280;
const LANES = 3;
const LANE_W = (ROAD_RIGHT - ROAD_LEFT) / LANES;

const PLAYER_W = 22;
const PLAYER_H = 44;
const PLAYER_START_Y = 318;
const PLAYER_STEP_Y = 52; // desplazamiento vertical por cada deslizamiento ↑/↓
const LANE_LERP = 18;
const Y_LERP = 9;

const TOBBY_Y = 440; // centro de Tobby durante la persecución
const TOBBY_REACH = 37; // distancia del centro de Tobby a la punta de su nariz

const START_SPEED = 210; // px/s
const MAX_SPEED = 520;
const SPEED_PER_POINT = 7;

const SWIPE_THRESHOLD_PX = 22; // en píxeles CSS
const CATCH_ANIM_TIME = 1.1; // s: Tobby corre hasta la moto
const PANEL_FADE_TIME = 0.45; // s: aparición del panel de Game Over
const RESTART_DELAY = 1.5; // s: evita reinicios accidentales
const MAX_DT = 1 / 30;

const HIGH_SCORE_KEY = 'tobby_high_score_v1';
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const C = {
  grass: '#3f8f43',
  grassDark: '#357c39',
  road: '#4a4d53',
  curbRed: '#d83b3b',
  curbWhite: '#f4f4f4',
  laneLine: '#f2f2f2',
  tan: '#d4a066',
  tanLight: '#e9c590',
  tanDark: '#a8743d',
  black: '#1c1a19',
  nose: '#0d0c0c',
  tongue: '#ee7389',
  mouth: '#4a1520',
  teeth: '#ffffff',
  eye: '#140f0c',
  gold: '#ffd54a',
  red: '#e53935',
  green: '#2e9d4f',
  white: '#ffffff',
  ink: '#1b1b1f',
  skin: '#f1c7a0',
  jacket: '#1f5fbf',
  jeans: '#2b3d63',
  motoRed: '#d32f2f',
} as const;

const CAR_COLORS: readonly string[] = [
  '#1e88e5', '#43a047', '#8e24aa', '#f4511e', '#00897b', '#5d4037', '#3949ab', '#c0ca33', '#eceff1',
];

// ───────────────────────────── Tipos ─────────────────────────────

const GameState = {
  START: 'START',
  PLAYING: 'PLAYING',
  GAMEOVER: 'GAMEOVER',
} as const;
type GameState = (typeof GameState)[keyof typeof GameState];

type CrashReason = 'car' | 'top' | 'bottom' | 'tobby';
type CarKind = 'sedan' | 'taxi' | 'van' | 'pickup';
type Action = 'left' | 'right' | 'up' | 'down' | 'primary';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Car {
  lane: number;
  offsetY: number;
  w: number;
  h: number;
  kind: CarKind;
  color: string;
}

/** Una "oleada": un par de carros que dejan un canal libre (el gap). */
interface Wave {
  y: number;
  speedFactor: number; // velocidad en pantalla relativa a la carretera (los carros van más lento que la moto)
  height: number;
  cars: Car[];
  passed: boolean;
}

interface Popup {
  x: number;
  y: number;
  life: number;
  text: string;
}

interface Snowflake {
  x: number;
  y: number;
  r: number;
  vy: number;
  sway: number;
}

// ───────────────────────────── Utilidades ─────────────────────────────

const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const randInt = (n: number): number => Math.floor(Math.random() * n);
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const laneCenter = (lane: number): number => ROAD_LEFT + LANE_W * (lane + 0.5);
const mod = (a: number, n: number): number => ((a % n) + n) % n;

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// ───────────────────────────── Primitivas de dibujo ─────────────────────────────

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function fillRoundRect(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, color: string,
): void {
  ctx.fillStyle = color;
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fill();
}

function fillEllipse(
  ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string, rot = 0,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fill();
}

function fillCircle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function fillPolygon(ctx: CanvasRenderingContext2D, pts: readonly number[], color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
  ctx.fill();
}

function strokeLine(
  ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, width: number, color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function fillHeart(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  const s = size / 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.9);
  ctx.bezierCurveTo(x - s * 1.6, y - s * 0.2, x - s * 0.6, y - s * 1.4, x, y - s * 0.5);
  ctx.bezierCurveTo(x + s * 0.6, y - s * 1.4, x + s * 1.6, y - s * 0.2, x, y + s * 0.9);
  ctx.fill();
}

interface TextOptions {
  align?: CanvasTextAlign;
  weight?: string;
  stroke?: string;
  strokeWidth?: number;
  baseline?: CanvasTextBaseline;
}

function drawText(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string,
  opts: TextOptions = {},
): void {
  ctx.font = `${opts.weight ?? 'bold'} ${size}px ${FONT}`;
  ctx.textAlign = opts.align ?? 'center';
  ctx.textBaseline = opts.baseline ?? 'middle';
  if (opts.stroke) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = opts.strokeWidth ?? Math.max(2, size / 6);
    ctx.strokeStyle = opts.stroke;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** Dibuja un texto reduciendo el tamaño si no cabe en maxW. */
function drawFittedText(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, maxW: number, color: string,
  opts: TextOptions = {},
): void {
  ctx.font = `${opts.weight ?? 'bold'} ${size}px ${FONT}`;
  const w = ctx.measureText(text).width;
  const finalSize = w > maxW ? Math.floor((size * maxW) / w) : size;
  drawText(ctx, text, x, y, finalSize, color, opts);
}

// ───────────────────────────── Récord (localStorage) ─────────────────────────────

const HighScoreStore = {
  load(): number {
    try {
      const raw = window.localStorage.getItem(HIGH_SCORE_KEY);
      const n = raw ? parseInt(raw, 10) : 0;
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch {
      return 0;
    }
  },
  save(value: number): void {
    try {
      window.localStorage.setItem(HIGH_SCORE_KEY, String(value));
    } catch {
      /* almacenamiento no disponible (modo privado, etc.) */
    }
  },
};

// ───────────────────────────── Canvas y escalado ─────────────────────────────

function getCanvas(): HTMLCanvasElement {
  const el = document.getElementById('gameCanvas');
  if (!(el instanceof HTMLCanvasElement)) throw new Error('No se encontró <canvas id="gameCanvas">');
  return el;
}

function get2DContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('El navegador no soporta Canvas 2D');
  return context;
}

/** Ajustes de página para que el navegador móvil no haga scroll, zoom ni selección. */
function applyMobilePageStyles(canvas: HTMLCanvasElement): void {
  const html = document.documentElement.style;
  const body = document.body.style;
  html.height = '100%';
  html.overflow = 'hidden';
  html.overscrollBehavior = 'none';
  body.height = '100%';
  body.minHeight = '100%';
  body.margin = '0';
  body.overflow = 'hidden';
  body.overscrollBehavior = 'none';
  body.touchAction = 'none';
  body.userSelect = 'none';
  body.setProperty('-webkit-user-select', 'none');
  body.setProperty('-webkit-touch-callout', 'none');
  body.setProperty('-webkit-tap-highlight-color', 'transparent');
  canvas.style.touchAction = 'none';
  canvas.style.display = 'block';
}

class Viewport {
  private readonly point = { x: 0, y: 0 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ctx: CanvasRenderingContext2D,
  ) {}

  /** Escala el canvas a la pantalla conservando 2:3 y usando devicePixelRatio para nitidez. */
  resize = (): void => {
    const vv = window.visualViewport;
    const vw = vv ? vv.width : window.innerWidth;
    const vh = vv ? vv.height : window.innerHeight;
    const scale = Math.max(0.1, Math.min(vw / BASE_W, vh / BASE_H));
    const dpr = Math.min(window.devicePixelRatio || 1, 2); // limitado a 2 por rendimiento
    const cssW = Math.floor(BASE_W * scale);
    const cssH = Math.floor(BASE_H * scale);

    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    // A partir de aquí todo se dibuja en coordenadas lógicas 320×480.
    this.ctx.setTransform(this.canvas.width / BASE_W, 0, 0, this.canvas.height / BASE_H, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
  };

  /** Convierte coordenadas de pantalla a coordenadas lógicas del juego. */
  toLogical(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    this.point.x = ((clientX - r.left) / r.width) * BASE_W;
    this.point.y = ((clientY - r.top) / r.height) * BASE_H;
    return this.point;
  }
}

// ───────────────────────────── Entrada (táctil, mouse, teclado) ─────────────────────────────

interface InputHandlers {
  /** Se llama al tocar. Devuelve true si el toque ya se consumió (p. ej. empezar/reiniciar). */
  onPress(): boolean;
  onAction(action: Action): void;
}

interface Gesture {
  startX: number;
  startY: number;
  logicalX: number;
  resolved: boolean;
}

class InputController {
  private readonly gestures = new Map<number, Gesture>();

  constructor(
    private readonly viewport: Viewport,
    private readonly handlers: InputHandlers,
  ) {
    // Pointer Events cubren táctil, mouse y lápiz con el mismo código.
    window.addEventListener('pointerdown', this.onPointerDown, { passive: false });
    window.addEventListener('pointermove', this.onPointerMove, { passive: false });
    window.addEventListener('pointerup', this.onPointerUp, { passive: false });
    window.addEventListener('pointercancel', this.onPointerCancel);
    window.addEventListener('keydown', this.onKeyDown);

    // Bloquear scroll, zoom por gesto y menú contextual (pulsación larga).
    const prevent = (e: Event): void => {
      if (e.cancelable) e.preventDefault();
    };
    document.addEventListener('touchmove', prevent, { passive: false });
    document.addEventListener('gesturestart', prevent, { passive: false });
    document.addEventListener('dblclick', prevent, { passive: false });
    document.addEventListener('contextmenu', prevent);
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.cancelable) e.preventDefault();
    const consumed = this.handlers.onPress();
    const p = this.viewport.toLogical(e.clientX, e.clientY);
    this.gestures.set(e.pointerId, {
      startX: e.clientX,
      startY: e.clientY,
      logicalX: p.x,
      resolved: consumed,
    });
  };

  private onPointerMove = (e: PointerEvent): void => {
    const g = this.gestures.get(e.pointerId);
    if (!g || g.resolved) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD_PX) return;
    g.resolved = true; // un deslizamiento = una acción
    if (Math.abs(dx) > Math.abs(dy)) this.handlers.onAction(dx < 0 ? 'left' : 'right');
    else this.handlers.onAction(dy < 0 ? 'up' : 'down');
  };

  private onPointerUp = (e: PointerEvent): void => {
    const g = this.gestures.get(e.pointerId);
    this.gestures.delete(e.pointerId);
    if (!g || g.resolved) return;
    // Toque simple: mitad izquierda / derecha de la pantalla.
    this.handlers.onAction(g.logicalX < BASE_W / 2 ? 'left' : 'right');
  };

  private onPointerCancel = (e: PointerEvent): void => {
    this.gestures.delete(e.pointerId);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    let action: Action | null = null;
    switch (e.key) {
      case 'ArrowLeft': case 'a': case 'A': action = 'left'; break;
      case 'ArrowRight': case 'd': case 'D': action = 'right'; break;
      case 'ArrowUp': case 'w': case 'W': action = 'up'; break;
      case 'ArrowDown': case 's': case 'S': action = 'down'; break;
      case ' ': case 'Enter': action = 'primary'; break;
      default: return;
    }
    e.preventDefault();
    if (e.repeat) return;
    if (this.handlers.onPress()) return;
    if (action !== 'primary') this.handlers.onAction(action);
  };
}

// ───────────────────────────── Entidades ─────────────────────────────

class Player {
  lane = 1;
  x = laneCenter(1);
  y = PLAYER_START_Y;
  targetY = PLAYER_START_Y;
  tilt = 0;
  private readonly box: Rect = { x: 0, y: 0, w: PLAYER_W - 6, h: PLAYER_H - 6 };

  reset(): void {
    this.lane = 1;
    this.x = laneCenter(1);
    this.y = PLAYER_START_Y;
    this.targetY = PLAYER_START_Y;
    this.tilt = 0;
  }

  changeLane(dir: -1 | 1): void {
    this.lane = clamp(this.lane + dir, 0, LANES - 1);
  }

  accelerate(): void {
    this.targetY -= PLAYER_STEP_Y;
  }

  brake(): void {
    this.targetY += PLAYER_STEP_Y;
  }

  /** drift: Tobby gana terreno poco a poco (la moto retrocede hacia él). */
  update(dt: number, drift: number): void {
    this.targetY += drift * dt;
    const tx = laneCenter(this.lane);
    const dx = tx - this.x;
    this.x += dx * Math.min(1, dt * LANE_LERP);
    this.tilt = clamp(dx / LANE_W, -1, 1) * 0.35;
    this.y += (this.targetY - this.y) * Math.min(1, dt * Y_LERP);
  }

  get bottom(): number {
    return this.y + PLAYER_H / 2;
  }

  /** Caja de colisión (algo más pequeña que el dibujo, para ser justos). */
  hitbox(): Rect {
    this.box.x = this.x - this.box.w / 2;
    this.box.y = this.y - this.box.h / 2;
    return this.box;
  }
}

class Tobby {
  x = laneCenter(1);
  y = TOBBY_Y;
  phase = 0;
  barkTimer = 2.5;
  barkVisible = 0;
  private fromX = 0;
  private fromY = 0;
  private toX = 0;
  private toY = 0;

  reset(): void {
    this.x = laneCenter(1);
    this.y = TOBBY_Y;
    this.phase = 0;
    this.barkTimer = 2.5;
    this.barkVisible = 0;
  }

  get noseY(): number {
    return this.y - TOBBY_REACH;
  }

  updateChase(dt: number, targetX: number, speed: number): void {
    this.x += (targetX - this.x) * Math.min(1, dt * 3.2);
    this.phase += dt * (10 + speed * 0.02);
    this.barkTimer -= dt;
    this.barkVisible = Math.max(0, this.barkVisible - dt);
    if (this.barkTimer <= 0) {
      this.barkVisible = 0.8;
      this.barkTimer = rand(2.5, 5);
    }
  }

  startCatch(px: number, py: number): void {
    this.fromX = this.x;
    this.fromY = this.y;
    this.toX = px;
    this.toY = py + PLAYER_H / 2 + 14;
    this.barkVisible = 0;
  }

  updateCatch(dt: number, elapsed: number): void {
    const k = easeOutCubic(clamp(elapsed / (CATCH_ANIM_TIME * 0.75), 0, 1));
    this.x = lerp(this.fromX, this.toX, k);
    this.y = lerp(this.fromY, this.toY, k);
    this.phase += dt * (k < 1 ? 16 : 4);
  }
}

function createCar(lane: number): Car {
  const r = Math.random();
  const color = CAR_COLORS[randInt(CAR_COLORS.length)];
  if (r < 0.18) return { lane, offsetY: 0, w: 40, h: 66, kind: 'taxi', color: '#fbc02d' };
  if (r < 0.38) return { lane, offsetY: 0, w: 44, h: 80, kind: 'van', color };
  if (r < 0.58) return { lane, offsetY: 0, w: 42, h: 74, kind: 'pickup', color };
  return { lane, offsetY: 0, w: 40, h: 66, kind: 'sedan', color };
}

class Traffic {
  readonly waves: Wave[] = [];
  private readonly carBox: Rect = { x: 0, y: 0, w: 0, h: 0 };

  reset(): void {
    this.waves.length = 0;
  }

  /** Crea un par de carros en 2 canales; el tercero (aleatorio) queda libre. */
  private spawn(): void {
    const freeLane = randInt(LANES);
    const cars: Car[] = [];
    let height = 0;
    for (let lane = 0; lane < LANES; lane++) {
      if (lane === freeLane) continue;
      const car = createCar(lane);
      car.offsetY = rand(0, 22);
      height = Math.max(height, car.offsetY + car.h);
      cars.push(car);
    }
    this.waves.push({ y: -height - 6, speedFactor: rand(0.68, 1), height, cars, passed: false });
  }

  update(dt: number, roadSpeed: number, gapTime: number): void {
    const ws = this.waves;

    // Cada oleada avanza a su propia velocidad.
    for (const w of ws) w.y += roadSpeed * w.speedFactor * dt;

    // Una oleada más rápida nunca "alcanza" a la de adelante: siempre queda espacio para pasar.
    const minWindow = PLAYER_H + 24 + roadSpeed * 0.32;
    for (let i = 1; i < ws.length; i++) {
      const ahead = ws[i - 1];
      const behind = ws[i];
      const maxY = ahead.y - minWindow - behind.height;
      if (behind.y > maxY) {
        behind.y = maxY;
        behind.speedFactor = Math.min(behind.speedFactor, ahead.speedFactor);
      }
    }

    // Generación por distancia.
    const newest = ws[ws.length - 1];
    const spacing = PLAYER_H + 24 + roadSpeed * gapTime;
    if (!newest || newest.y >= spacing) this.spawn();

    // Limpiar de memoria las oleadas que salieron por abajo.
    for (let i = ws.length - 1; i >= 0; i--) {
      if (ws[i].y > BASE_H + 10) ws.splice(i, 1);
    }
  }

  /** AABB de un carro (ligeramente reducida). Reutiliza el mismo objeto. */
  carHitbox(wave: Wave, car: Car): Rect {
    const b = this.carBox;
    b.x = laneCenter(car.lane) - car.w / 2 + 3;
    b.y = wave.y + car.offsetY + 4;
    b.w = car.w - 6;
    b.h = car.h - 8;
    return b;
  }
}

// ───────────────────────────── Dibujo: entorno ─────────────────────────────

function drawPine(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, seed: number): void {
  fillEllipse(ctx, x + 2, y + 26, 13, 4, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = '#6d4426';
  ctx.fillRect(x - 3, y + 16, 6, 10);
  fillPolygon(ctx, [x, y - 4, x + 15, y + 18, x - 15, y + 18], '#1f6b35');
  fillPolygon(ctx, [x, y - 14, x + 12, y + 6, x - 12, y + 6], '#25803f');
  fillPolygon(ctx, [x, y - 22, x + 9, y - 6, x - 9, y - 6], '#2c9449');
  fillCircle(ctx, x, y - 23, 3, C.gold);
  const lights = ['#ff5252', '#ffee58', '#40c4ff', '#ff80ab'];
  const blink = Math.floor(time * 3 + seed) % 2;
  for (let i = 0; i < 5; i++) {
    const lx = x + [-6, 5, -2, 8, -9][i];
    const ly = y + [-8, -3, 4, 12, 13][i];
    fillCircle(ctx, lx, ly, 1.7, lights[(i + blink) % lights.length]);
  }
}

function drawRoad(ctx: CanvasRenderingContext2D, offset: number, time: number): void {
  // Grama con franjas que se desplazan.
  ctx.fillStyle = C.grass;
  ctx.fillRect(0, 0, BASE_W, BASE_H);
  ctx.fillStyle = C.grassDark;
  for (let y = mod(offset, 80) - 80; y < BASE_H; y += 80) {
    ctx.fillRect(0, y, ROAD_LEFT, 40);
    ctx.fillRect(ROAD_RIGHT, y, BASE_W - ROAD_RIGHT, 40);
  }

  // Asfalto.
  ctx.fillStyle = C.road;
  ctx.fillRect(ROAD_LEFT, 0, ROAD_RIGHT - ROAD_LEFT, BASE_H);

  // Brocales rojo/blanco.
  for (let y = mod(offset, 48) - 48; y < BASE_H; y += 48) {
    ctx.fillStyle = C.curbRed;
    ctx.fillRect(ROAD_LEFT - 6, y, 6, 24);
    ctx.fillRect(ROAD_RIGHT, y, 6, 24);
    ctx.fillStyle = C.curbWhite;
    ctx.fillRect(ROAD_LEFT - 6, y + 24, 6, 24);
    ctx.fillRect(ROAD_RIGHT, y + 24, 6, 24);
  }

  // Líneas discontinuas entre canales.
  ctx.fillStyle = C.laneLine;
  for (let k = 1; k < LANES; k++) {
    const x = ROAD_LEFT + LANE_W * k - 2;
    for (let y = mod(offset, 52) - 52; y < BASE_H; y += 52) ctx.fillRect(x, y, 4, 28);
  }

  // Pinos navideños a los lados.
  const period = 160;
  const base = mod(offset, period);
  const index = Math.floor(offset / period);
  for (let i = -1; i < 4; i++) {
    const y = base + i * period - 20;
    drawPine(ctx, 19, y, time, index - i);
    drawPine(ctx, BASE_W - 19, y + period / 2, time, index - i + 1);
  }
}

function drawCar(ctx: CanvasRenderingContext2D, car: Car, x: number, y: number): void {
  const { w, h } = car;
  // Sombra
  fillRoundRect(ctx, x + 3, y + 4, w, h, 8, 'rgba(0,0,0,0.28)');
  // Ruedas
  ctx.fillStyle = '#151515';
  ctx.fillRect(x - 2, y + 10, 4, 14);
  ctx.fillRect(x + w - 2, y + 10, 4, 14);
  ctx.fillRect(x - 2, y + h - 22, 4, 14);
  ctx.fillRect(x + w - 2, y + h - 22, 4, 14);
  // Carrocería
  fillRoundRect(ctx, x, y, w, h, 8, car.color);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(x + 4, y + 4, 3, h - 8);

  const glass = '#25313f';
  if (car.kind === 'pickup') {
    // Cabina adelante, platón atrás.
    fillRoundRect(ctx, x + 5, y + 12, w - 10, 9, 3, glass);
    fillRoundRect(ctx, x + 5, y + 22, w - 10, 16, 3, 'rgba(0,0,0,0.12)');
    fillRoundRect(ctx, x + 5, y + 42, w - 10, h - 48, 2, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    for (let i = 0; i < 3; i++) ctx.fillRect(x + 7, y + 47 + i * 8, w - 14, 2);
  } else if (car.kind === 'van') {
    fillRoundRect(ctx, x + 5, y + 10, w - 10, 10, 3, glass);
    fillRoundRect(ctx, x + 6, y + 24, w - 12, h - 34, 3, 'rgba(255,255,255,0.12)');
    fillRoundRect(ctx, x + 7, y + h - 9, w - 14, 5, 2, glass);
  } else {
    fillRoundRect(ctx, x + 5, y + 14, w - 10, 11, 3, glass); // parabrisas
    fillRoundRect(ctx, x + 6, y + 26, w - 12, 20, 3, 'rgba(255,255,255,0.12)'); // techo
    fillRoundRect(ctx, x + 6, y + 47, w - 12, 8, 3, glass); // vidrio trasero
    if (car.kind === 'taxi') {
      fillRoundRect(ctx, x + w / 2 - 8, y + 31, 16, 8, 2, '#212121');
      ctx.fillStyle = C.gold;
      ctx.fillRect(x + w / 2 - 6, y + 33, 12, 4);
    }
  }
  // Faros y luces traseras
  fillRoundRect(ctx, x + 4, y + 1, 8, 4, 2, '#fff7c2');
  fillRoundRect(ctx, x + w - 12, y + 1, 8, 4, 2, '#fff7c2');
  fillRoundRect(ctx, x + 4, y + h - 4, 8, 3, 1, '#ff3d3d');
  fillRoundRect(ctx, x + w - 12, y + h - 4, 8, 3, 1, '#ff3d3d');
}

// ───────────────────────────── Dibujo: motorizado ─────────────────────────────

/** Moto vista desde arriba (mirando hacia arriba). */
function drawMotoTop(ctx: CanvasRenderingContext2D, x: number, y: number, tilt: number, time: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  // Haz del faro
  ctx.fillStyle = 'rgba(255,244,170,0.13)';
  ctx.beginPath();
  ctx.moveTo(-4, -22);
  ctx.lineTo(4, -22);
  ctx.lineTo(16, -70);
  ctx.lineTo(-16, -70);
  ctx.closePath();
  ctx.fill();
  // Sombra
  fillEllipse(ctx, 2, 4, 12, 23, 'rgba(0,0,0,0.28)');
  // Ruedas
  fillRoundRect(ctx, -4, 9, 8, 15, 3, '#111');
  fillRoundRect(ctx, -4, -24, 8, 13, 3, '#111');
  // Chasis
  fillRoundRect(ctx, -6, -15, 12, 31, 5, C.motoRed);
  ctx.fillStyle = '#ff6b6b';
  ctx.fillRect(-3, 17, 6, 3); // luz trasera
  // Manubrio
  ctx.fillStyle = '#222';
  ctx.fillRect(-12, -14, 24, 3);
  fillCircle(ctx, -12, -12.5, 2, '#444');
  fillCircle(ctx, 12, -12.5, 2, '#444');
  fillEllipse(ctx, 0, -22, 3, 2, '#fff59d'); // faro
  // Piloto: espalda, brazos y casco
  fillEllipse(ctx, 0, 5, 9.5, 10, C.jacket);
  strokeLine(ctx, -7, 1, -11, -11, 4, C.jacket);
  strokeLine(ctx, 7, 1, 11, -11, 4, C.jacket);
  fillCircle(ctx, 0, -3, 7.5, '#fafafa');
  ctx.fillStyle = C.red;
  ctx.fillRect(-1.5, -10.5, 3, 15);
  fillEllipse(ctx, 0, -8, 5, 2.4, '#263238');
  // Escape humeante
  const puff = (time * 6) % 1;
  ctx.globalAlpha = 0.35 * (1 - puff);
  fillCircle(ctx, 5, 26 + puff * 14, 2 + puff * 4, '#cfd8dc');
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** Motorizado de perfil, sentado en su moto mirando a la izquierda (pantalla final). */
function drawRiderSide(ctx: CanvasRenderingContext2D, mx: number, gy: number, lean: number): void {
  // Ruedas
  const wheel = (cx: number): void => {
    fillCircle(ctx, cx, gy - 14, 14, '#161616');
    fillCircle(ctx, cx, gy - 14, 7, '#9e9e9e');
    fillCircle(ctx, cx, gy - 14, 3, '#424242');
  };
  wheel(mx - 32);
  wheel(mx + 32);
  // Horquilla y escape
  strokeLine(ctx, mx - 32, gy - 14, mx - 22, gy - 52, 4, '#9e9e9e');
  strokeLine(ctx, mx + 4, gy - 22, mx + 46, gy - 26, 5, '#bdbdbd');
  // Motor
  fillRoundRect(ctx, mx - 12, gy - 34, 26, 16, 4, '#5f6368');
  // Guardafango trasero y colín
  ctx.fillStyle = C.motoRed;
  ctx.beginPath();
  ctx.moveTo(mx + 14, gy - 40);
  ctx.lineTo(mx + 50, gy - 38);
  ctx.lineTo(mx + 46, gy - 30);
  ctx.lineTo(mx + 14, gy - 30);
  ctx.closePath();
  ctx.fill();
  // Tanque
  fillRoundRect(ctx, mx - 22, gy - 48, 30, 16, 7, C.motoRed);
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillRect(mx - 16, gy - 45, 14, 3);
  // Asiento
  fillRoundRect(ctx, mx + 4, gy - 46, 34, 8, 4, '#1d1d1d');
  // Faro y manubrio
  fillCircle(ctx, mx - 30, gy - 50, 5, '#fff59d');
  strokeLine(ctx, mx - 22, gy - 52, mx - 18, gy - 62, 3, '#333');

  // Piloto (se inclina hacia Tobby)
  const hipX = mx + 18;
  const hipY = gy - 48;
  const shX = mx + 6 - lean * 6;
  const shY = gy - 84 + lean * 3;
  // Pierna
  strokeLine(ctx, hipX, hipY, mx - 4, gy - 50, 10, C.jeans);
  strokeLine(ctx, mx - 4, gy - 50, mx - 2, gy - 24, 9, C.jeans);
  fillRoundRect(ctx, mx - 10, gy - 26, 14, 7, 3, '#3e2723');
  // Torso
  strokeLine(ctx, hipX, hipY, shX, shY, 17, C.jacket);
  // Brazo hacia el manubrio
  strokeLine(ctx, shX, shY + 2, mx - 8, gy - 66, 7, C.jacket);
  strokeLine(ctx, mx - 8, gy - 66, mx - 18, gy - 62, 6, C.jacket);
  fillCircle(ctx, mx - 19, gy - 62, 3.5, C.skin);
  // Cabeza con casco abierto
  const hx = shX - 8 - lean * 4;
  const hy = shY - 14 + lean * 2;
  fillCircle(ctx, hx, hy, 13, '#fafafa');
  ctx.fillStyle = C.red;
  ctx.beginPath();
  ctx.arc(hx, hy, 13, Math.PI * 1.1, Math.PI * 1.9);
  ctx.lineTo(hx, hy);
  ctx.closePath();
  ctx.fill();
  fillEllipse(ctx, hx - 5, hy + 3, 8, 9, C.skin);
  // Visera levantada
  fillRoundRect(ctx, hx - 15, hy - 11, 15, 5, 2, '#37474f');
  // Cara feliz: ojo cerrado, sonrisa y rubor
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(hx - 7, hy + 1, 2.5, Math.PI * 1.1, Math.PI * 1.9);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(hx - 8, hy + 6, 3, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();
  fillCircle(ctx, hx - 2, hy + 6, 2.4, 'rgba(240,98,146,0.55)');
}

// ───────────────────────────── Dibujo: Tobby ─────────────────────────────

/** Tobby visto desde arriba, corriendo hacia arriba. */
function drawTobbyTop(ctx: CanvasRenderingContext2D, x: number, y: number, phase: number, tongue: boolean): void {
  const s = Math.sin(phase);
  ctx.save();
  ctx.translate(x, y);
  fillEllipse(ctx, 2, 5, 15, 30, 'rgba(0,0,0,0.25)');
  // Patas (alternadas al correr)
  fillEllipse(ctx, -10, -12 + s * 5, 3.5, 6.5, C.tan);
  fillEllipse(ctx, 10, -12 - s * 5, 3.5, 6.5, C.tan);
  fillEllipse(ctx, -9.5, 15 - s * 5, 4, 7, C.tan);
  fillEllipse(ctx, 9.5, 15 + s * 5, 4, 7, C.tan);
  // Cola moviéndose
  ctx.save();
  ctx.translate(0, 20);
  ctx.rotate(Math.sin(phase * 1.6) * 0.6);
  strokeLine(ctx, 0, 0, 0, 13, 4, C.tan);
  ctx.restore();
  // Cuerpo canela + silla de montar negra
  fillEllipse(ctx, 0, 2, 11, 20, C.tan);
  fillEllipse(ctx, 0, 5, 9.5, 14.5, C.black);
  // Cuello y cabeza
  fillEllipse(ctx, 0, -17, 8, 7, C.tan);
  fillEllipse(ctx, 0, -24, 10, 9, C.tan);
  fillEllipse(ctx, 0, -26, 5, 4, C.tanLight);
  // Orejas: base erguida, punta caída hacia los lados
  fillPolygon(ctx, [-6, -29, -8, -21, -15, -27], C.tan);
  fillPolygon(ctx, [-12.5, -28.5, -15, -27, -17, -22], C.tanDark);
  fillPolygon(ctx, [6, -29, 8, -21, 15, -27], C.tan);
  fillPolygon(ctx, [12.5, -28.5, 15, -27, 17, -22], C.tanDark);
  // Hocico negro (máscara), nariz y ojos
  fillEllipse(ctx, 0, -32, 5.5, 6.5, C.black);
  fillEllipse(ctx, 0, -37.5, 2.8, 2, C.nose);
  fillCircle(ctx, -4.6, -25.5, 1.4, C.eye);
  fillCircle(ctx, 4.6, -25.5, 1.4, C.eye);
  if (tongue) fillEllipse(ctx, 4.5, -30, 2, 4.5, C.tongue, 0.3);
  ctx.restore();
}

/** Tobby de frente (pantalla de inicio). Origen en el centro de la cabeza. */
function drawTobbyPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, time: number): void {
  const pant = Math.sin(time * 9);
  ctx.save();
  ctx.translate(cx, cy + Math.sin(time * 4.5) * 1.5);
  ctx.scale(s, s);

  // Sombra en el piso
  fillEllipse(ctx, 0, 122, 52, 8, 'rgba(0,0,0,0.3)');
  // Lomo/costados negros (silla de montar) detrás del pecho
  fillEllipse(ctx, 0, 66, 42, 30, C.black);
  // Pecho canela
  fillEllipse(ctx, 0, 70, 27, 36, C.tan);
  fillEllipse(ctx, 0, 62, 15, 20, C.tanLight);
  // Patas delanteras
  fillRoundRect(ctx, -24, 82, 15, 38, 7, C.tan);
  fillRoundRect(ctx, 9, 82, 15, 38, 7, C.tan);
  fillEllipse(ctx, -16.5, 119, 10, 5, C.tanLight);
  fillEllipse(ctx, 16.5, 119, 10, 5, C.tanLight);
  // Cuello
  fillEllipse(ctx, 0, 36, 23, 18, C.tan);

  // Orejas triangulares: base erguida, puntas dobladas hacia los lados
  fillPolygon(ctx, [-31, -12, -12, -28, -20, -44, -33, -38], C.tan);
  fillPolygon(ctx, [-20, -44, -33, -38, -45, -26], C.tanDark);
  fillPolygon(ctx, [31, -12, 12, -28, 20, -44, 33, -38], C.tan);
  fillPolygon(ctx, [20, -44, 33, -38, 45, -26], C.tanDark);
  fillPolygon(ctx, [-27, -16, -16, -27, -22, -36], '#b98552');
  fillPolygon(ctx, [27, -16, 16, -27, 22, -36], '#b98552');

  // Cabeza
  fillEllipse(ctx, 0, 0, 32, 30, C.tan);
  fillEllipse(ctx, 0, 12, 30, 21, C.tan);
  fillEllipse(ctx, 0, -14, 14, 10, C.tanLight);

  // Máscara negra alrededor del hocico
  fillEllipse(ctx, 0, 3, 8, 12, C.black);
  fillEllipse(ctx, 0, 18, 18, 16, C.black);

  // Boca entreabierta: lengua, interior y línea de dientes
  const tongueLen = 7 + pant * 2;
  fillEllipse(ctx, 0, 26, 12, 7, C.mouth);
  fillEllipse(ctx, 0, 29 + tongueLen / 2, 7.5, 5 + tongueLen / 2, C.tongue);
  ctx.strokeStyle = '#c95368';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 28);
  ctx.lineTo(0, 30 + tongueLen);
  ctx.stroke();
  ctx.fillStyle = C.teeth;
  ctx.fillRect(-10, 21, 20, 2.5);
  fillPolygon(ctx, [-9, 21, -6.5, 21, -7.8, 25], C.teeth);
  fillPolygon(ctx, [6.5, 21, 9, 21, 7.8, 25], C.teeth);

  // Nariz negra con brillo
  fillRoundRect(ctx, -8, 7, 16, 10, 5, C.nose);
  fillEllipse(ctx, -2.5, 9.5, 3, 1.4, '#4a4a4a');

  // Ojos pequeños y oscuros
  fillCircle(ctx, -13, -5, 3.6, C.eye);
  fillCircle(ctx, 13, -5, 3.6, C.eye);
  fillCircle(ctx, -12, -6.2, 1.1, C.white);
  fillCircle(ctx, 14, -6.2, 1.1, C.white);
  ctx.restore();
}

/**
 * Tobby de perfil, erguido sobre las patas traseras, lamiendo al motorizado.
 * (x, gy) = posición de las patas traseras sobre el piso.
 */
function drawTobbySide(ctx: CanvasRenderingContext2D, x: number, gy: number, s: number, time: number, lick: number): void {
  ctx.save();
  ctx.translate(x, gy);
  ctx.scale(s, s);

  // Sombra
  fillEllipse(ctx, 16, 0, 34, 5, 'rgba(0,0,0,0.25)');

  // Patas traseras (verticales sobre el piso)
  strokeLine(ctx, -2, -30, -6, -3, 8, C.tanDark);
  strokeLine(ctx, 6, -30, 6, -3, 8, C.tan);
  fillEllipse(ctx, -4, -2, 6, 3, C.tanLight);
  fillEllipse(ctx, 9, -2, 6, 3, C.tanLight);

  // Todo el resto gira desde la cadera
  ctx.translate(0, -30);
  ctx.rotate(-0.38);

  // Cola meneándose
  ctx.save();
  ctx.translate(-4, -4);
  ctx.rotate(-0.6 + Math.sin(time * 16) * 0.45);
  ctx.strokeStyle = C.tan;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(-14, -2, -22, -14);
  ctx.stroke();
  ctx.restore();

  // Muslo
  fillEllipse(ctx, 4, 2, 12, 13, C.tan);

  // Cuerpo canela con silla de montar negra (recortada a la silueta)
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(30, 0, 34, 15, 0, 0, Math.PI * 2);
  ctx.fillStyle = C.tan;
  ctx.fill();
  ctx.clip();
  fillEllipse(ctx, 28, -8, 31, 14, C.black);
  ctx.restore();

  // Patas delanteras apoyadas en el motorizado
  strokeLine(ctx, 52, 6, 66, 22, 7, C.tanDark);
  strokeLine(ctx, 57, 4, 74, 15, 7, C.tan);
  fillEllipse(ctx, 75, 16, 5, 3.5, C.tanLight, 0.5);

  // Cuello
  strokeLine(ctx, 54, -4, 70, -18, 16, C.tan);
  fillEllipse(ctx, 60, -2, 9, 8, C.tanLight);

  // Oreja: base erguida, punta caída
  fillPolygon(ctx, [66, -30, 75, -32, 70, -43], C.tan);
  fillPolygon(ctx, [70, -43, 72.5, -37.5, 62, -38], C.tanDark);

  // Cabeza
  fillEllipse(ctx, 75, -22, 13, 11, C.tan);
  fillEllipse(ctx, 72, -28, 6, 4, C.tanLight);

  // Hocico negro (máscara) con boca abierta
  const open = 1 + lick * 3;
  fillRoundRect(ctx, 79, -29, 18, 11, 5, C.black); // mandíbula superior
  ctx.save();
  ctx.translate(81, -16);
  ctx.rotate(0.15 * lick);
  fillRoundRect(ctx, 0, open - 3, 14, 6, 3, C.black); // mandíbula inferior
  ctx.restore();
  fillEllipse(ctx, 88, -16 + open / 2, 6, 1.5 + open / 2, C.mouth);
  ctx.fillStyle = C.teeth;
  ctx.fillRect(81, -18.5, 13, 1.8);
  fillEllipse(ctx, 96.5, -26, 3.6, 3, C.nose);
  fillEllipse(ctx, 96, -27, 1.4, 0.8, '#4a4a4a');

  // Lengua lamiendo
  const tipX = 98 + lick * 9;
  const tipY = -22 - lick * 6;
  ctx.strokeStyle = C.tongue;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(86, -15 + open / 2);
  ctx.quadraticCurveTo(100, -10, tipX, tipY);
  ctx.stroke();

  // Ojo feliz
  fillCircle(ctx, 78, -25, 2.3, C.eye);
  fillCircle(ctx, 78.6, -25.8, 0.7, C.white);
  ctx.restore();
}

function drawBark(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, size: number): void {
  ctx.font = `bold ${size}px ${FONT}`;
  const w = ctx.measureText(text).width + 14;
  const h = size + 10;
  fillRoundRect(ctx, x - w / 2, y - h / 2, w, h, 8, C.white);
  fillPolygon(ctx, [x - 10, y + h / 2 - 1, x - 2, y + h / 2 - 1, x - 14, y + h / 2 + 7], C.white);
  drawText(ctx, text, x, y + 1, size, C.ink);
}

// ───────────────────────────── Dibujo: pantalla final ─────────────────────────────

function drawAdminScene(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, time: number): void {
  const gy = y + h - 12; // piso
  ctx.save();
  roundRectPath(ctx, x, y, w, h, 12);
  ctx.clip();

  // Pared y zócalo
  ctx.fillStyle = '#f1e6cc';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#ddcaa4';
  ctx.fillRect(x, gy - 30, w, 30);
  ctx.fillStyle = '#c9b48b';
  ctx.fillRect(x, gy - 32, w, 3);
  // Piso
  ctx.fillStyle = '#8d7d68';
  ctx.fillRect(x, gy, w, 12);
  ctx.fillStyle = '#7a6b57';
  for (let i = x; i < x + w; i += 24) ctx.fillRect(i, gy, 2, 12);

  // Guirnalda con luces
  ctx.strokeStyle = '#2e7d32';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, y + 6);
  for (let i = 0; i <= 6; i++) {
    const sx = x + (w / 6) * i;
    ctx.quadraticCurveTo(sx - w / 12, y + 20, sx, y + 6);
  }
  ctx.stroke();
  const bulbs = ['#ff5252', '#ffee58', '#40c4ff', '#69f0ae', '#ff80ab'];
  const step = Math.floor(time * 3);
  for (let i = 0; i < 12; i++) {
    const bx = x + (w / 12) * (i + 0.5);
    const by = y + 6 + (i % 2 === 0 ? 7 : 10);
    fillCircle(ctx, bx, by + 3, 3.2, bulbs[(i + step) % bulbs.length]);
  }

  // Puerta de Administración
  const dw = 90;
  const dx = x + w / 2 - dw / 2;
  const dTop = y + 54;
  fillRoundRect(ctx, dx - 7, dTop - 7, dw + 14, gy - dTop + 7, 4, '#5d3a1a');
  ctx.fillStyle = '#8d5a2b';
  ctx.fillRect(dx, dTop, dw, gy - dTop);
  ctx.fillStyle = 'rgba(0,0,0,0.13)';
  ctx.fillRect(dx + 10, dTop + 10, dw - 20, 44);
  ctx.fillRect(dx + 10, dTop + 62, dw - 20, gy - dTop - 72);
  fillCircle(ctx, dx + dw - 12, dTop + 74, 4, C.gold);
  // Corona navideña
  ctx.strokeStyle = '#1b7a35';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(x + w / 2, dTop + 32, 13, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    fillCircle(ctx, x + w / 2 + Math.cos(a) * 13, dTop + 32 + Math.sin(a) * 13, 2, C.red);
  }
  fillPolygon(ctx, [x + w / 2, dTop + 44, x + w / 2 - 8, dTop + 39, x + w / 2 - 8, dTop + 49], C.red);
  fillPolygon(ctx, [x + w / 2, dTop + 44, x + w / 2 + 8, dTop + 39, x + w / 2 + 8, dTop + 49], C.red);

  // Letrero "Administración"
  const sw = 132;
  const sx = x + w / 2 - sw / 2;
  const sy = dTop - 34;
  fillRoundRect(ctx, sx - 2, sy - 2, sw + 4, 24, 5, C.gold);
  fillRoundRect(ctx, sx, sy, sw, 20, 4, '#1d4f8f');
  drawFittedText(ctx, 'ADMINISTRACIÓN', x + w / 2, sy + 10.5, 12, sw - 10, C.white);

  // Tobby lamiendo al motorizado
  const lick = (Math.sin(time * 9) + 1) / 2;
  const mx = x + w - 70;
  drawRiderSide(ctx, mx, gy, lick);
  drawTobbySide(ctx, mx - 115, gy, 1.05, time, lick);

  // Corazones que suben
  for (let i = 0; i < 5; i++) {
    const p = mod(time * 0.55 + i / 5, 1);
    const hx = mx - 30 + Math.sin(p * 6 + i * 2) * 10 + (i - 2) * 6;
    const hy = gy - 105 - p * 55;
    ctx.globalAlpha = 1 - p;
    fillHeart(ctx, hx, hy, 9 + i % 3 * 2, i % 2 === 0 ? '#ff4f7a' : C.red);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  ctx.strokeStyle = C.gold;
  ctx.lineWidth = 2;
  roundRectPath(ctx, x, y, w, h, 12);
  ctx.stroke();
}

// ───────────────────────────── Juego ─────────────────────────────

class Game {
  private state: GameState = GameState.START;
  private score = 0;
  private highScore = HighScoreStore.load();
  private newRecord = false;
  private crashReason: CrashReason = 'car';

  private roadSpeed = START_SPEED;
  private roadOffset = 0;
  private time = 0;
  private stateTime = 0;
  private shake = 0;
  private lastFrame = 0;

  private readonly player = new Player();
  private readonly tobby = new Tobby();
  private readonly traffic = new Traffic();
  private readonly popups: Popup[] = [];
  private readonly snow: Snowflake[] = [];
  private readonly nightSky: CanvasGradient;

  constructor(private readonly ctx: CanvasRenderingContext2D) {
    for (let i = 0; i < 6; i++) this.popups.push({ x: 0, y: 0, life: 0, text: '+1' });
    for (let i = 0; i < 45; i++) {
      this.snow.push({
        x: rand(0, BASE_W), y: rand(0, BASE_H), r: rand(0.8, 2.4), vy: rand(14, 40), sway: rand(0, Math.PI * 2),
      });
    }
    const g = ctx.createLinearGradient(0, 0, 0, BASE_H);
    g.addColorStop(0, '#0d1b3d');
    g.addColorStop(1, '#1d3b6e');
    this.nightSky = g;
  }

  // ── Entrada ──

  /** Toque/clic inicial. Devuelve true si se usó para cambiar de estado. */
  handlePress(): boolean {
    if (this.state === GameState.START) {
      this.startRun();
      return true;
    }
    if (this.state === GameState.GAMEOVER) {
      if (this.stateTime >= RESTART_DELAY) this.startRun();
      return true;
    }
    return false;
  }

  handleAction(action: Action): void {
    if (this.state !== GameState.PLAYING) return;
    switch (action) {
      case 'left': this.player.changeLane(-1); break;
      case 'right': this.player.changeLane(1); break;
      case 'up': this.player.accelerate(); break;
      case 'down': this.player.brake(); break;
      case 'primary': break;
    }
  }

  // ── Estados ──

  private setState(next: GameState): void {
    this.state = next;
    this.stateTime = 0;
  }

  private startRun(): void {
    this.score = 0;
    this.newRecord = false;
    this.roadSpeed = START_SPEED;
    this.shake = 0;
    this.player.reset();
    this.tobby.reset();
    this.traffic.reset();
    for (const p of this.popups) p.life = 0;
    this.setState(GameState.PLAYING);
  }

  private gameOver(reason: CrashReason): void {
    this.crashReason = reason;
    if (reason === 'car' || reason === 'top') this.shake = 0.35;
    if (this.score > this.highScore) {
      this.highScore = this.score;
      this.newRecord = true;
      HighScoreStore.save(this.highScore);
    }
    this.tobby.startCatch(this.player.x, this.player.y);
    this.setState(GameState.GAMEOVER);
  }

  // ── Bucle ──

  start(): void {
    this.lastFrame = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    const dt = Math.min(Math.max((now - this.lastFrame) / 1000, 0), MAX_DT);
    this.lastFrame = now;
    this.update(dt);
    this.render();
    requestAnimationFrame(this.frame);
  };

  private update(dt: number): void {
    this.time += dt;
    this.stateTime += dt;
    this.shake = Math.max(0, this.shake - dt);

    switch (this.state) {
      case GameState.START:
        this.roadOffset += 90 * dt;
        break;
      case GameState.PLAYING:
        this.updatePlaying(dt);
        break;
      case GameState.GAMEOVER:
        this.tobby.updateCatch(dt, this.stateTime);
        if (this.stateTime > CATCH_ANIM_TIME) this.updateSnow(dt);
        break;
    }
  }

  private updatePlaying(dt: number): void {
    // Dificultad progresiva
    this.roadSpeed = Math.min(MAX_SPEED, START_SPEED + this.score * SPEED_PER_POINT);
    const gapTime = Math.max(0.55, 0.9 - this.score * 0.01);
    const drift = Math.min(4 + this.score * 0.25, 12);

    this.roadOffset += this.roadSpeed * dt;
    this.player.update(dt, drift);
    this.tobby.updateChase(dt, this.player.x, this.roadSpeed);
    this.traffic.update(dt, this.roadSpeed, gapTime);

    for (const p of this.popups) {
      if (p.life > 0) {
        p.life -= dt;
        p.y -= 40 * dt;
      }
    }

    // Puntuación: +1 por cada par de carros superado
    for (const wave of this.traffic.waves) {
      if (!wave.passed && wave.y > this.player.bottom) {
        wave.passed = true;
        this.score++;
        this.spawnPopup(this.player.x + 18, this.player.y - 10);
      }
    }

    // Colisiones AABB con los carros
    const pb = this.player.hitbox();
    for (const wave of this.traffic.waves) {
      if (wave.y > pb.y + pb.h || wave.y + wave.height < pb.y) continue; // descarte rápido
      for (const car of wave.cars) {
        if (intersects(pb, this.traffic.carHitbox(wave, car))) {
          this.gameOver('car');
          return;
        }
      }
    }

    // Bordes del canvas y Tobby (que corre pegado al borde inferior)
    if (pb.y <= 0) this.gameOver('top');
    else if (pb.y + pb.h >= BASE_H) this.gameOver('bottom');
    else if (pb.y + pb.h >= this.tobby.noseY) this.gameOver('tobby');
  }

  private spawnPopup(x: number, y: number): void {
    const p = this.popups.find((it) => it.life <= 0) ?? this.popups[0];
    p.x = x;
    p.y = y;
    p.life = 0.7;
  }

  private updateSnow(dt: number): void {
    for (const f of this.snow) {
      f.y += f.vy * dt;
      f.sway += dt * 1.5;
      if (f.y > BASE_H + 4) {
        f.y = -4;
        f.x = rand(0, BASE_W);
      }
    }
  }

  // ── Render ──

  private render(): void {
    const ctx = this.ctx;
    ctx.save();
    if (this.shake > 0) {
      const m = this.shake * 14;
      ctx.translate(rand(-m, m), rand(-m, m));
    }
    switch (this.state) {
      case GameState.START:
        this.renderStart();
        break;
      case GameState.PLAYING:
        this.renderWorld(true);
        this.renderHud();
        break;
      case GameState.GAMEOVER:
        this.renderGameOver();
        break;
    }
    ctx.restore();
  }

  private renderWorld(withBark: boolean): void {
    const ctx = this.ctx;
    drawRoad(ctx, this.roadOffset, this.time);
    for (const wave of this.traffic.waves) {
      for (const car of wave.cars) drawCar(ctx, car, laneCenter(car.lane) - car.w / 2, wave.y + car.offsetY);
    }
    const tongue = Math.sin(this.time * 7) > 0;
    drawTobbyTop(ctx, this.tobby.x, this.tobby.y, this.tobby.phase, tongue);
    drawMotoTop(ctx, this.player.x, this.player.y, this.player.tilt, this.time);
    if (withBark && this.tobby.barkVisible > 0) drawBark(ctx, this.tobby.x + 26, this.tobby.y - 44, '¡Guau!', 12);
  }

  private renderHud(): void {
    const ctx = this.ctx;
    drawText(ctx, String(this.score), BASE_W / 2, 40, 38, C.white, { stroke: C.ink, strokeWidth: 6 });
    drawText(ctx, `Récord ${this.highScore}`, BASE_W - 8, 16, 11, C.white, {
      align: 'right', stroke: C.ink, strokeWidth: 3,
    });

    for (const p of this.popups) {
      if (p.life <= 0) continue;
      ctx.globalAlpha = clamp(p.life / 0.7, 0, 1);
      drawText(ctx, p.text, p.x, p.y, 16, C.gold, { stroke: C.ink, strokeWidth: 4 });
    }
    ctx.globalAlpha = 1;

    // Ayudas en pantalla
    if (this.stateTime < 3.2) {
      ctx.globalAlpha = clamp(3.2 - this.stateTime, 0, 1);
      drawText(ctx, 'Toca ← / → para cambiar de carril', BASE_W / 2, 84, 13, C.white, { stroke: C.ink, strokeWidth: 4 });
      drawText(ctx, 'Desliza ↑ para alejarte de Tobby', BASE_W / 2, 104, 13, C.white, { stroke: C.ink, strokeWidth: 4 });
      ctx.globalAlpha = 1;
    } else if (this.tobby.noseY - this.player.bottom < 38) {
      const pulse = 0.6 + 0.4 * Math.sin(this.time * 12);
      ctx.globalAlpha = pulse;
      drawText(ctx, '¡Desliza ↑ para acelerar!', BASE_W / 2, 84, 16, C.gold, { stroke: C.ink, strokeWidth: 5 });
      ctx.globalAlpha = 1;
    }
  }

  private renderStart(): void {
    const ctx = this.ctx;
    drawRoad(ctx, this.roadOffset, this.time);
    ctx.fillStyle = 'rgba(10,18,40,0.55)';
    ctx.fillRect(0, 0, BASE_W, BASE_H);

    drawText(ctx, 'El Juego de Tobby', BASE_W / 2, 42, 30, C.gold, { stroke: C.ink, strokeWidth: 6 });

    drawTobbyPortrait(ctx, BASE_W / 2, 132, 1.05, this.time);

    // Aviso estilo señal de tránsito
    const sy = 284;
    fillRoundRect(ctx, 22, sy, BASE_W - 44, 54, 10, C.ink);
    fillRoundRect(ctx, 25, sy + 3, BASE_W - 50, 48, 8, '#ffcc33');
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 2;
    roundRectPath(ctx, 30, sy + 8, BASE_W - 60, 38, 6);
    ctx.stroke();
    drawText(ctx, '¡No dejes que Tobby', BASE_W / 2, sy + 18, 17, C.ink);
    drawText(ctx, 'te alcance!', BASE_W / 2, sy + 36, 17, C.ink);

    drawText(ctx, 'Toca ← / → para cambiar de carril', BASE_W / 2, 360, 12, C.white, { weight: '600' });
    drawText(ctx, 'Desliza ↑ ↓ para acelerar o frenar', BASE_W / 2, 378, 12, C.white, { weight: '600' });

    const blink = 0.55 + 0.45 * Math.sin(this.time * 5);
    ctx.globalAlpha = blink;
    drawText(ctx, 'Toca para empezar', BASE_W / 2, 418, 24, C.white, { stroke: C.ink, strokeWidth: 5 });
    ctx.globalAlpha = 1;

    drawText(ctx, `Récord: ${this.highScore}`, BASE_W / 2, 456, 14, C.gold, { stroke: C.ink, strokeWidth: 3 });
  }

  private renderGameOver(): void {
    const ctx = this.ctx;
    const t = this.stateTime;

    // Fase 1: Tobby alcanza la moto en plena carretera
    if (t < CATCH_ANIM_TIME + PANEL_FADE_TIME) {
      this.renderWorld(false);
      drawText(ctx, String(this.score), BASE_W / 2, 40, 38, C.white, { stroke: C.ink, strokeWidth: 6 });
      if (t > 0.35) {
        const k = clamp((t - 0.35) / 0.25, 0, 1);
        ctx.globalAlpha = k;
        drawText(ctx, 'GAME OVER', BASE_W / 2, 190, 40, C.red, { stroke: C.white, strokeWidth: 7 });
        drawBark(ctx, this.tobby.x + 30, this.tobby.y - 50, '¡GUAU!', 15);
        for (let i = 0; i < 3; i++) {
          const p = mod(t * 1.2 + i / 3, 1);
          ctx.globalAlpha = k * (1 - p);
          fillHeart(ctx, this.player.x - 14 + i * 14, this.player.y - 20 - p * 40, 12, '#ff4f7a');
        }
        ctx.globalAlpha = 1;
      }
    }

    // Fase 2: Tobby lame al motorizado frente a la puerta de Administración
    if (t > CATCH_ANIM_TIME) {
      ctx.globalAlpha = clamp((t - CATCH_ANIM_TIME) / PANEL_FADE_TIME, 0, 1);
      this.renderGameOverPanel();
      ctx.globalAlpha = 1;
    }
  }

  private renderGameOverPanel(): void {
    const ctx = this.ctx;
    const alpha = ctx.globalAlpha;
    ctx.fillStyle = this.nightSky;
    ctx.fillRect(0, 0, BASE_W, BASE_H);

    for (const f of this.snow) fillCircle(ctx, f.x + Math.sin(f.sway) * 6, f.y, f.r, 'rgba(255,255,255,0.8)');

    drawText(ctx, 'GAME OVER', BASE_W / 2, 18, 12, '#9fb3d9');
    drawText(ctx, '¡Tobby te alcanzó!', BASE_W / 2, 40, 24, C.gold, { stroke: C.ink, strokeWidth: 5 });

    drawAdminScene(ctx, 12, 58, BASE_W - 24, 196, this.time);
    ctx.globalAlpha = alpha;

    drawFittedText(ctx, '¡Tobby no muerde!', BASE_W / 2, 268, 12, BASE_W - 24, '#cfe0ff', {
      weight: '600',
    });

    // Mensaje navideño (lo más importante)
    drawFittedText(ctx, 'Tobby les desea', BASE_W / 2, 292, 16, BASE_W - 24, C.white);
    drawText(ctx, '', BASE_W / 2, 311, 16, C.white);
    drawText(ctx, '¡Feliz Navidad!', BASE_W / 2, 340, 32, C.red, { stroke: C.white, strokeWidth: 6 });

    // Puntuaciones
    const cardY = 364;
    const cardW = 132;
    const drawCard = (cx: number, label: string, value: number, color: string): void => {
      fillRoundRect(ctx, cx - cardW / 2, cardY, cardW, 52, 10, 'rgba(255,255,255,0.12)');
      drawText(ctx, label, cx, cardY + 14, 11, '#cfe0ff', { weight: '600' });
      drawText(ctx, String(value), cx, cardY + 35, 24, color);
    };
    drawCard(BASE_W / 2 - 72, 'PUNTUACIÓN', this.score, C.white);
    drawCard(BASE_W / 2 + 72, 'RÉCORD', this.highScore, C.gold);
    if (this.newRecord) {
      drawText(ctx, '★ ¡Nuevo récord! ★', BASE_W / 2, 428, 13, C.gold);
    } else if (this.crashReason === 'top') {
      drawText(ctx, 'Te adelantaste demasiado…', BASE_W / 2, 428, 12, '#cfe0ff', { weight: '600' });
    }

    if (this.stateTime >= RESTART_DELAY) {
      ctx.globalAlpha = alpha * (0.55 + 0.45 * Math.sin(this.time * 5));
      drawText(ctx, 'Toca para reiniciar', BASE_W / 2, 456, 22, C.white, { stroke: C.ink, strokeWidth: 5 });
      ctx.globalAlpha = alpha;
    }
  }
}

// ───────────────────────────── Arranque ─────────────────────────────

function bootstrap(): void {
  const canvas = getCanvas();
  const ctx = get2DContext(canvas);
  applyMobilePageStyles(canvas);

  const viewport = new Viewport(canvas, ctx);
  viewport.resize();
  window.addEventListener('resize', viewport.resize);
  window.addEventListener('orientationchange', viewport.resize);
  window.visualViewport?.addEventListener('resize', viewport.resize);

  const game = new Game(ctx);
  new InputController(viewport, {
    onPress: () => game.handlePress(),
    onAction: (action) => game.handleAction(action),
  });
  game.start();
}

bootstrap();
