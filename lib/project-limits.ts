/**
 * Límites de los archivos que se adjuntan a un proyecto. Viven en un módulo sin
 * dependencias del servidor para que el formulario los use igual que la ruta que los
 * hace cumplir.
 */

export const MAX_FILES = 3;

/**
 * Por archivo. No son 10 MB: Vercel rechaza cualquier request de más de 4.5 MB antes de
 * que llegue a la función, así que un límite mayor solo produciría un 413 opaco. Por eso
 * también se sube de a un archivo por request.
 */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

/** Lo que acepta el selector de archivos. Las imágenes no: ningún proveedor las lee todavía. */
export const ACCEPTED_FILE_TYPES = ".pdf,.docx,.txt,.md,.markdown";

const READABLE = /\.(pdf|docx|txt|md|markdown)$/i;

export type FileProblem = "too-big" | "unsupported" | "empty";

/** Qué le pasa a un archivo antes de subirlo, o null si está bien. */
export function checkFile(file: { name: string; size: number }): FileProblem | null {
  if (file.size === 0) return "empty";
  if (file.size > MAX_FILE_BYTES) return "too-big";
  if (!READABLE.test(file.name)) return "unsupported";
  return null;
}
