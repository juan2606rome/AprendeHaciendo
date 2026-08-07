/**
 * markdown.js
 * Parseo muy simple de "front matter" (estilo YAML pero solo clave: valor,
 * sin anidamiento) + render del cuerpo markdown con marked.js.
 *
 * Formato esperado de cada archivo .md de tarea:
 *
 * ---
 * titulo: Hola, mundo
 * palabra_clave: fundamentos, consola
 * archivo: 001-hola-mundo.js
 * ---
 *
 * ## Descripción
 * ...
 *
 * ## Teoría
 * ...
 */
const MD = (() => {

  function parse(raw) {
    const meta = {};
    let body = raw;

    const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
    if (match) {
      const front = match[1];
      body = match[2];
      front.split('\n').forEach(line => {
        const idx = line.indexOf(':');
        if (idx === -1) return;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (key) meta[key] = value;
      });
    }

    // separa el cuerpo en secciones por encabezado ## nombre
    const sections = {};
    const parts = body.split(/\n(?=##\s)/);
    parts.forEach(part => {
      const headingMatch = part.match(/^##\s*(.+)\n?/);
      if (headingMatch) {
        const heading = headingMatch[1].trim().toLowerCase();
        const content = part.slice(headingMatch[0].length).trim();
        sections[heading] = content;
      }
    });

    return { meta, sections, rawBody: body };
  }

  function renderSection(mdText) {
    if (!mdText) return '';
    if (window.marked) return marked.parse(mdText);
    // fallback muy básico si marked no cargó (ej. sin internet)
    return `<p>${mdText.replace(/\n/g, '<br>')}</p>`;
  }

  function buildFrontMatter(meta) {
    const lines = ['---'];
    Object.entries(meta).forEach(([k, v]) => lines.push(`${k}: ${v}`));
    lines.push('---', '');
    return lines.join('\n');
  }

  function slugify(text) {
    return text
      .toString()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 60) || 'tarea';
  }

  /**
   * parseImportFile — parsea un archivo "lote" con varios ejercicios
   * (el que genera una IA a partir de la plantilla de prompt) para
   * poder crearlos todos de una sola vez.
   *
   * Formato esperado, un bloque por ejercicio, separados por una línea
   * que solo diga "===":
   *
   * titulo: Hola, mundo
   * palabra_clave: fundamentos, consola
   * extension: js
   *
   * ## Descripción
   * ...
   *
   * ## Teoría
   * ...
   *
   * ===
   *
   * titulo: siguiente ejercicio
   * ...
   *
   * Es tolerante con espacios extra, con bloques que no traigan
   * "Teoría", con encabezados sin "##" (pasa seguido al copiar la
   * respuesta ya renderizada de un chat en vez del markdown crudo), y
   * con "===" pegado a la línea siguiente por el reajuste de saltos de
   * línea que hacen algunos editores/chats al copiar texto largo.
   * Ignora bloques sin "titulo".
   */
  function normalizeHeadingLine(line) {
    return line.replace(/^#+\s*/, '').trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/:\s*$/, '');
  }

  const IMPORT_SECTION_HEADINGS = new Set(['descripcion', 'teoria']);
  const IMPORT_KEY_ALTERNATION = '(?:titulo|palabra[ _]clave|extension|ext|archivo)\\s*:';

  function extractHeaderField(flatHeader, key) {
    const re = new RegExp(key + '\\s*:\\s*(.*?)\\s*(?=' + IMPORT_KEY_ALTERNATION + '|$)', 'i');
    const m = flatHeader.match(re);
    return m ? m[1].trim() : '';
  }

  function parseImportFile(raw) {
    if (!raw || !raw.trim()) return [];

    // El separador "===" a veces no queda solo en su propia línea (p. ej.
    // "=== titulo: ..." pegado en una sola línea). Sin importar cómo haya
    // quedado el espacio/salto alrededor, lo normalizamos siempre a una
    // línea propia antes de partir en bloques.
    const normalized = raw.replace(/[ \t\n]*={3,}[ \t\n]*/g, '\n===\n');

    const blocks = normalized
      .split(/\n===\n/)
      .map(b => b.trim())
      .filter(Boolean);

    const items = [];
    for (const block of blocks) {
      const lines = block.split('\n');

      // ubica las líneas de encabezado de sección (Descripción / Teoría),
      // con o sin "##" delante — así toleramos texto pegado desde una
      // vista ya renderizada, donde el "##" se pierde.
      const headings = [];
      lines.forEach((line, i) => {
        const norm = normalizeHeadingLine(line);
        if (IMPORT_SECTION_HEADINGS.has(norm)) headings.push({ i, name: norm });
      });

      const headerLines = lines.slice(0, headings.length ? headings[0].i : lines.length);
      // el bloque "cabecera" se aplana a una sola línea: así da igual si
      // "titulo:", "palabra_clave:" y "extension:" quedaron cada uno en su
      // propia línea o todos revueltos en el mismo párrafo por un reajuste
      // de saltos de línea — cada valor se extrae hasta la siguiente clave
      // conocida, sin importar dónde caigan los saltos de línea reales.
      const flatHeader = headerLines.join(' ').replace(/\s+/g, ' ').trim();

      const sections = {};
      headings.forEach((h, idx) => {
        const end = idx + 1 < headings.length ? headings[idx + 1].i : lines.length;
        sections[h.name] = lines.slice(h.i + 1, end).join('\n').trim();
      });

      const titulo = extractHeaderField(flatHeader, 'titulo');
      if (!titulo) continue; // bloque inválido, se ignora

      const palabra_clave = extractHeaderField(flatHeader, 'palabra[ _]clave');
      let extension = extractHeaderField(flatHeader, 'extension')
        || extractHeaderField(flatHeader, 'ext')
        || extractHeaderField(flatHeader, 'archivo')
        || 'js';
      extension = extension.replace(/^\./, '').split(/[\s,]/)[0].toLowerCase() || 'js';

      items.push({
        titulo,
        palabra_clave,
        extension,
        descripcion: sections['descripcion'] || '',
        teoria: sections['teoria'] || '',
      });
    }
    return items;
  }

  return { parse, renderSection, buildFrontMatter, slugify, parseImportFile };
})();
