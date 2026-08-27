# Mobile
# 🎵 Rhythm Dash

Jogo mobile estilo **Geometry Dash** onde **a música gera o mapa**.

> 🌐 **Jogar online (sem instalar nada):** [https://JOAOCAETANO19.github.io/Mobile/](https://JOAOCAETANO19.github.io/Mobile/) — use a **faixa demo** (128 BPM) para testar sem internet.

O jogador escolhe a música (busca, link direto ou arquivo do aparelho) e o jogo analisa o áudio
em tempo real no dispositivo: detecta **batidas**, calcula o **BPM**, identifica **seções**
(intro, build, drop, break), mede a **energia** e extrai a **cor dominante** do som — e então
gera um nível com obstáculos alinhados exatamente aos acentos musicais, com tema visual e
velocidade que acompanham a faixa.

## ✨ Recursos

| Recurso | Como funciona |
| --- | --- |
| 🔍 **Buscar música** | **Spotify** (catálogo completo: duração exata, capa, prévia) + Deezer/iTunes — aceita link do Spotify; ▶▶ joga a **música completa** (Piped search + extração) e, se falhar, cai na prévia de 30s |
| ▶ **YouTube** | Cole o link (vídeo/Shorts/youtu.be/music.youtube): áudio extraído no aparelho (Piped → Invidious → Cobalt → Vevioz → InnerTube), com fallback para a busca legal |
| 🔗 **Link direto** | Cole uma URL de MP3/M4A/OGG/WAV/FLAC (com fallback de CORS) |
| 📂 **Arquivo local** | Envie uma música do aparelho — 100% offline/privada, completa |
| 🥁 **Sincronia com a batida** | Detecção por *spectral flux* + autocorrelação (FFT própria, sem libs) |
| 🎯 **Modo Batida** (*default*) | O pulo dura exatamente **1 batida**: toque quando o anel fecha (na batida) e o obstáculo passa no pico do pulo → **1 clique = 1 obstáculo = 1 batida**, com combo/PERFEITO. Janelas de julgamento **musicais** (PERFEITO/BOM = fração da batida, no max. o valor fixo em ms) + **linha de hit** na posição do jogador e **glow pulsante** nos obstáculos, tudo no acento |
| 🕹️ **Modo Livre** | Geometry Dash clássico: pule livremente sobre obstáculos (ainda sincronizados à música) |
| ⏱️ **Contagem 3-2-1** | Antes de iniciar, retomar do checkpoint, recomeçar ou "jogar de novo": contagem regressiva animada com a cena congelada no ponto de partida — a música (e o relógio do jogo) só começa no "go!" |
| 🎵 **Padrões rítmicos** | O levelgen monta células de 1–2 batidas: *double* (dois pulos em sequência), *bloco+espinho* e *[pad, espinho]* (o pad estica o arco para **1,15 batidas** e carrega por cima do espinho) — com a garantia de **nenhuma batida ocupada duas vezes** |
| 🎨 **Tema da música** | Paleta de cada seção derivada do centróide espectral (sinestesia visual) |
| 🌆 **Visual synthwave** | Renderer canvas: sol pulsante na batida, 2 camadas de montanhas em parallax, grade em perspectiva pulsando com a música, cubo com gradiente/rosto/rastro neon, HUD translúcido |
| 🧱 **Geração determinística** | A mesma música sempre gera o mesmo mapa (seed = hash da faixa) |
| 📱 **PWA instalável** | Adicione à tela inicial (Android/iOS Safari) e jogue |
| 🎮 **Gameplay** | Espinhos, blocos, pads (amarelos — arco esticado de **1,15 batidas**, física real), orbs (air-jump **a partir da altura atual**), escudo 🛡️, coletáveis 💎 + multiplicador de combo (1x→2x→3x→4x) |

## ▶️ Como rodar

```bash
npm install
npm run dev        # http://localhost:5173
```

Produção:

```bash
npm run build      # gera dist/
npm run preview
```

Testes do pipeline (BPM, geração de mapa, PRNG):

```bash
npm test
```

## 🏗️ Arquitetura

```
src/
  core/
    fft.js          FFT radix-2 própria (sem dependências)
    analysis.js     Analisador: onsets → BPM → seções → tema (espectro)
    audio.js        Download/decode com cadeia de fallback CORS
    http.js         fetch JSON com proxies CORS (compartilhado)
    search.js       Busca Spotify (catálogo completo) + Deezer/iTunes
    spotify.js      Token anônimo do player web + metadata da API do Spotify
    youtube.js      Extração YouTube (fallback, desde 2026 os públicos estão bloqueados)
  backend.js      Cliente do backend próprio (yt-dlp) — search + stream da faixa inteira

server/
  server.mjs      Backend zero-dependência: /api/health, /api/search, /api/stream/<id>
  ytdlp.js        Parser do yt-dlp + rankeamento por duração (testável)
  Dockerfile      Deploy com yt-dlp + ffmpeg (Railway/Render/VPS)
    fx.js           SFX sintetizados (Web Audio)
    rng.js          PRNG determinístico (mulberry32)
  game/
    levelgen.js     Conversão eventos musicais → obstáculos + relógio do mundo
    engine.js       Loop, física, colisões justas, sync com o áudio
    renderer.js     Canvas 2D neon: parallax, pulso na batida, partículas
    particles.js    Pool de partículas
  ui/
    screens.js      Telas (home, loading, jogo, overlays)
  demo/
    demotrack.js    Faixa demo sintetizada offline (128 BPM)
  main.js           Orquestrador
```

**Modo Batida (detalhes):**
- A física é derivada do BPM: `v = 4h/T`, `g = 8h/T²` com `T = 60/BPM` → o arco do pulo dura exatamente 1 batida (altura fixa de 1.9 células).
- Cada espinho é plantado no **meio da batida** (`beat + T/2`) — o pico do pulo. Tocar na batida N passa por cima do espinho e aterrissa na batida N+1.
- Densidade segue a seção: drop ≈ toda batida, build a cada 2, flow a cada 3, intro/break sem obstáculos.
- Timing: PERFEITO ±60ms, BOM ±150ms, tolerância total ±~0.3 batida (bem perdoável). O anel ao redor do cubo fecha exatamente na batida (guia visual).
- Só usa espinhos de 1 célula (com arco de 1 batida, obstáculos largos fariam aterrissar neles).

**Mecânica:**
- Rotação do cubo sincronizada: no modo batida gira exatamente 90° por pulo (aterrissa "de pé").
- Squash & stretch (estica no pulo, espreme na aterrissagem), faíscas de **near-miss** ("QUASE! 💨" soma no combo **e em pontos**), vibração no celular (perfect/marco/escudo/morte), feedback visual de timing.
- **Multiplicador de pontuação por combo** (degraus): 1x (padrão) → **2x** a partir de 10 de combo → **3x** a partir de 25 → **4x** a partir de 50. Cruzar um degrau dispara banner de "MARCO DE COMBO" na tela + vibração. Tudo converte por uma função central `registerHit()` (toques e near-misses).
- **Escudo 🛡️**: power-up raro (seções drop/build) que absorve **uma** colisão fatal e desaparece — dá um respiro no momento crítico.
- **Screen-shake reativo**: leve no near-miss, médio quando o escudo quebra, forte na morte.
- **Rastro neon**: posições recentes do jogador desenhadas como rastro atrás do cubo.
- **Variedade de obstáculos**: blocos 🟪 aparecem com mais frequência nas seções **build**; a abertura do nível é previsível (3 primeiros obstáculos = espinhos).
- **Checkpoints por seção musical** (BUILD/DROP…): morreu? "Retomar do DROP · 45%" recomeça a música exatamente ali (o áudio continua no tempo, sem dessincronizar).

**Visual (interface fora do canvas):**
- Tipografia própria: **Poppins** (texto) + **Space Grotesk** (títulos/HUD) via Google Fonts.
- Tela inicial com **cubo 3D animado flutuando** + glow de fundo pulsante.
- Cards de resultado, inputs e overlays (pausa/morte/vitória) com gradientes, bordas translúcidas e sombras.
- Botão de pausa no canto do canvas (conectado via `pointerdown`, sem delay de clique).

**Decisões-chave:**
- O **relógio do jogo é o relógio do áudio** (`AudioContext.currentTime`): posição do jogador,
  obstáculos e câmera derivam do tempo da música → sincronia perfeita.
- FFT/SPT feitos em **JS puro** → roda igual no Node (testável) e no navegador.
- Análise no dispositivo (privacidade; sem servidor).
- PWA puro (HTML5 Canvas + Web Audio) → sem loja para testar; pronto para Capacitor quando quiser publicar.

## 🖥️ Backend próprio — QUALQUER música inteira (recomendado)

As grandes gravadoras não liberam áudio para apps de terceiros e o YouTube bloqueia
extratores públicos (2026). A solução definitiva é **um servidor seu** rodando
[yt-dlp](https://github.com/yt-dlp/yt-dlp): o download deixa de acontecer no navegador
(bloqueado) e passa para a sua máquina/servidor.

```
# 1) Instale yt-dlp + ffmpeg
pip install yt-dlp            # ou: brew install yt-dlp; apt install yt-dlp
# ffmpeg também é necessário (na maioria dos SOs já vem)

# 2) Rode o backend (zero dependências, só Node 18+)
npm run server                # → http://localhost:8787

# 3) No app: painel "🖥️ Backend próprio" → cole o endereço → Testar
#    PC + celular na mesma rede: use http://IP-DO-PC:8787
#    Deploy na nuvem (HTTPS):  docker build -f server/Dockerfile -t rd-backend . && docker run -p 8787:8787 rd-backend
```

Com o backend conectado, a busca mostra os resultados **"Seu servidor"** no topo da seção
**MÚSICA COMPLETA** — qualquer faixa toca do início ao fim, e o "▶▶" das bibliotecas usa
ele primeiro (com rankeamento pela duração exata). Opcional: `RD_API_KEY=senha` protege o
endpoint público (o app envia `X-Rhythm-Dash-Key`).

> ⚠️ **Mixed content (importante neste preview):** o preview do Arena é `https`, e um
> backend local `http://` é bloqueado pelo navegador (por isso o app avisa "não consegui
> alcançar o backend"). Caminhos que funcionam:
> 1. **Túnel HTTPS (mais rápido p/ testar com o preview):**
>    `npx localtunnel --port 8787` ou `cloudflared tunnel --url http://localhost:8787`
>    → cole a URL `https://…` gerada no painel do app.
> 2. **Rodar tudo local:** `npm run server` + `npm run dev` na sua máquina e abra
>    `http://localhost:5174` (celular na mesma rede: `http://IP-DO-PC:5174`).
> 3. **Deploy fixo:** `docker build -f server/Dockerfile -t rd-backend . && docker run -p 8787:8787 rd-backend` (Railway/Render dão HTTPS).
> ⚖️ Use apenas com conteúdo próprio ou para uso pessoal; baixar músicas comerciais
> pode violar os termos do YouTube/direitos autorais.

## 📱 Publicar para outras pessoas (backend deles usarem o SEU)

Sim — todos os que instalarem o app podem usar seu backend. Basta preencher
`src/config.js` **antes do build**:

```js
export const DEFAULT_BACKEND_URL = 'https://seu-servidor.exemplo.com'; // HTTPS obrigatório
export const DEFAULT_BACKEND_KEY = 'minha-super-senha';                // mesmo valor do RD_API_KEY
```

Depois `npm run build` (ou empacotamento Capacitor) → **cada instalação já nasce
apontando para o seu backend** (o usuário ainda pode trocar no painel).

**Antes de expor publicamente, saiba:**
- ⚠️ **Legal/ToS:** servir download de músicas comerciais viola os termos do YouTube e
  direitos autorais — a Play/App Store reprova esses apps. Use música própria,
  licenciada, ou deixe o backend só para uso pessoal/sua comunidade.
- ⚠️ **Custo/estabilidade:** cada música baixada consome banda e CPU do seu servidor;
  o YouTube bloqueia serviços públicos de download (foi isso que matou os extratores
  em 2026). Limite com `RD_MAX_STREAMS`, proteja com `RD_API_KEY` e prefira um
  provedor robusto.
- 🔒 A chave embutida no app pode ser extraída do bundle — sirva-a como proteção
  contra abuso casual, não como segurança absoluta.
- O app diferencia: backend do dono (padrão) e backend pessoal (configurável). Para
  uso pessoal, cada um ainda pode rodar o seu próprio `npm run server`.

## 🎶 Músicas completas LEGAIS para publicar (sem backend)

| Fonte | Como usar | Licença |
| --- | --- | --- |
| 📁 **Minhas músicas** | Aba exclusiva: o jogador adiciona os arquivos que JÁ TEM (inclusive famosas) → tocam completas, salvas no aparelho | Quem distribui é o usuário — loja-safe |
| 🎮 **Música do jogo** | 2 faixas completas geradas + troque por produção própria em `public/music/` + `manifest.json` | Sua produção /**
licenciada |
| 🎶 **Jamendo** | Chave grátis (devportal.jamendo.com) → `src/config.js` | Creative Commons, comercial |
| 🌐 **Audius / Internet Archive** | Já integrados na busca (seção verde "MÚSICA COMPLETA") | Abertas / CC |

> ⚖️ **Famosas:** nenhum app pode distribuir sucessos das gravadoras sem licença — é lei.
> O caminho real para o jogador: ele adiciona **o arquivo que já tem** (Minhas músicas) ou curte a
> **prévia de 30s** da busca. Para o jogo ter "as famosas" de fábrica, seria necessário um acordo de
> licenciamento (como Beat Saber/Rock Band fazem) — fora do alcance de um projeto independente.

## 🆕 Desta versão

- **Contagem regressiva 3-2-1** antes de iniciar/retomar (`src/game/countdown.js`, máquina de
  estados pura e testada; overlay com números animados e "tick" sonoro a cada número).
- **Sincronia clique↔batida**: janelas de julgamento musicais (`judgeWindowsForBeat`),
  **linha de hit** na tela e glow dos obstáculos pulsando no acento da batida.
- **Física real dos boosts**: pad estica o arco para **1,15 batidas** (`vy = 1,15·v`);
  orb faz air-jump **da altura atual** (novo arco partindo de `player.y` — o antigo
  "air-jump" teleportava o cubo para o chão).
- **Padrões rítmicos no levelgen** (`RHYTHM_PATTERNS`): *double*, *bloco+espinho* e
  *[pad, espinho]*, posicionados com a regra "sem beat ocupado duas vezes".
- **Modo paisagem no celular** (`src/core/orientation.js`): manifest em `landscape`,
  `screen.orientation.lock('landscape')` ao iniciar o jogo (com tela cheia no Android)
  e overlay **"Gire o celular"** quando um aparelho touch está em pé — fallback para
  navegadores sem suporte ao lock (ex.: Safari do iOS).
- **Badge da música** 🎵: título e artista aparecem numa pílula no canto durante o jogo.
- **Replay da morte** ☠: por ~1s a cena congela e um anel pulsante marca exatamente
  o obstáculo que te derrubou (`engine.lastKiller` + `drawDeathMarker`), antes do overlay.
- **Modo Turma** 🏫 (`src/game/turma.js`): placar local no mesmo celular — cada jogador
  toca a mesma música, um de cada vez, com telinha "passe o celular" entre as vezes e
  pódio final com 🥇🥈🥉 (ranking por % de progresso, desempate por score e combo).
  Estado salvo no aparelho; suporta revanche com a mesma turma.
- **Pausa automática** ao trocar de aba/aplicativo (`visibilitychange`) — sem dessincronia
  entre a música e o jogo ao voltar.
- **Calibração de latência do áudio** 🎧 (`src/core/latency.js`): fone Bluetooth atrasa o
  som — toque no ritmo dos 8 bipes e o jogo compensa o atraso nas janelas de
  PERFEITO/BOM (só o julgamento; o visual continua sincronizado ao relógio do áudio).
- **Recordes locais** 🏆 (`src/game/stats.js`): melhor score/combo/% por música salvo no
  aparelho, seção "Seus recordes" na home e selo de "Novo recorde!" na tela de vitória.
- **Fantasma da melhor tentativa** 👻 (`src/game/ghost.js`): a trajetória da sua melhor
  corrida em cada música vira um cubo translúcido correndo junto — só dados locais,
  amostrados a 20 Hz (salva quando você bate seu próprio recorde de progresso).
- **Botão "Instalar app"** 📲: aparece na home quando o navegador oferece a instalação
  do PWA (`beforeinstallprompt`) — sem precisar caçar no menu do navegador.
- **Resposta de toque reformulada** 👆: *input buffering* — toque dado no ar fica
  guardado por 180 ms e pula no instante da aterrissagem (julgado nesse momento);
  e **todo toque no chão pula** (estilo Geometry Dash) — fora da janela musical só
  não pontua/julga. Fim do "cliquei e não pulou".
- **Editor de mapas** 🛠️ (`src/ui/editor.js` + `src/game/mapstore.js`): linha do
  tempo da música com as seções coloridas; toque adiciona espinho/bloco/pad/orb/
  escudo/moeda (encaixe na meia-batida), toque no item apaga, arrastar rola.
  Botões **Testar** (joga na hora com a mesma música), **Salvar** (vale sempre
  para aquela música, no aparelho) e **Link** (compartilha o mapa via URL —
  `?mapa=…` base64). **Temas visuais** por música (Neon, Pôr-do-sol, Oceano,
  Vulcão, Matrix) recolorem cenário e obstáculos, tudo procedural em Canvas.

## 🚀 Próximos passos sugeridos

- Empacotar com **Capacitor** (Play Store / App Store)
- Editor visual de mapas + share de níveis
- Modo *practice* com checkpoints
- Leaderboard global por música

> Previews de 30s vêm de Deezer/iTunes (uso de amostra). Mapas são 100% gerados no aparelho.

---

## 📝 Nota desta reconstrução

Este projeto foi **reconstruído do zero** nesta sessão a partir do README acima (o código-fonte
de uma sessão anterior não estava disponível). A implementação segue fielmente a arquitetura,
fórmulas de física e decisões técnicas descritas, incluindo:

- FFT radix-2 própria + detecção de onsets por spectral flux + estimativa de BPM por
  autocorrelação (`src/core/fft.js`, `src/core/analysis.js`) — testados com `node --test`.
- Geração de nível determinística (PRNG mulberry32 com seed por hash da faixa) e física do
  pulo derivada do BPM (`src/game/levelgen.js`).
- Motor de jogo com relógio derivado do `AudioContext`, colisões justas, combo/near-miss,
  modos Batida/Livre (`src/game/engine.js`).
- Renderer Canvas 2D neon com parallax e pulso na batida (`src/game/renderer.js`).
- Busca agregada Spotify (token anônimo do player web) + Deezer/iTunes/Audius/Internet Archive,
  extração best-effort de YouTube com cadeia de fallback, e link direto (`src/core/*.js`).
- Backend próprio zero-dependência com yt-dlp para música completa (`server/`).
- PWA instalável (manifest + service worker) e testes automatizados (44 testes, `npm test`).

**Reforma de mecânica e visual (PR #2):** multiplicador de pontuação por combo com marcos
(2x/3x/4x), escudo 🛡️ que absorve uma colisão fatal, near-miss pontuado via `registerHit()`,
screen-shake reativo, rastro neon do jogador, blocos mais frequentes em builds, e o renderer
reescrevido em estética synthwave (sol pulsante, montanhas em parallax, grade em perspectiva,
cubo com rosto e halo de escudo, HUD translúcido) — junto com a interface em HTML/CSS
redesenhada (Poppins + Space Grotesk, cubo flutuante no menu, cards/overlays com gradiente).

**Limitações conhecidas** (dependem de serviços externos de terceiros, que mudam com o tempo):
- A extração pública do YouTube (Piped/Invidious/Cobalt) pode estar bloqueada — use o
  backend próprio (`npm run server`, requer `yt-dlp` instalado) para música completa garantida.
- As APIs de busca (Spotify/Deezer/iTunes/Audius/Internet Archive) exigem CORS liberado ou os
  proxies públicos configurados em `src/core/http.js`; em produção, prefira seu próprio proxy.

Se você recuperar o código-fonte original da outra sessão, é só me enviar (arquivos, ZIP, ou
link de um repositório/branch) que eu comparo e faço o merge com o que for necessário.
