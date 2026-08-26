/**
 * Boundary parser for the optional context option. An absent option means an
 * empty context of the declared shape. This is the single place where that
 * default is normalized into the caller's context type.
 */
export function parseContextOption<ActorContext>(context: ActorContext | undefined): ActorContext {
  return context ?? ({} as ActorContext);
}
