# 01 · Migrar todos los estilos a Tailwind

## Por qué

Aplica la sección CSS de `finetunning/CODE_RULES.md`:

- Nunca estilar elementos HTML directamente. Todo estilo va en clases.
- Usar herencia y composición de clases. Reutilizar clases existentes antes de crear nuevas.
- Si es posible, usar Tailwind CSS en lugar de CSS propio.
- Evitar `style={{ }}` salvo para valores dinámicos que no se puedan expresar con clases.

## Estado actual

- `web/src/app.css` (222 líneas) tiene todo el CSS de la app.
- `web/src/themes.css` (106 líneas) define los 4 temas (`neon`, `gb`, `amber`, `syn`) como variables CSS bajo `[data-theme]`. `App.tsx:26` cambia el tema con `document.documentElement.dataset.theme`.
- `app.css` estila elementos directamente. Los selectores son estos:
  - Globales: `*`, `html`, `body`, `a`.
  - Formularios: `button`, `input`, `select`, `textarea`, `option`.
  - Tablas: `table`, `th`, `td`.
  - Elemento más clase: `hr.sep`, `details.tech`, `textarea.notes`.
- `app.css` también estila elementos por descendencia. Los selectores son estos:
  - `.bar nav`, `.col-tools button`, `.todo label`.
  - `.inline-form input`, `.feed-item a`, `.field textarea`, `.card-actions a`.
  - `.drawer h3` y `.drawer .md h2/p/ul/code`.
- Hay 62 `style={{ }}` en 10 archivos. La mayoría son valores fijos (`fontSize: '0.85em'`, `marginTop`, `display: 'flex'`).
- No hay Tailwind instalado.

## Qué hay que hacer

### 1. Instalar Tailwind

- Instalar Tailwind v4 con el plugin `@tailwindcss/vite` y agregarlo en `web/vite.config.ts`.
- Crear el CSS de entrada con `@import "tailwindcss";` e importarlo en `web/src/main.tsx`.

### 2. Conectar los temas con Tailwind

- Mantener los 4 temas como variables CSS bajo `[data-theme]`, porque el tema cambia en runtime.
- Exponer las variables como tokens de Tailwind con `@theme inline`. Así salen clases como `bg-bg`, `text-dim` o `border-acc`.
- Tokens a exponer:
  - Colores: `bg`, `bg2`, `fg`, `dim`, `acc`, `acc2`, `line`, `onacc`, `danger`, `warn`.
  - Colores del gráfico: `s1` a `s5`.
  - Fuente y tamaño base: `--ff` y `--fs`.
  - Sombras: `--glow-acc`, `--glow-acc2`, `--glow-box`.
  - Marco: `--frame`.
- Definir la animación `blink` como token (`--animate-blink` con su `@keyframes`).
- Definir el corte de 900px como breakpoint propio, en lugar de repetir `max-[900px]`.

### 3. Sacar los estilos de elementos

- Pasar cada estilo de elemento a clases en el JSX. Ejemplos:
  - `body`: clases en el `<body>` de `web/index.html` (fondo, color, fuente, tamaño, `leading-[1.35]`).
  - `button`, `input`, `select`, `textarea`: sus estilos base (borde, padding, hover, disabled, focus-visible, placeholder) van como clases en cada uno.
  - `table`, `th`, `td` de `UsagePage.tsx`: clases en cada celda.
  - `.kv > :nth-child(odd)`, `.todo:hover .x`, `.col-tools button`: variantes de Tailwind (`*:odd:`, `group-hover:`, `*:`).
- Algunos patrones se repiten en varios lugares: botón, input, `link`, `badge`, `st-*`, `field`, `dialog`. Cada uno se define una sola vez. Así no se copia la misma lista de utilidades en cada uso. Ver la pregunta abierta 1.
- El markdown del drawer (`Drawer.tsx:150`) usa `react-markdown`. Darle clases a `h2`, `p`, `ul` y `code` con la prop `components`, en lugar de `.drawer .md h2`.
- El `h2::before { content: '## ' }` del markdown pasa a la variante `before:content-['##_']`.
- Hoy `[data-theme='amber'] body::after` dibuja las líneas CRT del tema ámbar. Pasan a un elemento o clase que solo se activa con ese tema. Una opción es la variante `in-data-[theme=amber]:`.
- `body.resizing` lo agrega `useResizable.ts`. Mantener la clase y reemplazar el selector `body.resizing .resize-handle::after` por una variante (`in-[.resizing]:after:...`).
- `prefers-reduced-motion` pasa a `motion-reduce:animate-none`.
- `-webkit-line-clamp: 2` pasa a `line-clamp-2`.

### 4. Sacar los `style={{ }}` fijos

Quedan solo los dinámicos:

- `App.tsx:96`: la variable `--side-w` (ancho del panel lateral, viene de `useResizable`). La grilla usa `grid-cols-[minmax(0,1fr)_var(--side-w,320px)]`.
- `Drawer.tsx:33` y `Drawer.tsx:42`: ancho y posición del drawer redimensionable.
- `UsagePage.tsx:176`: posición `left` del tooltip del gráfico.

El resto pasa a clases. Esto incluye `UsagePage.tsx:180` (`color: 'var(--fg)'` pasa a `text-fg`) y `CardDialog.tsx:50` (ancho fijo).

### 5. Borrar el CSS propio

- Borrar `web/src/app.css`.
- `themes.css` queda solo con las variables de los temas y el `@theme inline`, o se une al CSS de entrada.

## Criterios de aceptación

- `npm run typecheck` y `npm run build` pasan.
- No queda ningún selector de elemento en los CSS del proyecto.
- Los únicos `style={{ }}` que quedan son los 4 dinámicos de la lista de arriba.
- La app se ve igual que antes en los 4 temas. Comparar capturas antes y después de cada vista: tablero, sesiones, historial, panel lateral, drawer (sesión, run y tarjeta), los 3 diálogos y la página de uso.
- Siguen andando estas cosas:
  - El foco con teclado (`focus-visible`).
  - El parpadeo de `badge.running` y `st-trabajando`, y su corte con `prefers-reduced-motion`.
  - El corte a una columna debajo de 900px.
  - Los dos tiradores para redimensionar.
  - Las líneas CRT del tema ámbar.

## Riesgos

- El preflight de Tailwind (su reset de estilos) cambia valores por defecto del navegador. Revisar `h3`, `ul`, `p`, `details`, `summary`, `hr` y `table`, que hoy dependen de esos valores.
- El preflight les pone fondo y borde nulos a los botones. Cada botón necesita su clase base para no perder el borde.

## Fuera de alcance

- Mover componentes a `library/` o a subcarpetas de `components/`.
- Separar archivos con más de un componente, `React.FC`, interfaces `Props` y named exports.
- Mover las llamadas a la API a services.

Cada uno de esos puntos va en su propio ticket.

## Preguntas abiertas

1. ¿Cómo se define un patrón repetido, como el botón base? Opción A: una clase en `@layer components` con `@apply` (por ejemplo `.btn`). Opción B: esperar al ticket de `library/` y que cada patrón sea un componente (`<Button>`) con sus utilidades adentro. Si se elige B, este ticket deja las utilidades repetidas y el ticket de `library/` las junta.
2. Las variables de tema se declaran en `:root` y `[data-theme]`. Son variables, no estilos, pero `:root` es el elemento `html`. ¿Esto cumple la regla de no estilar elementos?
