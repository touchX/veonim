import { onFnCall, onProp, Watchers, pascalCase } from '../utils'
import { Functions } from '../functions'
import { Session } from  './sessions'
import { sub } from '../dispatch'
import setupRPC from '../rpc'
import { Api } from '../api'

type GenericCallback = (...args: any[]) => void
type StrFnObj = { [index: string]: (callback: () => void) => void }
type DefineFunction = { [index: string]: (fnBody: TemplateStringsArray) => void }

const onReady = new Set<Function>()
const notifyReady = () => onReady.forEach(cb => cb())

const actionWatchers = new Watchers()
const io = new Worker(`${__dirname}/../workers/neovim-client.js`)
const { notify, request, on, onData } = setupRPC(m => io.postMessage(m))

io.onmessage = ({ data }: MessageEvent) => onData(data[0], data[1])
sub(Session.create, m => io.postMessage([65, m]))
sub(Session.switch, m => io.postMessage([66, m]))
sub(Session.create, () => notifyReady())
sub(Session.switch, () => notifyReady())

const req: Api = onFnCall((name: string, args: any[] = []) => request(name, args))
const api: Api = onFnCall((name: string, args: any[]) => notify(name, args))
const subscribe = (event: string, fn: (data: any) => void) => (on(event, fn), api.subscribe(event))

// TODO: buffer these calls: action/sub/define/autocmd until connected. don't make the client have to do it...
// TODO: and... how do we subscribe to all vim instances?
// TODO: on sessions: create run this
//subscribe('veonim', ([ event, args = [] ]) => actionWatchers.notify(event, ...args))

export const action = (event: string, cb: GenericCallback): void => actionWatchers.add(event, cb)
export const input = (keys: string) => api.input(keys)
export const cmd = (command: string) => api.command(command)
export const ex = (command: string) => req.commandOutput(command)
export const expr = (expression: string) => req.eval(expression)
export const call: Functions = onFnCall((name, args) => req.callFunction(name, args))
export const getCurrentLine = () => req.getCurrentLine()

export const g = new Proxy({}, {
  get: (_t, name: string) => req.getVar(name),
  set: (_t, name: string, val: any) => (api.setVar(name, val), true),
})

// TODO: and... how do we define in all vim instances?
export const define: DefineFunction = onProp((name: string) => (fn: TemplateStringsArray) => {
  const expr = fn[0]
    .split('\n')
    .filter(m => m)
    .join('\\n')
    .replace(/"/g, '\\"')

  cmd(`exe ":fun! ${pascalCase(name)}(...) range\n${expr}\nendfun"`)
})

// TODO: setup in all vim instances
// TODO: define augroup first
export const autocmd: StrFnObj = onFnCall((name, args) => {
  const ev = pascalCase(name)
  cmd(`au Veonim ${ev} * call rpcnotify(0, 'autocmd:${ev}')`)
  subscribe(`autocmd:${ev}`, args[0])
})
