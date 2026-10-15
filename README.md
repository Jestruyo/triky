# Triky

Tic tac toe para dos, en tiempo real. Cada partida es una sala con su propio código, por ejemplo `K7M2PQ`. Ese código es el id de la sesión: el tablero, los nombres y el marcador viven ahí y no se mezclan con otras partidas.

## Cómo se juega

1. Una persona escribe su nombre y pulsa **Crear partida**.
2. Comparte el código o el enlace `/?sala=CODIGO`.
3. La otra persona escribe su nombre y entra.
4. Juegan en vivo. Al terminar, **Reiniciar partida** deja el marcador y empieza otra ronda.

Si cierran la pestaña y vuelven a abrir el mismo enlace en ese navegador, recuperan su asiento. Un tercer visitante puede mirar, pero no juega. La sala se borra si pasa 6 horas sin nadie conectado.

## Local

```bash
nvm use 20
npm install
npm run dev
```

Abre la dirección que imprime Wrangler, normalmente `http://localhost:8787`.

## En línea

Hace falta una cuenta gratis de Cloudflare. El plan gratuito alcanza: las salas usan Durable Objects con SQLite.

```bash
npx wrangler login
npm run deploy
```

Al terminar, Wrangler muestra una dirección `https://triky.<tu-subdominio>.workers.dev`. Esa es la del juego.
