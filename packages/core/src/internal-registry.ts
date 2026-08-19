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

const INTERNAL_KEY = Symbol.for("mantaq.core.internal");

const UNREGISTERED: RegistryError = {
  message: "[mantaq] actor is not registered with the internal registry",
};

function withInternal<T>(
  actor: object,
  fn: (internal: ActorInternal) => T,
): Either<RegistryError, T> {
  const internal = (actor as Record<symbol, ActorInternal>)[INTERNAL_KEY];
  return internal === undefined ? Either.left(UNREGISTERED) : [undefined, fn(internal)];
}

export function registerActor(actor: object, internal: ActorInternal): void {
  (actor as Record<symbol, ActorInternal>)[INTERNAL_KEY] = internal;
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
