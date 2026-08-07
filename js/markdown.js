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
   * Es tolerante con espacios extra y con bloques que no traigan
   * "## Teoría". Ignora bloques sin "titulo".
   */
  function parseImportFile(raw) {
    if (!raw || !raw.trim()) return [];

    const blocks = raw
      .split(/\n[ \t]*={3,}[ \t]*\n/)
      .map(b => b.trim())
      .filter(Boolean);

    const items = [];
    for (const block of blocks) {
      // separa "cabecera" (líneas clave: valor) del cuerpo (secciones ##)
      const headerLines = [];
      const bodyLines = [];
      let inHeader = true;
      const lines = block.split('\n');
      for (const line of lines) {
        if (inHeader) {
          if (/^\s*$/.test(line)) { inHeader = false; continue; }
          if (/^##\s/.test(line)) { inHeader = false; bodyLines.push(line); continue; }
          headerLines.push(line);
        } else {
          bodyLines.push(line);
        }
      }

      const meta = {};
      headerLines.forEach(line => {
        const idx = line.indexOf(':');
        if (idx === -1) return;
        const key = line.slice(0, idx).trim().toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // sin tildes
        const value = line.slice(idx + 1).trim();
        if (key) meta[key] = value;
      });

      const body = bodyLines.join('\n');
      const sections = {};
      body.split(/\n(?=##\s)/).forEach(part => {
        const hm = part.match(/^##\s*(.+)\n?/);
        if (!hm) return;
        const heading = hm[1].trim().toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        sections[heading] = part.slice(hm[0].length).trim();
      });

      const titulo = (meta.titulo || '').trim();
      if (!titulo) continue; // bloque inválido, se ignora

      let extension = (meta.extension || meta.ext || meta.archivo || 'js').trim();
      extension = extension.replace(/^\./, '').split(/[\s,]/)[0].toLowerCase() || 'js';

      items.push({
        titulo,
        palabra_clave: meta.palabra_clave || meta['palabra clave'] || '',
        extension,
        descripcion: sections['descripcion'] || '',
        teoria: sections['teoria'] || '',
      });
    }
    return items;
  }

  return { parse, renderSection, buildFrontMatter, slugify, parseImportFile };
})();
