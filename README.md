# Enginy Qualification Map

Guía interactiva y gamificada que los SDRs de Enginy siguen **en directo durante la llamada de cualificación (QCALL)**. Al terminar, genera la nota de la QCALL lista para pegar en el deal de HubSpot.

Es una única página estática (`index.html`, con CSS y JS integrados): sin dependencias, sin build y sin backend.

## Cómo funciona

La llamada se recorre en 6 pasos. Un panel lateral muestra el **progreso de la quali** (0–100 %), los logros y los datos capturados.

| Paso | Qué hace el SDR | Sección de la nota QCALL |
| --- | --- | --- |
| 1 · Persona | Elige con quién habla (Founder, CEO, VP Sales, Head of SDR, Marketing, SDR, AE, RevOps) | Who are we meeting with |
| 2 · Empresa | Responde los 4 criterios de ICP-fit, una pregunta por carta | Outbound, IA, A, B, C, D |
| 3 · Descubrir | Detecta pains en el mapa de esferas, con preguntas detector y posicionamiento de Enginy | F |
| 4 · Cuantificar | Apunta los números de cada pain, el porqué y las métricas base | C, E, F |
| 5 · Mapear | Completa 6 bloques: impacto, competidores, timing, criterios, proceso y decisor, precio | G–L |
| 6 · Cerrar | Script de cierre con sus números y nota QCALL completa para copiar | Nota completa |

### Criterios de ICP-fit

Una empresa es target si cumple los cuatro:

- Más de 3 personas en el equipo de ventas
- Más de 20 empleados
- Venden a un ICP con presencia digital (LinkedIn o fuentes de datos de Enginy). Quedan excluidos, por ejemplo, restaurantes, hoteles o real estate.
- Hacen outbound y tienen un proceso para ello

Si falla alguno, o si se detecta el pain P1 (empieza outbound desde cero) o P2 (sin equipo de ventas), la app cambia a la **ruta Partner**: no hay demo y el lead se deriva a un Partner con fecha de revisión.

## Abrir en local

Haz doble clic en `index.html`. No hace falta instalar nada.

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
- `CO_CARDS`: preguntas de empresa e ICP-fit
- `BASE_CARDS`: métricas base (calidad de datos, volumen, ratios)
- `QUAL`: los 6 bloques de Mapear (secciones G–L)
- `qcallText()`: plantilla de la nota QCALL

## Datos y privacidad

El progreso de cada llamada se guarda solo en el `localStorage` del navegador del SDR. No se envía a ningún servidor, no se sincroniza entre dispositivos y se borra con **Nueva llamada**.
