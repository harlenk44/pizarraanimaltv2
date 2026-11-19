# Pizarra Animaltec TV

Aplicación web ultraligera diseñada específicamente para navegadores antiguos de Smart TVs (WebKit / Chromium antiguos), construida únicamente con **HTML5 clásico + CSS clásico (#hex y `display: table`) + JavaScript ES5 puro** (`var`, `function`, `XMLHttpRequest`, `JSON`, `setInterval`/`setTimeout`), sin React, Vite, Tailwind ni módulos ES en el navegador.

## Estructura para Cloudflare Pages

- `public/index.html` — Estructura HTML5 clásica (sin `<script type="module">`).
- `public/styles.css` — CSS clásico de alto contraste para TVs 720p/1080p (colores `#hex` y maquetación `display: table`).
- `public/app.js` — Cliente ES5 puro con persistencia dual (`localStorage` + Cookie), teclado en pantalla navegable con control remoto, sincronización cada 12s y rotación automática por páginas.
- `functions/api/tv-sync.js` — Cloudflare Pages Function puente (`GET /api/tv-sync` y `POST /api/tv-sync`) hacia `https://pizarraanimal.servhm.com/api/public/results/sync` sin CORS y con reducción de payload en `?poll=1`.
- `functions/api/tv-image.js` — Cloudflare Pages Function proxy (`GET /api/tv-image?url=...`) para logos e imágenes de animalitos (evita fallos de certificados/CORS en TVs antiguos).
- `wrangler.toml` — Configuración lista para despliegue directo en Cloudflare Pages (`pages_build_output_dir = "public"`).

## Despliegue en Cloudflare Pages

1. Conecte este repositorio en **Cloudflare Dashboard → Workers & Pages → Create → Pages**.
2. Configure:
   - **Framework preset**: `None`
   - **Build command**: *(dejar vacío)*
   - **Build output directory**: `public`
3. Despliegue el proyecto (Cloudflare Pages detectará automáticamente `functions/api/tv-sync.js` y `functions/api/tv-image.js`).
4. En **Custom domains**, agregue su subdominio (por ejemplo `tv.servhm.com`).

## Controles con Control Remoto de TV

- **Pantalla de PIN**: Flechas (`↑ ↓ ← →`) + `OK`/`Enter` o teclas numéricas `0–9` y `Back`/`Borrar`.
- **Pizarra diaria**:
  - `←` / `→`: cambiar página manualmente.
  - `↑` / `↓`: enfocar/desenfocar botones del encabezado (`‹`, `›`, `Recargar`, `PIN`).
  - `R` (o botón Rojo): recargar datos completos.
  - `P` (o botón Azul): abrir diálogo para cambiar PIN.
