// ============================================================================
// 验证脚本: 设计契约静态校验(docs/design/sodalive-ia-v1.html 的字面化)
//
// 为什么存在: 设计稿里的硬规则(令牌板、徽标档位、禁原生调色板、红不承载文字、
//   命名表、动效预算、双语键位)靠人肉逐屏看必然漏, 且改一处忘另一处不会报错。
//   这里把可静态判定的规则做成断言, 进 npm run verify 链, CI 上一起跑。
//
// 原则: 白名单是「有理由的例外」而非「暂时没修」。白名单条目一旦不再命中任何行,
//       视为该例外已失效, 直接 FAIL —— 防止白名单越攒越脏变成第二个债务账。
//
// 规则:
//   D1  徽标档位: 任何 badge 必须同带 badge-sm|badge-md(设计稿 3.3 R2, 同一视野只允许一档)
//   D2  档位锁死: badge-lg / pt--lg / size="lg" 不得出现(PlatTag 只有两档)
//   D3  禁原生调色板: 渲染层不得出现 Tailwind 原生色(gray-500/red-400/sky-500 …)
//   D4  禁硬编码色值: class/style 里的 #hex 只允许白名单(GitHub 第三方品牌面 / 品牌横幅)
//   D5  纯色状态底仅限圆点·进度条·仅图标按钮: bg-live|ok|warn 无 alpha 时必须命中白名单
//   D6  状态色不承载文字: text-live|ok|warn(非 ink)仅限图标, 必须命中白名单
//   D7  命名表: 「潘达」不得出现在任何用户可见源(注释除外); 产品名恒为 SODALive
//   D8  令牌层完好: styles.css 保留 focus-visible 焦点环 / not-allowed / err-dark, tailwind 映射齐全
//   D9  双语对齐: 渲染层 zh↔en 键集合相等且占位符一致; 主进程 zh↔en 同理
//   D10 取词存在: 模板里所有字面 t('a.b') 与主进程 mt('a.b') 必须能在字典里取到
//   D11 动效预算: 无入场动画类(animate-pop), transition 时长不得超过 300ms
//   D12 可点必有为: 设置页 switch 瓷片(tileCls)必须挂 @click(tileCls 自带 cursor-pointer+hover)
//   D13 平台维度: PlatFilter counts 三档齐; 库恒为录制页内的一段(顶栏两条 tab, 旧深链仍重定向)
//   D14 白屏与最小窗宽: structuredClone 先 toRaw; 顶栏不换行不塌搜索框; 库 0 条不摆筛选
//   D15 首屏与空态: 不等官方登录校验; 未取到态说「校验中」; 空态有界且下一步可点; 页头按钮同档; 坞不重复渲染在播
//   D16 承载矩阵: 关注/取关四个现场各按其形态承载; 进度条全应用一条且只给有真分母的对象; 管线文案与码率差分按任务类型/字节实长走
//   D17 仓库卫生: tailwind 不留死令牌; 历史设计稿必带覆盖横幅; docs/ 不放二进制; README 双平台口径与 verify 链在案
//   D18 圆角档位: 模板只用 rounded-card|ctl|md|full, 禁任意值; CSS 里的 border-radius 只允许 5/6/10/14/999/50%
//   D19 平台色点: 全应用一处 .pdot 规格(7px + ink3 描边), 组件不得再自画第二档
//   D20 计数药丸: 顶栏两枚同用 .platn, 视图分段用 .sec-n, 不得手搓 min-w+rounded-full
//   D21 等宽数字: 只有 tabular-nums 一种拼法(旧 .tnum 同义类已删), 覆盖面 ≥20 处
//   D22 naive 主题对齐: App.vue 的 LIGHT/DARK_OVERRIDES 每枚色值都能在 styles.css 语义变量里找到同名档
//   D23 品牌散文: 用户可见文案里不得出现小写 pandalive(那是枚举/目录名), 品牌形恒为 PandaLive
//   D24 动作行按钮: 自绘按钮必须用 h-* 锁档位, 不得用 py-[Npx] 撑高(与同行 naive 按钮实测差 6px 就是这么来的)
//   D25 设置保存链: 提交载荷先脱代理; 脏判定的基线是进页快照; 拒绝出声; 闸门/代理/窗口底色三处生效动作在案
//   D26 关于页身份: 作者/仓库/日志目录一律由 appInfo 下发, 渲染层不得写死(唯一定义处是 shared/appmeta.ts)
//   D27 段标题一档: 段标题只用 .sec-h, 卡内分组只用 .grp-h; 模板不得手搓 13px bold tracking-wide
//   D28 按钮宽度只锁下限: 按钮禁 !w-[Npx](定宽裁翻译), 下限 !min-w-[Npx]; 例外仅限表单列宽与弹窗宽
//   D29 筛选条不能被自己筛掉: 出现条件看基数(三视图同口径「词已生效 · chip 未生效」), 筛空的墙必带「取消筛选」
//   D30 空态文案与出口同一判据: 墙上的归因由 emptyAction 单点决定, 点到搜索词就必须给出「清除搜索」
//   D31 播放页返回从哪来回哪去: 读历史栈落回 ?view= / 录制页, 栈空或跨平台才兜底本平台直播页, 文案与目的地同源
// ============================================================================
import * as fs from 'fs'
import * as path from 'path'
import { createRequire } from 'module'

const ROOT = path.resolve(import.meta.dirname, '..')
const R = (...p) => path.join(ROOT, ...p)

let PASS = 0
let FAIL = 0
const fails = []
function assert(cond, name, detail) {
  if (cond) {
    PASS++
    console.log(`  [PASS] ${name}`)
  } else {
    FAIL++
    fails.push(name)
    console.log(`  [FAIL] ${name}${detail ? `\n         ${detail}` : ''}`)
  }
}

// ---------- 文件收集 ----------
function walk(dir, re) {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p, re))
    else if (re.test(e.name)) out.push(p)
  }
  return out
}
const rel = (abs) => path.relative(ROOT, abs).replace(/\\/g, '/')
const RENDERER = walk(R('src', 'renderer', 'src'), /\.(vue|ts|css)$/)
const SRC_ALL = walk(R('src'), /\.(vue|ts)$/)
const linesOf = (abs) => fs.readFileSync(abs, 'utf8').split(/\r?\n/)
/** 逐行回调: (文件, 行号1基, 行内容) */
function eachLine(files, fn) {
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8')
    text.split(/\r?\n/).forEach((l, i) => fn(f, i + 1, l, text))
  }
}
/** 该行是否是纯注释行(含块注释续行 ` * `) —— 注释里允许出现禁用词, 说明规则本身就要提它 */
function isCommentLine(l) {
  const t = l.trim()
  return t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('<!--')
}

const loc = (f, n) => `${rel(f)}:${n}`

// ---------- 白名单机制: 每条必须命中, 否则 FAIL ----------
function checkWithAllowlist(title, files, detector, allowlist) {
  const hits = []
  eachLine(files, (f, n, l) => {
    const bad = detector(l, f)
    if (bad) hits.push({ f, n, line: l.trim(), why: bad })
  })
  const consumed = new Set()
  const unjustified = []
  for (const h of hits) {
    const entry = allowlist.find((a) => rel(h.f) === a.file && a.re.test(h.line))
    if (!entry) unjustified.push(h)
    else consumed.add(a_key(entry))
  }
  const unused = allowlist.filter((a) => !consumed.has(a_key(a)))
  assert(
    unjustified.length === 0,
    title,
    unjustified.slice(0, 12).map((h) => `${loc(h.f, h.n)} [${h.why}] ${h.line.slice(0, 110)}`).join('\n         ')
  )
  assert(
    unused.length === 0,
    `${title} —— 白名单条目全部仍在用(失效例外必须删)`,
    unused.map((a) => `${a.file} :: ${String(a.re)} (${a.why})`).join('\n         ')
  )
}
const a_key = (a) => `${a.file}|${String(a.re)}`

// ============================================================================
// D1 / D2 徽标档位
// ============================================================================
{
  const bad = []
  eachLine(RENDERER.filter((f) => f.endsWith('.vue')), (f, n, l) => {
    // 只认 class 令牌里的 badge: 对象字段 `badge:` 与 `x.badge` 不是徽标类
    const isClassToken = /\bbadge\b(?!-)[^:]/.test(l) && !/\bbadge\s*:/.test(l) && !/[.\w$]badge\b/.test(l)
    if (isClassToken && !/badge-(sm|md)\b/.test(l)) bad.push(`${loc(f, n)} ${l.trim().slice(0, 110)}`)
  })
  assert(bad.length === 0, 'D1 每个 badge 都带档位 badge-sm|badge-md(3.3 R2)', bad.slice(0, 10).join('\n         '))

  const lg = []
  for (const f of RENDERER) {
    const t = fs.readFileSync(f, 'utf8')
    for (const re of [/badge-lg/g, /pt--lg/g, /size="lg"/g, /\|\s*'lg'/g]) {
      t.split(/\r?\n/).forEach((l, i) => {
        if (re.test(l)) lg.push(`${loc(f, i + 1)} ${l.trim().slice(0, 110)}`)
      })
    }
  }
  assert(lg.length === 0, 'D2 徽标只有两档: 无 badge-lg / pt--lg / size="lg"', lg.slice(0, 10).join('\n         '))
}

// ============================================================================
// D3 禁原生 Tailwind 调色板
// ============================================================================
{
  const PAL =
    /\b(?:bg|text|border|ring|from|to|via|divide|fill|stroke|shadow|outline|placeholder|accent|caret)-(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/
  const bad = []
  eachLine(RENDERER, (f, n, l) => {
    const m = l.match(PAL)
    if (m) bad.push(`${loc(f, n)} ${m[0]} :: ${l.trim().slice(0, 100)}`)
  })
  assert(bad.length === 0, 'D3 渲染层零原生 Tailwind 色(一切颜色走令牌板)', bad.slice(0, 12).join('\n         '))
}

// ============================================================================
// D4 硬编码色值白名单
// ============================================================================
checkWithAllowlist(
  'D4 class/style 里的 #hex 仅限白名单例外',
  RENDERER.filter((f) => f.endsWith('.vue')),
  (l) => {
    const inClass = /class="[^"]*#[0-9a-fA-F]{3,8}/.test(l)
    const inStyle = /style="[^"]*#[0-9a-fA-F]{3,8}/.test(l)
    return inClass ? 'class 内硬编码色' : inStyle ? 'style 内硬编码色' : null
  },
  [
    {
      file: 'src/renderer/src/views/SettingsView.vue',
      re: /style="background: linear-gradient\(115deg, #243a5e/,
      why: '品牌横幅渐变: Tailwind 任意值类无法表达三段渐变, 且该面恒为深底白字'
    }
  ]
)

// ============================================================================
// D5 纯色状态底仅限圆点 / 进度条 / 仅图标按钮
// ============================================================================
checkWithAllowlist(
  'D5 纯色 bg-live|bg-ok|bg-warn 仅限色点·进度条·仅图标控件',
  RENDERER.filter((f) => f.endsWith('.vue')),
  (l) => {
    const m = l.match(/\b(?:bg)-(?:live|ok|warn)\b(?![-\w/])/)
    return m ? '纯色状态底(3.91:1 / 2.89:1, 不得承载文字)' : null
  },
  [
    { file: 'src/renderer/src/components/LiveCard.vue', re: /rounded-full bg-live animate-breathe/, why: '在播/录制色点' },
    { file: 'src/renderer/src/components/LiveCard.vue', re: /'bg-live text-white'/, why: '停止录制按钮(仅图标, 白字压 live 是刻意与在播态同色)' },
    { file: 'src/renderer/src/components/LiveDock.vue', re: /rounded-full bg-live animate-breathe/, why: '在播坞色点' },
    { file: 'src/renderer/src/components/TopNav.vue', re: /watcherState\.tone === 'bad' \? 'bg-live'/, why: '监控心跳状态点(文字在点外, 用 ink)' },
    { file: 'src/renderer/src/components/TopNav.vue', re: /account\.live \? 'bg-okink' : 'bg-warn'/, why: '账号登录态点' },
    { file: 'src/renderer/src/views/AccountView.vue', re: /dot: 'bg-(ok|warn)( animate-breathe)?'/, why: '登录态色点字段' },
    { file: 'src/renderer/src/views/PlayerView.vue', re: /rounded-full bg-live animate-breathe/, why: 'REC 色点' },
    { file: 'src/renderer/src/components/LibrarySection.vue', re: /rounded-full bg-live grid place-items-center text-white/, why: '海报卡 hover 播放钮(仅 ▶ 字形, 与 LiveCard 停止录制钮同一档)' },
    { file: 'src/renderer/src/views/RecordingsView.vue', re: /rounded-full bg-live"/, why: '在录统计色点' },
    { file: 'src/renderer/src/views/RecordingsView.vue', re: /'bg-brand' : 'bg-live'/, why: '录制进度条填充(live 允许用于进度条, 设计稿 3.3 R3)' },
    { file: 'src/renderer/src/views/RecordingsView.vue', re: /'bg-warn' : 'bg-live'/, why: '监控总览的轮询色点(状态文字在点外, 用 ink)' },
    { file: 'src/renderer/src/views/WorkspaceView.vue', re: /'bg-live animate-breathe' : 'bg-dec/, why: '在播视图计数色点' }
  ]
)

// ============================================================================
// D6 状态色不承载文字
// ============================================================================
checkWithAllowlist(
  'D6 text-live|ok|warn(非 ink) 仅限图标',
  RENDERER.filter((f) => f.endsWith('.vue')),
  (l) => {
    const m = l.match(/\btext-(?:live|ok|warn)\b(?![-\w/])/)
    return m ? '状态色文字(承载文字必须用 ink 阶, 6.52:1)' : null
  },
  [
    { file: 'src/renderer/src/components/LiveCard.vue', re: /h-3\.5 text-live shrink-0/, why: '关注心形图标' },
    { file: 'src/renderer/src/components/ExploreCard.vue', re: /'text-live' : 'text-ink2'/, why: '关注心形图标' }
  ]
)

// ============================================================================
// D7 命名表
// ============================================================================
{
  const bad = []
  for (const f of SRC_ALL) {
    fs.readFileSync(f, 'utf8')
      .split(/\r?\n/)
      .forEach((l, i) => {
        if (l.includes('潘达') && !isCommentLine(l) && !/一律不出现|避免各处|曾经/.test(l))
          bad.push(`${loc(f, i + 1)} ${l.trim().slice(0, 100)}`)
      })
  }
  assert(bad.length === 0, 'D7a 「潘达」不出现在用户可见源(命名表 5.2)', bad.slice(0, 8).join('\n         '))

  const pkg = JSON.parse(fs.readFileSync(R('package.json'), 'utf8'))
  const yml = fs.readFileSync(R('electron-builder.yml'), 'utf8')
  const html = fs.readFileSync(R('src', 'renderer', 'index.html'), 'utf8')
  assert(/productName: SODALive Monitor/.test(yml), 'D7b electron-builder productName = SODALive Monitor')
  assert(/<title>SODALive Monitor<\/title>/.test(html), 'D7c 窗口标题 = SODALive Monitor')
  assert(pkg.description.includes('SODALive'), 'D7d package.json description 用 SODALive')
  const topnav = fs.readFileSync(R('src', 'renderer', 'src', 'components', 'TopNav.vue'), 'utf8')
  assert(/>SODALive<\/div>/.test(topnav), 'D7e 顶栏品牌字标 = SODALive')
  // 平台技术标识不许被顺手改名(枚举/服务/分区/目录)
  assert(/'pandalive'/.test(fs.readFileSync(R('src', 'shared', 'types.ts'), 'utf8')), 'D7f 平台枚举 pandalive 未被改名(技术标识不动)')
  assert(fs.existsSync(R('src', 'main', 'services', 'pandalive.ts')), 'D7g src/main/services/pandalive.ts 仍在(技术标识不动)')
}

// ============================================================================
// D8 令牌层完好
// ============================================================================
{
  const css = fs.readFileSync(R('src', 'renderer', 'src', 'styles.css'), 'utf8')
  const tw = fs.readFileSync(R('tailwind.config.js'), 'utf8')
  assert(/:focus-visible/.test(css) && /outline/.test(css), 'D8a 全局键盘焦点环存在(9. 可达性)')
  assert(/cursor: not-allowed/.test(css), 'D8b 统一禁用态光标存在')
  assert(/--c-err-dark:/.test(css), 'D8c 暗场专用亮红 --c-err-dark 已定义(黑底错误文字)')
  assert(/--c-live-ink:|--c-ok-ink:|--c-warn-ink:/.test(css), 'D8d ink 阶(承载文字的状态色)已定义')
  for (const k of ['liveink', 'okink', 'warnink', 'onimg', 'errdark', 'brand']) {
    assert(new RegExp(`\\b${k}:`).test(tw) || new RegExp(`\\b${k}: \\{`).test(tw) || new RegExp(`\\b${k}:`).test(tw), `D8e tailwind 映射 ${k}`)
  }
  assert(/\.badge-sm\b/.test(css) && /\.badge-md\b/.test(css) && !/\.badge-lg\b/.test(css), 'D8f 徽标两档样式定义齐全且无第三档')
}

// ============================================================================
// D9 / D10 双语对齐 + 取词存在
// ============================================================================
/** locale 文件是纯字面量模块, 直接求值即可(不引 sucrase, 因为里面没有 TS 语法) */
function evalDefault(file) {
  const src = fs.readFileSync(file, 'utf8')
  if (/^\s*import\s/m.test(src)) throw new Error(`${rel(file)} 含 import, 无法作为纯字面量求值`)
  return new Function(src.replace(/export default/, 'return'))()
}
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object') flatten(v, key, out)
    else out[key] = String(v)
  }
  return out
}
const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')

{
  const zh = flatten(evalDefault(R('src', 'renderer', 'src', 'i18n', 'locales', 'zh-CN.ts')))
  const en = flatten(evalDefault(R('src', 'renderer', 'src', 'i18n', 'locales', 'en-US.ts')))
  const onlyZh = Object.keys(zh).filter((k) => !(k in en))
  const onlyEn = Object.keys(en).filter((k) => !(k in zh))
  assert(onlyZh.length === 0, 'D9a 渲染层: 中文有键英文必有', onlyZh.slice(0, 10).join(', '))
  assert(onlyEn.length === 0, 'D9b 渲染层: 英文有键中文必有', onlyEn.slice(0, 10).join(', '))
  const phDiff = Object.keys(zh).filter((k) => k in en && ph(zh[k]) !== ph(en[k]))
  assert(phDiff.length === 0, 'D9c 渲染层: 同键占位符一致', phDiff.slice(0, 10).map((k) => `${k}: {${ph(zh[k])}} vs {${ph(en[k])}}`).join('\n         '))

  // 主进程字典: const zh: Dict = { 'a.b': '...' } 平铺
  const mainSrc = fs.readFileSync(R('src', 'main', 'i18n.ts'), 'utf8')
  const dictOf = (name) => {
    const m = new RegExp(`const ${name}: Dict = \\{([\\s\\S]*?)\\n\\}`, 'm').exec(mainSrc)
    if (!m) throw new Error(`主进程字典 ${name} 未找到`)
    // 值可能是单引号也可能是双引号(文案内含撇号时作者会换引号), 两种都收
    const out = {}
    for (const x of m[1].matchAll(/^\s*'([^']+)':\s*(['"])((?:\\.|(?!\2)[^])+)\2/gm)) out[x[1]] = x[3]
    return out
  }
  const mzh = dictOf('zh')
  const men = dictOf('en')
  const mOnlyZh = Object.keys(mzh).filter((k) => !(k in men))
  const mOnlyEn = Object.keys(men).filter((k) => !(k in mzh))
  assert(mOnlyZh.length === 0, 'D9d 主进程: 中文有键英文必有', mOnlyZh.slice(0, 10).join(', '))
  assert(mOnlyEn.length === 0, 'D9e 主进程: 英文有键中文必有', mOnlyEn.slice(0, 10).join(', '))
  // 解析器静默漏读会让上面两条「假绿」: 键数下限兜住
  assert(Object.keys(mzh).length > 120 && Object.keys(men).length > 120, 'D9f 主进程字典解析键数合理(两字典各 >120 键)', `zh=${Object.keys(mzh).length} en=${Object.keys(men).length}`)
  const mPhDiff = Object.keys(mzh).filter((k) => k in men && ph(mzh[k]) !== ph(men[k]))
  assert(mPhDiff.length === 0, 'D9g 主进程: 同键占位符一致', mPhDiff.slice(0, 10).map((k) => `${k}: {${ph(mzh[k])}} vs {${ph(men[k])}}`).join('\n         '))

  // D10 字面取词键必须存在(动态拼接 key 不在此列)
  const keyRe = /(?<![A-Za-z0-9_$])t\(\s*'([A-Za-z][\w]*(?:\.[\w]+)+)'/g
  const missR = []
  for (const f of RENDERER) {
    const t = fs.readFileSync(f, 'utf8')
    for (const m of t.matchAll(keyRe)) if (!(m[1] in zh)) missR.push(`${rel(f)} :: t('${m[1]}')`)
  }
  assert(missR.length === 0, 'D10a 渲染层所有字面 t() 键在中文字典存在', [...new Set(missR)].slice(0, 12).join('\n         '))

  const mtRe = /(?<![A-Za-z0-9_$])mt\(\s*'([A-Za-z][\w]*(?:\.[\w]+)+)'/g
  const missM = []
  for (const f of walk(R('src', 'main'), /\.ts$/)) {
    const t = fs.readFileSync(f, 'utf8')
    for (const m of t.matchAll(mtRe)) if (!(m[1] in mzh)) missM.push(`${rel(f)} :: mt('${m[1]}')`)
  }
  assert(missM.length === 0, 'D10b 主进程所有字面 mt() 键在字典存在', [...new Set(missM)].slice(0, 12).join('\n         '))

  // 删除键的连带检查: 字典里没被任何地方字面引用、也没被动态前缀引用的 key 允许存在(动态取词很多),
  // 但反过来 —— 模板里引用了却被删掉的键 —— 已由 D10a 拦住, 这里补一条: 孤儿中文键只做提示不断言
  const unusedZh = Object.keys(zh).filter((k) => {
    const leaf = k.split('.').pop()
    return !SRC_ALL.some((f) => fs.readFileSync(f, 'utf8').includes(`'${k}'`) || new RegExp(`\\.${leaf}\\b`).test(''))
  })
  if (unusedZh.length) console.log(`  [INFO] 渲染层中文键未见字面引用(${unusedZh.length} 个, 动态拼接取词属正常): ${unusedZh.slice(0, 8).join(', ')}`)
}

// ============================================================================
// D11 动效预算(3.4: 只允许颜色/阴影 150ms 与按下 scale; 无入场动画)
// ============================================================================
{
  const bad = []
  eachLine(RENDERER, (f, n, l) => {
    if (/\banimate-pop\b/.test(l)) bad.push(`${loc(f, n)} 入场动画 animate-pop`)
    const m = l.match(/\bduration-\[?(\d+)\]?/)
    if (m && Number(m[1]) > 300) bad.push(`${loc(f, n)} duration-${m[1]} 超过 300ms 预算`)
  })
  assert(bad.length === 0, 'D11 动效预算: 无入场动画、无 >300ms 过渡', bad.slice(0, 10).join('\n         '))
  const tw = fs.readFileSync(R('tailwind.config.js'), 'utf8')
  assert(!/pop:/.test(tw), 'D11b tailwind 里 pop 关键帧已随规则清除(不留死令牌)')
}

// ============================================================================
// D12 可点必有为: 设置页 switch 瓷片
// ============================================================================
{
  const f = R('src', 'renderer', 'src', 'views', 'SettingsView.vue')
  const bad = []
  linesOf(f).forEach((l, i) => {
    if (/:class="tileCls"/.test(l) && !/@click=/.test(l)) bad.push(`${loc(f, i + 1)} ${l.trim().slice(0, 120)}`)
  })
  assert(bad.length === 0, 'D12 设置页每块可点瓷片都挂了点击行为(tileCls 含 cursor-pointer+hover)', bad.slice(0, 10).join('\n         '))
  const src = fs.readFileSync(f, 'utf8')
  assert(/function tileClick\(/.test(src), 'D12b 瓷片点击开关的处理函数存在')
  const nTiles = (src.match(/:class="tileCls"/g) || []).length
  const nClicks = (src.match(/@click="tileClick\(/g) || []).length
  assert(nTiles === nClicks && nTiles > 0, 'D12c 瓷片数 == 绑定数', `${nTiles} 瓷片 / ${nClicks} 绑定`)
}

// ============================================================================
// D13 平台维度: PlatFilter counts 三档齐 + 库的归属(录制页内一段, 无独立页)
// ============================================================================
{
  const users = RENDERER.filter((f) => f.endsWith('.vue') && /<PlatFilter[^>]*:counts=/.test(fs.readFileSync(f, 'utf8')))
  assert(users.length >= 1, 'D13a 库分段给 PlatFilter 传 counts(4.2② 平台分解)', users.map(rel).join(', '))
  const missing = users.filter((f) => {
    const t = fs.readFileSync(f, 'utf8')
    return !/all:/.test(t) || !/pandalive:/.test(t) || !/soop:/.test(t)
  })
  assert(missing.length === 0, 'D13b counts 对象三档(all/pandalive/soop)齐', missing.map(rel).join(', '))

  // 库不是第三页: 顶栏只两条 tab, 录制页里没有平台 tab(它没有「在播/发现/离线」那种视图)
  const rec = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'RecordingsView.vue'), 'utf8')
  const nav = fs.readFileSync(R('src', 'renderer', 'src', 'components', 'TopNav.vue'), 'utf8')
  const rt = fs.readFileSync(R('src', 'renderer', 'src', 'router.ts'), 'utf8')
  assert(/<LibrarySection/.test(rec), "D13c 录制页内嵌「库」分段(历史任务不另立概念)")
  assert(!/<PlatFilter/.test(rec), "D13d 录制页本身没有平台 tab(它不是工作区页)")
  assert(!/name:\s*'library'/.test(rt), "D13e 路由里没有独立的 library 页(旧 /:plat/library 只能是重定向)")
  assert(/\/library['`][^\n]*redirect/.test(rt), 'D13f 旧库深链仍有重定向(用户历史卡片不能落空白页)')
  const tabNames = [...nav.matchAll(/\{ name: '(\w+)', label: t\('nav\./g)].map((m) => m[1])
  assert(tabNames.join(',') === 'live,recordings', 'D13g 顶栏恰好两条页面 tab', tabNames.join(','))
}

// ============================================================================
// D14 白屏与最小窗宽契约(2026-09-30 实机截图审查后补: 三条都是当场看到的真故障)
// ============================================================================
{
  // ① 设置页整屏空白: structuredClone 吃 Pinia 响应式代理会抛 DataCloneError,
  //    抛在 setup 的 immediate watch 里 = 该页 v-if 永远不成立 = 白屏
  const clones = []
  for (const f of RENDERER) {
    linesOf(f).forEach((l, i) => {
      if (/structuredClone\(/.test(l)) clones.push({ at: `${rel(f)}:${i + 1}`, ok: /toRaw\(/.test(l) })
    })
  }
  const rawLess = clones.filter((c) => !c.ok)
  assert(
    clones.length > 0 && rawLess.length === 0,
    'D14a 渲染层 structuredClone 一律先 toRaw(响应式代理不可克隆)',
    rawLess.map((c) => c.at).join(', ') || `${clones.length} 处全部合规`
  )

  // ② 顶栏在最小窗宽(1024)下的溢出: 页面 tab 不许换行, 搜索框不许塌成纯图标
  const css = fs.readFileSync(R('src', 'renderer', 'src', 'styles.css'), 'utf8')
  const navTab = /\.nav-tab\s*\{[^}]*\}/.exec(css)?.[0] || ''
  assert(/white-space:\s*nowrap/.test(navTab), 'D14b .nav-tab 禁换行(否则「直播」竖排两行, 顶栏溢出 57px)')
  const nav = fs.readFileSync(R('src', 'renderer', 'src', 'components', 'TopNav.vue'), 'utf8')
  assert(/flex-1\s+min-w-\[\d+px\]/.test(nav), 'D14c 顶栏搜索框有 min-width 下限(右侧是 shrink-0 固定段, 无下限就被压扁)')
  const win = fs.readFileSync(R('src', 'main', 'index.ts'), 'utf8')
  const minW = Number(/minWidth:\s*(\d+)/.exec(win)?.[1] || 0)
  assert(minW > 0, 'D14d 主窗口有 minWidth(界面审查的响应式下限就是它)', `minWidth=${minW}`)

  // ③ 库空态: 一条记录都没有时不许摆出一排筛选, 也不许把「还没录过」说成「筛错了」
  const lib = fs.readFileSync(R('src', 'renderer', 'src', 'components', 'LibrarySection.vue'), 'utf8')
  assert(/v-if="totalCount" class="sec-bar"/.test(lib), 'D14e 库为 0 条时段条(五枚 chip + 平台 + 分组 + 搜索)整条不出现')
  assert(!/emptyFilter[^"]*\?:|:. *t\('library\.emptyFilter'/.test(lib), 'D14f emptyFilter 不再被三元当全局空态用')
  assert(!/emptyNoDir|emptyGoLive/.test(lib), 'D14g 库空态收成一句事实(去向入口在录制页页头, 不再按有没有目录给两种下一步)')
}

// ============================================================================
// D15 冷启动不被网络按住在「加载中」空屏 (2026-09-30 实机: 冷启动前十几秒整屏只有一行小字)
// ============================================================================
{
  const app = fs.readFileSync(R('src', 'renderer', 'src', 'stores', 'app.ts'), 'utf8')
  const init = /async init\(\)\s*\{[\s\S]*?\n    \},/.exec(app)?.[0] || ''
  assert(init.length > 0, 'D15a 找得到 store.init()')
  const gate = /await Promise\.all\(\[([\s\S]*?)\]\)/.exec(init)?.[1] || ''
  assert(gate.length > 0 && !/authState/.test(gate), 'D15b 首屏就绪的门禁里只有本地取数(账号校验要发官方接口, 一进 await 就是全网卡整屏)', gate.replace(/\s+/g, ' ').trim())
  assert(/void api\.authState\(\)/.test(init), 'D15c 账号校验照发, 只是不阻塞: 结果经 EV.account 回挂')

  const ipc = fs.readFileSync(R('src', 'main', 'ipc.ts'), 'utf8')
  const push = /async function pushAccounts[\s\S]*?\n\}/.exec(ipc)?.[0] || ''
  assert(/Promise\.all\(\[pandaAccount\(\), soopAccount\(\)\]\)/.test(push), 'D15d 两平台登录态并行取(串行把最慢一方的等待叠两遍)')

  // 态没回来之前只能说「还没查」: 报成未登录会凭空劝人重登
  const nav = fs.readFileSync(R('src', 'renderer', 'src', 'components', 'TopNav.vue'), 'utf8')
  assert((nav.match(/t\('nav\.checking'\)/g) || []).length === 2, 'D15e 顶栏两平台在态未回来时都显示「校验中」')
  const acct = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'AccountView.vue'), 'utf8')
  // 2026-09-30 账号页重设计: 一屏只留一套平台切换(顶栏)、一张动作卡、一句存储说明
  assert(!/<PlatFilter/.test(acct), 'D15f 账号页不自备第二套平台分段(换方归顶栏, 页内只标注当前是哪一方)')
  assert(/page === 'account'[\s\S]{0,220}query: \{ \.\.\.route\.query, plat: target \}/.test(nav), 'D15f2 顶栏分段在账号页原地改 ?plat=(从前把人踢回直播页, 页面才被迫自备分段)')
  assert(!/states\?:|pf__state/.test(fs.readFileSync(R('src', 'renderer', 'src', 'components', 'PlatFilter.vue'), 'utf8')), 'D15f3 PlatFilter 的 states 通道随账号页分段一起退役(没有消费方就删干净)')
  const zhAcct = fs.readFileSync(R('src', 'renderer', 'src', 'i18n', 'locales', 'zh-CN.ts'), 'utf8')
  assert(!/badgeEnc:|mARec:|mCStable:|mBT1:|segOk:/.test(zhAcct), 'D15f4 冗余徽章(推荐/最稳定/加密存储)与分段状态字已删: 推荐由按钮档位说, 存储由页底 doorNote 说一次')
  assert(/t\('account\.stChecking'\)/.test(acct) && /mode: 'checking' as const/.test(acct), "D15g 账号页大状态卡有独立一档「正在校验」(不与 none 共用, 否则复检按钮会被一起藏掉)")
  assert(/v-if="status\.mode === 'ok' \|\| status\.mode === 'warn'"/.test(acct), "D15h 退出登录只在确实有会话时给(校验中摆红色退出是空承诺)")

  // 空态要有界: 整屏垂直居中的一行小字看起来像界面坏了
  const ws = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'WorkspaceView.vue'), 'utf8')
  assert(!/v-else class="h-full flex flex-col items-center justify-center"/.test(ws), 'D15i 工作区空墙收成有界卡(不再整屏居中)')
  assert(/border-dashed[\s\S]{0,120}py-16/.test(ws), 'D15j 空态卡与「库」「进行中」同一份有界规格')

  // 页头动作按钮档位: 两个页面页头曾是 medium 与 tiny 并存(全应用主流是 small)
  assert(!/size="medium"/.test(ws), 'D15k 直播页页头不用 medium')
  const rec = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'RecordingsView.vue'), 'utf8')
  assert(!/size="tiny"/.test(rec), 'D15l 录制页页头快捷入口不用 tiny(tiny 只留给设置页行内控件)')

  // ㉖ 在播坞: 站在「在播关注」视图时下方整屏卡片墙就是同一批房间, 坞在这里只是第二份呈现
  assert(/v-if="view !== 'live'"[\s\S]{0,90}<LiveDock/.test(ws), 'D15m 在播坞只在非在播视图出现(不重复渲染同一批在播房间)')
  const dock = fs.readFileSync(R('src', 'renderer', 'src', 'components', 'LiveDock.vue'), 'utf8')
  assert(!/onLiveView/.test(dock) && !/onLiveView/.test(ws), 'D15m2 onLiveView 已删: 收起后「全部在播」永远往别处跳, 无需自我指向开关')

  // ㉗′(2026-09-30 订正) 同一屏的同类入口只留一处: 录制页的快捷入口是页头右上角那一排
  //    (去直播页 / 打开保存目录 / 录制设置)。空态里再挂一枚同去向的按钮, 让人先判断该点哪个。
  assert(!/<template #extra>[\s\S]{0,300}<n-button/.test(rec), 'D15n 「进行中」空态不挂按钮, 只留指引句(去直播页由页头给)')
  const libsec = fs.readFileSync(R('src', 'renderer', 'src', 'components', 'LibrarySection.vue'), 'utf8')
  assert(!/gotoNextStep/.test(libsec), 'D15n2 库空态行只剩一句事实, 末尾链接撤掉(页头已有录制设置)')
  const zh = fs.readFileSync(R('src', 'renderer', 'src', 'i18n', 'locales', 'zh-CN.ts'), 'utf8')
  assert(
    !/emptyGoLive:/.test(zh) && !/emptyNoDir:/.test(zh) && !/emptyActiveHint: '到「直播」页/.test(zh),
    'D15n3 空态的去向说明文案键已删(链接没了, 句子也不必再报地址)'
  )

  // ㉘ 空槽要长满剩余视口: 数据为零时页面下半截是裸页面底, 与「坏了」只隔一层边框
  assert(/min-h-full flex flex-col/.test(rec), 'D15o 录制页正文列撑满视口(留白归给空槽而不是裸页面底)')
  assert(/flex-1 min-h-\[200px\][\s\S]{0,160}border-dashed/.test(rec), 'D15o2 「进行中」空态是会长高的空槽, 且有 min-h 兜住矮视口')
  assert(!/flex-1 min-h-\[200px\][\s\S]{0,160}place-items-center/.test(rec), 'D15o3 空槽内容贴顶不居中(居中=小字飘在 538px 框正中, 又回到 ㉕ 反对的样子)')
}

// ============================================================================
// D16 关注/取关承载矩阵 + 进度承载面 (2026-09-30 用真实数据 876 关注 / 24 在播逐点取证)
// ============================================================================
{
  const anchor = fs.readFileSync(R('src', 'renderer', 'src', 'components', 'AnchorCard.vue'), 'utf8')
  const explore = fs.readFileSync(R('src', 'renderer', 'src', 'components', 'ExploreCard.vue'), 'utf8')
  const player = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'PlayerView.vue'), 'utf8')
  const dock = fs.readFileSync(R('src', 'renderer', 'src', 'components', 'LiveDock.vue'), 'utf8')
  const ws = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'WorkspaceView.vue'), 'utf8')

  // ① 卡片形态的取关在「…」菜单里, 且菜单项是 button 不是 div+cursor-pointer(div 键盘到不了)
  assert(/<button[^>]*text-liveink[^>]*@click="emit\('remove'/.test(anchor), 'D16a 已关注卡片的取关在「…」菜单内, 且是可聚焦的 button')
  assert(!/<[a-z][^>]*cursor-pointer/.test(anchor), 'D16a2 卡片菜单不用 div 装按钮(同一动作在离线行上是 button, 在这里不能是不可 Tab 到的 div)')
  // ② 紧凑行形态的取关在行尾 ✕
  assert(/:title="t\('card\.unfollow'\)" @click="removeAnchor/.test(ws), 'D16b 离线关注行的取关是行尾按钮')
  // ③ 心形只出现在发现卡的 hoverActions(浏览现场), 且整仓只有这一枚
  assert(/#hoverActions[\s\S]*M12 21s/.test(explore), 'D16c 发现卡的心形挂在 hoverActions 里')
  const hearts = RENDERER.filter((f) => /M12 21s/.test(fs.readFileSync(f, 'utf8')))
  assert(hearts.length === 2, 'D16c2 全应用只有两枚心形(发现卡 + 卡片「已关注」标记), 取关不再新增第三种心形入口', hearts.map(rel).join(', '))
  // ④ 播放页是第四种承载: 取关态必须与其余三处同为红, 不能穿中性灰
  assert(/:type="following \? 'error' : 'primary'"/.test(player), 'D16d 播放页取关按钮用 error 档(卡片菜单/离线行/发现卡三处的取关都是红)')
  // ⑤ 在播坞不承载取关: 它是「一眼看全谁在播」的读数条, 不是管理现场
  assert(!/unfollow|anchorsRemove|removeAnchor/.test(dock), 'D16e 在播坞无取关承载(管理动作只在卡片菜单/离线行/播放页)')

  // ⑥ 进度承载面: 全应用一条 .meter, 且只给有真实分母的对象(VOD 下载全长来自 m3u8 清单)
  const css = fs.readFileSync(R('src', 'renderer', 'src', 'styles.css'), 'utf8')
  assert(/^\.meter\s*\{/m.test(css) && /^\.meter i\s*\{/m.test(css), 'D16f .meter 与其填充条在样式层有定义')
  const meters = []
  eachLine(RENDERER, (f, n, l) => { if (/class="[^"]*\bmeter\b/.test(l)) meters.push(`${rel(f)}:${n}`) })
  assert(meters.length === 1 && meters[0].includes('RecordingsView.vue'), 'D16g 全应用只有一处进度条(多一处就该问它有没有真分母)', meters.join(', '))
  const rec = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'RecordingsView.vue'), 'utf8')
  assert(/v-if="task\.vod"[\s\S]{0,400}class="w-\[88px\] meter"/.test(rec) && /vodPct\(task\) !== null/.test(rec), 'D16h .meter 只在回放分支内, 且被「清单给了真实全长」守卫兜住(拉不到全长退回纯文字)')
  assert(!/n-progress/.test(rec), 'D16h2 不引第二套进度控件(n-progress 与 .meter 并存=同一件事两种画法)')
  assert(/\{ key: 'fetch', label: t\(task\.vod \? 'rec\.pipeFetchVod' : 'rec\.pipeFetch'\) \}/.test(rec), 'D16i 管线首棒文案跟着任务类型走: 回放行不许写「拉取直播源」')
  assert(/if \(task\.bytes > p\.bytes\)[\s\S]{0,200}else\s*\{[\s\S]{0,200}next\[k\] = p/.test(rec), 'D16j 码率差分只在字节真长了时推进基线(按推送间隔算会把 8.4 Mbps 稳流读成 0.0↔26.1 跳变)')
  assert(!/Math\.max\(0, \(task\.bytes - p\.bytes\)/.test(rec), 'D16j2 退回旧写法(把无字节增长的推送算成 0 码率)即失败')
}

// ============================================================================
// D17 仓库卫生: 死令牌 / 无横幅的历史设计稿 / docs 里的二进制负重 / README 口径回潮
// ============================================================================
{
  const twCfg = createRequire(import.meta.url)(R('tailwind.config.js'))
  const ext = twCfg?.theme?.extend || {}
  const cls = [
    ...Object.keys(ext.boxShadow || {}).map((k) => `shadow-${k}`),
    ...Object.keys(ext.borderRadius || {}).map((k) => `rounded-${k}`),
    ...Object.keys(ext.animation || {}).map((k) => `animate-${k}`)
  ]
  // 解析器空转会让本条「假绿」(D9f 同款教训): 令牌数下限先兜住
  assert(cls.length >= 4, 'D17a0 tailwind 令牌清单解析合理(至少 4 个自定义类)', cls.join(', '))
  const srcAll = walk(R('src'), /\.(vue|ts|css|html)$/)
    .map((f) => fs.readFileSync(f, 'utf8'))
    .join('\n')
  const dead = cls.filter((c) => !srcAll.includes(c))
  assert(dead.length === 0, 'D17a tailwind 自定义令牌全部有使用处(死令牌就是下一个没人敢删的债, 3.4「不留死令牌」)', dead.join(', '))

  const noBanner = walk(R('docs', 'design'), /\.html$/).filter(
    (f) => !f.endsWith('sodalive-ia-v1.html') && !/superseded-banner/.test(fs.readFileSync(f, 'utf8'))
  )
  assert(noBanner.length === 0, 'D17b 历史设计稿一律带「被谁覆盖」横幅(没横幅=读者拿作废的页面划分去实现)', noBanner.map(rel).join(', '))

  const bin = walk(R('docs'), /\.(png|jpe?g|gif|webp|zip|7z)$/i)
  assert(bin.length === 0, 'D17c docs/ 只放自包含 HTML: 截图导出物一旦没人引用就是纯仓库负重', bin.map(rel).join(', '))

  for (const name of ['README.md', 'README_EN.md']) {
    const t = fs.readFileSync(R(name), 'utf8')
    const tag = t.split(/\r?\n/).find((l) => l.startsWith('> ')) || ''
    assert(/PandaLive/.test(tag) && /SOOP/.test(tag), `D17d ${name} 副标题是双平台口径`, tag)
    assert(/npm run verify/.test(t), `D17e ${name} 记了 verify 回归链(package.json 里有就必须能在文档里找到)`)
    for (const svc of ['soop.ts', 'source.ts', 'hlsProxy.ts']) {
      assert(t.includes(svc), `D17f ${name} 代码结构含 ${svc}(整个 SOOP 半边不能只在源码里存在)`)
    }
  }
}

// ============================================================================
// D18 圆角只有四档: 卡片 14 / 控件 10 / 徽标 6(sm=5) / 胶囊 999(设计稿 0.4 尺度表)
//   档位是抄来的还是拍的? 拍的一档(rounded-lg/xl/2xl/裸 rounded)在同屏里长出 4/8/12/16px 四种
//   圆角, 用户看不出道理, 下一个人也无从判断该用哪个 —— 所以数值本身要能被断言。
// ============================================================================
{
  const LADDER = new Set(['card', 'ctl', 'md', 'full']) // md=6px(徽标档), full=胶囊/圆点
  const off = []
  let seen = 0
  eachLine(RENDERER.filter((f) => f.endsWith('.vue')), (f, n, l) => {
    if (isCommentLine(l)) return
    for (const m of l.matchAll(/\brounded(?:-[a-z0-9[\].%]+)?/g)) {
      seen++
      const raw = m[0].slice('rounded'.length)
      const tier = raw.startsWith('-[') ? '任意值' : raw.replace(/^-/, '')
      if (!LADDER.has(tier)) off.push(`${loc(f, n)} :: ${m[0]}`)
    }
  })
  const css = fs.readFileSync(R('src', 'renderer', 'src', 'styles.css'), 'utf8')
  const CSS_LADDER = new Set(['5px', '6px', '10px', '14px', '999px', '50%'])
  const cssOff = []
  let cssSeen = 0
  for (const src of [css, ...RENDERER.filter((f) => f.endsWith('.vue')).map((f) => fs.readFileSync(f, 'utf8'))]) {
    for (const m of src.matchAll(/border-radius:\s*([^;]+)/g)) {
      cssSeen++
      for (const v of m[1].trim().split(/\s+/)) if (!CSS_LADDER.has(v)) cssOff.push(m[1].trim())
    }
  }
  // 解析器空转 = 假绿(D9f 同款教训): 先兜住命中数下限
  assert(seen >= 60, `D18a0 模板圆角类命中数合理(≥60)`, `${seen} 处`)
  assert(cssSeen >= 12, `D18a1 CSS 圆角声明命中数合理(≥12)`, `${cssSeen} 处`)
  assert(off.length === 0, 'D18a 模板只用 14/10/6/999 四档圆角(设计稿 0.4)', off.slice(0, 10).join('\n         '))
  assert(cssOff.length === 0, 'D18b CSS 里的 border-radius 也全在档位上(含滚动条与进度条端点)', [...new Set(cssOff)].slice(0, 8).join(', '))
}

// ============================================================================
// D19 平台身份色点只有一处定义(全局 .pdot), 各组件不再自画尺寸与描边环
// ============================================================================
{
  const css = fs.readFileSync(R('src', 'renderer', 'src', 'styles.css'), 'utf8')
  for (const sel of ['.pdot {', '.pdot-sm {', '.pdot-panda {', '.pdot-soop {']) {
    assert(css.includes(sel), `D19a 平台色点定义齐全: ${sel}`)
  }
  assert(/\.pdot\s*\{[^}]*box-shadow: 0 0 0 1px rgb\(var\(--c-ink3\)\)/.test(css), 'D19b .pdot 描边环恒为 ink3(SOOP 黄压白卡 1.43:1, 不勾边就等于看不见)')
  const legacy = ['platdot', 'pf__dot', 'plat-tag__dot', 'dot-panda', 'dot-soop']
  const still = []
  const users = []
  for (const f of RENDERER.filter((x) => x.endsWith('.vue'))) {
    const t = fs.readFileSync(f, 'utf8')
    for (const name of legacy) if (new RegExp(`\\b${name}\\b`).test(t)) still.push(`${rel(f)} :: ${name}`)
    if (/\bpdot\b/.test(t)) users.push(rel(f))
  }
  assert(still.length === 0, 'D19c 组件自画的平台点(旧名)已清零(两处规格=下一轮又要选一次用哪个)', still.join(', '))
  assert(users.length >= 4, 'D19d .pdot 消费面 ≥4 处(解析器空转即假绿)', users.join(', '))
  const handPainted = []
  eachLine(RENDERER.filter((f) => f.endsWith('.vue')), (f, n, l) => {
    if (isCommentLine(l)) return
    if (/background: *'var\(--plat-/.test(l) || /:style="\{\s*background:.*--plat-/.test(l)) handPainted.push(loc(f, n))
  })
  assert(handPainted.length === 0, 'D19e 模板里不再用内联 style 拼平台底色(点走 .pdot, 底面板走 .ava/.pt--*)', handPainted.join(', '))
}

// ============================================================================
// D20 计数药丸一枚定义: 顶栏 .platn / 段标题 .sec-n, 不许再有手搓的第三种
// ============================================================================
{
  const nav = fs.readFileSync(R('src', 'renderer', 'src', 'components', 'TopNav.vue'), 'utf8')
  assert(!/min-w-\[\d+px\][^"]*rounded-full/.test(nav), 'D20a 顶栏没有手搓计数药丸')
  const pills = (nav.match(/class="platn/g) || []).length
  assert(pills === 2, 'D20b 顶栏两枚计数药丸同用 .platn(平台分段 + 页面 tab)', `${pills} 处`)
  const ws = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'WorkspaceView.vue'), 'utf8')
  assert(/class="sec-n"/.test(ws), 'D20c 视图分段计数是 .sec-n 药丸(设计稿 .vt .n), 不是裸字')
}

// ============================================================================
// D21 等宽数字一种写法: Tailwind 的 tabular-nums(曾有同义类 .tnum, 两种拼法混用查不出漏网)
// ============================================================================
{
  const css = fs.readFileSync(R('src', 'renderer', 'src', 'styles.css'), 'utf8')
  // 去注释后再查: 下面那段注释本身就是「为什么曾有 .tnum」的记录, 提它是规则的本意
  assert(!/\.tnum\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'D21a .tnum 同义类已删(等宽数字只有 tabular-nums 一种拼法)')
  let tn = 0
  eachLine(RENDERER.filter((f) => f.endsWith('.vue')), (f, n, l) => {
    for (const m of l.matchAll(/\btabular-nums\b/g)) tn++
  })
  assert(tn >= 20, 'D21b 等宽数字覆盖面合理(≥20 处计数/时长/码率)', `${tn} 处`)
}

// ============================================================================
// D22 naive 主题面与 styles.css 语义变量逐值对齐(App.vue 的注释承诺, 此前无人核对)
//   供应商组件与自绘界面在同一屏里出现两套底色/两套主色, 就是这套值漂移出来的。
// ============================================================================
{
  const css = fs.readFileSync(R('src', 'renderer', 'src', 'styles.css'), 'utf8')
  const varsOf = (sel) => {
    // 必须锚定到块头(选择器+{): `:root` 与 `.dark` 都先在注释里被提过一次,
    // 裸 indexOf 会把 .dark 解析到 :root 块尾 —— 于是深色一侧整列拿到浅色值, 假红一片
    const i = css.search(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`))
    const body = css.slice(i, css.indexOf('\n}', i))
    const out = {}
    for (const m of body.matchAll(/--c-([\w-]+):\s*(\d+)\s+(\d+)\s+(\d+)/g)) {
      out[m[1]] = '#' + [m[2], m[3], m[4]].map((x) => Number(x).toString(16).padStart(2, '0')).join('')
    }
    return out
  }
  const L = varsOf(':root')
  const D = varsOf('.dark')
  const appSrc = fs.readFileSync(R('src', 'renderer', 'src', 'App.vue'), 'utf8')
  const overridesOf = (name) => {
    // 同上: 锚定 `const NAME = {`, 否则命中文件下方 computed 里的引用
    const i = appSrc.search(new RegExp(`const ${name} =\\s*\\{`))
    const body = appSrc.slice(i, appSrc.indexOf('\n}', i))
    const out = {}
    for (const m of body.matchAll(/(\w+):\s*'#([0-9a-fA-F]{6})'/g)) out[m[1]] = `#${m[2].toLowerCase()}`
    return out
  }
  const LT = overridesOf('LIGHT_OVERRIDES')
  const DT = overridesOf('DARK_OVERRIDES')
  assert(Object.keys(L).length >= 12 && Object.keys(D).length >= 12, 'D22a 两套 CSS 变量解析合理(各 ≥12 色)', `L=${Object.keys(L).length} D=${Object.keys(D).length}`)
  assert(Object.keys(LT).length >= 10 && Object.keys(DT).length >= 10, 'D22b 两套 naive 覆盖解析合理(各 ≥10 色)', `L=${Object.keys(LT).length} D=${Object.keys(DT).length}`)
  // naive 键 ↔ 语义变量; 深浅两档不同时写 [浅变量, 深变量]
  const PAIRS = [
    ['primaryColor', 'brand', 'brand'],
    ['primaryColorHover', 'brand-hi', 'brand-hi'],
    ['bodyColor', 'page', 'page'],
    ['cardColor', 'card', 'card'],
    ['modalColor', 'card', 'fill'],
    ['popoverColor', 'card', 'fill'],
    ['inputColor', 'fill', 'fillh'],
    ['borderColor', 'line', 'line'],
    ['textColorBase', 'ink1', 'ink1'],
    ['errorColor', 'live-ink', 'live'],
    ['successColor', 'ok', 'ok-ink'],
    ['warningColor', 'warn', 'warn-ink']
  ]
  const drift = []
  for (const [key, lv, dv] of PAIRS) {
    if (LT[key] !== L[lv]) drift.push(`light ${key}: naive ${LT[key]} vs --c-${lv} ${L[lv]}`)
    if (DT[key] !== D[dv]) drift.push(`dark ${key}: naive ${DT[key]} vs --c-${dv} ${D[dv]}`)
  }
  assert(PAIRS.length >= 12, 'D22c 对齐清单条数合理(≥12 组)')
  assert(drift.length === 0, 'D22 naive 主题每一枚色值都能在语义变量里找到同名档(漂移=同一屏两套色)', drift.join('\n         '))
}

// ============================================================================
// D23 品牌散文: 用户可见文案里的小写 pandalive 是代码枚举/磁盘目录名, 不是品牌形
//   (实测: 设置·关于的免责文案写着「与 pandalive 官方无任何关联」, 而同页分组标题写的是 PandaLive —— 同一屏两种称呼)
//   例外只有「落盘结构」两条: 那里说的确实是目录名本身, 改成品牌形反而教人找不到文件夹。
// ============================================================================
{
  const LOCALES = walk(R('src', 'renderer', 'src', 'i18n'), /\.ts$/)
  let scanned = 0
  checkWithAllowlist(
    'D23 文案里的平台品牌形统一(PandaLive, 不是 pandalive)',
    LOCALES,
    (l) => {
      if (!isCommentLine(l) && /['"`][^'"`]*:?\s*[^'"`]*['"`]/.test(l)) scanned++
      return /['"`][^'"`]*\bpandalive\b/.test(l) && !isCommentLine(l) ? '小写 pandalive 出现在用户可见文案' : ''
    },
    [
      { file: 'src/renderer/src/i18n/locales/zh-CN.ts', re: /saveDirLayout/, why: '说的是磁盘目录名本身, 不是品牌称呼' },
      { file: 'src/renderer/src/i18n/locales/en-US.ts', re: /saveDirLayout/, why: '同上(与 zh 对齐)' }
    ]
  )
  assert(scanned >= 200, 'D23a0 文案扫描面合理(≥200 条字符串)', `${scanned} 行`)
}

// ============================================================================
// D24 动作行按钮档位: 自绘按钮的高度必须由 h-* 锁档, 不能靠 py-[Npx] 撑
//   实测漏网: 设置·关于的「GitHub 主页」用 py-[7px] 撑到 34.35px, 同行 naive small「检查更新」是 28px,
//   两枚按钮并排一眼看出不齐 —— 而 D1~D22 没有任何一条查得到它(圆角/颜色都在档上)。
// ============================================================================
{
  const bad = []
  let seen = 0
  for (const f of RENDERER.filter((x) => x.endsWith('.vue'))) {
    const ls = linesOf(f)
    ls.forEach((l, i) => {
      if (!/py-\[\d+(\.\d+)?px\]/.test(l)) return
      seen++
      const cls = (l.match(/class="([^"]*)"/) || [])[1] || ''
      if (!/rounded-(ctl|card|md)\b/.test(cls)) return
      if (/\bh-\[?[\d.]+|\bh-(2|3|4|5|6|7|8|9|10|11|12)\b/.test(cls)) return
      // 判定这一行的宿主标签: 从本行往上找到第一个带开标签的行, 取该行最后一个标签名
      // (class 常与 <button 分行写; 只看「附近有没有 button」会把 4 行外的按钮算成自己)
      let tag = ''
      for (let j = i; j >= Math.max(0, i - 6) && !tag; j--) {
        const ms = [...ls[j].matchAll(/<([a-zA-Z][-\w]*)/g)].map((m) => m[1])
        if (ms.length) tag = ms[ms.length - 1]
      }
      if (tag === 'button' || tag === 'n-button') bad.push(`${loc(f, i + 1)} ${l.trim().slice(0, 110)}`)
    })
  }
  assert(seen >= 5, 'D24a0 py-[Npx] 扫描面合理(≥5 处)', `${seen} 行`)
  assert(bad.length === 0, 'D24 自绘按钮用 h-* 锁档位(py-[Npx] 撑高会与同行 naive 按钮差 6px)', bad.slice(0, 8).join('\n         '))
}

// ============================================================================
// D25 设置保存链契约 (2026-09-30 设置页审查 P0: 「保存设置」在实机上是静默 no-op)
//   机制: 提交 {...form.value} 时 notify/autoRecordDefault 仍是 Pinia 响应式代理,
//   IPC 走 structured clone ⇒ 整包被拒; 而保存只有 try/finally, 失败连气泡都没有 ——
//   于是"点了没反应", 且盘没写、界面却显示已改(数据与界面分叉)。
// ============================================================================
{
  const sv = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'SettingsView.vue'), 'utf8')
  const ipc = fs.readFileSync(R('src', 'main', 'ipc.ts'), 'utf8')
  const main = fs.readFileSync(R('src', 'main', 'index.ts'), 'utf8')
  assert(!/\{\s*\.\.\.form\.value/.test(sv), 'D25a 提交载荷不得浅展开 form.value(嵌套对象仍是代理, 不可克隆)')
  assert(/structuredClone\(toRaw\(/.test(sv), 'D25b 提交载荷经 toRaw + structuredClone 脱代理')
  const i = sv.indexOf('const dirtyKeys = computed')
  const dirtyBody = sv.slice(i, sv.indexOf('})', sv.indexOf('return out', i)))
  assert(/baseline\.value/.test(dirtyBody) && !/store\.settings/.test(dirtyBody), 'D25c 脏清单跟「进页快照」比, 不跟实时投影比(后者被别的写入方刷新 ⇒ 一按保存就把对方新值回滚)')
  const adopted = (sv.match(/baseline\.value\.\w+ =/g) || []).length
  assert(adopted >= 2, 'D25d 主题/语言即时通道落盘后同步基线(否则已保存的项永远挂着「未保存」)', `${adopted} 处`)
  assert(/catch \(e\)[\s\S]{0,220}?t\('settings\.saveFail'/.test(sv), 'D25e 保存失败出声(此前 try/finally 把它吞成「点了没反应」)')
  assert(/sanitizeSettingsPatch\(/.test(ipc), 'D25f settings:set 过入站闸门(不合格键不收, 而不是收了再兜底)')
  assert(/logger\.(warn|info)\([^)]*拒收/.test(ipc), 'D25g 被拒的键落日志(不静默吞掉: 前端越界要看得见)')
  assert(!/\bnet\.fetch\(/.test(ipc), 'D25h ipc 里没有绕过代理的 net.fetch(它走默认会话, 用户配的代理形同虚设)')
  assert(/fromPartition\(SESSION_PARTITION\)\s*\.fetch\(/.test(ipc), 'D25i 检查更新走已配代理的分区会话')
  assert(/setBackgroundColor\(windowBg\(/.test(ipc) && /backgroundColor: windowBg\(/.test(main), 'D25j 「主题立即生效」名副其实: 建窗与切主题两处同用 windowBg')
}

// ============================================================================
// D26 关于页身份数据单一来源: 作者/头像/仓库 slug/日志目录都从 appInfo(IPC) 来
//   实测漏网: 模板里写死 `Joftal/pd-monitor`、`https://github.com/Joftal.png`、`…\data\logs\app-YYYYMMDD.log`
//   —— 换作者、换仓库名、mac/linux 下跑一份, 这三行显示的全是错的, 而且没人会去改模板。
// ============================================================================
checkWithAllowlist(
  'D26 渲染层不得写死作者/仓库/日志路径(一律 appInfo 下发)',
  RENDERER.filter((f) => f.endsWith('.vue')),
  (l) => {
    if (isCommentLine(l)) return ''
    if (/github\.com\/[A-Za-z0-9_.-]+/.test(l)) return '写死 GitHub 身份 URL'
    if (/Joftal/.test(l)) return '写死作者名'
    if (/data[/\\]logs/.test(l)) return '写死日志目录样式'
    return ''
  },
  []
)
{
  const sv = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'SettingsView.vue'), 'utf8')
  const meta = fs.readFileSync(R('src', 'shared', 'appmeta.ts'), 'utf8')
  const types = fs.readFileSync(R('src', 'shared', 'types.ts'), 'utf8')
  for (const k of ['author', 'authorUrl', 'repo', 'releasesPage']) {
    assert(new RegExp(`\\b${k}:`).test(meta), `D26b APP_META 定义 ${k}(唯一定义处)`)
    assert(new RegExp(`^\\s{2}${k}: string$`, 'm').test(types.slice(types.indexOf('export interface AppInfo'), types.indexOf('/** 检查结果'))), `D26c AppInfo 下发 ${k}`)
  }
  const iface = types.slice(types.indexOf('export interface AppInfo'), types.indexOf('/** 检查结果'))
  assert(/logsDir: string/.test(iface), 'D26d AppInfo 下发 logsDir(跨平台的真值, 不是 Windows 路径样式)')
  assert(/info\?\.logsDir/.test(sv) && /avatarUrl/.test(sv) && /repoSlug/.test(sv), 'D26e 关于页三处身份数据都用 appInfo 的计算属性')
}

// ============================================================================
// D27 段标题只有两档规格: 段用 .sec-h, 卡内分组用 .grp-h
//   实测漏网: 设置页 7 个段标题手搓 `text-[13.5px] font-bold text-ink1 tracking-wide`,
//   账号页同一角色又写成 13.5px、录制页写成 14.5px extrabold —— 同一屏三种字号字重。
//   16px 的品牌字标(TopNav / 关于横幅)不是段标题, 不在这一档里。
// ============================================================================
{
  const bad = []
  eachLine(RENDERER.filter((f) => f.endsWith('.vue')), (f, n, l) => {
    if (isCommentLine(l)) return
    if (/text-\[1[34](\.\d)?px\][^"]*font-(bold|extrabold)[^"]*tracking-wide/.test(l)) bad.push(`${loc(f, n)} ${l.trim().slice(0, 110)}`)
  })
  assert(bad.length === 0, 'D27 段标题不得在模板里手搓(13~14px bold tracking-wide → 用 .sec-h)', bad.slice(0, 8).join('\n         '))
  const css = fs.readFileSync(R('src', 'renderer', 'src', 'styles.css'), 'utf8')
  const views = RENDERER.filter((f) => f.endsWith('.vue'))
  for (const cls of ['sec-h', 'grp-h']) {
    assert(new RegExp(`\\.${cls}\\s*\\{`).test(css), `D27b .${cls} 在 styles.css 有定义(模板引用的自定义类必须存在)`)
    const used = views.filter((f) => new RegExp(`\\b${cls}\\b`).test(fs.readFileSync(f, 'utf8'))).length
    assert(used >= 1, `D27c .${cls} 至少被一个视图使用(定义了没人用 = 死令牌)`, `${used} 个视图`)
  }
}

// ============================================================================
// D28 按钮宽度只锁下限: !min-w-[Npx] 允许, !w-[Npx] 禁止
//   实测漏网: 账号页「打开登录窗口」定宽 112px 在中文下刚好, 切英文被裁成「Open login wind」——
//   定宽锁的是「这一档视觉」, 却顺手裁掉了翻译。下限保住对齐的最小宽度, 长译文自己撑开。
//   例外必须是「布局盒」而不是「文案盒」: 表单输入框与对话框的宽是列宽, 与翻译无关, 走白名单。
// ============================================================================
{
  const vues = RENDERER.filter((f) => f.endsWith('.vue'))
  const hard = []
  eachLine(vues, (f, n, l) => {
    if (isCommentLine(l)) return
    if (/<(n-button|button)\b/.test(l) && /!w-\[\d+px\]/.test(l)) hard.push(`${loc(f, n)} ${l.trim().slice(0, 110)}`)
  })
  assert(hard.length === 0, 'D28 按钮不用定宽(裁掉的是翻译; 中文永远看不出问题)', hard.slice(0, 8).join('\n         '))

  const LAYOUT_W = [
    { where: 'AccountView.vue', re: /<n-input\b[^>]*!w-\[180px\]/, why: '托管账密的账号输入框是列宽' },
    { where: 'WorkspaceView.vue', re: /<n-modal\b[^>]*!w-\[460px\]/, why: '添加房间对话框的弹窗宽' }
  ]
  for (const e of LAYOUT_W) {
    const hit = vues.filter((f) => f.endsWith(e.where)).some((f) => e.re.test(fs.readFileSync(f, 'utf8')))
    assert(hit, `D28b 定宽例外仍成立: ${e.where} 的 ${e.why}(例外不再命中任何行=该作废, 按仓库规矩直接 FAIL)`)
  }

  const floors = vues.reduce((a, f) => a + (fs.readFileSync(f, 'utf8').match(/!min-w-\[\d+px\]/g) || []).length, 0)
  assert(floors >= 8, `D28c 下限写法覆盖面 ≥8 处(全应用按钮档位; 计数归零说明这条规则被静默拆除)`, `${floors} 处`)
}

// ============================================================================
// D29 筛选条不能被自己筛掉: 出现与否看基数, 筛空的墙必带取消出口
//   实机(2026-09-30): Panda 站内发现 395 条, 点「只看已关注」(本机关注数 0) 之后整条筛选条
//   从 DOM 消失 —— 锁住人的不是筛子, 是开着的那枚 chip 跟着结果一起没了; 而空墙写的是
//   「站内暂时没有可展示的在播房间」, 一句与筛子无关的通用解释顶掉了真正的归因。
//   订正: 基数三视图必须同一口径(搜索词已生效、chip 未生效)。发现段原先用未过词的
//   store.discovery.length, 于是「词无命中 + chip 开着」会被报成 chip 的锅, 而「取消筛选」
//   按下去仍旧是空墙 —— 与本轮修掉的是同一类无出口现场, 只是换了个触发路径。
// ============================================================================
{
  const wsSrc = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'WorkspaceView.vue'), 'utf8')
  assert(!/v-if="activeList\.length" class="px-7 pt-3/.test(wsSrc), 'D29a 筛选条不得按「筛完还剩几条」决定出现(chip 会连自己一起消失)')
  assert(/v-if="filterBarVisible" class="px-7 pt-3/.test(wsSrc), 'D29b 筛选条的出现条件走 filterBarVisible')
  assert(/const filterBarVisible = computed\(\(\) => baseCount\.value > 0 \|\| activeFilters\.value\.length > 0\)/.test(wsSrc), 'D29c filterBarVisible = 基数有条 或 有筛子开着(后者必须留出口)')
  assert(/const baseCount = computed\(\(\) => \{[\s\S]{0,40}if \(view\.value === 'live'\) return liveList\.value\.length[\s\S]{0,40}if \(view\.value === 'discover'\) return store\.discovery\.filter\(\(x\) => hit\(x\)\)\.length[\s\S]{0,40}return offBase\.value\.length/.test(wsSrc), 'D29d 三视图基数同一口径「搜索词已生效 · chip 未生效」(liveList / discovery 过 hit / offBase)')
  assert(!/view\.value === 'discover' \? store\.discovery\.length/.test(wsSrc), 'D29h 发现段基数不得用未过搜索词的 store.discovery.length(无命中时冤枉 chip, 取消筛选救不回现场)')
  assert(/@click="clearFilters"/.test(wsSrc), 'D29e 筛空的墙必带「取消筛选」出口')
  assert(/if \(activeFilters\.value\.length && baseCount\.value\)/.test(wsSrc), 'D29f 空态归因把「是筛空的」排在其它解释之前(否则被通用文案顶掉)')
  const zh = fs.readFileSync(R('src', 'renderer', 'src', 'i18n', 'locales', 'zh-CN.ts'), 'utf8')
  assert(/emptyFiltered: '「\{label\}」筛完是 0 条 · 这一栏本来有 \{n\} 条'/.test(zh), 'D29g 筛空那句话报的是筛子名与基数, 不是「没有房间」')
  // D30 空态的文案与出口是一件事的两半: 分两处判断就会漂(实机: 发现段有词无命中, 墙上写「没有匹配 X」而手里一个按钮都没有,
  //       而顶栏搜索框没有 ✕ —— 用户得自己去顶栏找回那个词)。改为 emptyAction 与 listEmpty 同判据同顺序。
  assert(/const emptyAction = computed<EmptyAction>\(\(\) => \{/.test(wsSrc), 'D30a 空态出口由 emptyAction 单点决定(不再按视图各写一套 v-if)')
  assert(/if \(view\.value === 'discover'\) \{\s*if \(kw\.value\) return 'clearKw'/.test(wsSrc), 'D30b 发现段判据里 kw 排在「缺前提」之前 —— 有词时该清除搜索, 不该跳登录')
  assert(/v-if="emptyAction" class="flex gap-2 justify-center mt-2"/.test(wsSrc) && /emptyAction === 'clearKw'/.test(wsSrc), 'D30c 墙上句子里点到搜索词, 手里就必须有「清除搜索」这枚按钮')
  assert(!/v-else-if="kw" size="small" secondary class="mt-2"/.test(wsSrc), 'D30d 出口不得再退回视图分支里的散写(与文案不同判据即失败)')
}

// ============================================================================
// D31 播放页返回 = 从哪来回哪去, 且不跨平台
//   实机(2026-10-01): 此前 goBack() 写死 router.push({name:'live'}), 于是从站内发现(甚至从录制页)
//   进房后点返回, 一律被甩到「在播关注」—— 用户的话是"不要跨域, 这样体验非常不好"。
//   现读历史栈: 上一站是同平台的直播页/录制页就 router.back()(连 ?view= 与滚动位一起带回),
//   栈空(TG 推送/收藏直链)或来自对面平台才落本平台直播页。按钮写的就是它会去的地方。
// ============================================================================
{
  const pv = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'PlayerView.vue'), 'utf8')
  assert(/const backTarget = computed<\{ label: string; run: \(\) => void \}>\(\(\) => \{/.test(pv), 'D31a 返回目标由 backTarget 单点决定(目的地与文案同源)')
  assert(/router\.options\.history\.state\.back/.test(pv), 'D31b 返回读历史栈的上一站, 不是写死直播页')
  assert(/prev\.startsWith\(`\/\$\{platform\}\/recordings`\)/.test(pv), 'D31c 录制页是一等返回目的地(从库/录制页进房不该被甩去直播)')
  assert(/new URLSearchParams\(prev\.slice\(prev\.indexOf\('\?'\) \+ 1\)\)\.get\('view'\)/.test(pv), 'D31d 工作区返回按 ?view= 落位, 发现段回来还在发现段')
  assert((pv.match(/backTarget\.label/g) || []).length === 2, `D31e 两处返回按钮都绑 backTarget.label(模板里再写死一句就是假话)`, `${(pv.match(/backTarget\.label/g) || []).length} 处`)
  assert((pv.match(/t\('player\.backToLive'/g) || []).length === 1, `D31f 「返回 直播」只剩兜底那一处(栈空/跨平台), 不得再当默认目的地`, `${(pv.match(/t\('player\.backToLive'/g) || []).length} 处`)
  assert(/run: \(\) => void router\.push\(\{ name: 'live', params: \{ plat: platform \} \}\)/.test(pv), 'D31g 兜底仍旧落本平台直播页(深链直进播放页时 back() 会停在原地)')
}

// ============================================================================
console.log('\n' + '─'.repeat(72))
console.log(`设计契约: 通过 ${PASS} / 失败 ${FAIL}`)
if (FAIL) {
  console.log('\n失败项:')
  for (const f of fails) console.log(`  · ${f}`)
  process.exit(1)
}
