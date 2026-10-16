import { loadEnv } from 'vite'

// Chave do localStorage em que o supabase-js guarda a sessão: sb-<primeiro rótulo do host>-auth-token.
// É sb-127-auth-token com o Supabase local e sb-<ref>-auth-token com o hospedado. A URL é lida como o build
// (`react-router build`, modo production) lê: variáveis do processo primeiro, depois os arquivos .env*.
const url = loadEnv('production', process.cwd(), 'VITE_').VITE_SUPABASE_URL || 'http://127.0.0.1:54321'
export const authStorageKey = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`
