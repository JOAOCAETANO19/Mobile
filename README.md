# Mobile
# 🎵 Rhythm Dash

Jogo mobile estilo **Geometry Dash** onde **a música gera o mapa**.

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
| 🎯 **Modo Batida** (*default*) | O pulo dura exatamente **1 batida**: toque quando o anel fecha (na batida) e o obstáculo passa no pico do pulo → **1 clique = 1 obstáculo = 1 batida**, com combo/PERFEITO |
| 🕹️ **Modo Livre** | Geometry Dash clássico: pule livremente sobre obstáculos (ainda sincronizados à música) |
| 🎨 **Tema da música** | Paleta de cada seção derivada do centróide espectral (sinestesia visual) |
| 🧱 **Geração determinística** | A mesma música sempre gera o mesmo mapa (seed = hash da faixa) |
| 📱 **PWA instalável** | Adicione à tela inicial (Android/iOS Safari) e jogue |
| 🎮 **Gameplay** | Espinhos, blocos, pads (amarelos), orbs (air-jump), coletáveis 💎 |

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
- Squash & stretch (estica no pulo, espreme na aterrissagem), faíscas de **near-miss** ("QUASE! 💨" soma no combo), vibração no celular (perfect/morte), feedback visual de timing.
- **Checkpoints por seção musical** (BUILD/DROP…): morreu? "Retomar do DROP · 45%" recomeça a música exatamente ali (o áudio continua no tempo, sem dessincronizar).

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
- PWA instalável (manifest + service worker) e testes automatizados (40 testes, `npm test`).

**Limitações conhecidas** (dependem de serviços externos de terceiros, que mudam com o tempo):
- A extração pública do YouTube (Piped/Invidious/Cobalt) pode estar bloqueada — use o
  backend próprio (`npm run server`, requer `yt-dlp` instalado) para música completa garantida.
- As APIs de busca (Spotify/Deezer/iTunes/Audius/Internet Archive) exigem CORS liberado ou os
  proxies públicos configurados em `src/core/http.js`; em produção, prefira seu próprio proxy.

Se você recuperar o código-fonte original da outra sessão, é só me enviar (arquivos, ZIP, ou
link de um repositório/branch) que eu comparo e faço o merge com o que for necessário.
