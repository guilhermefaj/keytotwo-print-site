// Trabalho depois da resposta (ex.: e-mail de entrega após o commit da liberação).
// Na Edge Function usa EdgeRuntime.waitUntil; os testes trocam o executor para aguardar as tarefas.
type Runner = (task: Promise<unknown>) => void

const defaultRunner: Runner = (task) => {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime
  if (runtime?.waitUntil) runtime.waitUntil(task)
}

let runner: Runner = defaultRunner

export function runInBackground(name: string, work: () => Promise<unknown>): void {
  runner(work().catch((error) => console.error(`${name}: falhou em segundo plano (${error instanceof Error ? error.name : 'erro'})`)))
}

export function setBackgroundRunner(next: Runner | null): void {
  runner = next ?? defaultRunner
}
