# claudiopiloto

Panel local para ver y manejar tu trabajo con Claude Code: sesiones, uso, agentes, todos, notas y novedades de Jira y Slack.

## Requisitos

- macOS. Borrar sesiones usa la papelera de macOS y "abrir en la app" usa los links `claude://` de la app de escritorio de Claude.
- Node 22 o más nuevo.
- Claude Code instalado, con `claude` en el `PATH` (o en `~/.local/bin/claude`) y tu sesión iniciada. Si está en otro lado, definí `CLAUDE_BIN` con la ruta.
- Para las novedades de Jira y Slack: los conectores de Atlassian y Slack activos en tu cuenta de claude.ai. También el archivo `~/.claude/skills/triage/sources.md`, con el proyecto de Jira y los canales.

## Instalar y arrancar

```bash
git clone https://github.com/nicolasperez-blip/strife-dashboard-claude-code.git claudiopiloto
```

```bash
cd claudiopiloto
```

```bash
npm install
```

```bash
npm start
```

Abrí http://127.0.0.1:4477. `npm start` compila la web y levanta el servidor en un solo proceso. Para usar otro puerto, definí `CP_PORT`.

El panel arranca vacío y arma el índice de tus sesiones la primera vez. Tus datos (tablero, todos, notas, resúmenes) quedan en `data/`, que no se sube a git.

Para actualizar, hacé `git pull` y volvé a correr `npm install` y `npm start`.

## Desarrollo

```bash
npm run dev
```

Levanta el servidor con recarga y Vite en http://localhost:5177.

## Qué lee y dónde guarda

- Sesiones y uso: lee `~/.claude/projects/**.jsonl`. No modifica esos archivos.
- Sesiones abiertas: lee `~/.claude/sessions/*.json`.
- Skills para lanzar: lee `~/.claude/skills/*/SKILL.md`.
- Datos propios en `data/`: `board.json`, `todos.json`, `projects.json` (notas, links, agentes guardados), `runs.json`, `feed.json`, `summaries/`, `index.json` (cache), `aux-costs.json`.

## Costos

- Agentes: cuestan lo que cueste la corrida. El costo queda en el historial como cualquier sesión.
- Resúmenes de sesión: Haiku, centavos por resumen. Se generan la primera vez que abrís una sesión.
- Novedades de Jira y Slack: Sonnet, entre $0.20 y $1.20 por actualización. Solo corren cuando apretás "actualizar".
- Los resúmenes y las novedades no dejan sesión, así que su costo se suma aparte como "claudiopiloto (resúmenes y novedades)" en la página de uso.

## Seguridad

- El servidor escucha solo en `127.0.0.1` y rechaza requests con `Host` u `Origin` que no sean locales.
- Cada corrida de `claude` que lanza el panel lleva un hook `PreToolUse` (`server/hooks/block-connector-writes.mjs`). El hook bloquea toda tool de conectores de claude.ai (Jira, Confluence, Slack, Monday, Google) que no sea de lectura. La regla está en `server/hooks/connector-policy.mjs`.
- Si un agente necesita escribir en Jira o Slack, deja un borrador en su respuesta para que lo apruebes y lo mandes vos.

## Estructura

- `server/`: Hono sobre Node. `sessions.ts` indexa transcripts, `usage.ts` arma el uso, `agents.ts` corre agentes, `summaries.ts` hace los resúmenes, `feed.ts` trae novedades, `board.ts` guarda tablero, todos y extras por proyecto.
- `web/`: React + Vite. Temas en `web/src/themes.css` (neón, Game Boy, CRT ámbar, synthwave).
- 'finetunning/': Aca van una lista de skills, se van a versionar y algunas reglas