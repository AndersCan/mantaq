export interface Subscribable<T> {
  subscribe(fn: (value: T) => void): () => void;
}

export interface NodeSelectDetail {
  nodeId: string;
}

export interface EdgeSelectDetail {
  edgeId: string;
  label: string;
  guard: string;
  action: string;
}

export interface TimerActionDetail {
  timerId: string;
  action: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface DragState {
  active: boolean;
  sx: number;
  sy: number;
}

export interface TouchState {
  active: boolean;
  startX: number;
  startY: number;
  startPanX: number;
  startPanY: number;
  pinchDist: number;
  pinchZoom: number;
  pinchCenterX: number;
  pinchCenterY: number;
  lastTapTime: number;
  tapCount: number;
  tapTimer: ReturnType<typeof setTimeout> | null;
}

export interface StateRef {
  name: string;
  isFinal: boolean;
}

export interface TransitionHandler {
  (
    event: unknown,
    options: { context: unknown; actor: unknown },
  ):
    | {
        state?: { name?: string };
        emit?: Array<{ id?: string }>;
      }
    | undefined;
}

export interface TransitionMap {
  [stateName: string]: {
    [eventId: string]: TransitionHandler | undefined;
  };
}

export interface ActorOptions {
  states?: StateRef[];
  transitions?: TransitionMap;
}

export function isTouchEvent(e: Event): e is TouchEvent {
  return "touches" in e;
}

export function isMouseEvent(e: Event): e is MouseEvent {
  return "clientX" in e && "button" in e;
}

export function isWheelEvent(e: Event): e is WheelEvent {
  return "deltaY" in e;
}

export function isCustomEvent(e: Event): e is CustomEvent {
  return "detail" in e;
}

export function isKeyboardEvent(e: Event): e is KeyboardEvent {
  return "key" in e && "ctrlKey" in e;
}
