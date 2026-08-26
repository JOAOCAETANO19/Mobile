// Configuração embutida no build — preencha antes de `npm run build` para que cada
// instalação do app já nasça apontando para o SEU backend (yt-dlp) e/ou chave da Jamendo.
// O usuário final ainda pode trocar o backend no painel "🖥️ Backend próprio" em tempo de execução.

export const DEFAULT_BACKEND_URL = ''; // ex: 'https://seu-servidor.exemplo.com' (HTTPS obrigatório)
export const DEFAULT_BACKEND_KEY = ''; // mesmo valor definido em RD_API_KEY no servidor

// Chave gratuita opcional para a Jamendo (Creative Commons, uso comercial permitido).
// Obtenha em https://devportal.jamendo.com
export const JAMENDO_CLIENT_ID = '';

export const APP_NAME = 'Rhythm Dash';
export const APP_VERSION = '0.1.0';
