import "server-only";

/**
 * Extracción de texto de los archivos que se adjuntan a un proyecto.
 *
 * Los archivos NO se guardan: se leen en memoria, se saca el texto y se descartan.
 * Lo único que persiste es un resumen (ver lib/context-summary.ts).
 */

export const MAX_FILES = 3;
/**
 * Por archivo. No son 10 MB: Vercel rechaza cualquier request de más de 4.5 MB
 * antes de que llegue a la función, así que un límite mayor solo produciría un 413
 * opaco. Se sube de a un archivo por request.
 */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
/** Tope de texto que se conserva de un archivo antes de resumirlo. */
export const MAX_TEXT_CHARS = 200_000;

export type FileKind = "pdf" | "docx" | "text" | "image" | "unsupported";

export type FileErrorCode =
  | "TOO_LARGE"
  | "UNSUPPORTED_TYPE"
  | "IMAGES_UNSUPPORTED"
  | "EMPTY"
  | "UNREADABLE";

export class FileError extends Error {
  readonly code: FileErrorCode;
  constructor(code: FileErrorCode, message: string) {
    super(message);
    this.name = "FileError";
    this.code = code;
  }
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|heic|tiff?)$/i;

/** El tipo por extensión y MIME. La extensión manda: los navegadores reportan MIME vacío a menudo. */
export function detectFileKind(name: string, mime = ""): FileKind {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf") || mime === "application/pdf") return "pdf";
  if (
    lower.endsWith(".docx") ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  if (lower.endsWith(".txt") || lower.endsWith(".md") || lower.endsWith(".markdown")) return "text";
  if (mime === "text/plain" || mime === "text/markdown") return "text";
  if (IMAGE_EXT.test(lower) || mime.startsWith("image/")) return "image";
  return "unsupported";
}

const startsWith = (bytes: Uint8Array, ascii: string) =>
  ascii.split("").every((char, i) => bytes[i] === char.charCodeAt(0));

function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function readPdf(bytes: Uint8Array): Promise<string> {
  if (!startsWith(bytes, "%PDF")) throw new FileError("UNREADABLE", "The file is not a valid PDF.");
  // Imported lazily: the PDF engine is heavy and only this path needs it.
  const { extractText, getDocumentProxy } = await import("unpdf");
  try {
    // pdf.js takes ownership of the buffer, so it gets its own copy.
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  } catch {
    throw new FileError("UNREADABLE", "The PDF could not be read (damaged or password protected).");
  }
}

async function readDocx(bytes: Uint8Array): Promise<string> {
  // A .docx is a zip: "PK".
  if (!startsWith(bytes, "PK")) throw new FileError("UNREADABLE", "The file is not a valid DOCX.");
  const mammoth = (await import("mammoth")).default;
  try {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return value;
  } catch {
    throw new FileError("UNREADABLE", "The DOCX could not be read.");
  }
}

function readPlainText(bytes: Uint8Array): string {
  // A "text" file full of NUL bytes is a binary with the wrong extension.
  const sample = bytes.subarray(0, 4096);
  if (sample.includes(0)) throw new FileError("UNREADABLE", "The file does not look like text.");
  return new TextDecoder("utf-8").decode(bytes);
}

export type ExtractedFile = {
  name: string;
  kind: Exclude<FileKind, "image" | "unsupported">;
  text: string;
  /** El texto pasó de MAX_TEXT_CHARS y se cortó. */
  truncated: boolean;
};

/**
 * Saca el texto de un archivo. Nunca devuelve texto vacío: un PDF escaneado (solo
 * imágenes) sale como EMPTY en vez de mandarle a la IA un contexto en blanco.
 */
export async function extractFileText(file: {
  name: string;
  type?: string;
  bytes: Uint8Array;
}): Promise<ExtractedFile> {
  if (file.bytes.byteLength > MAX_FILE_BYTES) {
    throw new FileError("TOO_LARGE", `The file is larger than ${MAX_FILE_BYTES / (1024 * 1024)} MB.`);
  }
  if (file.bytes.byteLength === 0) throw new FileError("EMPTY", "The file is empty.");

  const kind = detectFileKind(file.name, file.type);
  if (kind === "image") {
    throw new FileError("IMAGES_UNSUPPORTED", "Images cannot be read yet.");
  }
  if (kind === "unsupported") {
    throw new FileError("UNSUPPORTED_TYPE", "Only PDF, DOCX, TXT and MD files are supported.");
  }

  const raw =
    kind === "pdf" ? await readPdf(file.bytes) : kind === "docx" ? await readDocx(file.bytes) : readPlainText(file.bytes);

  const text = normalize(raw);
  if (text.length === 0) {
    throw new FileError("EMPTY", "No text could be extracted (a scanned document?).");
  }

  const truncated = text.length > MAX_TEXT_CHARS;
  return { name: file.name, kind, text: truncated ? text.slice(0, MAX_TEXT_CHARS) : text, truncated };
}
