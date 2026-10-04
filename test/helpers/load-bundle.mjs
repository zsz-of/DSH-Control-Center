/**
 * 测试用的客户端 bundle 装载器与替身。
 *
 * bundle 是 `window.__ModuleLoader__.load({...})` 形式的手写 CJS 注册，所以测试里把它当
 * **脚本文本**用 `new Function` 求值，再手动调 `factory(require)` —— 这样不需要浏览器、
 * 不需要打包器，而且 `require` 由测试自己控制（既能塞真 React，也能塞能抓错的手写替身）。
 *
 * @module test/helpers/load-bundle
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 生成的客户端 bundle 路径。 */
export const BUNDLE = join(HERE, '..', '..', 'lib', 'client.js')

/** 覆盖 Node 的全局对象（Node 24 的 `navigator` 是只读访问器，必须用 defineProperty）。 */
function defineGlobal(key, value) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
}

/** 一个最小的 localStorage 替身，可注入失败以验证降级路径。 */
export function createStorage({ fail = false } = {}) {
  const map = new Map()
  return {
    getItem(key) {
      if (fail) throw new Error('storage disabled')
      return map.has(key) ? map.get(key) : null
    },
    setItem(key, value) {
      if (fail) throw new Error('storage disabled')
      map.set(key, String(value))
    },
    removeItem(key) {
      map.delete(key)
    },
    /**
     * 标准 Storage 的枚举接口。
     *
     * 生产代码按标准接口遍历（`length` + `key(i)`）而不是 `Object.keys`：
     * 真实 `localStorage` 的键并不是自有可枚举属性，`Object.keys` 在浏览器里不可靠。
     */
    get length() {
      return map.size
    },
    key(index) {
      if (fail) throw new Error('storage disabled')
      return [...map.keys()][index] ?? null
    },
    /** 测试读取用。 */
    raw: map,
  }
}

/**
 * 手写 React 替身：`createElement` **直接调用函数组件**。
 *
 * 这么做能在 node 里跑完整渲染而不需要 DOM，而且能抓到「组件是 undefined」这类错误
 * （真实 React 的表现是整块白屏，很难定位）。
 *
 * 类组件（错误边界是唯一一种）必须真的被 `new` 出来再调 `render()`：本插件的原生座位外面
 * 套着一个错误边界，替身若不支持类组件，整个 bundle 连装载都会失败。
 * 替身**不模拟**错误边界语义（不会接住子树抛错）——那条路径交给真实 React 的 SSR 用例验证。
 *
 * @returns React 替身。
 */
export function createFakeReact() {
  class Component {
    constructor(props) {
      this.props = props ?? {}
      this.state = {}
    }

    setState(next) {
      this.state = { ...this.state, ...(typeof next === 'function' ? next(this.state, this.props) : next) }
    }

    render() {
      throw new Error('类组件必须实现 render')
    }
  }

  const react = {
    Component,
    createElement(type, props, ...children) {
      if (type === undefined || type === null) throw new Error('createElement 收到了未定义的组件（拼写错误或未导出）')
      const merged = { ...(props ?? {}) }
      if (children.length === 1) merged.children = children[0]
      else if (children.length > 1) merged.children = children
      if (typeof type === 'function') {
        if (type.prototype instanceof Component) return new type(merged).render()
        return type(merged)
      }
      return { type, props: merged }
    },
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useMemo: (factory) => factory(),
    useCallback: (callback) => callback,
    useRef: (initial) => ({ current: initial ?? null }),
    memo: (component) => component,
    /**
     * 上下文：替身**只支持默认值**。
     *
     * 真实 React 是先建 Provider 元素、再渲染子树；本替身是「`createElement` 直接调用组件」，
     * 子树的 `h(...)` 在 Provider 元素生成**之前**就求值完了，因此无法用压栈模拟值传播
     * （`useContext` 读到的永远是默认值）。
     * 需要验证真值传播的用例走真实 React 的 SSR（`client-render-react.test.js`），
     * 或者给组件传显式的 `seat` 测试接缝。
     */
    createContext(defaultValue) {
      const context = { _default: defaultValue }
      context.Provider = (props) => props.children ?? null
      context.Consumer = (props) => props.children(defaultValue)
      return context
    },
    useContext: (context) => (context === undefined || context === null ? null : context._default),
  }
  return react
}

/**
 * primitives 替身：取任何名字都得到一个「渲染 children 或 text」的组件。
 *
 * 之所以连 `text` 也渲染：`MarkdownText` 这类原语是**用 prop 传正文**的
 * （没有 children），纯 children 替身会让正文在断言里凭空消失。
 *
 * 唯一的例外是 `projectUserText`：真实原语是**投影函数**（`(text, sessionLabels,
 * slashNames, slashKind, references)` → 行内节点），不是组件。0.2 的用户气泡就是
 * `projectUserText(text, …)`，所以替身必须同样返回可以塞进 JSX 的东西（这里直接返回原文）。
 */
export function createPrimitivesStub() {
  return new Proxy(
    {},
    {
      get: (_target, key) => {
        if (key === 'then' || typeof key === 'symbol') return undefined
        if (key === 'projectUserText') return (text) => text
        return function Stub(props) {
          const given = props ?? {}
          const children =
            given.children !== undefined
              ? given.children
              : typeof given.text === 'string'
                ? given.text
                : undefined
          return { type: 'primitive', props: { name: String(key), children } }
        }
      },
    },
  )
}

/**
 * 装载 bundle 并返回它的导出对象。
 *
 * @param options - `react` / `primitives` 替身，`storage` 与 `document` 覆盖。
 * @returns `{exports, registration, requireCount}`。
 */
export async function loadBundle(options = {}) {
  const source = await readFile(BUNDLE, 'utf8')
  const react = options.react ?? createFakeReact()
  const primitives = options.primitives ?? createPrimitivesStub()
  const storage = options.storage ?? createStorage()
  const appendedStyles = []
  const elements = new Map()
  let registration
  const requested = []

  /* bundle 里的 `window` 是 `new Function` 的**形参**，不是 `globalThis.window`，
     所以测试要改 `matchMedia` 之类的全局时必须拿到这一个对象本身（下面作为 `window` 返回）。 */
  const windowObject = {
    __ModuleLoader__: {
      load(entry) {
        registration = entry
      },
    },
    localStorage: storage,
  }
  defineGlobal('window', windowObject)
  /* 极简 DOM：`getElementById` 认识 `head.appendChild` 过的带 id 节点，
     这样「按 id 去重注入样式」这类行为能被真实断言，而不是永远返回 null。
     `addEventListener` / `removeEventListener` 记账在案，测试可以自己把事件打回来
     （视图里「点外 / Esc 关闭下拉」这类全局监听只能这样验）。 */
  const documentListeners = new Map()
  const documentStub = {
    getElementById: (id) => elements.get(id) ?? null,
    createElement: () => ({ id: '', style: {}, dataset: {}, appendChild() {}, remove() {} }),
    head: {
      appendChild(node) {
        if (typeof node.id === 'string' && node.id !== '') elements.set(node.id, node)
        appendedStyles.push(node)
      },
    },
    body: { appendChild() {}, removeChild() {} },
    querySelector: () => null,
    addEventListener(type, handler) {
      const list = documentListeners.get(type) ?? []
      list.push(handler)
      documentListeners.set(type, list)
    },
    removeEventListener(type, handler) {
      const list = documentListeners.get(type) ?? []
      const index = list.indexOf(handler)
      if (index >= 0) list.splice(index, 1)
    },
  }
  defineGlobal('document', documentStub)
  defineGlobal('navigator', { userAgent: 'node-test' })

  new Function('window', 'document', 'navigator', source)(globalThis.window, globalThis.document, globalThis.navigator)

  if (registration === undefined) throw new Error('bundle 没有调用 window.__ModuleLoader__.load')
  const requireImpl = (id) => {
    requested.push(id)
    if (id === 'react') return react
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error(`测试未提供模块：${id}`)
  }
  return {
    exports: registration.factory(requireImpl),
    registration,
    requested,
    appendedStyles,
    storage,
    window: windowObject,
    document: documentStub,
    /** 把一次全局事件打给所有登记在案的监听器（模拟用户按 Esc / 点页面别处）。 */
    fireDocumentEvent(type, event) {
      for (const handler of [...(documentListeners.get(type) ?? [])]) handler(event)
    },
    /** 现在挂着几个某类全局监听（断言「收起时要摘掉」）。 */
    documentListenerCount(type) {
      return (documentListeners.get(type) ?? []).length
    },
  }
}

/**
 * 遍历手写渲染器产出的元素树，收集所有文本。
 *
 * @param element - `createElement` 的返回值。
 * @returns 拼接后的文本。
 */
export function collectText(element) {
  const parts = []
  const walk = (value) => {
    if (value === null || value === undefined || value === false || value === true) return
    if (typeof value === 'string' || typeof value === 'number') {
      parts.push(String(value))
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (typeof value === 'object' && value.props !== undefined) walk(value.props.children)
  }
  walk(element)
  return parts.join(' ')
}
