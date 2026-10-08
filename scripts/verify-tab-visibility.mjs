import { chromium, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// Playwright enables focused-page emulation on its pages, which masks native
// visibility changes. Use a separate, owned headless Chromium and raw CDP here.
// No document property override or synthetic visibilitychange event is used.
export async function verifyTabVisibility(url) {
  const tempRoot = path.resolve(os.tmpdir())
  const profile = await mkdtemp(path.join(tempRoot, 'kito-native-visibility-'))
  const chrome = spawn(chromium.executablePath(), [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', 'about:blank',
  ], { windowsHide: true })
  let socket, send
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  try {
    const endpoint = await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('Native Chromium startup timed out')), 15000)
      let stderr = ''
      chrome.stderr.on('data', chunk => {
        stderr += chunk
        const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)
        if (match) { clearTimeout(deadline); resolve(match[1]) }
      })
      chrome.on('error', error => { clearTimeout(deadline); reject(error) })
    })
    socket = new WebSocket(endpoint)
    await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
    let id = 0
    const pending = new Map()
    socket.addEventListener('message', event => {
      const value = JSON.parse(event.data)
      if (!pending.has(value.id)) return
      const { resolve, reject, deadline } = pending.get(value.id)
      pending.delete(value.id); clearTimeout(deadline)
      if (value.error) reject(new Error(JSON.stringify(value.error)))
      else resolve(value.result)
    })
    send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const key = ++id
      const deadline = setTimeout(() => { pending.delete(key); reject(new Error(`${method} timed out`)) }, 10000)
      pending.set(key, { resolve, reject, deadline })
      socket.send(JSON.stringify({ id: key, method, params, sessionId }))
    })
    const { targetId } = await send('Target.createTarget', { url })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false }, sessionId)
    const evaluate = async expression => {
      const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
      if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails))
      return response.result.value
    }
    const state = () => evaluate(`({ visibility: document.visibilityState,
      ...document.querySelector('.hero-scene-region')?.dataset,
      animations: [...document.querySelectorAll('.kito-track,.kito-frames')].map(el => ({
        time: el.getAnimations()[0].currentTime, state: el.getAnimations()[0].playState
      })) })`)
    async function waitState(check) {
      for (let attempt = 0; attempt < 100; attempt++) {
        const value = await state()
        if (check(value)) return value
        await pause(50)
      }
      throw new Error('Native tab visibility did not reach expected state')
    }
    await waitState(value => value.running === 'true' && value.visibility === 'visible')
    const other = await send('Target.createTarget', { url: 'about:blank' })
    await send('Target.activateTarget', { targetId: other.targetId })
    await waitState(value => value.visibility === 'hidden' && value.running === 'false')
    await pause(100)
    const hiddenBefore = await state()
    await pause(350)
    const hiddenAfter = await state()
    expect(hiddenAfter.animations).toEqual(hiddenBefore.animations)
    expect(hiddenAfter.animations.map(a => a.state)).toEqual(['paused', 'paused'])
    await send('Target.activateTarget', { targetId })
    const restored = await waitState(value => value.visibility === 'visible' && value.running === 'true')
    await pause(250)
    const moving = await state()
    expect(moving.animations[0].time).toBeGreaterThan(restored.animations[0].time + 100)
    await evaluate("document.querySelector('.motion-button').click()")
    await waitState(value => value.userPaused === 'true' && value.running === 'false')
    await pause(100)
    const manuallyPaused = await state()
    await send('Target.activateTarget', { targetId: other.targetId })
    await waitState(value => value.visibility === 'hidden')
    await send('Target.activateTarget', { targetId })
    const stillPaused = await waitState(value => value.visibility === 'visible')
    expect(stillPaused.userPaused).toBe('true')
    expect(stillPaused.running).toBe('false')
    expect(stillPaused.animations).toEqual(manuallyPaused.animations)
    return { method: 'Native headless Chromium tabs via raw CDP; no focus/visibility emulation', hiddenBefore, hiddenAfter, restored, stillPaused, status: 'PASS' }
  } finally {
    if (send && socket?.readyState === WebSocket.OPEN) await send('Browser.close').catch(() => {})
    socket?.close()
    await pause(300)
    if (chrome.exitCode === null) chrome.kill()
    // This exact directory was created by mkdtemp for this isolated test.
    if (path.dirname(profile) === tempRoot && path.basename(profile).startsWith('kito-native-visibility-')) {
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }
}
