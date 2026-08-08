import type { InternalEvent } from "./event.ts";
import type { AnyActor } from "./actor-internal.ts";
import { Either } from "@mantaq/utils";

export interface ActorInternal {
  children: Map<string, AnyActor>;
  getOutputHandler(): ((event: InternalEvent) => void) | null;
  setOutputHandler(fn: ((event: InternalEvent) => void) | null): void;
  pushInternal(event: InternalEvent): void;
  drainInternal(): void;
  abortEffects(): void;
}

export interface RegistryError {
  message: string;
}

declare global {
  var __mantaqCoreInternalRegistry: WeakMap<object, ActorInternal> | undefined;
}

const registry: WeakMap<object, ActorInternal> = (globalThis.__mantaqCoreInternalRegistry ??=
  new WeakMap());

const UNREGISTERED: RegistryError = {
  message: "[mantaq] actor is not registered with the internal registry",
};

function withInternal<T>(
  actor: object,
  fn: (internal: ActorInternal) => T,
): Either<RegistryError, T> {
  const internal = registry.get(actor);
  return internal === undefined ? Either.left(UNREGISTERED) : [undefined, fn(internal)];
}

export function registerActor(actor: object, internal: ActorInternal): void {
  registry.set(actor, internal);
}

export function getChildren(actor: object): Either<RegistryError, Map<string, AnyActor>> {
  return withInternal(actor, (internal) => internal.children);
}

export function getOutputHandler(
  actor: object,
): Either<RegistryError, ((event: InternalEvent) => void) | null> {
  return withInternal(actor, (internal) => internal.getOutputHandler());
}

export function setOutputHandler(
  actor: object,
  fn: ((event: InternalEvent) => void) | null,
): Either<RegistryError, void> {
  return withInternal(actor, (internal) => internal.setOutputHandler(fn));
}

export function pushInternal(actor: object, event: InternalEvent): Either<RegistryError, void> {
  return withInternal(actor, (internal) => internal.pushInternal(event));
}

export function drainInternal(actor: object): Either<RegistryError, void> {
  return withInternal(actor, (internal) => internal.drainInternal());
}

export function abortEffects(actor: object): Either<RegistryError, void> {
  return withInternal(actor, (internal) => internal.abortEffects());
}
