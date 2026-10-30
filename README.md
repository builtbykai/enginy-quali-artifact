# Enginy Qualification Map

Guía interactiva y gamificada que los SDRs de Enginy siguen **en directo durante la llamada de cualificación (QCALL)**. Al terminar, genera la nota de la QCALL lista para pegar en el deal de HubSpot.

Es una página estática (`index.html`, con CSS y JS integrados) más una función serverless (`api/enrich.js`) para el autocompletado con Enginy. Sin dependencias ni build.

## Cómo funciona

La llamada se organiza en 5 secciones por tema, no por orden. El SDR puede saltar a cualquiera en cualquier momento: con las pestañas, con las teclas 1–5 o con el buscador **"¿De qué está hablando?"** (tecla `/` o ⌘K), que lleva directo a la pregunta del tema que saca el prospect ("CRM", "bounce", "competencia", "precio"…).

| Sección | Qué se apunta | Nota QCALL |
| --- | --- | --- |
| 1 · Cuenta | LinkedIn (autocompletado con Enginy), persona, criterios de ICP, tamaño de la empresa, situación y su ICP | Who, outbound, A, B |
| 2 · Proceso y stack | Proceso de listas, herramientas, calidad de datos, día a día y canales, volumen y ratios | C, D, E |
| 3 · Pains | Mapa de pains según persona y tamaño; al hacer clic se cuantifica y se apunta el porqué ahí mismo | F |
| 4 · Decisión | Seis bloques a la vista: impacto, competidores, timing, criterios, proceso y decisor, precio; con cómo compra cada tamaño | G–L |
| 5 · Cierre | Progreso, insignias, script de cierre, campos pendientes (clic para ir) y nota QCALL | Nota completa |

Cada pregunta es una tarjeta: clic para apuntar, Enter guarda y abre la siguiente sin responder. Las de Sí/No se marcan con un clic.

### Segmentos por tamaño

El tamaño se calcula con el número de comerciales (o con los empleados si no se sabe): **Startup** 4–10, **Mid-market** 11–50, **Enterprise** más de 50 (o más de 1.000 empleados). Se puede ajustar a mano en Cuenta. Cambia tres cosas:

- Qué pains aparecen y en qué orden (relevancia alta, media o baja por segmento), con pains propios de cada tamaño (F1–F4).
- El ángulo de cada pain para ese segmento.
- En Decisión: quién firma, cuánto dura la compra, qué la bloquea y preguntas extra por segmento.

### Criterios de ICP-fit

Una empresa es target si cumple los cuatro:

- Más de 3 personas en el equipo de ventas
- Más de 20 empleados
- Venden a un ICP con presencia digital (LinkedIn o fuentes de datos de Enginy). Quedan excluidos, por ejemplo, restaurantes, hoteles o real estate.
- Hacen outbound y tienen un proceso para ello

Si falla alguno, o si se detecta el pain P1 (empieza outbound desde cero) o P2 (sin equipo de ventas), la app cambia a la **ruta Partner**: no hay demo y el lead se deriva a un Partner con fecha de revisión.

## Autocompletar desde LinkedIn (Enginy)

En el paso 1 el SDR puede pegar la URL del LinkedIn de su interlocutor. La app pide los datos a Enginy y rellena sola la persona y la empresa: nombre y cargo, empleados, comerciales estimados (departamentos Sales + Business Development de LinkedIn), ubicación y sector. También sugiere el perfil de comprador según el cargo. Los datos rellenados llevan la marca ✨ para que el SDR los confirme con el prospect, y nunca pisan lo que el SDR ya haya escrito.

Cómo funciona (`api/enrich.js`, función serverless de Vercel):

1. Busca el contacto en Enginy por la URL de LinkedIn. Si existe con datos completos, los devuelve al instante, sin gastar créditos.
2. Si no existe, lo crea y lanza `SCRAPE_LEAD_FROM_LINKEDIN` (perfil y empresa). Si la empresa sigue incompleta, lanza `SCRAPE_COMPANY_FROM_LINKEDIN`. El navegador consulta el estado cada 4 s; suele tardar entre 1 y 5 minutos, y el SDR puede seguir con la llamada mientras tanto.
3. Si el contacto se actualizó en Enginy hace menos de 15 minutos, no se vuelve a scrapear, para no gastar créditos dos veces.

Cada scraping consume créditos del workspace de Enginy.

### Configuración en Vercel (obligatoria para el autocompletado)

En el proyecto de Vercel → **Settings → Environment Variables**, añade:

| Variable | Valor |
| --- | --- |
| `ENGINY_API_KEY` | API key de Enginy (`gsk_…`) con permisos de contactos, empresas y acciones |
| `APP_ACCESS_CODE` | Un código que repartes a los SDRs. La app lo pide en una pantalla de acceso al entrar, lo comprueba en el servidor (`api/auth.js`) y queda guardado en su navegador. Si lo cambias, se les vuelve a pedir |

Después haz **Redeploy**. Sin estas variables, la app funciona igual en modo manual y el autocompletado muestra un aviso.

Seguridad: la API key solo vive en el servidor. Sin el código de acceso no se puede llamar a la función, y los tokens de seguimiento van firmados (HMAC), así que nadie puede usarlos para leer otros contactos del workspace.

### Tests

```bash
npm test
```

## Abrir en local

Haz doble clic en `index.html`. Funciona todo salvo el autocompletado, que necesita la función de Vercel.

## Desplegar en Vercel (recomendado, funciona con repo privado)

1. En [vercel.com](https://vercel.com): **Add New → Project → Import Git Repository** y elige `enginy-quali-artifact`.
2. **Framework Preset:** `Other` · **Build Command:** vacío · **Output Directory:** `.`
3. **Deploy**. Cada push a `main` vuelve a desplegar.

`vercel.json` activa URLs limpias y añade cabeceras de seguridad básicas.

## Desplegar en GitHub Pages (alternativa)

1. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push a `main`: el workflow `.github/workflows/pages.yml` publica la raíz del repo.

> En el plan gratuito de GitHub, Pages solo funciona con repos **públicos**. Para mantener el playbook privado, usa Vercel.

## Editar el contenido

Todo el contenido está en el `<script>` de `index.html`:

- `PERSONAS`: perfiles, su rol en la venta, decisor esperado y pains que ven
- `PAINS`: cada pain con pista, preguntas detector, preguntas de cuantificación, frase de impacto, productos de Enginy, estrategia y ángulo por persona
- `SEGREL`: relevancia y ángulo de cada pain por tamaño; `SEGBUY` y `SEGQ`: cómo compra cada tamaño y sus preguntas extra
- `FIELDS`: todas las preguntas de Cuenta y Proceso y stack, con su sección, grupo y palabras clave para el buscador
- `QUAL`: los 6 bloques de Decisión (secciones G–L)
- `qcallText()`: plantilla de la nota QCALL

## Datos y privacidad

El progreso de cada llamada se guarda solo en el `localStorage` del navegador del SDR: no se sincroniza entre dispositivos y se borra con **Nueva llamada**. Lo único que sale del navegador es la URL de LinkedIn que pega el SDR, que se envía a Enginy (a través de `api/enrich.js`) para el autocompletado; el contacto queda guardado en el workspace de Enginy.
