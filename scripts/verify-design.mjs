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
//   D15 首屏与空态: 不等官方登录校验; 未取到态说「校验中」; 空态有界且下一步可点; 页头按钮同档; 工作区不引头像坞
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
//   D32 播放页侧栏与动作行: 侧栏自带滚动且卡片 shrink-0(不被压扁裁掉尾行); 动作行按轻重分档(幽灵/描边/实心)且只锁宽度下限; 观众数一屏只报一次
//   D33 播放页读数一处收敛: room 快照 = 关注列表 > 站内发现, 展示值 = 回包 > 快照 > 裸 ID(未关注房不得整屏「—」)
//   D34 工作区视图分段行不常驻快捷键提示: 1/2/3 与 / 的键盘本体保留, 屏上那条 11px 灰字撤掉且双语不留死键
//   D35 工作区筛选条右端只在真有搜索词时出声: 「排序与页码在本视图内记忆」常驻说明撤掉(记忆本体不动), 无词时不留空转 flex-1
//   D36 「关注主播」按平台拆成两个专属入口: 无「自动识别」档, 平台由工作区决定, 粘错平台给出口, SOOP 纯数字场次号单独归因
//   D37 分段时长填 0 = 不分段: 整场一个不带段号的 TS, 合并档/管线第四棒随之收起, 库里与手动合并产物同归「整文件」一类
//   D38 「关注在播」一屏只留一个现场: 头像坞退役, 读数只剩分段第一档 + 顶栏徽标, 组件/样式/文案/store getter 不留残骸
//   D39 SOOP 头像按频道 ID 派生并落卡(404 回落兜底, 不画破图); 面板点赞/粉丝只在有数时摆行, 「不适用」那句连死键一起删
//   D40 SOOP 的 ID 槽只放裸频道名: 「房间」前缀连 ws.roomNo 双语死键一起撤(Panda 的 @ 是可粘贴地址的一部分, 留着); 播放页那一格同判据
//   D41 播放页侧栏「标签」整行撤掉: 同一批房态在页头已有徽标, 普通房只剩「—」占位; 撤行不撤信号(四枚徽标 + isVod 必须在位)
//   D42 取源回写按字段合并: 这一路看不到的 isAdult 不许写 false(19+ 旗不被抹掉), 看得到的 isPw 照写; Panda 不回收
//   D43 播放源卡的两个出口各复制各的: 「复制」给屏上那串(本机正在用的), 「复制真实源」从代理地址的 url= 解出官方清单(零请求), 只在真是代理地址时出现; 提示语只归因不警告
//   D44 SOOP 不带房间级 19+ 标记(㊌): is_adult 全链路不读、applySoopRow 不继承它、已离线房的旧 true 在读库时收敛; 密码房旗仍是三态 + ?? 合并; 下播只清场次属性; Panda 的 19+ 三处消费端都还在
//   D45 监控节奏三格按平台分家(㊍): 契约只有 Settings.monitor 一份, 老库那三格展开成两格后顶层删净, 闸门逐平台逐格夹, 引擎两条独立定时器(Panda 熔断只压自己那条), 三格住在各自平台节且全局「监控」节连死键一起撤
//   D46 首轮未落地时顶栏胶囊只报间隔: roundMs 的初值 0 不得当成「上次拉取耗时」报出, 耗时那一截连同 tooltip 一起省略
//   D47 模板结构当场编译: 每个 .vue 的 <template> 单独过 vue/compiler-sfc, 断链的 v-else-if 不许等 build 才炸
//   D48 store 的 getter 普查: 零消费者的死 getter 一律撤(㊀「无消费方即删」), 不留"以后可能用"
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
  assert(/function monTileClick\(/.test(src), 'D12b2 按平台分家的预取瓷片有自己的开关(㊍ 它写的不是顶层布尔)')
  const nTiles = (src.match(/:class="tileCls"/g) || []).length
  // 瓷片开关两种: 全局布尔走 tileClick, monitor.<平台>.prefetchStream 走 monTileClick(㊍)
  const nClicks = (src.match(/@click="(tileClick|monTileClick)\(/g) || []).length
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

  // ㉖′(2026-10-01 订正) 在播坞整体退役: 视图分段的第一档已经给了「关注在播」的计数与出口,
  //    别视图再挂一条头像带就是同一批房间的第二份呈现(判据见 D38)
  assert(!/LiveDock|livedock/.test(ws), 'D15m 工作区不引不挂头像坞(补回视图不该自带第二条读数带)')
  assert(!/onLiveView/.test(ws), 'D15m2 自我指向开关 onLiveView 随坞一起退役')

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
  const nav = fs.readFileSync(R('src', 'renderer', 'src', 'components', 'TopNav.vue'), 'utf8')
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
  // ⑤ 在播读数不承载管理动作: 坞退役后「谁在播」只剩顶栏徽标与分段计数两处读数, 二者只管跳
  assert(!/unfollow|anchorsRemove|removeAnchor/.test(nav), 'D16e 顶栏在播徽标无取关承载(管理动作只在卡片菜单/离线行/播放页)')

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
    { where: 'AddFollowDialog.vue', re: /<n-modal\b[^>]*!w-\[460px\]/, why: '关注/添加对话框的弹窗宽(2026-10-01 随对话框从 WorkspaceView 拆出, 例外跟着搬)' }
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
// D32 播放页侧栏读得完 + 动作行按轻重分档 (2026-10-01 实机 1600x900 取证)
//   ① 侧栏: 三张 .panel 直接放在 flex 列里, 默认会被压扁, 而 .panel{overflow:hidden}
//      把尾部就地裁掉 —— aside 因此"没有溢出", 滚动条压根不出现, 被裁的几行永远滚不到。
//      量尺: aside h=763 / scroll=763 / scrollTop=9999→0, 「上次失效」「开播自动录制」消失。
//   ② 动作行: 刷新穿 primary secondary(淡蓝底)看着像禁用, 关注却是全排最响的实心,
//      而本页真正的核心动作(录制)反而是淡底 —— 轻重与频次/后果都不匹配。
// ============================================================================
{
  const pv = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'PlayerView.vue'), 'utf8')
  const aside = (pv.match(/<aside[\s\S]*?<\/aside>/) || [''])[0]
  assert(aside.length > 500, 'D32a0 侧栏解析面合理(aside 段落取到了)', `${aside.length} 字符`)
  assert(/<aside class="[^"]*\boverflow-y-auto\b/.test(aside), 'D32a 侧栏自己是滚动容器(读不完的内容必须滚得到)')
  const panels = aside.match(/<div class="panel(?: [^"]*)?"/g) || []
  assert(panels.length >= 3, `D32b 侧栏卡数合理(≥3 张)`, `${panels.length} 张`)
  assert(panels.every((p) => /\bshrink-0\b/.test(p)), 'D32 侧栏每张卡 shrink-0(flex 列的默认压缩 + .panel{overflow:hidden} = 尾部行被裁且滚不到)', panels.join(' '))
  assert(!/bg-brand\/\[0\.07\]/.test(pv), 'D32c 用法说明不再单占一枚品牌色大卡(它讲的是源失效怎么办, 并到播放源卡脚注)')
  assert((pv.match(/t\('player\.tips'\)/g) || []).length === 1, `D32d 说明文案全页只出现一次`, `${(pv.match(/t\('player\.tips'\)/g) || []).length} 处`)

  const acts = [...pv.matchAll(/<n-button\b(?=[^>]*@click="(manualRefresh|toggleFollow|toggleRecord)")[^>]*>/g)].map((m) => m[0])
  assert(acts.length === 4, `D32e 动作行按钮解析面合理(刷新 1 + 关注 1 + 录制 2 分支)`, `${acts.length} 枚`)
  assert(acts.every((a) => /size="small"/.test(a)), 'D32f 动作行同档 size="small"(实机四枚 h=28 齐高)')
  assert(acts.every((a) => /!min-w-\[\d+px\]/.test(a)), 'D32g 动作行每枚都有宽度下限(定宽或无下限, 裁掉的都是翻译)')
  assert(/quaternary[^>]*@click="manualRefresh"/.test(pv), 'D32h 刷新降为幽灵档(随手可点的辅助不该和核心动作同响)')
  assert(/secondary :type="following \? 'error' : 'primary'"/.test(pv), 'D32i 关注恒描边(可逆收藏, 轻于录制; 取关仍走 error 红, 见 D16d)')
  assert(!/:secondary="!recording"/.test(pv), 'D32j 录制按钮不再按开关态退回淡底(生效后最不明显 = 这一排最要紧的动作点完反而消失)')
  assert(/<n-button v-if="!isVod" size="small" type="error" @click="toggleRecord"/.test(pv), 'D32k 直播录制恒实心 error 档(naive error = liveink 6.52:1, 可承载白字; 开关态由文案自己的 ⏺/■ 承担)')
  // ③ 同一读数一屏只说一次: 观众数此前在画面角标 / 标题元信息行 / 侧栏 kv 各挂一遍
  assert((pv.match(/\{\{ viewers \}\}/g) || []).length === 1, `D32l 观众数全页只渲染一次(三处各列一遍 = 用户先要判断该信哪个)`, `${(pv.match(/\{\{ viewers \}\}/g) || []).length} 处`)
  assert(!/v-if="m3u8[^"]*"[^>]*viewers|v-if="m3u8 && viewers"/.test(pv), 'D32m 那唯一一处不得挂在播放态守卫里(源失效时读数连同自己的上下文一起消失)')
}

// ============================================================================
// D33 播放页读数不得只认「关注列表」 (2026-10-01 实机取证)
//   站内发现进来的房大多没被关注, 那时 store.anchors 里根本没有这条 —— 而播放页的身份字段
//   只从 anchor 播种、点赞/粉丝只读 anchor, 于是快照里明摆着的数据被渲染成裸 ID 与「—」:
//   znvely00 快照 likes 2652 / fans 5681, 侧栏两行「—」; 密码房 umeceo 取不到源, 整屏写成
//   「umeceo的直播间 / 标签 — / 点赞 —」。现一处 room 快照(关注列表 > 站内发现, 两级都随轮询整包推),
//   展示值 = loadPlay 回包 > room > 裸 ID; 两样都没有的深链房仍旧如实显示「—」(那是真不知道)。
// ============================================================================
{
  const pv = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'PlayerView.vue'), 'utf8')
  assert(/const room = computed\(\(\) => \{[\s\S]{0,60}const a = anchor\.value[\s\S]{0,60}const d = discoveryItem\.value/.test(pv), 'D33a 房间读数一处收敛(room 快照 = 关注列表 > 站内发现)')
  const chained = (pv.match(/\|\| room\.value\./g) || []).length
  assert(chained >= 5, `D33b 展示值都走「回包 > 快照」这条链(≥5 处: title/nick/userImg/thumb/tags)`, `${chained} 处`)
  assert(!/numOrNa/.test(pv) && /v-if="room\.likes"[\s\S]{0,140}\{\{ room\.likes \}\}/.test(pv) && /v-if="room\.fans"[\s\S]{0,140}\{\{ room\.fans \}\}/.test(pv), 'D33c 点赞/粉丝仍从 room 取值, 且只在给得出数时摆这一行(未关注房读快照; 没有数就整行缺席, 不再画「—」或「不适用」)')
  assert(!/const viewers = computed\(\(\) => anchor\.value\?\.viewerCount \|\| discoveryItem/.test(pv), 'D33d 观众数不再自带一套取值链(与 room 同判据, 免得两处口径分叉)')
  const playWrites = ['playTitle.value = r.title', 'playNick.value = r.nick', 'playUserImg.value = r.userImg', 'playThumb.value = r.thumbUrl', 'playTags.value = r.tags']
  const writes = playWrites.filter((w) => pv.includes(w)).length
  assert(!/\b(title|nick|userImg|thumb|tags)\.value = r\./.test(pv) && writes === 5, 'D33e loadPlay 回包只写 play* 引用(直接覆盖展示值就会把快照挤掉, 回包是一次性的)', `回包写入 play* ${writes}/5`)
  assert(/const autoRecHere = computed\(\(\) => !!anchor\.value\?\.autoRecord\)/.test(pv), 'D33f 「开播自动录制」仍只读 anchor: 它是关注关系身上的开关, 没关注就是未开启, 不是缺失')
}

// ============================================================================
// D34 工作区·视图分段行右侧不常驻快捷键提示 (2026-10-01 用户指令)
//   撤下的是屏上那条常驻灰字, 不是快捷键本身: 1/2/3 切视图与 / 聚焦搜索照旧能用。
//   提示一旦上屏就成一排分段右侧的第三条声音(分段本身 + 计数药丸 + 一句说明书),
//   而它讲的动作不需要看见才会发生 —— 键盘是自己会敲的人用的。
//   口径: 提示文案没有消费方就必须连 i18n 键一起删(㊀ 的「无消费方即删」), 死键会让双语 parity 看起来还在但其实没人读。
// ============================================================================
{
  const wv = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'WorkspaceView.vue'), 'utf8')
  const zh = fs.readFileSync(R('src', 'renderer', 'src', 'i18n', 'locales', 'zh-CN.ts'), 'utf8')
  const en = fs.readFileSync(R('src', 'renderer', 'src', 'i18n', 'locales', 'en-US.ts'), 'utf8')
  const nav = fs.readFileSync(R('src', 'renderer', 'src', 'components', 'TopNav.vue'), 'utf8')
  assert(/function onKey\(e: KeyboardEvent\)/.test(wv) && /e\.key === '1'/.test(wv) && /getElementById\('global-search'\)/.test(wv) && /id="global-search"/.test(nav), 'D34a 快捷键本体仍在且指得到实物(1/2/3 切视图 · / 聚焦顶栏搜索)—— 撤的是提示, 不是功能')
  const segRow = /<!-- 视图分段 -->\n\s*<div[\s\S]*?\n {4}<\/div>/.exec(wv)?.[0] ?? ''
  assert(segRow.includes('sec-n') && segRow.includes('@click="setView(v)"'), 'D34b0 视图分段行解析面合理(分段按钮与计数都取到了)', `${segRow.length} 字节`)
  assert(!/keyHint/.test(wv + zh + en), 'D34c 提示文案三处净空(模板 + 双语键, 无消费方即删不留死键)')
  assert(!/flex-1/.test(segRow), 'D34d 分段行右侧不再挂东西(为一句灰字摆的撑开块一并撤, 不留空转的 flex-1)')
}

// ============================================================================
// D35 工作区筛选条右端「只在真有搜索词时出声」 (2026-10-01 用户指令, 与 D34 同一条口径)
//   撤的是常驻说明书「排序与页码在本视图内记忆」: 记忆是这一屏的默认行为, 不是需要天天提醒的规则。
//   搜索态那句(「{kw}」的搜索结果 + 清除搜索出口)必须留着 —— 它说的是此刻正在发生的事, 不是规则。
// ============================================================================
{
  const wv = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'WorkspaceView.vue'), 'utf8')
  const zh = fs.readFileSync(R('src', 'renderer', 'src', 'i18n', 'locales', 'zh-CN.ts'), 'utf8')
  const en = fs.readFileSync(R('src', 'renderer', 'src', 'i18n', 'locales', 'en-US.ts'), 'utf8')
  const bar = /<!-- 本视图的排序 \/ 筛选条[\s\S]*?\n {4}<\/div>/.exec(wv)?.[0] ?? ''
  assert(bar.includes('setSort(') && bar.includes('toggleFilter(') && bar.includes('ws.searchResult'), 'D35a0 筛选条解析面合理(排序 chip · 筛子 · 搜索态那句都取到了)', `${bar.length} 字节`)
  assert(!/memoryHint/.test(wv + zh + en), 'D35b 「排序与页码在本视图内记忆」三处净空(模板 + 双语键, 无消费方即删不留死键)')
  assert(/<template v-if="kw">[\s\S]{0,200}flex-1[\s\S]{0,200}ws\.searchResult/.test(bar), 'D35c 右端整块(撑开 + 那句)都挂在搜索态里 —— 无词时不留空转的 flex-1')
  const st = fs.readFileSync(R('src', 'renderer', 'src', 'stores', 'app.ts'), 'utf8')
  assert(/views: Record<WSView, ViewFilter>/.test(st) && /views: \{ live:[\s\S]{0,120}discover:[\s\S]{0,120}offline:/.test(st), 'D35d 记忆本体仍在(三视图各存一份 ViewFilter)—— 撤的只是屏上那句话')
}

// ============================================================================
// D36 「关注主播」拆成两平台专属入口 (2026-10-01 用户指令: 不要做在一起, 不需要自动识别, 都分平台做)
//   原状: 一枚对话框里挂「自动识别 / Panda / SOOP」三档分段 + 一个输入框 —— 粘什么都会先替你猜一遍平台,
//   而这一屏的用户本来就知道自己在哪一方(工作区就是按平台切的), 猜错还直接把对面的房间种进了本平台。
//   判据: ① 平台由所在工作区决定, 对话框只收本平台的房间; ② 粘到对面平台的地址不静默入库 —— 明说是
//   哪一方的并给一键过去(原文经 store.addDraft 过境换平台, 新实例把对话框撑开, 不用重打); ③ SOOP 的纯数字是场次号, 单独归因,
//   不许当频道名进库; ④ 提交恒带平台参数, 不再留 undefined 让主进程按默认平台兜底。
// ============================================================================
{
  const dlg = fs.readFileSync(R('src', 'renderer', 'src', 'components', 'AddFollowDialog.vue'), 'utf8')
  const wsSrc = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'WorkspaceView.vue'), 'utf8')
  const pf = fs.readFileSync(R('src', 'renderer', 'src', 'components', 'PlatFilter.vue'), 'utf8')
  const i18n = fs.readFileSync(R('src', 'renderer', 'src', 'i18n', 'locales', 'zh-CN.ts'), 'utf8') + fs.readFileSync(R('src', 'renderer', 'src', 'i18n', 'locales', 'en-US.ts'), 'utf8')
  assert(dlg.includes('add.titlePanda') && dlg.includes('add.titleSoop') && dlg.includes('add.phPanda') && dlg.includes('add.phSoop') && dlg.includes('add.confirmPanda') && dlg.includes('add.confirmSoop'), 'D36a 两平台各自成套的标题/占位符/按钮文案都被消费(不是同一套皮换个名)')
  assert(!/platAuto/.test(i18n) && !/'auto'/.test(pf) && !/PlatFilter/.test(dlg), 'D36b 「自动识别」这一档全站净空(双语键 + 控件选项 + 对话框里的平台分段)')
  assert(/api\.anchorsAdd\(raw\.value\.trim\(\), props\.platform\)/.test(dlg), 'D36c 提交恒带平台参数(不得再传 undefined 让主进程按默认平台兜底)')
  assert(dlg.includes("state === 'other'") && /emit\('goto-other', raw\.value\.trim\(\)\)/.test(dlg) && /@goto-other="gotoOtherPlat"/.test(wsSrc) && /store\.addDraft = text/.test(wsSrc) && /ref\(store\.addDraft !== ''\)/.test(wsSrc), 'D36d 粘错平台: 归因之外必须有出口 —— 原文经 store.addDraft 过境换平台, 新实例自己把对话框撑开')
  assert(dlg.includes('/^\\d+$/.test(s)') && dlg.includes("return 'seq'"), 'D36e SOOP 的纯数字是场次号 —— 单独归因, 不许当频道名入库')
  assert(/<AddFollowDialog v-model:show="showAdd" :platform="plat"/.test(wsSrc) && !/addPlatform|addParsed|addInput/.test(wsSrc), 'D36f 工作区只把当前平台交给对话框, 自己不留第二份解析态')
}

// ============================================================================
// D37 分段时长填 0 = 不分段 (2026-10-01 用户指令: 「现在似乎是必须要分段录制, 我要支持不分段的」)
//   形态是「数字框允许 0」而不是新摆一档开关: 0 在这一格不是越界值, 是「这一档关掉」的显式取值,
//   所以闸门(夹取下界之前)、控件(min)、三处读数面都得各自认这个 0 —— 任何一处按旧惯用法
//   `x || 900` / `Math.max(60, x)` / `f === 'merged'` 处理, 0 就静默变回 900 或整块UI消失。
//   归类: 不分段的成品与手动合并的产物同形(一个不带 _NNNN 后缀的文件), 库里合并为一档「整文件」,
//   不新增字段记"当初怎么录的" —— 那个信息对用户没有下一步动作, 只会多出一个永远对不上的枚举。
// ============================================================================
{
  const rec = fs.readFileSync(R('src', 'main', 'services', 'recorder.ts'), 'utf8')
  const guard = fs.readFileSync(R('src', 'main', 'services', 'settingsGuard.ts'), 'utf8')
  const sv = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'SettingsView.vue'), 'utf8')
  const pv = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'PlayerView.vue'), 'utf8')
  const rv = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'RecordingsView.vue'), 'utf8')
  const lib = fs.readFileSync(R('src', 'renderer', 'src', 'components', 'LibrarySection.vue'), 'utf8')
  const media = fs.readFileSync(R('src', 'renderer', 'src', 'utils', 'media.ts'), 'utf8')
  const i18n = fs.readFileSync(R('src', 'renderer', 'src', 'i18n', 'locales', 'zh-CN.ts'), 'utf8') + fs.readFileSync(R('src', 'renderer', 'src', 'i18n', 'locales', 'en-US.ts'), 'utf8')

  assert(/const segSec = Number\.isFinite\(cfg\.splitSeconds\) \? cfg\.splitSeconds : 900/.test(rec), 'D37a 分段秒数只在"不是有限数"时才兜默认(旧写法 `= cfg.splitSeconds || 900` 会把 0 吞成 900, 注释里留着的那一句不是代码)')
  assert(/else if \(segSec === 0\) \{[\s\S]{0,300}args\.push\('-i', m3u8, '-map', '0', '-c', 'copy', this\.liveSingleFile\)/.test(rec), 'D37b 0 走单文件直出那一支: -c copy 到 liveSingleFile, 不进 -f segment')
  assert(/get liveSingleFile\(\): string \{\r?\n\s*return path\.join\(this\.dirPath, `\$\{this\.baseName\}\.ts`\)/.test(rec), 'D37c 单文件产出名 = 基名.ts, 不带 _NNNN —— SEG_RE 认它是"整文件"而不是"某一段", 合并那侧也就喂不进 concat')
  assert(/'-segment_time', String\(Math\.max\(60, segSec\)\)/.test(rec), 'D37d 分段那一支的 60s 下限照旧(0 已被上面那一支截走, 不该在这里被夹成一个 60 秒的分段档)')
  assert(/ZERO_OK: readonly \(keyof Settings\)\[\] = \['splitSeconds'\]/.test(guard) && /v === 0 && ZERO_OK\.includes\(key\) \? 0/.test(guard), 'D37e 入站闸门认 0 是显式取值(负数与 1~59 仍夹到 60, 只有白名单里的键的 0 原样落盘)')
  assert(/function clampSplit\(v: unknown\): number \{[\s\S]{0,200}return n === 0 \? 0 : Math\.min\(7200, Math\.max\(60, n\)\)/.test(sv) && /:min="0" :max="7200"/.test(sv), 'D37f 设置页这一格收 0: 控件 :min="0" 且本地夹取不把 0 抬成 60(清空/NaN 才回默认 900)')
  assert(/form\.autoMp4 && form\.splitSeconds !== 0[\s\S]{0,40}mergeMp4/.test(sv) && /form\.autoMp4 && form\.mergeMp4 && form\.splitSeconds !== 0/.test(sv), 'D37g 不分段时"合并成片""删分段"两档收起: 没有第二段可合, 摆着就是让人去点一个不会发生的事')
  assert(pv.includes("t('player.outMerge')") && pv.includes("t('player.segOff')") && /s\.splitSeconds !== 0 \?/.test(pv), 'D37h 播放页侧栏: 产出与分段两个读数各说各的 0, 「合并成片」不再挂在产出那行')
  assert(/splitOff\.value \? t\('rec\.segOff'\)/.test(rv) && /st\?\.splitSeconds !== 0\) out\.push\(\{ key: 'merge'/.test(rv), 'D37i 录制页: 顶部那句读数是「不分段 · 整场单文件」, 流水线的第四棒(合并)在 0 时不存在')
  assert(/if \(h\.vod \|\| mp4s\.length !== 1 \|\| \(h\.files \|\| \[\]\)\.length !== 1\) return false/.test(media) && !/isMergedTask/.test(media + lib + rv), 'D37j 库判据改名到位(isMergedTask 全站绝迹): 盘上就一个不带后缀的文件 ⇒ 整文件')
  assert(lib.includes("type FilterKey = 'all' | 'live' | 'vod' | 'whole' | 'error'") && lib.includes("t('library.fWhole')") && !/fMerged|'merged'/.test(lib), 'D37k 筛档只剩一档「整文件」: 不按"当初怎么录的"分叉, 合并来源与不分段来源同形同归')
  const mainI18n = fs.readFileSync(R('src', 'main', 'i18n.ts'), 'utf8')
  assert(/'rec\.fileOne': '1 个文件'/.test(mainI18n) && /'rec\.fileOne': '1 file'/.test(mainI18n) && /this\.files\.length === 1 \? mt\('rec\.fileOne'\)/.test(rec), 'D37l 收尾提示在单文件时说「1 个文件」而不是「共 1 段」(主进程双语齐备)')
  // 实机抓到的(2026-10-01 第五轮): 录制页进行中的读数写着「已写入 · 1 段」—— 那一档压根没有段
  assert(/isSingleFileTask\(task\.currentFile\) \? t\('rec\.writtenOne'\)/.test(rv) && !/writtenVod/.test(rv + i18n), 'D37m 进行中卡片的写入数在单文件那一档说「单文件」而不是「1 段」(判据读当前文件名的形状, 旧 vod 键随改名绝迹)')
}

// ============================================================================
// D38 「关注在播」一屏只留一个现场 (2026-10-01: 头像坞从站内发现 / 离线关注两视图退役)
//   判据: 一条读数只允许一个现场 —— 分段第一档自带呼吸点与计数, 顶栏徽标给跨页计数,
//         别视图再复制一条头像带就是同一批房间的第二份呈现, 而它连一个管理动作都不承载
// ============================================================================
{
  const ws = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'WorkspaceView.vue'), 'utf8')
  const nav = fs.readFileSync(R('src', 'renderer', 'src', 'components', 'TopNav.vue'), 'utf8')
  const css = fs.readFileSync(R('src', 'renderer', 'src', 'styles.css'), 'utf8')
  const zh = fs.readFileSync(R('src', 'renderer', 'src', 'i18n', 'locales', 'zh-CN.ts'), 'utf8')
  const en = fs.readFileSync(R('src', 'renderer', 'src', 'i18n', 'locales', 'en-US.ts'), 'utf8')

  assert(!fs.existsSync(R('src', 'renderer', 'src', 'components', 'LiveDock.vue')), 'D38a 在播坞组件是删掉而不是藏起来(留着文件就等着被人再挂回别视图)')
  const leftovers = RENDERER.filter((f) => /LiveDock|livedock|dock\./.test(fs.readFileSync(f, 'utf8')))
  assert(leftovers.length === 0, 'D38b 渲染层再无第二处坞的痕迹(引名、样式类、取词全清)', leftovers.map(rel).join(', '))
  assert(!/dock: \{/.test(zh) && !/dock: \{/.test(en), 'D38c dock.* 四键两语言绝迹(界面撤了, 文案不许留在字典里当孤儿)')
  assert(!/liveAnchors/.test(SRC_ALL.map((f) => fs.readFileSync(f, 'utf8')).join('')), 'D38d 只喂坞的那个 store getter 随唯一消费方下线(没有读者的库存字段不留)')

  // 撤的是重复呈现, 不是「该去看」这条信号: 两个读数面必须各自还在
  assert(/viewCounts\.live \? 'bg-live animate-breathe'/.test(ws) && /class="sec-n">\{\{ viewCounts\[v\] \}\}/.test(ws), 'D38e 「关注在播」的屏上现场只剩分段第一档: 有呼吸点、有计数, 点下去就是整屏卡片墙')
  assert(/liveCount\(p\.key\)/.test(nav) && /store\.newLiveCount\(p\.key\) \? 'is-new'/.test(nav), 'D38f 顶栏徽标照旧报本平台在播数, 新开播仍把徽标转红(旧坞的 2px 竖条由它接回, 不劫持阅读)')

  assert(/看「在播关注」那一档和顶栏的在播计数/.test(zh) && /segment and the top-bar live count/.test(en), 'D38g SOOP 发现段空态的指引句改口指向分段与顶栏, 不再把人引向一条已经不存在的坞')
  assert(!/\.livedock/.test(css), 'D38h 渲染层样式表不留 .livedock 死规则')
}

// ============================================================================
// D39 SOOP 拿得到头像, 拿不到的读数就不许占位 (2026-10-01 用户指令「soop能不能拿到主播的头像? 点赞和粉丝数量拿不到的话, 不要在面板展示出来」)
//   头像: SOOP 关注列表整行没有一个图片字段(实测 718 行的键集), 但 logo 地址就是频道 ID 的函数 ——
//         播放页 <div id="bjThumbnail"> 的 <img src> 正是这一串, 而官方自己给它挂了 onerror:
//         "这一房没传过 logo"是预期内的一档(实测 14 个关注里 1 个 404), 所以 404 必须回落成"没有头像", 不许画破图。
//   占位: 一行永远填不上数的读数不是信息。写「不适用 · SOOP 接口不返回」是把我们的采集边界当成读数交给用户读。
// ============================================================================
{
  const so = fs.readFileSync(R('src', 'main', 'services', 'soop.ts'), 'utf8')
  const wt = fs.readFileSync(R('src', 'main', 'services', 'watcher.ts'), 'utf8')
  const ip = fs.readFileSync(R('src', 'main', 'ipc.ts'), 'utf8')
  const av = fs.readFileSync(R('src', 'renderer', 'src', 'components', 'AvatarImg.vue'), 'utf8')
  const pv = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'PlayerView.vue'), 'utf8')
  const zh = fs.readFileSync(R('src', 'renderer', 'src', 'i18n', 'locales', 'zh-CN.ts'), 'utf8')
  const en = fs.readFileSync(R('src', 'renderer', 'src', 'i18n', 'locales', 'en-US.ts'), 'utf8')

  const sh = fs.readFileSync(R('src', 'shared', 'types.ts'), 'utf8')
  assert(/export function soopAvatarUrl\(userId: string\): string \{/.test(sh) && /stimg\.sooplive\.com\/LOGO\/\$\{userId\.slice\(0, 2\)\}\/\$\{userId\}\/\$\{userId\}\.jpg/.test(sh), 'D39a 头像地址由频道 ID 派生(与播放页 #bjThumbnail 同一串, 零请求), 与 roomUrl 同族放共享层')
  assert(/userImg: soopAvatarUrl\(userId\)/.test(so) && /userImg: string/.test(so), 'D39b 关注行落库就带头像, 并且注释老实写明这是我们派生的而非接口给的')
  assert(/if \(!a\.userImg\) store\.updateAnchor\(a\.platform, a\.userId, \{ userImg: soopAvatarUrl\(a\.userId\) \}\)/.test(wt), 'D39c 轮询只补空着的那批: 一轮收敛, 之后每轮这里零写入(库里既有的整墙空头像靠这一步补上)')
  assert(/userImg = soopAvatarUrl\(userId\)/.test(ip), 'D39d 手动新增的 SOOP 关注当场有头像, 不等下一轮')

  assert(/@error="failed = true"/.test(av) && /<slot v-else \/>/.test(av) && /watch\(\s*\(\) => props\.src/.test(av), 'D39e 头像只有一种画法: 取不到就把槽位交回调用方的兜底(首字母/剪影), 换房时判据复位')
  const bare = RENDERER.filter((f) => /<img[^>]*v-if="[^"]*userImg/.test(fs.readFileSync(f, 'utf8')))
  assert(bare.length === 0, 'D39f 裸 img 版头像全部换到 AvatarImg(裸写没有 onerror, 404 就画成破图)', bare.map(rel).join(', '))

  assert(!/naSoop/.test(pv) && !/naSoop/.test(zh) && !/naSoop/.test(en), 'D39g「不适用 · SOOP 接口不返回」连同两语言键一起绝迹: 撤掉的是一行占位, 不是给它换一句解释')
  assert(!/isSoop \? 'text-ink3'/.test(pv) && /const isSoop = platform === 'soop'/.test(pv), 'D39h 侧栏不再按平台分色(有数才摆行, 摆出来的行本来就都是真值), isSoop 仍服务于线路/保活那两处真实能力差异')
}

// ============================================================================
// D40 SOOP 的 ID 槽只放 ID: 「房间」那两个字是给自说明的东西写说明书 (2026-10-01 用户指令「这里的房间+ID, 直接显示ID就行」)
//   这一格的位置就是判据: 它在头像与昵称旁边, 前面还有直播状态与标题, 没有人会把它读成别的字段;
//   Panda 侧的 @ 不是文案而是用户名的一部分(粘出去就是 @xxx), SOOP 侧的频道名粘出去就是裸的 tnwl9630 ——
//   所以两平台各自的写法保留, 撤掉的只有我们替它加上去的那个前缀。
// ============================================================================
{
  const lc = fs.readFileSync(R('src', 'renderer', 'src', 'components', 'LiveCard.vue'), 'utf8')
  const wsv = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'WorkspaceView.vue'), 'utf8')
  const zh = fs.readFileSync(R('src', 'renderer', 'src', 'i18n', 'locales', 'zh-CN.ts'), 'utf8')
  const en = fs.readFileSync(R('src', 'renderer', 'src', 'i18n', 'locales', 'en-US.ts'), 'utf8')

  assert(/\? m\.userId : '@' \+ m\.userId/.test(lc) && /\? a\.userId : '@' \+ a\.userId/.test(wsv), 'D40a 卡片与离线行的 SOOP ID 槽都是裸频道名(Panda 仍 @用户名 —— 那是可粘贴地址的一部分, 不是文案)')
  assert(!/roomNo/.test(zh) && !/roomNo/.test(en) && !/房间 \{id\}|Room \{id\}/.test(zh + en), 'D40b「房间 {id}」这个带前缀的写法连两语言键一起绝迹(唯一消费方已改口, 死键不留)')
  const prefixed = RENDERER.filter((f) => /t\(['"][\w.]*roomNo['"]/.test(fs.readFileSync(f, 'utf8')))
  assert(prefixed.length === 0, 'D40c 全仓不再有任何一处给 ID 加「房间」前缀', prefixed.map(rel).join(', '))
  // 同一判据的下一次出现: 播放页侧栏那一格长期无条件替两平台加 @, 而 SOOP 的 @tnwl9630 粘出去不是任何地址
  const pv = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'PlayerView.vue'), 'utf8')
  assert(/\{\{ isSoop \? userId : '@' \+ userId \}\}/.test(pv), 'D40d 播放页 ID 槽按平台各写各的: SOOP 裸频道名, Panda 留 @')
  assert(!/>@\{\{\s*userId\s*\}\}/.test(pv), 'D40e 播放页不再有无条件的 @ 前缀(那等于替 SOOP 编一个粘不出去的形状)')
}

// ============================================================================
// D41 播放页侧栏的「标签」整行撤掉: 房态在标题下方已有徽标, 普通房那一行只剩「—」 (2026-10-01 用户指令「这显示不了也去掉把, 不要占位」)
//   能提取到 —— SOOP 的关注行带 is_adult / is_password, 但只有 19+ / 密码 / 普通这一档, 粉丝团与回放是 Panda 的字段;
//   同一批 tags 在页头 ③ 标题元信息里已经画成徽标, 侧栏再列一遍是第二次呈现, 而"什么旗都没打"的多数房间只剩「—」占位。
//   撤的是行, 不是信号: 四枚徽标与 isVod(回放判定)必须原样在位。
// ============================================================================
{
  const pv = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'PlayerView.vue'), 'utf8')
  const zh = fs.readFileSync(R('src', 'renderer', 'src', 'i18n', 'locales', 'zh-CN.ts'), 'utf8')
  const en = fs.readFileSync(R('src', 'renderer', 'src', 'i18n', 'locales', 'en-US.ts'), 'utf8')

  assert(!/labelList/.test(pv) && !/player\.labels/.test(pv), 'D41a 侧栏「标签」那一行连同它的取值 computed 一起绝迹(留半个死 computed 就是等下次挂回去)')
  assert(!/^    labels: /m.test(zh) && !/^    labels: /m.test(en), 'D41b player.labels 双语死键同删(唯一消费方已撤)')
  const badges = ['account.tagPw', '19+', "tags?.type === 'fan'", 'isVod'].filter((k) => !pv.includes(k))
  assert(badges.length === 0, 'D41c 房态信号仍在页头: 密码 / 19+ / 粉丝团 三枚徽标 + isVod 回放判定一处都不能少', badges.join(', '))
  assert(/const tags = computed\(\(\) => playTags\.value \|\| room\.value\.tags\)/.test(pv), 'D41d tags 仍走「回包 > 快照」那条链: 徽标读的是它, 撤一行不许把取值链也降级')
}

// ============================================================================
// D42 取源回写按字段合并: 这一路观察不到的字段不许写 false (2026-10-01 实机抓到 —— 19+ 房一开播旗就没了)
//   SOOP 的 getPlay 看不到 19+(GRADE 语义未实测), 过去它交一份 isAdult: false, applyPlayMeta 又整包覆写,
//   于是"取一次源 = 擦一次真值", 下一轮列表才写回来 —— 卡与页头之间的闪断就是这么来的(库里那一晚就是 false)。
//   修法在两处: 回包不带看不见的字段; 合并只认回包真给的值。动态面由 verify-playcache 的 T25 覆盖。
//   ㊌ 之后列表那一路也不再取房间级 19+(所以"下一轮列表写回来"已不成立), 但这一路的规定一字未改: 看不见的字段依然不许写成 false。
// ============================================================================
{
  const so = fs.readFileSync(R('src', 'main', 'services', 'soop.ts'), 'utf8')
  const sc = fs.readFileSync(R('src', 'main', 'services', 'source.ts'), 'utf8')
  const ip = fs.readFileSync(R('src', 'main', 'ipc.ts'), 'utf8')

  const mediaLine = (so.match(/media: \{[^}]*isPw[^}]*\}/) || [''])[0]
  assert(mediaLine !== '' && !/isAdult/.test(mediaLine), 'D42a SOOP 取源回包不再携带 isAdult(看不到 = 不给这一格, 给 false 就是替列表下结论)', mediaLine.slice(0, 90))
  assert(/: AnchorTag \| null/.test(sc) && /typeof m\.isAdult === 'boolean' \? m\.isAdult : !!prev\?\.isAdult/.test(sc), 'D42b applyPlayMeta 按字段合并并把合并结果交回去(整包覆写的老写法不得复活)')
  assert(/const merged = applyPlayMeta\(platform, userId, r\)/.test(ip) && /tags: merged \?\?/.test(ip), 'D42c 渲染层拿到的房态 = 库里那一份(SOOP 走合并, Panda 仍走回包整包)')
}

// ============================================================================
// D43 播放源卡的两个出口各复制各的 (2026-10-01 用户指令「搞成能一键复制真地址的吧」)
//   屏上那串是本机才认的代理地址, 官方清单原址就压在它的 url= 参数里 —— 解出来零请求, 不必回主进程再要一个字段。
//   两枚按钮不是重复读数: 一个是"现在正在用的", 一个是"平台那张清单的原样", 各自与自己的标签相符。
//   出口只在地址真是代理地址时才出现(Panda 看到的就是真地址, 给它第二枚等于造一个恒等的假选项)。
// ============================================================================
{
  const pv = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'PlayerView.vue'), 'utf8')
  const zh = fs.readFileSync(R('src', 'renderer', 'src', 'i18n', 'locales', 'zh-CN.ts'), 'utf8')
  const en = fs.readFileSync(R('src', 'renderer', 'src', 'i18n', 'locales', 'en-US.ts'), 'utf8')

  assert(
    /const realSource = computed\(\(\) => \{\s*if \(!isProxySource\.value\) return m3u8\.value/.test(pv) &&
      /searchParams\.get\('url'\)/.test(pv),
    'D43a 真实源由本地代理地址的 url= 参数解出(Panda 直接原样返回) —— 这条出口不许变成第二次网络请求或主进程新字段'
  )
  const realBtn = (pv.match(/<button[^>]*@click="copyReal"[^>]*>\s*\{\{\s*t\('player\.copyReal'\)\s*\}\}/) || [''])[0]
  assert(/v-if="isProxySource"/.test(realBtn) && realBtn !== '', 'D43b 「复制真实源」只在源真是本地代理地址时出现, 且标签与动作一致', realBtn.slice(0, 90))
  assert(/@click="copyUrl"/.test(pv) && /return copyText\(m3u8\.value,/.test(pv), 'D43c 「复制」仍复制屏上那串正在用的源 —— 复制的必须等于看到的')
  const fallbacks = (pv.match(/document\.execCommand/g) || []).length
  assert(fallbacks === 1, 'D43d 剪贴板回退只有一份(两枚按钮共用 copyText): 复制第二份就是下次只改漏一半', `命中 ${fallbacks} 处`)
  // 只约束 srcProxyTip 这一个 key 的值: 「无法播放」在别处是正当文案(player.noPlay / 文件失效那句), 整文件否定会拦下正常文案
  const tipOf = (src) => (src.match(/srcProxyTip: '([^']*)'/) || [''])[1]
  const tipZh = tipOf(zh)
  const tipEn = tipOf(en)
  assert(
    tipZh !== '' && tipEn !== '' &&
      /copyReal: |copiedReal: /.test(zh) && /copyReal: |copiedReal: /.test(en) &&
      !/无法播放|will not work/.test(tipZh) && !/无法播放|will not work/.test(tipEn),
    'D43e copyReal / copiedReal 双语齐, 且 srcProxyTip 不再警告"复制出去放不了"(出口已给出, 留着就是自相矛盾的说明书)',
    `zh=${tipZh} / en=${tipEn}`
  )
}

// ============================================================================
// D44 SOOP 的房间级 19+ 标记整条不取 (2026-10-01 真机 7 轮 + 用户定「标记不重要, 可以不展示」)
//   平台自己会在同一场直播里改口(同一 broad_start: true→false×3→true), 所以"保住上一轮真值"救不了闪断;
//   而这一旗的消费面只有展示(卡片徽标 / 页头徽标 / TG 的 [19+]) —— 能不能取到 19+ 的源靠 SOOP 登录态与账号的成人认证。
//   规定落在五处: 解析层不读 is_adult → 列表回写不继承它(顺带清掉旧轮次残留) → 密码房旗照旧三态+?? → 下播仍只清场次属性(Panda 受益) → 读库时把已离线房的旧 true 收敛掉(它没有第二个写点)。
//   动态面由 verify-follows 的 B3/B6 覆盖。
// ============================================================================
{
  const so = fs.readFileSync(R('src', 'main', 'services', 'soop.ts'), 'utf8')
  const wa = fs.readFileSync(R('src', 'main', 'services', 'watcher.ts'), 'utf8')
  const lc = fs.readFileSync(R('src', 'renderer', 'src', 'components', 'LiveCard.vue'), 'utf8')
  const pv = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'PlayerView.vue'), 'utf8')
  const tg = fs.readFileSync(R('src', 'main', 'services', 'tgFormat.ts'), 'utf8')

  const liveIface = (so.match(/export interface SoopFavoriteLive \{[\s\S]*?\n\}/) || [''])[0]
  const parsedLiteral = (so.match(/row\.live = \{[\s\S]*?\n  \}/) || [''])[0]
  assert(
    liveIface !== '' &&
      !/isAdult/.test(liveIface) &&
      parsedLiteral !== '' &&
      !/is_adult|isAdult/.test(parsedLiteral.replace(/\/\/[^\n]*/g, '')),
    'D44a SOOP 关注行不再解析 is_adult: 接口与 row.live 字面量里都不许有这一格(注释里提到它是为了说明为什么没有)',
    parsedLiteral.slice(0, 80)
  )
  const asr = (wa.match(/private applySoopRow[\s\S]*?\n  \}/) || [''])[0]
  assert(
    asr !== '' && /isAdult: false,/.test(asr) && !/live\.isAdult/.test(asr) && !/a\.tags\?\.isAdult/.test(asr),
    'D44b 列表回写不继承房间级 19+(恒 false, 顺带把旧轮次残留的 true 清掉): 上一轮的 isAdult 不得再进这一路',
    asr.slice(0, 60)
  )
  assert(
    /isPw: typeof live\.is_password === 'boolean' \? live\.is_password : undefined/.test(so) &&
      /isPw: live\.isPw \?\? a\.tags\?\.isPw \?\? false/.test(asr),
    'D44c 密码房旗不受这一刀影响: 解析仍留 undefined(不知道), 合并仍保住上一轮真值 —— 它决定弹不弹密码框、录制带不带密码'
  )
  const offPatch = (wa.match(/private offPatch[\s\S]*?\n  \}/) || [''])[0]
  assert(
    /tags: a\.tags \? \{ isAdult: a\.tags\.isAdult, isPw: false, type: a\.tags\.type, liveType: '' \} : null/.test(offPatch),
    'D44d 下播补丁分家照旧(㊌ 之后为 Panda 的 19+/粉丝团服务): 场次属性清, 房态属性留 —— 整对象写 null 就是把房间读成普通房',
    offPatch.slice(0, 80)
  )
  assert(
    !/soopBlindAdult/.test(wa) &&
      /v-if="m\.isAdult"/.test(lc) &&
      /v-if="tags\?\.isAdult"/.test(pv) &&
      /tags\?\.isAdult/.test(tg),
    'D44e 随这一路一起绝迹的只有那个盲读计数; Panda 的 19+ 三处消费端(卡片徽标 / 页头徽标 / TG [19+])一处都不许被顺手删掉'
  )
  // f 读库时收敛旧残留(2026-10-01 复验抓到): 在播房每轮被列表回写成 false, 而**已经离线**的房再无写点,
  //   offPatch 保的又是"房间属性"—— 对 SOOP 这一格自 ㊌ 起不再是属性, 于是 papcon0206 下播后页头仍画 19+。
  {
    const st = fs.readFileSync(R('src', 'main', 'services', 'store.ts'), 'utf8')
    const norm = (st.match(/^\s*if \(a\.platform === 'soop'[^\n]*$/m) || [''])[0]
    assert(
      norm !== '' && /a\.tags\?\.isAdult/.test(norm) && /isAdult: false/.test(norm) && /\.map\(migrateAnchor\)/.test(st),
      'D44f 旧库残留的 SOOP 房间级 19+ 在读库时清掉(幂等): 判据精确到 soop 那一行, 且 migrateAnchor 仍在 load 的逐条路径上 —— 离线的 SOOP 房没有第二个写点, 不在这里收敛就永久挂在页头',
      norm.slice(0, 90)
    )
    assert(
      !/platform === 'pandalive'[^\n]*isAdult: false/.test(st) && /isAdult: !!item\.isAdult/.test(wa) && /isAdult: !!x\.isAdult/.test(wa),
      'D44g Panda 的 19+ 仍由它自己的列表维护(watcher 的两处 !! 读值): 读库收敛只认 soop, 不许把 pandalive 的正当真值一并擦掉'
    )
  }
}

// ============================================================================
// D45 监控配置按平台分家 (2026-10-01 用户指令「现在是 2 个平台公用的, 我要改成 2 个平台独立, 自己用自己的」)
//   当轮四条决策: ①只拆节奏三格(pollIntervalSec / requestGapMs / prefetchStream), proxyUrl 与 autoRetryRecord 明确不拆;
//   ②三格搬进各自平台节, 全局「监控」节随之撤销(只剩 defaultWorkspace 一格, 那一节已是空壳, 并入外观);
//   ③引擎两套独立定时器(用户否掉了"一条时间轴 + 到期判定"的省事方案);
//   ④SOOP 节里「源保活 / 备用线路 · 官方无对应机制」先不动, 保持只报不改。
//   规定落在六层: 契约(矩阵取代三标量) → 迁移(老库一格铺成两格、顶层旧键删净) → 闸门(逐平台逐格夹) →
//   引擎(两条 timer + 两条预取队列, Panda 熔断只压自己那条时间轴) → 消费端(ipc/启动/读数一律带平台) → 界面与文案。
//   动态面: verify-playcache T26(预取与间隔互不带走、熔断只压自己) + verify-settings A6h/A7d/A16c~A16i/B5b/B5c + verify-notify A3/A5/A7b/A7c/A9b。
// ============================================================================
{
  const ty = fs.readFileSync(R('src', 'shared', 'types.ts'), 'utf8')
  const st = fs.readFileSync(R('src', 'main', 'services', 'store.ts'), 'utf8')
  const sg = fs.readFileSync(R('src', 'main', 'services', 'settingsGuard.ts'), 'utf8')
  const wa = fs.readFileSync(R('src', 'main', 'services', 'watcher.ts'), 'utf8')
  const ip = fs.readFileSync(R('src', 'main', 'ipc.ts'), 'utf8')
  const mi = fs.readFileSync(R('src', 'main', 'index.ts'), 'utf8')
  const pl = fs.readFileSync(R('src', 'preload', 'index.ts'), 'utf8')
  const sv = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'SettingsView.vue'), 'utf8')
  const tn = fs.readFileSync(R('src', 'renderer', 'src', 'components', 'TopNav.vue'), 'utf8')
  const wv = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'WorkspaceView.vue'), 'utf8')
  const pv = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'PlayerView.vue'), 'utf8')
  const zh = fs.readFileSync(R('src', 'renderer', 'src', 'i18n', 'locales', 'zh-CN.ts'), 'utf8')
  const en = fs.readFileSync(R('src', 'renderer', 'src', 'i18n', 'locales', 'en-US.ts'), 'utf8')

  const setIface = (ty.match(/export interface Settings \{[\s\S]*?\n\}/) || [''])[0]
  assert(
    setIface !== '' && /monitor: MonitorMatrix/.test(setIface) && !/^  (pollIntervalSec|requestGapMs|prefetchStream):/m.test(setIface),
    'D45a 契约只有一份真值: Settings 里那一格是矩阵, 顶层三个标量不许复活(留着就有"到底改哪个"的第二份真相)',
    setIface.slice(0, 60)
  )
  const monIface = (ty.match(/export interface MonitorRules \{[\s\S]*?\n\}/) || [''])[0]
  assert(
    monIface !== '' && /pollIntervalSec/.test(monIface) && /requestGapMs/.test(monIface) && /prefetchStream/.test(monIface),
    'D45b MonitorRules 三格齐 —— 拆的就是这一套节奏'
  )
  assert(!/proxyUrl|autoRetryRecord/.test(monIface), 'D45b2 范围守住: proxyUrl / autoRetryRecord 没混进矩阵(决策①明确不拆它们)')
  const defMon = (ty.match(/  monitor: \{\r?\n    pandalive:[\s\S]*?\r?\n    soop:[\s\S]*?\r?\n  \}/) || [''])[0]
  assert(
    /pandalive: \{ pollIntervalSec: 30, requestGapMs: 1200, prefetchStream: true \}/.test(defMon) &&
      /soop: \{ pollIntervalSec: 30, requestGapMs: 1200, prefetchStream: true \}/.test(defMon),
    'D45c 两平台默认同值 = 老库那一格铺开后的样子: 全新安装与升级安装不许行为不同(没改过设置的用户不该被换节奏)'
  )
  const mig = (st.match(/function migrateSettings[\s\S]*?\n\}/) || [''])[0]
  assert(
    mig !== '' && /legacyMon/.test(mig) && /r\.pollIntervalSec/.test(mig) && /r\.requestGapMs/.test(mig) && /r\.prefetchStream/.test(mig) && /toMonitorRules\(mm\.soop,[\s\S]{0,80}legacyMon/.test(mig),
    'D45d 老库那三格各铺进两平台同值(迁移不是重置: 只把"这一格归谁"说清楚)',
    mig.slice(0, 60)
  )
  const delLoop = (mig.match(/for \(const k of \[[\s\S]*?\]\)[\s\S]*?delete [^\n]*/) || [''])[0]
  assert(
    delLoop !== '' && ['pollIntervalSec', 'requestGapMs', 'prefetchStream'].every((k) => delLoop.includes(`'${k}'`)),
    'D45e 顶层旧键与九个死键在同一处删净: setSettings 是浅合并, 死键留在对象上就会永久回写 db.json',
    delLoop.slice(0, 60)
  )
  assert(
    /function mergeMonitor\(base: MonitorMatrix, inc: unknown\)/.test(st) && /monitor: mergeMonitor\(db\.settings\.monitor, patch\.monitor\)/.test(st),
    'D45f 写侧半格提交先与现值逐格兜底: 只交 SOOP 那一格不许把 Panda 整格写掉'
  )
  const numRange = (sg.match(/const NUM_RANGE[^=]*= \{[\s\S]*?\n\}/) || [''])[0]
  assert(
    numRange !== '' && !/pollIntervalSec|requestGapMs|prefetchStream/.test(numRange),
    'D45g 顶层数值表不再认识这三键(留着=给未注册键做夹紧, 还与矩阵那套两套口径)',
    numRange.slice(0, 60)
  )
  const monRange = (sg.match(/const MONITOR_RANGE[^=]*= \{[\s\S]*?\n\}/) || [''])[0]
  assert(/pollIntervalSec: \[5, 600\]/.test(monRange) && /requestGapMs: \[300, 10000\]/.test(monRange), 'D45h 矩阵内的数值区间逐格登记(与设置页控件同口径)')
  assert(/key === 'monitor'/.test(sg) && /function sanitizeMonitor/.test(sg), 'D45i 闸门认识 monitor 这一格: 未注册平台与拼错格名都要出声, 不是静默丢掉')

  assert(/private loop: Record<Platform, Loop> = \{ pandalive: newLoop\(\), soop: newLoop\(\) \}/.test(wa), 'D45j 决策③落地: 每平台自己的定时器/在飞标志/上次发车时刻/轮次计数')
  assert(!/this\.lastSoopRoundAt/.test(wa) && !/private timer: NodeJS/.test(wa), 'D45k 那条共用的时间轴与它给 SOOP 单设的节流闸门一并作废(字段留着就是假装有分家)')
  const ivf = (wa.match(/private intervalFor\(platform: Platform\): number \{[\s\S]*?\n  \}/) || [''])[0]
  assert(
    ivf !== '' && /platform === 'pandalive' && this\.status\.byPlatform\.pandalive\.circuitOpen/.test(ivf) && /monitor\[platform\]\.pollIntervalSec/.test(ivf) && /Math\.max\(1,/.test(ivf),
    'D45l 熔断的 30s 只压 Panda 自己那条(SOOP 不陪着提速), 间隔来自各自那一格, 1s 下限只防手改库写出 0'
  )
  assert(/private prewarmQueue: Record<Platform, string\[\]>/.test(wa) && /private prewarmPumping: Record<Platform, boolean>/.test(wa), 'D45m 预取队列与泵各平台一条: 共用版里 Panda 熔断的 length=0 会把排在队里的 SOOP 房一起丢掉')
  assert(/cfg\.monitor\[a\.platform\]\.prefetchStream/.test(wa), 'D45n 开播是否预取源, 看本平台那一格')
  assert(/this\.loop\.pandalive\.inFlight\) break/.test(wa), 'D45o 间隙泵让路看的是 Panda 自己那条时间轴(SOOP 在飞与它无关)')

  assert(/cfg\.monitor\[a\.platform\]\.prefetchStream\) watcher\.prewarmNow\(a\.platform/.test(mi), 'D45p 启动自热也按平台取格并只喂自己那条队列')
  assert(
    /watcher\.tick\(isPlatform\(platform\) \? platform : undefined\)/.test(ip) && /anchorsRefresh, \(_e, platform: Platform\)/.test(ip),
    'D45q 工作区「立即刷新」只惊动所在平台那一条, 不为另一个平台多发一轮(平台不认识才退回首轮语义)'
  )
  assert(/JSON\.stringify\(before\.monitor\[p\]\) !== JSON\.stringify\(cfg\.monitor\[p\]\)\) nudge\.add\(p\)/.test(ip), 'D45r 设置保存后逐平台比对那一条, 只惊动真的改了的那条时间轴')
  assert(/anchorsRefresh: \(platform\?: Platform\)/.test(pl), 'D45s preload 桥带上可选平台参数(不传=两平台各一轮的旧语义)')

  assert(!/key: 'monitor'/.test(sv) && !/data-sec="monitor"/.test(sv) && !/\|\s*'monitor'/.test(sv), 'D45t 决策②: 导航项与全局「监控」节一起撤销(那一节已只剩 defaultWorkspace 一格, 空壳节并入外观)')
  assert(
    ['pandalive', 'soop'].every((p) => new RegExp(`form\\.monitor\\.${p}\\.(pollIntervalSec|requestGapMs|prefetchStream)`).test(sv)) &&
      (sv.match(/form\.monitor\.pandalive\./g) || []).length >= 3 &&
      (sv.match(/form\.monitor\.soop\./g) || []).length >= 3,
    'D45u 三格在两个平台节里各绑各的, 且两平台都是满三格(少一格就是又一处"只改一半")'
  )
  assert(!/form\.(pollIntervalSec|requestGapMs|prefetchStream)\b/.test(sv), 'D45v 界面里不许再出现顶层节奏的读法')
  const secOf = (name) => {
    const i = sv.indexOf(`<section data-sec="${name}"`)
    if (i < 0) return ''
    const j = sv.indexOf('</section>', i)
    return sv.slice(i, j < 0 ? sv.length : j)
  }
  const pandaSec = secOf('panda')
  const soopSec = secOf('soop')
  assert(
    pandaSec !== '' &&
      /form\.monitor\.pandalive\.(pollIntervalSec|requestGapMs|prefetchStream)/.test(pandaSec) &&
      !/form\.monitor\.soop\./.test(pandaSec) &&
      soopSec !== '' &&
      /form\.monitor\.soop\.(pollIntervalSec|requestGapMs|prefetchStream)/.test(soopSec) &&
      !/form\.monitor\.pandalive\./.test(soopSec),
    'D45v2 每块平台节只绑自己那一格: 绑串了=在 SOOP 页上调间隔写进 Panda 那一格, 三格看着各就各位, 值的归属却错了'
  )
  assert(/monitor: \{ pandalive: clampMonitor\(f\.monitor\.pandalive\), soop: clampMonitor\(f\.monitor\.soop\) \}/.test(sv), 'D45w 提交载荷恒带两平台整格(半格=另一平台被浅合并写掉)')
  assert(
    /monitor\?\.\[plat\.value\]\?\.pollIntervalSec/.test(tn) && /monitor\?\.\[plat\.value\]\?\.pollIntervalSec/.test(wv) && /monitor\?\.\[platform\]\?\.pollIntervalSec/.test(pv),
    'D45x 三处轮询读数(顶栏 / 工作区分段 / 播放页)各读自己平台那一格 —— 共用时 SOOP 页报的是 Panda 的节奏'
  )
  assert(!/navMonitor|monitorDesc/.test(zh) && !/navMonitor|monitorDesc/.test(en) && !/^\s{4}monitor:/m.test(zh) && !/^\s{4}monitor:/m.test(en), 'D45y 节撤销后死键跟着死: navMonitor / settings.monitor / monitorDesc 双语都不留(有消费端时 D10 会查取词, 无人取词的键只能靠这一条)')
  assert(!/^\s*(pollSecDesc|gapMsDesc):/m.test(zh) && !/^\s*(pollSecDesc|gapMsDesc):/m.test(en), 'D45z 没有后缀的那两句必须随分家变成两套(留一句"通用说明"就是替另一个平台说话)')
  assert(['pollSecDescPanda', 'pollSecDescSoop', 'gapMsDescPanda', 'gapMsDescSoop'].every((k) => zh.includes(k) && en.includes(k)), 'D45za 四句分平台文案双语齐(D9 只保证键集合相等, 这一条保证真的各写各的事)')
  assert(
    /soopNa:/.test(zh) && /soopNa:/.test(en) && /t\('settings\.soopNa'\)/.test(sv),
    'D45zb 决策④的口径原样保留: SOOP 那一节仍只报不改(官方无对应机制), 分家这一刀没顺手把它做成假开关'
  )
}

// ============================================================================
// D46 首轮未落地时顶栏胶囊只报间隔 (2026-10-01 第十五轮真机复验查出, 台账 ㊍⑤f)
//   SOOP 关注列表 TLS 断连后降级逐房扫 718 位(约 20 分钟一轮), 那 20 分钟里胶囊一直读「60s · 0 毫秒」——
//   roundMs 的初值 0 不是"上一轮花了多久", 它是"还没量过"; 把它报出去等于替一件没发生的事签字。
//   判据同 ㊇: 结构性没有的那一格不摆行 —— 没量过就只报间隔, tooltip 里那句「上次拉取耗时」一起省略。
// ============================================================================
{
  const nav = fs.readFileSync(R('src', 'renderer', 'src', 'components', 'TopNav.vue'), 'utf8')
  const lzh = flatten(evalDefault(R('src', 'renderer', 'src', 'i18n', 'locales', 'zh-CN.ts')))
  const len = flatten(evalDefault(R('src', 'renderer', 'src', 'i18n', 'locales', 'en-US.ts')))
  assert(/const first = w\.lastRoundAt === null/.test(nav), 'D46a 胶囊先问"首轮落地没有"再决定报不报耗时(判据是 lastRoundAt, 不是 roundMs 的真假)')
  assert(/first \? t\('nav\.wHeartFirst', \{ sec: interval \}\) : t\('nav\.wHeart', \{ sec: interval, cost \}\)/.test(nav), 'D46b 首轮那一档的胶囊文本只带 {sec}, 耗时那一截整块省略')
  assert(/first \? t\('nav\.wTipFirst', \{ sec: interval \}\) : t\('nav\.wTip', \{ sec: interval, cost \}\)/.test(nav), 'D46c tooltip 走同一道闸门: 冷却与失败两档共用这一个 heartbeat, 首轮都不许说"上次耗时"')
  assert('nav.wHeartFirst' in lzh && 'nav.wHeartFirst' in len && ph(lzh['nav.wHeartFirst']) === 'sec' && ph(len['nav.wHeartFirst']) === 'sec', 'D46d wHeartFirst 双语齐且占位符只有 {sec}(这一格里再没有第二个字段可以撒谎)')
  assert('nav.wTipFirst' in lzh && 'nav.wTipFirst' in len && !/\{cost\}/.test(lzh['nav.wTipFirst'] + len['nav.wTipFirst']), 'D46e wTipFirst 双语齐且不含 {cost}')
  assert(/nav\.wHeart', \{ sec: interval, cost \}/.test(nav) && /nav\.wTip', \{ sec: interval, cost \}/.test(nav), 'D46f 首轮之后的读数没被牵连(带耗时的两句话照旧在位)')
}

// ============================================================================
// D47 模板结构必须当场编译得通过 (2026-10-01 台账 ㊍⑤a)
//   撤「监控」导航档时连带删掉了 svg 分支链的头一枚, v-else-if 失去相邻 v-if —— 十套脚本与两路 tsc 全绿, 直到 npm run build 才炸,
//   而 build 既不在 typecheck 链也不在 verify 链, CI 也只跑那两条。这一条把"模板还编译得过吗"变成日常断言, 不再等打包。
// ============================================================================
{
  const { parse, compileTemplate } = createRequire(import.meta.url)('vue/compiler-sfc')
  const vues = walk(R('src', 'renderer', 'src'), /\.vue$/)
  const broken = []
  for (const f of vues) {
    const src = fs.readFileSync(f, 'utf8')
    const { descriptor, errors } = parse(src, { filename: f })
    if (errors.length) {
      broken.push(`${rel(f)}: 解析失败 ${errors[0].message}`)
      continue
    }
    if (!descriptor.template) continue
    const res = compileTemplate({
      source: descriptor.template.content,
      filename: f,
      id: path.basename(f),
      scoped: descriptor.styles.some((s) => s.scoped)
    })
    if (res.errors.length) broken.push(`${rel(f)}: ${res.errors.map((e) => e.message || String(e)).join(' | ')}`)
  }
  // 探测器本身必须先证明会咬人: 否则"零错误"可能只是"什么都没检查"
  const probe = compileTemplate({ source: '<div><i v-if="a">x</i><b v-else-if="b">y</b></div><i v-else>z</i>', filename: 'probe.vue', id: 'probe' })
  assert(probe.errors.length > 0 && /v-else|v-if/.test(probe.errors.map((e) => e.message).join(' ')), 'D47a 变异自检: 断链的 v-else 必须被这套探测判为错误')
  assert(vues.length >= 20, 'D47b 普查覆盖渲染层每个 .vue', `命中 ${vues.length} 个`)
  assert(broken.length === 0, 'D47c 现存模板零编译错误(结构错误不再只有 build 才炸)', broken.join('\n         '))
}

// ============================================================================
// D48 store 的 getter 普查 (2026-10-01 复核: store.offlineAnchors 全仓零消费者, 按 ㊀「无消费方即删」撤除)
//   它和 ㊆ 那次撤坞是同一条规则的两种尺寸。getter 是四处残骸里最安静的一种: 没人调用也就不出错, 只在 store 里替一个已经不存在的界面占着名额。
// ============================================================================
{
  const appFile = R('src', 'renderer', 'src', 'stores', 'app.ts')
  const appSrc = fs.readFileSync(appFile, 'utf8')
  const strip = (s) => s.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const gi = appSrc.indexOf('getters: {')
  const body = appSrc.slice(gi, appSrc.indexOf('actions:', gi))
  const names = [...body.matchAll(/^ {4}([A-Za-z_]\w*):/gm)].map((m) => m[1])
  const others = RENDERER.filter((f) => path.resolve(f) !== path.resolve(appFile)).map((f) => strip(fs.readFileSync(f, 'utf8')))
  const dead = []
  for (const n of names) {
    // store 内部自引用也算消费者, 但要先抹掉它自己的定义那一行
    const selfRefs = strip(appSrc).replace(new RegExp(`^ {4}${n}:`, 'm'), '       :')
    const used = others.some((t) => new RegExp(`\\b${n}\\b`).test(t)) || new RegExp(`\\b${n}\\b`).test(selfRefs)
    if (!used) dead.push(n)
  }
  assert(names.length >= 5, 'D48a 普查解析到合理数量的 getter(少于 5 个说明解析器瞎了, 而不是真没有死键)', `names=${names.length}`)
  assert(dead.length === 0, 'D48b 每个 getter 都真有消费者(零消费者的死 getter 一律撤, 不留"以后可能用")', dead.join(', '))
  const remnants = SRC_ALL.filter((f) => /offlineAnchors/.test(fs.readFileSync(f, 'utf8')))
  assert(remnants.length === 0, 'D48c offlineAnchors 整体绝迹(定义与调用一处不留)', remnants.map(rel).join(', '))
}

// ============================================================================
console.log('\n' + '─'.repeat(72))
console.log(`设计契约: 通过 ${PASS} / 失败 ${FAIL}`)
if (FAIL) {
  console.log('\n失败项:')
  for (const f of fails) console.log(`  · ${f}`)
  process.exit(1)
}
