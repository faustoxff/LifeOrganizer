/**
 * Cuándo mover una tarea a otra fecha cuenta como "postergarla".
 *
 * Una sola regla, para que la edición a mano, Milo y la replanificación cuenten
 * igual: pasar a un día POSTERIOR es postergar; adelantar, o dejarla en el mismo
 * día, no. Las fechas son "YYYY-MM-DD", que ordenan como texto.
 */
export function isPostponement(fromDate: string, toDate: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(fromDate) && /^\d{4}-\d{2}-\d{2}$/.test(toDate) && toDate > fromDate;
}

/** Cuánto suma `postponed_count` por este movimiento (0 o 1). */
export function postponementIncrement(fromDate: string, toDate: string): 0 | 1 {
  return isPostponement(fromDate, toDate) ? 1 : 0;
}
