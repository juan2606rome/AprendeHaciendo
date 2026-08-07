# aprendeHaciendo

Una página simple para aprender **haciendo, no leyendo**: creas un reto, lo resuelves y sigues con el siguiente. Nació pensada para practicar programación, pero cada tarea puede asociarse a cualquier tipo de archivo (código, texto, imagen...), así que sirve igual para llevar el seguimiento de dibujo, cocina, idiomas o cualquier otra cosa que quieras practicar con retos concretos.

No tiene backend ni proceso de build. Es HTML + CSS + JavaScript plano que lee y escribe archivos **directamente en tu computador**, usando la File System Access API del navegador (la misma tecnología detrás de VS Code para la web). Nada se sube a ningún servidor: todo se queda en tu máquina, salvo que tú decidas publicarlo.

> Esta página (el código en sí) se construyó en colaboración con Claude (Anthropic). Eso es independiente de cómo la uses: los ejercicios los resuelves tú, la página no resuelve nada por ti — lo único relacionado con IA es un generador opcional de *prompt* para pedirle ideas de ejercicios a una IA externa (ver más abajo).

## ¿Cómo funciona?

Las tareas viven en una carpeta `data/`, donde **cada tarea son dos archivos que comparten número**:

```
data/
  001-hola-mundo.md   ← enunciado: título, palabra clave, descripción, teoría (opcional)
  001-hola-mundo.js   ← donde resuelves el reto (puede ser .js, .py, .png, lo que aplique)
  002-variables-y-tipos.md
  002-variables-y-tipos.js
  manifest.json        ← índice usado solo por el modo de solo lectura
```

La página tiene **dos modos**, elegibles desde la pantalla de inicio:

- **Ver ejercicios del creador** — modo de solo lectura, no requiere seleccionar nada. Carga la carpeta `data/` que viene con este sitio.
- **Probar tú mismo** — seleccionas tu **propia** carpeta local (puede ser esta misma `data/` o cualquier otra). Ahí puedes crear tareas nuevas, editar el archivo asociado y guardar los cambios directo al disco. El navegador recuerda la carpeta entre visitas.

## Requisitos: navegadores soportados

La File System Access API (lo que permite el modo "Probar tú mismo") solo existe en navegadores basados en Chromium. En **Chrome, Edge y Opera** viene activada por defecto. En **Firefox y Safari** no existe todavía, así que ese modo no está disponible ahí (el modo "Ver ejercicios del creador" sí funciona en cualquier navegador, porque solo usa `fetch`).

**Brave** también está basada en Chromium, pero trae esta función **apagada por defecto** (por privacidad) — hay que encenderla a mano, una sola vez:

1. Ve a `brave://flags/#file-system-access-api`.
2. Cambia el selector de *Default* a **Enabled**.
3. Reinicia Brave cuando te lo pida (botón *Relaunch*).

Después de eso, "Probar tú mismo" funciona en Brave exactamente igual que en Chrome (lectura y escritura reales en tu carpeta, sin subir nada a ningún lado). La página también te muestra estos pasos automáticamente si detecta que tu navegador no soporta la función.

## Crear una tarea nueva

Botón **+ Nueva tarea** (modo "Probar tú mismo"):

1. Escribe el título, una palabra clave (o varias, separadas por comas — es lo que se ve en la lista de la izquierda), la descripción del reto y, si aplica, teoría.
2. Elige qué archivo se genera para resolverlo — `.js` se puede ejecutar dentro de la misma página, `.md` trae un editor con vista previa bonita (viñetas, negritas, etc.), `.png`/`.jpg`/`.gif`/`.webp`/`.svg` se resuelven subiendo una foto, y cualquier otra extensión se edita como texto plano o se abre en tu editor de preferencia.
3. Al confirmar, se crean `NNN-slug.md` y `NNN-slug.ext` en tu carpeta, numerados en orden.

## Pedirle ideas de ejercicios a una IA (opcional)

La página no llama a ninguna IA ni depende de ella para funcionar. Lo que sí incluye es un botón **"Generar prompt para IA"** (en la pantalla de inicio y dentro de la app) que arma, ahí mismo en el navegador, un texto listo para copiar y pegar en la IA que prefieras (ChatGPT, Claude, etc.). Escribes el tema que quieres practicar y cuántos ejercicios quieres, copias el resultado, se lo pegas a la IA, y lo que te devuelva lo pegas de vuelta en "Importar tareas" para crear todos los ejercicios de un solo golpe.

El prompt le pide a la IA que responda en bloques con este formato, separados por una línea `===`:

```
titulo: <título corto>
palabra_clave: <una o varias, separadas por coma>
extension: <js, py, html, txt, md, png, etc. — según el tema>

## Descripción
<qué hay que lograr, sin resolverlo>

## Teoría
<opcional>
```

Como el formato no exige código, sirve para cualquier disciplina: para dibujo o cocina, por ejemplo, la IA puede sugerir `extension: png` (subes una foto del resultado) o `extension: md` (para redactar o resumir teoría, con vista previa bonita) en vez de código.

El importador es tolerante con texto "mal pegado" desde un chat (saltos de línea reacomodados, encabezados sin `##`, el separador `===` pegado a la línea siguiente): igual detecta cada ejercicio correctamente.

## Importar muchos ejercicios de una vez

Botón **⇪ Importar tareas** (junto a "+ Nueva tarea"). Pega ahí el archivo con el formato de arriba —el que te devolvió una IA, o uno que armes tú mismo— y, al confirmar, se crean todos los pares de archivos de una sola vez, numerados en orden, sin tener que hacerlo uno por uno.

## Editar y ejecutar código

El botón **↗ Abrir en VS Code** abre el archivo exacto en tu editor (la primera vez pide la ruta absoluta de tu carpeta, porque el navegador no la expone por seguridad — ni siquiera después de que ya elegiste esa carpeta con el selector nativo). Si guardas desde ahí con la tarea abierta, la página relee el archivo del disco cada par de segundos y actualiza sola.

En modo "Ver ejercicios del creador" no hay ninguna carpeta local seleccionada (el código se trae por `fetch` desde el sitio publicado), así que ahí aparece primero un botón **⬇ Descargar** para bajar el archivo a tu computador — después "Abrir en VS Code" te pide dónde quedó guardado (normalmente tu carpeta de Descargas) y lo recuerda para la próxima vez.

Para archivos `.js`, el botón **▶ Ejecutar** corre el código en un `<iframe>` aislado y muestra la salida de `console.log`. Hay un selector de vista:

- **Código** — solo el editor.
- **Ambos** — editor y salida lado a lado.
- **Ejecución** — solo la salida, a pantalla completa.

Para archivos `.md` aparece el mismo selector de vista (renombrado a **Editar / Ambos / Vista previa**), más una pequeña barra con negrita, cursiva, encabezado, viñetas, lista numerada, cita, código en línea y enlace — la vista previa se renderiza igual de bonito que el enunciado de la izquierda.

Para archivos de imagen (`.png`, `.jpg`, `.gif`, `.webp`, `.svg`) no hay editor de texto ni selector de vista: se ve la foto tal cual, y en modo "Probar tú mismo" aparece un botón **📷 Seleccionar foto** que reemplaza el archivo en tu carpeta con la foto que elijas de tu computador (se guarda con el mismo nombre que ya tenía).

Para el resto de extensiones (`.py`, `.html`, `.css`, `.txt`, etc.) solo aparece el editor de texto plano, sin selector de vista ni botón de ejecutar, ya que no aplican.

Tanto el ancho entre el enunciado y el editor, como el ancho entre el editor y la salida, se pueden arrastrar y quedan guardados entre visitas.

## Publicar tu propia copia

Al no tener backend ni build, este proyecto se puede publicar tal cual en cualquier hosting estático — por ejemplo Netlify o GitHub Pages — y todo sigue funcionando, incluido el modo "Probar tú mismo" con selección de carpeta (la File System Access API solo exige HTTPS o `localhost`, y ambos servicios ya sirven por HTTPS por defecto).

Para previsualizar cambios en tu propia computadora antes de publicar (o si prefieres no depender de un link publicado y correrlo localmente), hace falta un servidor simple porque abrir `index.html` con doble clic no cumple ese requisito de "contexto seguro":

```bash
# desde la carpeta raíz del proyecto (donde está index.html)
npx serve .
# o
python3 -m http.server 8080
```

y abre la URL que indique (`http://localhost:...`).

## Formato de los archivos

Para quien prefiera editar las tareas a mano en vez de usar los botones de la página, cada `.md` sigue este formato:

```markdown
---
titulo: Hola, mundo
palabra_clave: fundamentos, consola
archivo: 001-hola-mundo.js
---

## Descripción
Lo que hay que lograr en el ejercicio.

## Teoría
Notas opcionales de contexto.
```

## Estructura del proyecto

```
index.html          landing + shell de la app
css/style.css        estilos
js/fs.js             helpers de File System Access API + persistencia (IndexedDB)
js/markdown.js        parseo de front-matter, secciones markdown y del archivo de importación en lote
js/app.js             lógica de la aplicación (crear/importar tareas, generador de prompt, editor, ejecución)
data/                 ejercicios de ejemplo (bórralos o reemplázalos por los tuyos)
```
