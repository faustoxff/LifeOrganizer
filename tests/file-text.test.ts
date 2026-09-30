import { describe, expect, it } from "vitest";
import {
  detectFileKind,
  extractFileText,
  FileError,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_TEXT_CHARS
} from "@/lib/file-text";
import { bytes, makeDocx, makePdf } from "./helpers/fixtures";

const code = async (promise: Promise<unknown>) => {
  try { await promise; } catch (error) { return (error as FileError).code; }
  return null;
};

describe("detectFileKind", () => {
  it("reconoce por extensión y por MIME", () => {
    expect(detectFileKind("consigna.PDF")).toBe("pdf");
    expect(detectFileKind("x", "application/pdf")).toBe("pdf");
    expect(detectFileKind("tp.docx")).toBe("docx");
    expect(detectFileKind("notas.txt")).toBe("text");
    expect(detectFileKind("leeme.md")).toBe("text");
    expect(detectFileKind("foto.jpg")).toBe("image");
    expect(detectFileKind("x", "image/png")).toBe("image");
    expect(detectFileKind("planilla.xlsx")).toBe("unsupported");
    expect(detectFileKind("tp.doc")).toBe("unsupported");
  });

  it("los límites son los del diseño", () => {
    expect(MAX_FILES).toBe(3);
    expect(MAX_FILE_BYTES).toBe(4 * 1024 * 1024);
  });
});

describe("extractFileText", () => {
  it("lee un TXT y un MD", async () => {
    const txt = await extractFileText({ name: "notas.txt", bytes: bytes("Entregar el informe\n\n\n\nel 15 de octubre") });
    expect(txt).toMatchObject({ kind: "text", text: "Entregar el informe\n\nel 15 de octubre", truncated: false });
    const md = await extractFileText({ name: "leeme.md", bytes: bytes("# Consigna\n- Punto uno\n- Punto dos") });
    expect(md.text).toContain("# Consigna");
  });

  it("lee acentos y caracteres no ASCII", async () => {
    const r = await extractFileText({ name: "a.txt", bytes: bytes("Diseño de la planificación — ñandú") });
    expect(r.text).toBe("Diseño de la planificación — ñandú");
  });

  it("lee un PDF", async () => {
    const r = await extractFileText({ name: "consigna.pdf", bytes: makePdf("Consigna del TP: armar la tabla de actividades") });
    expect(r.kind).toBe("pdf");
    expect(r.text).toContain("Consigna del TP");
    expect(r.text).toContain("tabla de actividades");
  });

  it("lee un DOCX y conserva los párrafos", async () => {
    const r = await extractFileText({ name: "tp.docx", bytes: await makeDocx(["Primera parte: introducción", "Segunda parte: desarrollo & conclusiones"]) });
    expect(r.kind).toBe("docx");
    expect(r.text).toContain("Primera parte: introducción");
    expect(r.text).toContain("desarrollo & conclusiones");
    expect(r.text.split("\n").length).toBeGreaterThanOrEqual(2);
  });

  it("corta el texto larguísimo y lo avisa", async () => {
    const r = await extractFileText({ name: "grande.txt", bytes: bytes("palabra ".repeat(40_000)) });
    expect(r.text.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
    expect(r.truncated).toBe(true);
  });

  it("rechaza lo que pasa el tamaño máximo, sin leerlo", async () => {
    expect(await code(extractFileText({ name: "a.txt", bytes: new Uint8Array(MAX_FILE_BYTES + 1) }))).toBe("TOO_LARGE");
  });

  it("las imágenes quedan afuera con un código propio", async () => {
    expect(await code(extractFileText({ name: "foto.png", bytes: bytes("x") }))).toBe("IMAGES_UNSUPPORTED");
    expect(await code(extractFileText({ name: "x", type: "image/jpeg", bytes: bytes("x") }))).toBe("IMAGES_UNSUPPORTED");
  });

  it("rechaza otros formatos", async () => {
    expect(await code(extractFileText({ name: "planilla.xlsx", bytes: bytes("x") }))).toBe("UNSUPPORTED_TYPE");
    expect(await code(extractFileText({ name: "viejo.doc", bytes: bytes("x") }))).toBe("UNSUPPORTED_TYPE");
  });

  it("un archivo vacío o sin texto es EMPTY", async () => {
    expect(await code(extractFileText({ name: "a.txt", bytes: new Uint8Array(0) }))).toBe("EMPTY");
    expect(await code(extractFileText({ name: "a.txt", bytes: bytes("   \n\n  ") }))).toBe("EMPTY");
    expect(await code(extractFileText({ name: "vacio.pdf", bytes: makePdf("") }))).toBe("EMPTY");
    expect(await code(extractFileText({ name: "vacio.docx", bytes: await makeDocx([""]) }))).toBe("EMPTY");
  });

  it("un archivo con la extensión equivocada es UNREADABLE, no un crash", async () => {
    expect(await code(extractFileText({ name: "falso.pdf", bytes: bytes("esto no es un pdf") }))).toBe("UNREADABLE");
    expect(await code(extractFileText({ name: "falso.docx", bytes: bytes("esto no es un docx") }))).toBe("UNREADABLE");
    expect(await code(extractFileText({ name: "roto.docx", bytes: bytes("PK\u0003\u0004basura") }))).toBe("UNREADABLE");
    expect(await code(extractFileText({ name: "binario.txt", bytes: new Uint8Array([80, 75, 0, 0, 1, 2, 3]) }))).toBe("UNREADABLE");
    const truncatedPdf = makePdf("hola").slice(0, 60);
    expect(await code(extractFileText({ name: "cortado.pdf", bytes: truncatedPdf }))).toBe("UNREADABLE");
  });
});
