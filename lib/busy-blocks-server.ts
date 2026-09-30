import "server-only";
import { collectBusyBlocks, mergeBlocks, type BusyBlock, type PrepSettings } from "@/lib/busy-blocks";
import { loadTasks } from "@/lib/storage";
import { getPrepSettings, resolveUserTimeZone } from "@/lib/user-settings";
import type { Task } from "@/types/task";

/**
 * Una fuente EXTERNA de bloques ocupados (hoy ninguna; mañana, Google Calendar). Devuelve
 * bloques con `source: 'calendar'` y el resto de la app los ve sin cambiar nada: la recomendación,
 * el scheduler y Milo leen `getBusyBlocks`, no las fuentes.
 */
export type BusyBlockSource = {
  name: string;
  load: (userId: string, from: string, to: string, ctx: { timeZone: string; prep: PrepSettings }) => Promise<BusyBlock[]>;
};

/** El registro. Sumar la sincronización con Google es agregar una fuente acá. */
export const busyBlockSources: BusyBlockSource[] = [];

/** Los bloques de las fuentes externas. Una fuente que falla se saltea: nunca rompe la agenda. */
export async function getExternalBusyBlocks(
  userId: string,
  from: string,
  to: string,
  ctx: { timeZone: string; prep: PrepSettings },
  sources: readonly BusyBlockSource[] = busyBlockSources
): Promise<BusyBlock[]> {
  const lists = await Promise.all(
    sources.map((source) =>
      source.load(userId, from, to, ctx).catch((error) => {
        console.warn(`[busy-blocks] source ${source.name} failed`, error);
        return [] as BusyBlock[];
      })
    )
  );
  return mergeBlocks(...lists);
}

export type BusyContext = { blocks: BusyBlock[]; timeZone: string; prep: PrepSettings };

/**
 * Los bloques ocupados del usuario entre dos fechas ("YYYY-MM-DD", inclusive): sus recordatorios
 * con hora y las tareas fijadas a una hora, más lo que aporten las fuentes externas. Todo sale
 * filtrado por el usuario autenticado.
 */
export async function getBusyBlocks(
  userId: string,
  from: string,
  to: string,
  options: { tasks?: readonly Task[]; timeZone?: string; prep?: PrepSettings } = {}
): Promise<BusyContext> {
  const [tasks, prep, timeZone] = await Promise.all([
    options.tasks ?? loadTasks(userId),
    options.prep ?? getPrepSettings(userId),
    options.timeZone ?? resolveUserTimeZone(userId)
  ]);
  const own = collectBusyBlocks(tasks, { timeZone: timeZone || "UTC", from, to, prep });
  const external = await getExternalBusyBlocks(userId, from, to, { timeZone, prep });
  return { blocks: mergeBlocks(own, external), timeZone, prep };
}
