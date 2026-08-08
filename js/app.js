/**
 * app.js — lógica principal de aprendeHaciendo.
 * No usa ningún framework ni IA: solo DOM + File System Access API.
 */

const state = {
  mode: null,            // 'creator' | 'own'
  dirHandle: null,       // FileSystemDirectoryHandle (solo modo 'own')
  tasks: [],             // lista de tareas normalizadas
  current: null,         // tarea seleccionada
  dirty: false,          // ¿hay cambios sin guardar en el editor?
  pollTimer: null,
  viewMode: 'both',      // 'code' | 'run' | 'both' — solo tiene sentido para .js
};

const el = (id) => document.getElementById(id);

// ---------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------
function toast(msg) {
  const t = el('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

function extFromFilename(name) {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i + 1).toLowerCase();
}

function baseNumero(name) {
  const m = name.match(/^(\d+)/);
  return m ? m[1] : null;
}

// El enunciado de una tarea siempre es "NNN-slug.md". Si el ejercicio en sí
// se resuelve en markdown (extensión "md"), el archivo de respuesta NO puede
// llamarse igual (se pisarían entre sí) — se distingue con ".respuesta.md".
function isDescriptionMd(name) {
  const lower = name.toLowerCase();
  return lower.endsWith('.md') && !lower.endsWith('.respuesta.md');
}
function answerFilename(base, ext) {
  return ext === 'md' ? `${base}.respuesta.md` : `${base}.${ext}`;
}

// ---------------------------------------------------------------
// A qué "tipo" de contenido corresponde cada extensión: cambia qué
// controles tiene sentido mostrar (editor de texto vs. imagen,
// ejecutar vs. vista previa markdown vs. nada).
// ---------------------------------------------------------------
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
function kindForExt(ext) {
  if (ext === 'js') return 'code';
  if (ext === 'md') return 'markdown';
  if (IMAGE_EXTS.has(ext)) return 'image';
  return 'text';
}

function sortTasks() {
  state.tasks.sort((a, b) => parseInt(a.numero, 10) - parseInt(b.numero, 10));
}

// ---------------------------------------------------------------
// Carga: modo "creador" (solo lectura, vía fetch + manifest.json)
// ---------------------------------------------------------------
async function loadCreatorMode() {
  state.mode = 'creator';
  el('mode-tag').textContent = 'Modo lectura · ejercicios del creador';
  el('sidebar-actions').classList.add('hidden');
  el('btn-change-folder').classList.add('hidden');

  const res = await fetch('data/manifest.json');
  if (!res.ok) {
    toast('No se encontró data/manifest.json');
    return;
  }
  const manifest = await res.json();
  const tasks = [];
  for (const t of manifest.tareas) {
    const ext = extFromFilename(t.codigo);
    const isImg = IMAGE_EXTS.has(ext);
    const [mdRaw, codeRaw] = await Promise.all([
      fetch(`data/${t.md}`).then(r => r.text()),
      isImg ? Promise.resolve('') : fetch(`data/${t.codigo}`).then(r => r.text()).catch(() => ''),
    ]);
    const parsed = MD.parse(mdRaw);
    tasks.push({
      numero: t.numero,
      mdName: t.md,
      codeName: t.codigo,
      ext,
      meta: parsed.meta,
      sections: parsed.sections,
      codeText: codeRaw,
      codeBlob: null, // se completa al vuelo la primera vez que se ve una imagen
      readonly: true,
    });
  }
  state.tasks = tasks;
  sortTasks();
  renderSidebar();
}

// ---------------------------------------------------------------
// Carga: modo "propia carpeta" (File System Access API)
// ---------------------------------------------------------------
async function loadOwnMode(dirHandle) {
  state.mode = 'own';
  state.dirHandle = dirHandle;
  el('mode-tag').textContent = 'Tu carpeta · lectura y escritura';
  el('sidebar-actions').classList.remove('hidden');
  el('btn-change-folder').classList.remove('hidden');

  await refreshTaskListFromDisk();
}

async function refreshTaskListFromDisk() {
  const files = await FS.listFiles(state.dirHandle);
  const groups = {};

  files.forEach(({ name, handle }) => {
    const numero = baseNumero(name);
    if (!numero) return; // ignora archivos que no siguen la convención NNN-...
    groups[numero] = groups[numero] || {};
    if (isDescriptionMd(name)) {
      groups[numero].mdName = name;
      groups[numero].mdHandle = handle;
    } else if (name !== 'manifest.json') {
      groups[numero].codeName = name;
      groups[numero].codeHandle = handle;
    }
  });

  const tasks = [];
  for (const numero of Object.keys(groups)) {
    const g = groups[numero];
    if (!g.mdName) continue; // sin markdown no hay tarea válida
    const raw = await FS.readText(g.mdHandle);
    const parsed = MD.parse(raw);
    tasks.push({
      numero,
      mdName: g.mdName,
      mdHandle: g.mdHandle,
      codeName: g.codeName || null,
      codeHandle: g.codeHandle || null,
      ext: g.codeName ? extFromFilename(g.codeName) : '',
      meta: parsed.meta,
      sections: parsed.sections,
      codeText: null, // se carga al seleccionar
      readonly: false,
    });
  }

  state.tasks = tasks;
  sortTasks();
  renderSidebar();

  // si la tarea actual ya no existe, límpiala
  if (state.current && !tasks.find(t => t.numero === state.current.numero)) {
    state.current = null;
    showEmptyState();
  }

  await syncManifest();
}

// ---------------------------------------------------------------
// manifest.json se regenera solo, cada vez que cambia la lista de
// tareas en modo "own". Así, cuando hagas commit + push de tu carpeta
// data/ a GitHub, el modo "Ver ejercicios del creador" (que lee
// manifest.json vía fetch, sin File System Access API) siempre queda
// al día automáticamente — nunca hay que tocarlo a mano.
// ---------------------------------------------------------------
async function syncManifest() {
  if (state.mode !== 'own' || !state.dirHandle) return;
  const tareas = state.tasks
    .filter(t => t.codeName) // una tarea sin archivo de código no tiene sentido en modo lectura
    .map(t => ({ numero: t.numero, md: t.mdName, codigo: t.codeName }));
  const manifest = {
    descripcion: "Manifiesto usado SOLO en el modo 'Ver ejercicios del creador' (lectura vía fetch, sin File System Access API). Se genera y actualiza solo, automáticamente, cada vez que creas o importas tareas en modo 'Probar tú mismo' — no hace falta editarlo a mano. Para que el modo lectura lo vea en la página publicada, recuerda hacer commit + push de este archivo junto con tus tareas.",
    tareas,
  };
  try {
    await FS.writeText(state.dirHandle, 'manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  } catch (e) {
    console.error('No se pudo actualizar manifest.json automáticamente', e);
  }
}

// ---------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------
function renderSidebar() {
  const list = el('task-list');
  list.innerHTML = '';

  if (state.tasks.length === 0) {
    list.innerHTML = `<div class="sidebar-empty">Aún no hay tareas aquí.${state.mode === 'own' ? ' Crea la primera con “+ Nueva tarea”.' : ''}</div>`;
    return;
  }

  state.tasks.forEach(task => {
    const item = document.createElement('div');
    item.className = 'task-item' + (state.current && state.current.numero === task.numero ? ' active' : '');
    item.innerHTML = `<span class="n mono">${task.numero}</span><span class="t">${task.meta.titulo || '(sin título)'}</span>`;
    item.addEventListener('click', () => selectTask(task.numero));
    list.appendChild(item);
  });
}

// ---------------------------------------------------------------
// Selección de tarea + paneles
// ---------------------------------------------------------------
async function selectTask(numero) {
  if (state.dirty) {
    const ok = confirm('Tienes cambios sin guardar en el editor. ¿Cambiar de tarea de todas formas?');
    if (!ok) return;
  }
  stopPolling();
  const task = state.tasks.find(t => t.numero === numero);
  if (!task) return;
  state.current = task;
  renderSidebar();
  renderReadPanel(task);
  await renderCodePanel(task);
  startPolling();
}

function showEmptyState() {
  el('empty-state').classList.remove('hidden');
  el('read-content').classList.add('hidden');
  el('panel-code').classList.add('hidden');
  el('stub-badge').classList.add('hidden');
}

function renderReadPanel(task) {
  el('empty-state').classList.add('hidden');
  const box = el('read-content');
  box.classList.remove('hidden');

  const keywords = (task.meta.palabra_clave || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  const descHtml = MD.renderSection(task.sections['descripción'] || task.sections['descripcion'] || '');
  const teoriaHtml = MD.renderSection(task.sections['teoría'] || task.sections['teoria'] || '');

  el('stub-badge').classList.remove('hidden');
  el('stub-chip-text').textContent = `Nº ${task.numero}`;

  box.innerHTML = `
    <div class="read-eyebrow">Tarea ${task.numero}</div>
    <h2 class="read-title">${task.meta.titulo || '(sin título)'}</h2>
    ${keywords.length ? `<div class="keyword-row">${keywords.map(k => `<span class="keyword-chip">${k}</span>`).join('')}</div>` : ''}
    <div class="read-section">
      <h4>Descripción</h4>
      <div class="content">${descHtml || '<p><em>Sin descripción.</em></p>'}</div>
    </div>
    ${teoriaHtml ? `<div class="read-section"><h4>Teoría</h4><div class="content">${teoriaHtml}</div></div>` : ''}
    ${state.mode === 'own' ? `
    <div class="delete-task-row">
      <button class="btn-danger-ghost" id="btn-delete-task">🗑 Eliminar tarea</button>
    </div>` : ''}
  `;
}

async function renderCodePanel(task) {
  const panel = el('panel-code');
  if (!task.codeName) {
    panel.classList.add('hidden');
    el('resizer-main').classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');
  el('resizer-main').classList.remove('hidden');
  el('code-filename').textContent = task.codeName;
  state.dirty = false;

  el('btn-download-code').classList.toggle('hidden', state.mode !== 'creator');

  const kind = kindForExt(task.ext);
  if (kind === 'image') {
    await renderImagePanel(task);
  } else {
    await renderTextPanel(task, kind);
  }
}

async function renderTextPanel(task, kind) {
  el('code-split').classList.remove('hidden');
  el('pane-image').classList.add('hidden');
  el('btn-pick-image').classList.add('hidden');

  let text = task.codeText;
  if (state.mode === 'own') {
    text = await FS.readText(task.codeHandle);
    task.codeText = text;
  }
  const editor = el('code-editor');
  editor.value = text || '';
  editor.readOnly = state.mode === 'creator';
  editor.classList.remove('hidden');
  el('btn-save-code').classList.remove('hidden');
  el('btn-save-code').disabled = state.mode === 'creator';

  const isJs = kind === 'code';
  const isMd = kind === 'markdown';
  const hasChrome = isJs || isMd; // ¿tiene sentido el toggle de vista aquí?

  el('btn-run').classList.toggle('hidden', !isJs);
  el('view-toggle').classList.toggle('hidden', !hasChrome);
  el('md-toolbar').classList.toggle('hidden', !isMd);

  if (isMd) {
    el('view-btn-code').textContent = 'Editar';
    el('view-btn-run').textContent = 'Vista previa';
  } else {
    el('view-btn-code').textContent = 'Código';
    el('view-btn-run').textContent = 'Ejecución';
  }

  el('run-output').classList.toggle('hidden', !isJs);
  el('md-preview').classList.toggle('hidden', !isMd);
  if (isJs) {
    el('run-output').innerHTML = '<div class="line hint">La salida de console.log() aparecerá aquí al ejecutar.</div>';
  } else if (isMd) {
    updateMdPreview(editor.value);
  }

  setViewMode(hasChrome ? state.viewMode : 'code');
}

// ---------------------------------------------------------------
// Vista previa en vivo para archivos .md (mismo renderizador que el
// panel de la izquierda, para que "Vista previa" se vea igual de bonito).
// ---------------------------------------------------------------
function updateMdPreview(text) {
  const html = MD.renderSection(text || '');
  el('md-preview').innerHTML = html || '<p class="md-preview-empty">Escribe algo a la izquierda para ver la vista previa…</p>';
}

function wrapSelection(before, after, placeholder) {
  const ta = el('code-editor');
  const start = ta.selectionStart, end = ta.selectionEnd;
  const selected = ta.value.slice(start, end) || placeholder;
  ta.value = ta.value.slice(0, start) + before + selected + after + ta.value.slice(end);
  const cursorStart = start + before.length;
  ta.focus();
  ta.setSelectionRange(cursorStart, cursorStart + selected.length);
  ta.dispatchEvent(new Event('input'));
}

function prefixLines(prefix) {
  const ta = el('code-editor');
  const start = ta.selectionStart, end = ta.selectionEnd;
  const value = ta.value;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = value.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = value.length;
  const block = value.slice(lineStart, lineEnd);
  const newBlock = block.length ? block.split('\n').map(l => prefix + l).join('\n') : prefix;
  ta.value = value.slice(0, lineStart) + newBlock + value.slice(lineEnd);
  ta.focus();
  ta.setSelectionRange(lineStart, lineStart + newBlock.length);
  ta.dispatchEvent(new Event('input'));
}

el('md-toolbar').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-md]');
  if (!btn || el('code-editor').readOnly) return;
  switch (btn.dataset.md) {
    case 'bold': wrapSelection('**', '**', 'texto en negrita'); break;
    case 'italic': wrapSelection('*', '*', 'texto en cursiva'); break;
    case 'h2': prefixLines('## '); break;
    case 'ul': prefixLines('- '); break;
    case 'ol': prefixLines('1. '); break;
    case 'quote': prefixLines('> '); break;
    case 'code': wrapSelection('`', '`', 'código'); break;
    case 'link': wrapSelection('[', '](https://)', 'texto del enlace'); break;
  }
});

// ---------------------------------------------------------------
// Panel de imagen (.png/.jpg/.gif/.webp/.svg): sin editor de texto,
// solo una vista previa y (en modo "own") un botón para reemplazar
// el archivo por una foto elegida del computador.
// ---------------------------------------------------------------
async function renderImagePanel(task) {
  el('code-split').classList.add('hidden');
  el('pane-image').classList.remove('hidden');
  el('btn-run').classList.add('hidden');
  el('view-toggle').classList.add('hidden');
  el('md-toolbar').classList.add('hidden');
  el('btn-save-code').classList.add('hidden');

  const img = el('image-preview');
  const placeholder = el('image-placeholder');
  if (img.dataset.blobUrl) URL.revokeObjectURL(img.dataset.blobUrl);
  img.removeAttribute('src');
  img.classList.add('hidden');
  placeholder.classList.remove('hidden');

  let blob = null;
  try {
    if (state.mode === 'own') {
      blob = await task.codeHandle.getFile();
    } else {
      if (!task.codeBlob) {
        const res = await fetch(`data/${task.codeName}`);
        if (res.ok) task.codeBlob = await res.blob();
      }
      blob = task.codeBlob;
    }
  } catch (e) { /* sin archivo todavía o no se pudo leer */ }

  if (blob && blob.size > 0) {
    const url = URL.createObjectURL(blob);
    img.src = url;
    img.dataset.blobUrl = url;
    img.classList.remove('hidden');
    placeholder.classList.add('hidden');
  } else {
    placeholder.textContent = state.mode === 'own'
      ? 'Todavía no hay foto — usa “Seleccionar foto” para subir una.'
      : 'Esta tarea no tiene una imagen todavía.';
  }

  el('btn-pick-image').classList.toggle('hidden', state.mode !== 'own');
}

el('btn-pick-image').addEventListener('click', () => {
  if (state.mode !== 'own' || !state.current) return;
  el('f-image-input').click();
});

el('f-image-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !state.current || state.mode !== 'own') return;
  try {
    await FS.writeBinary(state.dirHandle, state.current.codeName, file);
    toast('Foto reemplazada ✓');
    await renderImagePanel(state.current);
  } catch (err) {
    console.error(err);
    toast('No se pudo guardar la foto.');
  }
});

function setViewMode(mode) {
  state.viewMode = mode;
  const split = el('code-split');
  split.classList.remove('view-code', 'view-both', 'view-run');
  split.classList.add(`view-${mode}`);
  el('view-toggle').querySelectorAll('.view-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === mode);
  });
  el('resizer-code').classList.toggle('hidden', mode !== 'both');
  if (mode === 'run' && state.current && kindForExt(state.current.ext) === 'code') {
    runJs(el('code-editor').value);
  }
}

el('view-toggle').addEventListener('click', (e) => {
  const btn = e.target.closest('.view-btn');
  if (!btn || btn.disabled) return;
  setViewMode(btn.dataset.view);
});

el('code-editor').addEventListener('input', () => {
  state.dirty = true;
  el('btn-save-code').disabled = state.mode !== 'own';
  if (state.current && kindForExt(state.current.ext) === 'markdown') {
    updateMdPreview(el('code-editor').value);
  }
});

// ---------------------------------------------------------------
// Polling: detecta cambios hechos externamente (ej. guardados desde VS Code)
// ---------------------------------------------------------------
function startPolling() {
  if (state.mode !== 'own' || !state.current || !state.current.codeHandle) return;
  if (kindForExt(state.current.ext) === 'image') return; // no tiene sentido comparar bytes de imagen como texto
  state.pollTimer = setInterval(async () => {
    if (state.dirty) return; // no pisar cambios locales sin guardar
    try {
      const fresh = await FS.readText(state.current.codeHandle);
      if (fresh !== el('code-editor').value) {
        el('code-editor').value = fresh;
        state.current.codeText = fresh;
        if (kindForExt(state.current.ext) === 'markdown') updateMdPreview(fresh);
        toast('Archivo actualizado desde el disco');
      }
    } catch (e) { /* silencioso */ }
  }, 2000);
}
function stopPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
}

// ---------------------------------------------------------------
// Guardar código editado
// ---------------------------------------------------------------
el('btn-save-code').addEventListener('click', async () => {
  if (state.mode !== 'own' || !state.current || kindForExt(state.current.ext) === 'image') return;
  await FS.writeText(state.dirHandle, state.current.codeName, el('code-editor').value);
  state.current.codeText = el('code-editor').value;
  state.dirty = false;
  el('btn-save-code').disabled = true;
  toast('Guardado ✓');
});

el('btn-refresh-code').addEventListener('click', async () => {
  if (!state.current) return;
  await renderCodePanel(state.current);
  toast('Releído del disco');
});

// ---------------------------------------------------------------
// Ejecutar JS en un iframe sandbox
// ---------------------------------------------------------------
function runJs(code) {
  const output = el('run-output');
  output.innerHTML = '';

  const iframe = document.createElement('iframe');
  iframe.sandbox = 'allow-scripts';
  iframe.style.display = 'none';
  iframe.srcdoc = `<!DOCTYPE html><html><body><script>
    const send = (type, args) => parent.postMessage({ __aprendeHaciendo:true, type, args }, '*');
    ['log','error','warn','info'].forEach(m => {
      console[m] = (...args) => send(m, args.map(a => {
        try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
        catch(e){ return String(a); }
      }));
    });
    window.addEventListener('message', (ev) => {
      if (!ev.data || ev.data.__aprendeHaciendoRun !== true) return;
      try {
        new Function(ev.data.code)();
      } catch(e) {
        send('error', [e.message]);
      }
      send('__done', []);
    });
  <\/script></body></html>`;

  const onMessage = (ev) => {
    if (!ev.data || !ev.data.__aprendeHaciendo) return;
    if (ev.data.type === '__done') {
      window.removeEventListener('message', onMessage);
      setTimeout(() => iframe.remove(), 50);
      return;
    }
    const line = document.createElement('div');
    line.className = 'line' + (ev.data.type === 'error' ? ' error' : '');
    line.textContent = ev.data.args.join(' ');
    output.appendChild(line);
  };
  window.addEventListener('message', onMessage);

  document.body.appendChild(iframe);
  iframe.addEventListener('load', () => {
    iframe.contentWindow.postMessage({ __aprendeHaciendoRun: true, code }, '*');
  });
}

el('btn-run').addEventListener('click', () => {
  if (!state.current || kindForExt(state.current.ext) !== 'code') return;
  runJs(el('code-editor').value);
});

// ---------------------------------------------------------------
// Abrir en VS Code (requiere ruta base guardada una sola vez)
// ---------------------------------------------------------------
function vscodeBasepathKey() {
  // en modo lectura el archivo no vive en tu carpeta de datos sino en donde
  // lo descargues, así que se guarda por separado y no se mezcla con la ruta
  // de tu carpeta "own".
  return state.mode === 'creator' ? 'aprendeHaciendo-basepath-downloads' : 'aprendeHaciendo-basepath';
}

el('btn-open-vscode').addEventListener('click', () => {
  if (!state.current || !state.current.codeName) return;
  const basePath = localStorage.getItem(vscodeBasepathKey());
  if (!basePath) {
    if (state.mode === 'creator') {
      el('vscode-path-title').textContent = '¿Dónde guardaste el archivo descargado?';
      el('vscode-path-sub').textContent = 'Estás en modo lectura, así que primero descarga el archivo con "⬇ Descargar" (si no lo has hecho). Después dime en qué carpeta quedó guardado — normalmente tu carpeta de Descargas — y no te lo vuelvo a preguntar en este navegador.';
    } else {
      el('vscode-path-title').textContent = '¿En qué carpeta de tu computador está esta tarea?';
      el('vscode-path-sub').textContent = 'Aunque ya seleccionaste la carpeta arriba, por seguridad ningún navegador le permite a una página saber la ruta real de una carpeta en tu disco — solo te deja leer y escribir dentro de ella. Por eso este es el único dato que te voy a pedir escrito, y solo una vez.';
    }
    el('modal-vscode-path').classList.remove('hidden');
    return;
  }
  openInVsCode(basePath, state.current.codeName);
});

function openInVsCode(basePath, filename) {
  const sep = basePath.includes('\\') ? '\\' : '/';
  const full = basePath.replace(/[\\/]+$/, '') + sep + filename;
  window.location.href = `vscode://file/${full.replace(/\\/g, '/')}`;
}

el('btn-cancel-vscode-path').addEventListener('click', () => {
  el('modal-vscode-path').classList.add('hidden');
});
el('btn-confirm-vscode-path').addEventListener('click', () => {
  const val = el('f-basepath').value.trim();
  if (!val) return;
  localStorage.setItem(vscodeBasepathKey(), val);
  el('modal-vscode-path').classList.add('hidden');
  if (state.current) openInVsCode(val, state.current.codeName);
});

// ---------------------------------------------------------------
// Descargar el archivo de código (modo "Ver ejercicios del creador",
// donde no hay carpeta local real: hay que descargarlo antes de poder
// abrirlo en un editor de tu computador).
// ---------------------------------------------------------------
el('btn-download-code').addEventListener('click', async () => {
  if (!state.current || !state.current.codeName) return;
  const isImg = kindForExt(state.current.ext) === 'image';
  let blob;
  if (isImg) {
    blob = state.current.codeBlob;
    if (!blob) { toast('Todavía no se pudo leer la imagen.'); return; }
  } else {
    blob = new Blob([el('code-editor').value], { type: 'text/plain' });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = state.current.codeName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Descargado ✓ — normalmente cae en tu carpeta de Descargas');
});

// ---------------------------------------------------------------
// Nueva tarea
// ---------------------------------------------------------------
el('btn-new-task').addEventListener('click', () => {
  el('f-titulo').value = '';
  el('f-keyword').value = '';
  el('f-desc').value = '';
  el('f-teoria').value = '';
  el('f-ext').value = 'js';
  el('f-ext-custom').classList.add('hidden');
  el('f-ext-custom').value = '';
  el('modal-new-task').classList.remove('hidden');
  el('f-titulo').focus();
});
el('btn-cancel-new-task').addEventListener('click', () => {
  el('modal-new-task').classList.add('hidden');
});
el('f-ext').addEventListener('change', (e) => {
  el('f-ext-custom').classList.toggle('hidden', e.target.value !== 'other');
});

el('btn-confirm-new-task').addEventListener('click', async () => {
  const titulo = el('f-titulo').value.trim();
  if (!titulo) { toast('El título es obligatorio'); return; }
  const keyword = el('f-keyword').value.trim();
  const desc = el('f-desc').value.trim();
  const teoria = el('f-teoria').value.trim();
  let ext = el('f-ext').value;
  if (ext === 'other') ext = (el('f-ext-custom').value.trim() || 'txt').replace(/^\./, '');

  const maxNum = state.tasks.reduce((m, t) => Math.max(m, parseInt(t.numero, 10) || 0), 0);
  const numero = String(maxNum + 1).padStart(3, '0');
  const slug = MD.slugify(titulo);
  const base = `${numero}-${slug}`;
  const mdName = `${base}.md`;
  const codeName = answerFilename(base, ext);

  const meta = { titulo, palabra_clave: keyword || '(sin palabra clave)', archivo: codeName };
  let mdContent = MD.buildFrontMatter(meta) + '\n## Descripción\n' + (desc || '_Pendiente por escribir._') + '\n';
  if (teoria) mdContent += '\n## Teoría\n' + teoria + '\n';

  const starter = ext === 'js'
    ? `// Ejercicio ${numero} · ${titulo}\n// Escribe tu código debajo de esta línea\n\n`
    : ext === 'md'
    ? `# ${titulo}\n\n`
    : '';

  await FS.writeText(state.dirHandle, mdName, mdContent);
  await FS.writeText(state.dirHandle, codeName, starter);

  el('modal-new-task').classList.add('hidden');
  await refreshTaskListFromDisk();
  await selectTask(numero);
  toast('Tarea creada ✓');
});

// ---------------------------------------------------------------
// Importar tareas en lote (archivo generado por una IA)
// ---------------------------------------------------------------
function updateImportPreview() {
  const raw = el('f-import-text').value;
  const items = MD.parseImportFile(raw);
  const preview = el('import-preview');
  const btn = el('btn-confirm-import');
  if (!raw.trim()) {
    preview.textContent = 'Aún no hay nada para importar.';
    btn.disabled = true;
    return;
  }
  if (items.length === 0) {
    preview.textContent = 'No se reconoció ningún ejercicio válido. Revisa que cada bloque tenga al menos "titulo:" y que estén separados por una línea "===".';
    btn.disabled = true;
    return;
  }
  const primeros = items.slice(0, 3).map(i => `“${i.titulo}”`).join(', ');
  preview.textContent = `Se detectaron ${items.length} ejercicio${items.length === 1 ? '' : 's'}: ${primeros}${items.length > 3 ? ', …' : ''}.`;
  btn.disabled = false;
}

// ---------------------------------------------------------------
// Eliminar tarea (botón al fondo del enunciado, solo en modo "own")
// ---------------------------------------------------------------
el('read-content').addEventListener('click', (e) => {
  if (!e.target.closest('#btn-delete-task') || !state.current) return;
  const t = state.current;
  el('delete-task-text').textContent =
    `Se van a borrar los archivos de la tarea Nº ${t.numero} — “${t.meta.titulo || '(sin título)'}” — de tu carpeta. Esta acción no se puede deshacer.`;
  el('modal-delete-task').classList.remove('hidden');
});
el('btn-cancel-delete-task').addEventListener('click', () => {
  el('modal-delete-task').classList.add('hidden');
});
el('btn-confirm-delete-task').addEventListener('click', async () => {
  if (state.mode !== 'own' || !state.current || !state.dirHandle) return;
  const t = state.current;
  el('btn-confirm-delete-task').disabled = true;
  el('btn-confirm-delete-task').textContent = 'Eliminando…';
  try {
    stopPolling();
    await FS.removeFile(state.dirHandle, t.mdName);
    if (t.codeName) await FS.removeFile(state.dirHandle, t.codeName);
    state.current = null;
    state.dirty = false;
    el('modal-delete-task').classList.add('hidden');
    showEmptyState();
    await refreshTaskListFromDisk();
    toast('Tarea eliminada ✓');
  } catch (e) {
    console.error(e);
    toast('No se pudo eliminar la tarea.');
  } finally {
    el('btn-confirm-delete-task').disabled = false;
    el('btn-confirm-delete-task').textContent = 'Sí, eliminar';
  }
});

el('btn-import-tasks').addEventListener('click', () => {
  el('f-import-file').value = '';
  el('f-import-text').value = '';
  updateImportPreview();
  el('modal-import-tasks').classList.remove('hidden');
});
el('btn-cancel-import').addEventListener('click', () => {
  el('modal-import-tasks').classList.add('hidden');
});
el('f-import-text').addEventListener('input', updateImportPreview);
el('f-import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  el('f-import-text').value = await file.text();
  updateImportPreview();
});

async function importTasksFromList(items) {
  let maxNum = state.tasks.reduce((m, t) => Math.max(m, parseInt(t.numero, 10) || 0), 0);
  let creados = 0;
  for (const item of items) {
    maxNum += 1;
    const numero = String(maxNum).padStart(3, '0');
    const slug = MD.slugify(item.titulo);
    const base = `${numero}-${slug}`;
    const mdName = `${base}.md`;
    const codeName = answerFilename(base, item.extension || 'js');

    const meta = { titulo: item.titulo, palabra_clave: item.palabra_clave || '(sin palabra clave)', archivo: codeName };
    let mdContent = MD.buildFrontMatter(meta) + '\n## Descripción\n' + (item.descripcion || '_Pendiente por escribir._') + '\n';
    if (item.teoria) mdContent += '\n## Teoría\n' + item.teoria + '\n';

    const starter = item.extension === 'js'
      ? `// Ejercicio ${numero} · ${item.titulo}\n// Escribe tu código debajo de esta línea\n\n`
      : item.extension === 'md'
      ? `# ${item.titulo}\n\n`
      : '';

    await FS.writeText(state.dirHandle, mdName, mdContent);
    await FS.writeText(state.dirHandle, codeName, starter);
    creados++;
  }
  return creados;
}

el('btn-confirm-import').addEventListener('click', async () => {
  if (state.mode !== 'own' || !state.dirHandle) return;
  const items = MD.parseImportFile(el('f-import-text').value);
  if (items.length === 0) return;
  el('btn-confirm-import').disabled = true;
  el('btn-confirm-import').textContent = 'Importando…';
  try {
    const creados = await importTasksFromList(items);
    el('modal-import-tasks').classList.add('hidden');
    await refreshTaskListFromDisk();
    toast(`${creados} tarea${creados === 1 ? '' : 's'} importada${creados === 1 ? '' : 's'} ✓`);
  } catch (e) {
    console.error(e);
    toast('Algo falló importando las tareas. Revisa la consola.');
  } finally {
    el('btn-confirm-import').disabled = false;
    el('btn-confirm-import').textContent = 'Importar tareas';
  }
});

// ---------------------------------------------------------------
// Guía / generador de prompt para pedirle ejercicios a una IA
// (no llama a ninguna IA: solo arma texto para copiar y pegar)
// ---------------------------------------------------------------
function buildPromptText() {
  const tema = el('f-prompt-tema').value.trim() || '(escribe aquí el tema que quieres practicar)';
  const n = parseInt(el('f-prompt-n').value, 10) || 30;
  return `Actúa como generador de ejercicios prácticos para aprender haciendo, no leyendo.

Tema que quiero practicar: ${tema}

Dame ${n} ejercicios progresivos, del más simple al más avanzado, para que yo los resuelva por mi cuenta (no me des la solución).

Responde SIGUIENDO EXACTAMENTE este formato, sin saludo, sin texto antes o después, sin numerar tú los ejercicios, porque voy a importar tu respuesta tal cual en una app:

titulo: <título corto y claro del ejercicio>
palabra_clave: <una o varias palabras clave separadas por coma, para identificarlo en una lista>
extension: <extensión del archivo que debo crear para resolver este ejercicio: js, py, html, txt, md, png, etc. — usa "md" si el ejercicio es más de redactar/tomar notas/resumir teoría, "png" si es de subir una foto (dibujo, manualidad, plato de cocina...), o la que tenga sentido según el tema>

## Descripción
<qué tengo que lograr en este ejercicio, en 2-4 líneas, SIN resolverlo>

## Teoría
<opcional: 2-4 líneas del contexto mínimo necesario para entenderlo; si no aplica, deja esta sección vacía>

===

titulo: <siguiente ejercicio>
palabra_clave: ...
extension: ...

## Descripción
...

## Teoría
...

===

(repite este bloque hasta completar los ${n} ejercicios, separando cada uno con una línea que solo diga ===)

Reglas:
- Un bloque por ejercicio, siempre con "titulo:", "palabra_clave:" y "extension:".
- Si el tema no es de programación (dibujo, cocina, música, etc.), usa una extension como "txt" o "png" y describe la tarea igual de concreta (ej. "sube una foto de tu dibujo terminado" en la descripción).
- No agregues encabezados generales, introducciones ni conclusiones fuera de los bloques.
- No resuelvas los ejercicios, solo descríbelos.`;
}

function refreshPromptOutput() {
  el('prompt-output').value = buildPromptText();
}

function openPromptGuide() {
  if (!el('f-prompt-tema').value) el('f-prompt-tema').value = '';
  refreshPromptOutput();
  el('modal-prompt-guide').classList.remove('hidden');
}

el('btn-prompt-guide-landing').addEventListener('click', openPromptGuide);
el('btn-prompt-guide-app').addEventListener('click', openPromptGuide);
el('btn-close-prompt-guide').addEventListener('click', () => {
  el('modal-prompt-guide').classList.add('hidden');
});
el('f-prompt-tema').addEventListener('input', refreshPromptOutput);
el('f-prompt-n').addEventListener('input', refreshPromptOutput);

el('btn-copy-prompt').addEventListener('click', async () => {
  const text = el('prompt-output').value;
  try {
    await navigator.clipboard.writeText(text);
    toast('Prompt copiado ✓');
  } catch (e) {
    el('prompt-output').select();
    document.execCommand('copy');
    toast('Prompt copiado ✓');
  }
});

// ---------------------------------------------------------------
// Navegación entre landing / app + selección de modo
// ---------------------------------------------------------------
function showApp() {
  el('landing').classList.add('hidden');
  el('app').classList.remove('hidden');
}
function showLanding() {
  stopPolling();
  el('app').classList.add('hidden');
  el('landing').classList.remove('hidden');
  state.current = null;
  state.tasks = [];
}

el('btn-mode-creator').addEventListener('click', async () => {
  showApp();
  showEmptyState();
  await loadCreatorMode();
});

let resumableHandle = null;

function markResumable(handle) {
  resumableHandle = handle;
  el('btn-mode-own').textContent = 'Reanudar mi carpeta';
}

async function showFsaHelp() {
  const brave = await FS.isBrave().catch(() => false);
  el('fsa-help-text').textContent = brave
    ? 'Detecté que estás en Brave: trae esta función apagada por defecto (por privacidad) y hay que encenderla a mano, una sola vez, con los pasos de abajo.'
    : 'Para poder leer y escribir carpetas de tu computador, esta página usa la File System Access API del navegador. Chrome y Edge la traen encendida por defecto; en Firefox y Safari no existe todavía. Si estás en Brave, tráela apagada por defecto — enciéndela con los pasos de abajo.';
  el('modal-fsa-help').classList.remove('hidden');
}

el('btn-mode-own').addEventListener('click', async () => {
  if (!FS.isSupported()) {
    await showFsaHelp();
    return;
  }
  try {
    if (resumableHandle) {
      const granted = await FS.verifyPermission(resumableHandle, 'readwrite');
      if (granted) {
        showApp();
        showEmptyState();
        await loadOwnMode(resumableHandle);
        return;
      }
      toast('Permiso no concedido. Elige la carpeta de nuevo.');
    }
    const handle = await FS.pickDirectory();
    markResumable(handle);
    showApp();
    showEmptyState();
    await loadOwnMode(handle);
  } catch (e) {
    if (e.message === 'NO_SUPPORT') {
      await showFsaHelp();
    } else if (e.name !== 'AbortError') {
      toast('No se pudo abrir la carpeta.');
      console.error(e);
    }
  }
});

el('btn-close-fsa-help').addEventListener('click', () => {
  el('modal-fsa-help').classList.add('hidden');
});
el('btn-copy-flag-url').addEventListener('click', async () => {
  const text = el('fsa-flag-url').textContent;
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const range = document.createRange();
    range.selectNode(el('fsa-flag-url'));
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    document.execCommand('copy');
    window.getSelection().removeAllRanges();
  }
  toast('Copiado ✓');
});

el('btn-change-folder').addEventListener('click', async () => {
  try {
    const handle = await FS.pickDirectory();
    markResumable(handle);
    showEmptyState();
    await loadOwnMode(handle);
  } catch (e) {
    if (e.name !== 'AbortError') toast('No se pudo cambiar de carpeta.');
  }
});

el('btn-back-landing').addEventListener('click', showLanding);

// ---------------------------------------------------------------
// Divisores arrastrables (ancho del panel de lectura y, dentro del
// panel de código, el ancho entre editor y salida en modo "Ambos")
// ---------------------------------------------------------------
function makeResizable(resizer, leftPanel, container, storageKey, { min = 220, max = 900 } = {}) {
  const saved = localStorage.getItem(storageKey);
  if (saved) leftPanel.style.flexBasis = `${saved}px`;

  let dragging = false;
  resizer.addEventListener('pointerdown', (e) => {
    dragging = true;
    resizer.classList.add('dragging');
    resizer.setPointerCapture(e.pointerId);
  });
  resizer.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const isColumn = getComputedStyle(container).flexDirection === 'column';
    const rect = container.getBoundingClientRect();
    let size = isColumn ? (e.clientY - rect.top) : (e.clientX - rect.left);
    size = Math.max(min, Math.min(max, size));
    leftPanel.style.flexBasis = `${size}px`;
  });
  const stop = () => {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove('dragging');
    localStorage.setItem(storageKey, parseInt(leftPanel.style.flexBasis, 10));
  };
  resizer.addEventListener('pointerup', stop);
  resizer.addEventListener('pointercancel', stop);
}

makeResizable(el('resizer-main'), el('panel-read'), el('main'), 'aprendeHaciendo-w-main', { min: 260, max: 760 });
makeResizable(el('resizer-code'), el('pane-editor'), el('code-split'), 'aprendeHaciendo-w-code', { min: 180, max: 1400 });

// ---------------------------------------------------------------
// Colapsar/expandir la barra lateral: en colapsado solo se ven los
// números de cada tarea. Queda guardado entre visitas.
// ---------------------------------------------------------------
function setSidebarCollapsed(collapsed) {
  el('sidebar').classList.toggle('collapsed', collapsed);
  localStorage.setItem('aprendeHaciendo-sidebar-collapsed', collapsed ? '1' : '0');
}
el('btn-toggle-sidebar').addEventListener('click', () => {
  setSidebarCollapsed(!el('sidebar').classList.contains('collapsed'));
});
if (localStorage.getItem('aprendeHaciendo-sidebar-collapsed') === '1') {
  setSidebarCollapsed(true);
}

// ---------------------------------------------------------------
// Al cargar: si hay una carpeta guardada de una sesión anterior,
// ofrece reanudar el acceso con un solo clic (requiere gesto del usuario
// por seguridad del navegador, así que se muestra como botón, no automático).
// ---------------------------------------------------------------
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const saved = await FS.loadHandle();
    if (saved) markResumable(saved);
  } catch (e) { /* IndexedDB no disponible o vacío: no pasa nada */ }
});
