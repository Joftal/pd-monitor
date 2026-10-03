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
//   D49 时长单位: 轮次耗时恒按秒且只在一处格式化(胶囊与设置页不许各读各的), 中文格子不混拉丁 s; 节流/分段/熔断/长时长各自的单位是语境, 不许被顺手统一
//   D50 在播关注与站内发现的头两档排序同序(人气最高在前), 且默认档就跟着第一格(两视图默认都是人气最高)
//   D51 Panda 轮询换真值源(㊑): 一发站内关注列表判全部关注, 读不到必须回落而不是判全员下播, 下播仍要两轮, 匿名不发注定失败的那一发
//   D52 全站榜改按需(㊑): 大厅有独立入口 + 60 秒复用 + 熔断退避期拒发 + 失败保留旧快照 + 并发合流, 桥/预加载/IPC 三处接线齐全
//   D53 大厅与 watchMode 解耦(㊑): 逐个模式不再清空快照, 「模式不可用」那句连出口与死键一起撤, 发现页那一格读大厅自己的钟
//   D54 SOOP 降级探针有每轮预算(㊒): 环形游标轮换不饿死任何房, 未读数与新失明判据同口径改口
//   D55 SOOP 有自己的退避(㊒): 失明轮零请求零心跳、每个失明轮重新武装, 但绝不推 Panda 熔断位也不新增第二句读数
//   D56 SOOP 取流不再为拿场次号读整页(㊒): 列表播种的 broad_no 直接进第 2 步, 号过期/失效各有上界定性, 页面微缓存不拦探针
//   D57 作废纪元门(㊓①②): 显式作废/换号之后, 先于它发出的取流链不许把源写回缓存; 在飞两格(带密/不带密)一起摘; seedPlay 只认真源
//   D58 续录一次判活 + 退避(㊓③): 意外退出只现拉一发(同一发既判活又当种子), 重录按房挂计时器且指数退避, 手动接管即撤销时续录
//   D59 分页单飞·探针节流·刷新下限(㊓④⑤⑥⑦): 全站榜翻页只有一处实现且并发合流, 判死期不再每轮复读 login_info, 立即刷新有每平台 8 秒下限, 预取补扫挪到首轮之后
//   D60 三条老覆盖: 本机代理地址不给 ffmpeg 挂 -http_proxy, 旧全局键的删除清单逐键锁死, 无消费方即删
//   D61 保活泵改口(㊔): 周期 60 秒 + 间隔随规模自适应, 源缓存两道活性时限, 真死只认主档(㊕ 起心跳也只读主档)
//   D62 档位扇出只有一个闸口(㊔): SOOP 后台预取只解最高档, partial 只在真缺档时成立, Panda 不装这个旋钮
//   D63 在途键表达档级(㊔): 满档 caller 绝不接一份只解最高档的包, 在飞链按 key 装摘、按纪元门落缓存
//   D64 SOOP 风控记账(㊔): 判据只在接口上算数且排除 515, 只写表不抛、窗口内只出声一次, 冷却只归后台泵消费
//   D65 代理在途合流 + 门槛回执记账(㊔): 同一上游 target 并发只打一发且不缓存, 五个"不会自己好"的码记 15 分钟
//   D66 脚本自审(㊔): 验证脚本里不许出现恒真正则(裸 || / 匹配空串), 扫描本身要跑到
//   D67 按站后台车道(㊕): 一站一条道、间隔取本平台那一格、只在下端各接一处, 媒体/CDN 豁免, 排队有上限, 用户级不排队但照样落笔
//   D68 force 下限与关注列表合流(㊕): 手动刷新豁免 60 秒复用却不豁免 8 秒下限(与 tick 同一枚常量), 关注列表那一发有在飞合并且按身份撒
//   D69 预取让路 · 年龄收手(㊕): 泵与轮次/停轮让路但不清队, 两条队列随 stop 一起清; SOOP 抄同两档且收手零网络, 闸门只关心跳不关记账
//   D70 三处观测面(㊕): 兜底重发与代理合流各 60 秒出声一句(次数一起报), 页面读那一发按来源标签分得清谁在读
//   D71 保活扇出收口(㊕): 每源一轮一发主档, 心跳里没有档循环, 投影读数改口报"档在手"
//   D72 间隙泵续扫游标(㊖): 快照整批替换必须从上一窗口没扫到的那一间起排, 消费每间只计一次
//   D73 预取出队时重判真值(㊖): 排空要几分钟, 散场/取关的房不再为其拉整条链, 且跳过不清队
//   D74 Panda 也有自己的风控账(㊖): 五种风控形状全记账, 只让后台两条泵收手, 用户那一条与换号不受牵连
//   D75 播放器网络重试有上限(㊖): 致命错误的重连必须有终点, 满次数上抛换源而不是无限重连死源
//   D76 SOOP 降级态只留痕不减发(㊖, P1-1 改判): 失明轮数只喂日志, 不留退避死字段, 全灭轮不重复出声
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
/** 方法体收尾: 缩进两格的 `}` 才是类方法的那一刀。
 *  必须按 \r?\n 找 —— 工作树是 CRLF(core.autocrlf), 找字面 '\n  }\n' 会一路 slice 到文件末尾,
 *  于是"这个方法体内不得出现 X"的负向断言全部形同虚设(轮23 实测: 两条老契约因此凭空改判) */
const bodyEnd = (src, from) => {
  const m = /\r?\n {2}\}/.exec(src.slice(from))
  return m ? from + m.index : -1
}
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
  const ac = fs.readFileSync(R('src', 'renderer', 'src', 'components', 'AnchorCard.vue'), 'utf8')
  const ec = fs.readFileSync(R('src', 'renderer', 'src', 'components', 'ExploreCard.vue'), 'utf8')
  assert(
    !/soopBlindAdult/.test(wa) &&
      /v-if="m\.isAdult"/.test(lc) &&
      /v-if="tags\?\.isAdult"/.test(pv) &&
      /tags\?\.isAdult/.test(tg) &&
      /isAdult: a\.tags\?\.isAdult/.test(ac) &&
      /isAdult: x\.isAdult/.test(ec),
    'D44e 随这一路一起绝迹的只有那个盲读计数; Panda 的 19+ 消费端一处都不许被顺手删掉(㊓ 补范围: 在播卡 / 播放页页头 / TG [19+] / 关注卡 AnchorCard / 发现卡 ExploreCard —— 后两处读的是同一格, 曾落在断言之外)'
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

  assert(
    /if \(!store\.getSettings\(\)\.monitor\[platform\]\.prefetchStream\) return/.test(wa) &&
      /if \(L\.roundCnt === 1\) this\.prewarmSweep\(platform\)/.test(wa) &&
      !/watcher\.prewarmNow\(a\.platform/.test(mi),
    'D45p 预取补扫按本平台那一格, 且只在首轮落地后跑(㊓⑦: 开机即按库态群发的那段已从 index.ts 撤走)'
  )
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
// D49 时长单位: 同一个量只有一套读法 (2026-10-01 复核, 台账 ㊏)
//   两枚胶囊一个报「666 毫秒」一个报「8.6 秒」不是精度差异, 是 TopNav 里按数量级换单位 + 设置页另写一套 ms 的结果:
//   同一屏两枚同族胶囊先比单位再比快慢, 读的人第一眼看错了对象。耗时恒按秒(一位小数), 格式化收在 fmtRoundCost 一处。
//   另一头是语境: 节流 300 毫秒、分段 15 分钟、熔断 3 分钟、开播 2:14:07 —— 换秒只会把数字变长变碎, 那些格子不许被顺手统一。
// ============================================================================
{
  const media = fs.readFileSync(R('src', 'renderer', 'src', 'utils', 'media.ts'), 'utf8')
  const nav = fs.readFileSync(R('src', 'renderer', 'src', 'components', 'TopNav.vue'), 'utf8')
  const sv = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'SettingsView.vue'), 'utf8')
  const pv = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'PlayerView.vue'), 'utf8')
  const wv = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'WorkspaceView.vue'), 'utf8')
  const zhSrc = fs.readFileSync(R('src', 'renderer', 'src', 'i18n', 'locales', 'zh-CN.ts'), 'utf8')
  const enSrc = fs.readFileSync(R('src', 'renderer', 'src', 'i18n', 'locales', 'en-US.ts'), 'utf8')
  const lzh = flatten(evalDefault(R('src', 'renderer', 'src', 'i18n', 'locales', 'zh-CN.ts')))
  const len = flatten(evalDefault(R('src', 'renderer', 'src', 'i18n', 'locales', 'en-US.ts')))
  // ① 格式化只有一个出处
  assert(/export function fmtRoundCost\(ms: number\): string \{\s*return \(Math\.max\(0, ms\) \/ 1000\)\.toFixed\(1\)/.test(media), 'D49a fmtRoundCost 是唯一的"毫秒→秒"出处: 除以 1000 且固定一位小数(亚秒档的分辨率靠小数保住, 不靠换单位)')
  assert(/const cost = fmtRoundCost\(w\.roundMs\)/.test(nav) && /from '@\/utils\/media'/.test(nav), 'D49b 胶囊的耗时取 fmtRoundCost, 不再就地分档')
  assert(!/roundMs\s*<\s*1000/.test(nav) && !/\$\{w\.roundMs\}/.test(nav) && !/ms: soopStatus\.roundMs/.test(sv), 'D49c 两处消费点都没有第二套换算: 曾经分家的写法(按数量级换单位 / 裸 ms 直出)不得回来')
  assert(/t\('settings\.soopRound', \{ cost: fmtRoundCost\(soopStatus\.roundMs\)/.test(sv), 'D49d 设置页那行与胶囊同出处: 同一个 roundMs 在两屏上必须是同一个单位的同一个数')
  // ② 中文那一格不再混拉丁单位
  assert(/wHeart: '\{sec\} 秒 · \{cost\} 秒'/.test(zhSrc) && /wHeartFirst: '\{sec\} 秒'/.test(zhSrc), 'D49e 中文胶囊两处单位都是「秒」: 一枚胶囊里不再 {sec}s 与 毫秒/秒 并存')
  assert(/wHeart: '\{sec\}s · \{cost\}s'/.test(enSrc) && /last round took \{cost\}s/.test(enSrc), 'D49f 英文那一格保持拉丁 s 且耗时自带单位(fmtRoundCost 交的是裸数, 单位词归文案)')
  assert(ph(lzh['nav.wHeart']) === 'cost,sec' && ph(len['nav.wHeart']) === 'cost,sec', 'D49g {cost} 双语都仍在胶囊那句里(单位进文案不能顺手把字段挤掉)')
  assert(/segInterval: '检测间隔 \{sec\} 秒'/.test(zhSrc) && /kaOn: '[^']*心跳 \{s\} 秒前'/.test(zhSrc), 'D49h 同族的两处中文读数一起改口: 工作区「检测间隔」与播放页「心跳 …前」不再各挂一个拉丁 s')
  assert(/t\('ws\.segInterval', \{ sec:/.test(wv) && /t\('player\.kaOn', \{ s,/.test(pv), 'D49i 改的是单位词不是数据源: 两处的占位符与调用方给的值原样不动')
  // ③ 死键跟着死
  assert(!('common.ms' in lzh) && !('common.sec' in lzh) && !('common.ms' in len) && !('common.sec' in len) && !/common\.ms|common\.sec/.test(nav + sv + pv + wv), 'D49j common.ms / common.sec 双语键与调用四处一起绝迹(唯一消费方已改口, 无消费方即删)')
  // ④ 语境例外不许被下一次"统一"顺手抹平
  const exceptions = [
    ['settings.gapMs', '单请求节流(毫秒)'],
    ['settings.splitSec', '分段时长(秒)'],
    ['player.segN', '{n} 分钟'],
    ['rec.segInfo', '分段 {min} 分钟/段'],
    ['player.fetchedAgoMin', '{n} 分前'],
    ['ws.segRoundAt', '上轮拉取 {time}']
  ]
  const stillZh = exceptions.filter(([k, want]) => lzh[k] !== want)
  assert(stillZh.length === 0, 'D49k 该留毫秒/分钟/钟面的格子原样在位: 节流 300 毫秒、分段按分钟、旧读数按钟面 —— 秒不是万能单位', stillZh.map(([k]) => `${k}=${lzh[k]}`).join(', '))
  assert(/export function fmtDurHMS\(sec: number\)/.test(media) && /const s = Math\.max\(0, Math\.round\(\(kaNow\.value - k\.lastAt\) \/ 1000\)\)/.test(pv), 'D49l 长时长仍走 h:mm:ss, 心跳那格本来就是整秒计数(它们不在本轮改动面内)')
}

// ============================================================================
// D50 排序档的排面与默认 (2026-10-01 用户指令「直播界面筛选顺序，最新开播和人气最高这2个位置进行交换」→「修改后默认还是在最新开播筛选态，应该变更为人气最高」)
//   两视图的 base 两档同序(人气最高在前), 而默认档跟着首位走: 冷启动第一眼的排序 = 左手第一格。
//   锁"同序"是因为同一个词在两视图落在不同格子会被读成两个档位; 锁"默认=首位"是因为这两件事一旦分家,
//   用户换了序却发现开箱还是旧档, 只会以为没改。
// ============================================================================
{
  const wv = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'WorkspaceView.vue'), 'utf8')
  const appSrc = fs.readFileSync(R('src', 'renderer', 'src', 'stores', 'app.ts'), 'utf8')
  const baseOf = (name) => {
    const i = wv.indexOf(`const ${name} = computed`)
    if (i < 0) return null
    // 必须在这一段 computed 内取到 base: 不设边界时前一段找不到会顺手读到后一段的 base, 假绿
    const end = wv.indexOf('\n})', i)
    const m = /const base: \{ key: SortKey; label: string \}\[\] = \[([\s\S]*?)\]/.exec(wv.slice(i, end))
    return m ? [...m[1].matchAll(/key: '(\w+)'/g)].map((x) => x[1]) : null
  }
  const live = baseOf('liveSorters')
  const disc = baseOf('discSorters')
  assert(live && disc, 'D50a 两视图的 base 档位块都解析得到(解析器瞎了不许冒充"顺序一致")', `live=${JSON.stringify(live)} disc=${JSON.stringify(disc)}`)
  assert(!!live && !!disc && live.join(',') === 'viewers,recent' && disc.join(',') === live.join(','), 'D50b 在播关注与站内发现的头两档同序: 人气最高在前、最新开播在后(交换的是排面, 不是各自的排序实现)', `live=${JSON.stringify(live)} disc=${JSON.stringify(disc)}`)
  assert(/views: \{ live: newFilter\('viewers'/.test(appSrc), 'D50c 在播关注的默认已是 人气最高(2026-10-01 用户指令改口: 换序就要连默认一起换, 冷启动第一眼不再读旧档)')
  // 默认档必须解析得到, 且与那一排的第一格同名 —— 首位与默认分家的形状从此站不住
  const defs = [...appSrc.matchAll(/(live|discover|offline): newFilter\('(\w+)'/g)]
  const dflt = Object.fromEntries(defs.map(([, v, k]) => [v, k]))
  assert(
    !!live && !!disc && Object.keys(dflt).length === 3 && dflt.live === live[0] && dflt.discover === disc[0],
    'D50d 在播/发现两视图的默认档就是各自第一格(解析到三份默认才许判), 默认与首位不许各说各话',
    JSON.stringify(dflt)
  )
}

// ============================================================================
// D51~D53 ㊑ Panda 轮询换真值源 + 大厅改按需 (2026-10-02 分析指令「保证时效性的同时尽可能避免风控触发」→ 实测后开工)
//   实测基线: 158 关注 = 1 发 /v1/live/bookmark / 90KB; 全站榜那条 = 4 页 / 403KB + 每轮扫一遍离线关注。
//   所以 list 模式的真值源换成站内关注列表(请求面与全站热度无关), 全站榜退回它本来的职责(大厅, 用户
//   真的站在发现页才拉)。这三条契约锁的是"换源不换语义": 读不到必须回落而不是判全员下播、下播仍要两轮、
//   匿名不发注定失败的那一发、没证明过的会话先问一句 login_info(冷启动不整轮落回四页)
//   —— 以及大厅不再被 watchMode 牵着走。
// ============================================================================
{
  const wt = fs.readFileSync(R('src', 'main', 'services', 'watcher.ts'), 'utf8')
  const pl = fs.readFileSync(R('src', 'main', 'services', 'pandalive.ts'), 'utf8')
  const seg = (decl) => {
    const i = wt.indexOf(decl)
    if (i < 0) return ''
    const j = bodyEnd(wt, i)
    return wt.slice(i, j < 0 ? undefined : j)
  }
  assert(/const riskHold = api\.oracleRiskCooling\(\)\s*\r?\n\s*const viaBookmark = await this\.roundByBookmark\(anchors, riskHold\)/.test(wt) && /if \(viaBookmark === null && riskHold\) \{[\s\S]{0,340}return\s*\r?\n\s*\}[\s\S]{0,60}if \(viaBookmark === null\) \{[\s\S]{0,200}this\.pandaLiveFound = await this\.roundByList\(anchors\)/.test(wt), 'D51a list 模式先问站内关注列表, 只有"读不到(null)"才回落全站榜 —— 绝不把没读到当成就没人播。㊘(R28-3) 回落那一支多一道风控闸: 这一站正拦着我(冷却账未到)时"读不到"不是"换个更贵的问法"的理由, 旧写法把它当扳机 ⇒ 同一轮改打 5 页全站榜 + 逐房复查 + 间隙泵约 100 发 = 现场量级 ≈110 发/轮。㊙(R29-1) 这道闸读的是"整表那一发自己被拒"那一格, 不是总账')
  const bm = seg('private async roundByBookmark(')
  assert(bm.length > 0 && !/fetchLivePage|roundByList/.test(bm), 'D51b 预言机自己一页全站榜都不发(它只覆盖"我关注的人", 请求面与全站热度无关)', bm.slice(0, 60))
  assert(/if \(!api\.hasSession\(\)\) \{[\s\S]{0,120}return null/.test(bm), 'D51c 匿名(罐里没有会话)不发这一发(实测必回 result:false, 每轮白掷)')
  assert(/if \(!api\.cookieValid\) \{[\s\S]{0,600}await api\.checkLoginInfo\(\)[\s\S]{0,400}api\.cookieValid = true/.test(bm), 'D51g 「罐在但没证明」先问一句 login_info 再决定(30 秒缓存在飞合并): 冷启动第一轮不该因为一个初值 false 就整轮落回全站榜四页 —— 真机实测过这个坑')
  assert(/this\.pandaOracle = 'list'[\s\S]{0,200}return null/.test(bm) && /this\.pandaOracle = 'bookmark'/.test(bm), 'D51d 两条链各归各的账(轮次日志据此判本轮是"1 发问完 158"还是"真的看过全站")')
  // 边界必须收在这一个方法体内: `if (n < 2)` 在 SOOP 那两轮里各出现一次, 不设界会把它们当本条的证据(变异测试实测)
  const mo = seg('private markPandaOffline(')
  assert(mo.length > 0 && /if \(n < 2\)/.test(mo) && /this\.onLiveEnd\(a\)/.test(mo), 'D51e 预言机报下播仍要两轮才翻转(单轮读数不发通知、不停播、不作废旧源)', mo.slice(0, 60))
  assert(/async fetchBookmarks\(\)[\s\S]{0,400}const limit = 200/.test(pl), 'D51f 站内关注一发 limit=200 = 官方上限(实测 158 条一发收满, 分页留作上限被抬高的保险)')
}
{
  const wt = fs.readFileSync(R('src', 'main', 'services', 'watcher.ts'), 'utf8')
  const ipc = fs.readFileSync(R('src', 'main', 'ipc.ts'), 'utf8')
  const pre = fs.readFileSync(R('src', 'preload', 'index.ts'), 'utf8')
  const ty = fs.readFileSync(R('src', 'shared', 'types.ts'), 'utf8')
  const seg = () => {
    const i = wt.indexOf('async refreshDiscovery(')
    return i < 0 ? '' : wt.slice(i, bodyEnd(wt, i))
  }
  const rd = seg()
  assert(rd.length > 0, 'D52a 大厅有独立的按需刷新入口(轮询不再是全站榜的唯一发车人)')
  assert(/const since = Date\.now\(\) - this\.status\.discoveryAt\s*if \(!force && since < 60_000\)/.test(rd), 'D52b 60 秒内的快照直接复用: 来回切视图/翻页/搜索不再各打一遍官网四页(force 只豁免这一条, 8 秒下限见 D67)')
  assert(/circuitOpen \|\| Date\.now\(\) < this\.cooldownUntil/.test(rd), 'D52c 熔断与退避期一发都不发(与间隙泵同语义), 调用方继续看旧快照')
  assert(/if \(liveMap\.size\) this\.publishDiscovery\(liveMap\)/.test(rd), 'D52d 刷新失败保留上一份快照: 一页都没取到 ≠ 全站没人播')
  assert(/if \(this\.discoveryInFlight\) return this\.discoveryInFlight/.test(rd), 'D52e 并发刷新合并在飞的那一次(不把整批页发两遍)')
  assert(!/this\.discovery = \[\]/.test(wt), 'D52f 没有任何一处再把大厅清空(旧实现用"清空"来表达"逐个模式大厅不可用", ㊑ 起大厅与 watchMode 无关)')
  assert(/discoveryRefresh\(force\?: boolean\): Promise<DiscoveryItem\[\]>/.test(ty) && /discoveryRefresh: 'discovery:refresh'/.test(ty), 'D52g ApiBridge 与通道名成对声明')
  assert(/discoveryRefresh: \(force\?: boolean\)[\s\S]{0,80}invoke\(CH\.discoveryRefresh, force\)/.test(pre), 'D52h preload 把 force 传到底(手动刷新不许在桥这一层被吞成 false)')
  assert(/CH\.discoveryRefresh[\s\S]{0,120}watcher\.refreshDiscovery\(force === true\)/.test(ipc), 'D52i IPC 侧只认 force === true(渲染层送来任何非布尔的脏值都不算"强制刷新"的通行证)')
  const pb = (() => { const i = wt.indexOf('private publishDiscovery('); return i < 0 ? '' : wt.slice(i, bodyEnd(wt, i)) })()
  assert(/this\.status\.discoveryAt = Date\.now\(\)/.test(pb) && !/this\.discoveryAt\b/.test(wt), 'D52j 大厅时刻只有一个家(status.discoveryAt): 私有一式一份的写法迟早漂移, 而渲染层读的是那份公开的')
  assert(/this\.pushDiscovery\(\)[\s\S]{0,200}this\.push\(\)/.test(pb), 'D52k 快照广播时同步推一次状态: 只有 discovery 那一条落屏、时刻却等下一轮才更新的话, 页头会显示"拉取于 上一轮"')
}
{
  const wv = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'WorkspaceView.vue'), 'utf8')
  const wt = fs.readFileSync(R('src', 'main', 'services', 'watcher.ts'), 'utf8')
  const zh = fs.readFileSync(R('src', 'renderer', 'src', 'i18n', 'locales', 'zh-CN.ts'), 'utf8')
  const en = fs.readFileSync(R('src', 'renderer', 'src', 'i18n', 'locales', 'en-US.ts'), 'utf8')
  assert(/view\.value === 'discover' && !isSoop\.value\) await api\.discoveryRefresh\(true\)/.test(wv), 'D53a 发现页的手动刷新走大厅自己的入口(不再"重拉关注"绕一圈)')
  assert(/view\.value === 'discover' && !isSoop\.value\) void api\.discoveryRefresh\(\)\.catch/.test(wv), 'D53b 站到发现页就取一次快照: 全站榜不再搭轮询的车以后, 这一屏自己就是发车人')
  assert(!/gotoDetectList|emptyDiscoverPerAnchor/.test(wv + zh + en), 'D53c 「大厅在逐个模式不可用, 请切回列表模式」那句话与它的出口一起删净了(模式管的是怎么查关注, 不管大厅有没有数据)')
  assert(/站内覆盖=\$\{this\.pandaCovered\}/.test(wt) && /全站=\$\{this\.status\.liveCount\}/.test(wt), 'D53d 轮次摘要日志分家: 预言机报覆盖数, 兜底轮才报全站在播数(否则 全站= 会被读成上一份大厅快照)')
  assert(/一个请求覆盖全部关注/.test(zh) && /one bookmark-list request per round/.test(en), 'D53e 模式说明讲的是"怎么查我的关注", 双语同口径')
  assert(/列表模式每轮只发一发站内关注列表/.test(zh) && !/大厅/.test(zh.match(/pollSecDescPanda: '[\s\S]{0,200}'/)?.[0] || ''), 'D53f 轮询间隔那格的建议值跟着新真值源改口, 且不再顺带承诺大厅的有无')
  const segc = (() => { const i = wv.indexOf('const seg = computed'); return i < 0 ? '' : wv.slice(i, wv.indexOf('\n})\n', i)) })()
  const disc = (() => { const i = segc.indexOf("view.value === 'discover'"); return i < 0 ? '' : segc.slice(i, bodyEnd(segc, i)) })()
  assert(/store\.watcher\?\.discoveryAt/.test(disc) && /ws\.segHallAt/.test(disc), 'D53g 发现页那一格的时间是大厅自己的钟(㊑): 全站榜不再搭轮询的车以后, 在这屏说"上轮拉取"是把轮次的计时器借给大厅')
  assert(disc.length > 0 && !/segRoundAt|segInterval/.test(disc), 'D53h 发现页不再回落轮次时间或检测间隔(大厅没拉过就不摆时间, 不借别处的钟凑一句)')
  assert(/segHallAt: '拉取于 \{time\}'/.test(zh) && /segHallAt: 'Pulled \{time\}'/.test(en), 'D53i segHallAt 双语成对(只在发现页出现的一格, 不该留英文界面的孤儿键)')
}

// ============================================================================
// D54~D56 ㊒ SOOP 降级链的三重收口(2026-10-02 第 21 轮, 用户指令「按你的建议进行调整」)
//   实测基线: 718 个 SOOP 关注, 列表整表不可用时"每房一发"= 718 发/轮 ≈ 5.7 万发/天, 且网络越坏发得越凶;
//   取流五步链的第一发整页 HTML(≈200KB)只为拿一个 nBroadNo, 而列表那一发本来就把 broad_no 全给了。
//   三条契约分别锁: 探针的每轮预算与环形轮换(D54)、SOOP 自己的退避且绝不连坐 Panda(D55)、
//   场次号复用与播放页微缓存(D56)。行为侧的对应用真源码跑请求计数(verify-playcache T24/T28、verify-follows F 段)。
// ============================================================================
{
  const wt = fs.readFileSync(R('src', 'main', 'services', 'watcher.ts'), 'utf8')
  const seg = (decl) => {
    const i = wt.indexOf(decl)
    if (i < 0) return ''
    const j = bodyEnd(wt, i)
    return wt.slice(i, j < 0 ? undefined : j)
  }
  const rs = seg('private async roundSoop(')
  assert(/private static SOOP_PROBE_BUDGET = 40/.test(wt) && /const budget = Watcher\.SOOP_PROBE_BUDGET/.test(rs), 'D54a 降级探针有每轮预算, 且预算只有一处定义(要改就只改一处)')
  assert(/if \(probe\.length > budget\) \{[\s\S]{0,600}this\.soopProbeCursor = 0/.test(rs), 'D54b 刀只在真超出时落, 未超即游标归零 —— "少数几个房不在列表里"这一常态与改造前一字不差')
  assert(/const start = this\.soopProbeCursor % probe\.length/.test(rs) && /sent = \[\.\.\.probe\.slice\(start\), \.\.\.probe\.slice\(0, start\)\]\.slice\(0, budget\)/.test(rs), 'D54c 切的是环形窗口而不是头一段: 本轮被挡下的房下一轮排到队首, 不会被永久饿死')
  assert(/this\.soopProbeCursor = \(start \+ budget\) % probe\.length/.test(rs), 'D54d 游标推进取模(轮完一圈回队首), 不留单调递增、迟早越界的游标')
  assert(/for \(const a of sent\)/.test(rs) && !/for \(const a of probe\)/.test(rs), 'D54e 循环只消费 sent: 预算不是日志里的装饰, 真发出去的就是那一刀')
  assert(/roundFailed = fail \+ \(probe\.length - sent\.length\)/.test(rs), 'D54f「未读到状态」的口径随预算一起改口: 发出且失败的 + 本轮被挡下的 = 顶栏/工作区那一句的 N(旧口径只数 fail, 有了预算就少报)')
  assert(/covered === 0/.test(rs) && /fail === sent\.length/.test(rs) && !/fail === anchors\.length/.test(rs), 'D54g 失明判据跟着改口(列表一个房都没覆盖 + 实际发出的全灭): 老的 fail===anchors.length 在预算下永远不成立, 留着等于"永远不会瞎"')
}
{
  const wt = fs.readFileSync(R('src', 'main', 'services', 'watcher.ts'), 'utf8')
  const mi = fs.readFileSync(R('src', 'main', 'i18n.ts'), 'utf8')
  const seg = (decl) => {
    const i = wt.indexOf(decl)
    if (i < 0) return ''
    const j = bodyEnd(wt, i)
    return wt.slice(i, j < 0 ? undefined : j)
  }
  const rt = seg('private async roundSoopTop(')
  const rs = seg('private async roundSoop(')
  const st = seg('start(): void {')
  assert(/if \(Date\.now\(\) < this\.soopCooldownUntil\) return/.test(rt), 'D55a SOOP 有自己的退避: 退避期整轮零请求(连列表那一发也不发) —— 失明时"每一轮都重发"的形状正是风控最忌讳的')
  assert(rt.indexOf('soopCooldownUntil) return') < rt.indexOf('this.roundSoop(') && rt.indexOf('soopCooldownUntil) return') < rt.indexOf('const sBegin'), 'D55b 门在发问与计时上游: 冷却轮既不请求也不写 lastRoundAt/roundMs(真发了才记时, 与 Panda 冷却同规约), 顶栏「上次拉取耗时」不被空转轮刷成刚刚')
  assert(/if \(this\.soopFailStreak >= 2\) this\.soopCooldownUntil = Date\.now\(\) \+ Watcher\.SOOP_COOLDOWN_MS/.test(rs), 'D55c 每个失明轮都重新武装(不是只有跨阈值那一次), 恢复当轮归零')
  assert(/this\.soopFailStreak = 0[\s\S]{0,80}this\.soopCooldownUntil = 0/.test(st), 'D55d 重启监控即把连败与退避一起作废: 只清一半会让新会话莫名哑五分钟')
  // 读数面只许一处出声: 退避这件事不许新造一句 key(watcher.soopDown 那句「这期间不会有 SOOP 开播通知」本就写着它)
  const soopKeys = [...new Set([...mi.matchAll(/'(watcher\.soop\w+)'/g)].map((m) => m[1]))].sort()
  assert(soopKeys.join(',') === 'watcher.soopDown,watcher.soopDownT,watcher.soopPartial', 'D55e 退避不新增第二句读数: 失明那句已在顶栏 tooltip 与工作区正文, 同一件事不在两处各说一遍', soopKeys.join(','))
  assert(!/circuitOpen/.test(rt) && !/circuitOpen/.test(rs), 'D55f SOOP 的失明只写自己那半截状态: 不推熔断位(㊍ 分家), 合并 circuitOpen 恒等于 Panda, 顶栏「去登录」那颗按钮因此仍是 Panda 专供')
}
{
  const so = fs.readFileSync(R('src', 'main', 'services', 'soop.ts'), 'utf8')
  const wt = fs.readFileSync(R('src', 'main', 'services', 'watcher.ts'), 'utf8')
  const seg = (src, decl) => {
    const i = src.indexOf(decl)
    if (i < 0) return ''
    const j = bodyEnd(src, i)
    return src.slice(i, j < 0 ? undefined : j)
  }
  const fp = seg(so, 'async fetchPlay(')
  const fv = seg(so, 'private async readFavorites(')
  const fb = seg(so, 'private freshBroadNo(')
  const fm = seg(so, 'async fetchPageMeta(')
  const rp = seg(so, 'private async readPageMeta(')
  assert(/const known = this\.freshBroadNo\(channel\)/.test(fp), 'D56a 取流先问一句"这一场的号我是不是已经有了"(列表整表白送 broad_no, 不用等于扔掉)')
  assert(/if \(r\.live\) this\.bnoCache\.set\(r\.userId, \{ bno: r\.live\.broadNo, at: Date\.now\(\) \}\)/.test(fv) && /else this\.bnoCache\.delete\(r\.userId\)/.test(fv), 'D56b 关注列表那一发顺手播种场次号, 而列表改口说离线就当场作废 —— 号是这一场的钥匙, 不是这个房的门牌')
  assert(/Date\.now\(\) - hit\.at >= SoopApi\.BNO_TTL/.test(fb) && /this\.bnoCache\.delete\(channel\)/.test(fb), 'D56c 号过期=当没读到过并删掉(不供成永久, 也不带着旧号白撞整链)')
  assert(/const meta = await this\.fetchPageMeta\(channel\)\s*return this\.runPlayChain\(channel, password, meta(, fullVariants)?\)/.test(fp), 'D56d 手里没号才读整页: 既有那条链路一字不动地留着(降级路径没被换掉, 只是不再是唯一路径; ㊔ 只多带一个档级参数)')
  assert(/if \(r\.ok \|\| r\.needPassword \|\| r\.needLogin\) return r/.test(fp), 'D56e 成功/要密码/要登录三类答案与场次号无关 → 原样回报, 不为它们多读一页')
  assert(/this\.bnoCache\.delete\(channel\)[\s\S]{0,250}this\.fetchPageMeta\(channel, false, false, '取流复查'\)/.test(fp), 'D56f 只有真失败才回读整页定性。㊘(R28-2) 改判: 那一发不再是 fresh —— 它问的是"这一页怎么说", 而十秒内刚读过的那一页(pageCache 由探针/上一条链写入)就是最新读数, 旧写法把微缓存与在途合并一并绕过 ⇒ 同一间房几秒内被买两页整页 HTML')
  assert(/if \(!m\.living \|\| m\.broadNo !== known\) return this\.runPlayChain\(channel, password, m(, fullVariants)?\)\s*return r/.test(fp), 'D56g 页面说没在播或给了新号才重走一次, 号还对得上就原样回报 —— 复用的代价上界恒为 1 页 + 1 次整链, 不会滚成三次五步(㊔ 重走时档级沿用 caller 要的那一份)')
  assert(/soopApi\.fetchPageMeta\(a\.userId, true, true, '探针'\)/.test(wt), 'D56h 轮询探针以 fresh 取页: 它就是"这房现在怎么样"的裁判, 而最短一档 5 秒比页面 TTL 还小, 缓存会把两轮读成同一份页')
  assert(/if \(!fresh\) \{[\s\S]{0,120}const hit = this\.pageCache\.get\(channel\)/.test(fm) && /if \(!fresh\) this\.pageInflight\.set\(channel, p\)/.test(fm), 'D56i fresh 同时绕过微缓存与在飞合并: 探针既不该拿旧页, 也不该把自己并进别人那一发的结果里')
  assert(/this\.pageCache\.set\(channel, \{ at: Date\.now\(\), meta \}\)/.test(rp) && /this\.pageCache\.size > 64/.test(rp), 'D56j 页面缓存只在真读到以后写, 且带 64 条上限(先清过期再截断, 不随关注数无界增长)')
  assert(/if \(meta\.living && meta\.broadNo\) this\.bnoCache\.set\(channel, \{ bno: meta\.broadNo, at: Date\.now\(\) \}\)/.test(rp), 'D56k 页面实读到的号同样进缓存(连击型取流第二次就不再读页), 但"在场且给得出号"才进 —— 离线/读数不足的一页不播种')
}

// ============================================================================
// D57~D60 第 22 轮(㊓): 结构性重复与扇出护栏
//   审计里的四条同类病灶都是"同一次意图被两条链各自实现"或"作废与在飞没有先后关系":
//     R4 作废只删了缓存, 没管在飞的链 → 缓存复活(= 已下播/已换号的房还能秒开)
//     R5 意外退出先拉一次判活, 续录再拉一次 → 源最抖的时刻打两条完整链, 且零退避
//     R6 全站榜翻页在轮询兜底与大厅刷新里各写了一遍 → 同时启动即翻两趟四页
//     R7 会话判死期每轮白问一句 login_info(它的 30 秒缓存短于轮询间隔)
//     R8 「立即刷新」没有下限: 人手连点即人手放大整站请求面
//   行为侧由 verify-playcache T29~T33 与 verify-follows G1~G4 用真源码数请求, 这里锁形状与"只有一处"。
// ============================================================================
{
  const so = fs.readFileSync(R('src', 'main', 'services', 'soop.ts'), 'utf8')
  const pa = fs.readFileSync(R('src', 'main', 'services', 'pandalive.ts'), 'utf8')
  const src = R('src', 'main', 'services', 'source.ts')
  const si = fs.readFileSync(src, 'utf8')
  // 本仓库三个文件是 CRLF: 段尾必须按 \r?\n 找, 否则窗口一路开到文件末尾(锁等于没锁)
  const seg = (s, decl) => {
    const i = s.indexOf(decl)
    if (i < 0) return ''
    const m = /\r?\n {2}\}\r?\n/.exec(s.slice(i))
    return s.slice(i, m ? i + m.index + m[0].length : undefined)
  }
  const count = (s, re2) => (s.match(re2) || []).length
  const trio = (s, id) =>
    count(s, /private playEpoch = new Map<string, number>\(\)/g) === 1 &&
    count(s, /private playEpochAll = 0/g) === 1 &&
    new RegExp(`private epochOf\\(${id}: string\\): number \\{[\\s\\S]{0,120}this\\.playEpochAll \\+ \\(this\\.playEpoch\\.get\\(${id}\\)`).test(s) &&
    new RegExp(`private bumpEpoch\\(${id}: string\\)`).test(s)
  assert(trio(so, 'channel') && trio(pa, 'userId'), 'D57a 纪元三件套在两平台各只有一套定义(逐房纪元 + 整表纪元): 换号那一档靠整表前移, 不靠逐房补刀')
  assert(
    /if \(r\.ok && this\.epochOf\(channel\) === e0\)/.test(so) && /if \(r\.ok && this\.epochOf\(userId\) === e0\)/.test(pa),
    'D57b 缓存写入受纪元门管: 这条链出发后被作废过, 结果照还给调用方但不许把源写回来'
  )
  for (const [name, s, id] of [['soop', so, 'channel'], ['panda', pa, 'userId']]) {
    const g = seg(s, `async getPlayCached(${id}`)
    assert(g.includes('const e0 = this.epochOf(') && g.includes('const p = (async') && g.indexOf('const e0 = this.epochOf(') < g.indexOf('const p = (async'), `D57c-${name} 纪元在链出发前取快照: 出发之后再取, 等于承认任何作废都晚于自己`)
    assert(/=== e0\)[\s\S]{0,240}return r/.test(g), `D57d-${name} 被挡下的那一发仍然 return r(门只管缓存, 不管给调用方答案)`)
    assert(count(s, /this\.playCache\.set\(/g) === 2, `D57e-${name} 全文件只有两处 playCache.set(纪元门那一处 + seedPlay): 不许有第三个写入口`, `实数=${count(s, /this\.playCache\.set\(/g)}`)
  }
  const invSo = seg(so, 'invalidatePlay(channel: string): void {')
  const invPa = seg(pa, 'invalidatePlay(userId: string): void {')
  assert(/this\.bumpEpoch\(channel\)/.test(invSo) && /this\.bumpEpoch\(userId\)/.test(invPa), 'D57f 显式作废即纪元 +1(顺序上先抬纪元再删缓存, 免得删与抬之间挤进一条链)')
  assert(
    /for \(const pw of \[('', )?'#pw'[^\]]*\]\)[\s\S]{0,60}for \(const fan of \[[^\]]*'#top'[^\]]*\]\)[\s\S]{0,60}this\.playInflight\.delete\(/.test(invSo) &&
      /this\.playInflight\.delete\(userId\)[\s\S]{0,60}this\.playInflight\.delete\(userId \+ '#pw'\)/.test(invPa),
    'D57g 在飞键的每一种形状(裸房 / 房#密码槽 / ㊔ 再加档级槽)作废时都必须摘净: 留一半 = 让新 caller 合进一条注定作废的链'
  )
  assert(
    /playEpochAll\+\+[\s\S]{0,120}this\.playCache\.clear\(\)[\s\S]{0,160}this\.playInflight\.clear\(\)/.test(seg(so, 'clearPlayCache(): void {')) &&
      /playEpochAll\+\+[\s\S]{0,120}this\.playCache\.clear\(\)[\s\S]{0,160}this\.keepaliveInfo\.clear\(\)[\s\S]{0,80}this\.playInflight\.clear\(\)/.test(seg(pa, 'clearPlayCache(): void {')),
    'D57h 换号/登出那一条: 整表纪元前移 + 缓存与在飞一起清(Panda 还带保活台账) —— 旧账号签发的源一枚都不许留下'
  )
  assert(
    /seedPlay\(channel: string, pack: PlayResult\): void \{\s*if \(!pack\.ok\) return/.test(so) &&
      /seedPlay\(userId: string, pack: PlayResult\): void \{\s*if \(!pack\.ok\) return/.test(pa) &&
      /seedPlay\(id: string, pack: PlayResult\): void/.test(si),
    'D57i 种子入口在三处对齐(契约 + 两平台实现), 且只认真源: ok=false 的包不许进缓存'
  )
}
{
  const rc = fs.readFileSync(R('src', 'main', 'services', 'recorder.ts'), 'utf8')
  const seg = (declRe) => {
    const m = declRe.exec(rc)
    if (!m) return ''
    const e = /\r?\n {2}\}\r?\n/.exec(rc.slice(m.index))
    return rc.slice(m.index, e ? m.index + e.index + e[0].length : undefined)
  }
  const hx = seg(/private async handleUnexpectedExit\(/)
  assert(
    !/\.fetchPlay\(/.test(hx) && /sourceFor\(this\.platform\)\.getPlayCached\(this\.userId, this\.password, true, false\)/.test(hx),
    'D58a 改口(㊕): 判活仍然现拉(第 3 参 true = 永不读缓存, 缓存里就是正在死的那一条, 原话不变), 但第 4 参 false 只解最高档 —— 旧写法直调 fetchPlay 把整张菜单买完(SOOP 实测 8~10 发), 而录制从来只用最高那一路'
  )
  assert(
    hx.includes('if (stillLive)') && hx.includes('this.freshSeed = play') && hx.indexOf('if (stillLive)') < hx.indexOf('this.freshSeed = play') && (rc.match(/this\.freshSeed = /g) || []).length === 1,
    'D58b 只有"还在播=中断"这一支留种子: 真下播那一支留给缓存的东西就是一个死源'
  )
  assert(/recorder\.maybeRetry\(\s*\{[\s\S]{0,320}?this\.freshSeed\s*\)/.test(rc), 'D58c 种子随失败收尾一起交给续录(finalize 已经作废过旧源, 这一发比它新)')
  const mr = seg(/\r?\n {2}maybeRetry\(/)
  assert(/if \(seed\?\.ok\) sourceFor\(prev\.platform\)\.seedPlay\(prev\.userId, seed\)/.test(mr), 'D58d 续录前先把种子种回: 新任务命中缓存即不再打第二条完整链(㊓②)')
  assert(/private static RETRY_BACKOFF_MS = 10_000/.test(rc) && /const delay = Recorder\.RETRY_BACKOFF_MS \* 2 \*\* \(streak - 1\)/.test(mr), 'D58e 退避按连续失败次数指数增长(上一条链刚死就立刻再打一条, 等于在源最抖的时刻把扇出打满)')
  assert(/setTimeout\(\(\) => \{[\s\S]{0,420}\}, delay\)/.test(mr), 'D58f 退避真作用在重排上(delay 是唯一的延后来源)')
  assert(/private retryTimers = new Map<string, NodeJS\.Timeout>\(\)/.test(rc) && /this\.retryTimers\.set\(\s*key,/.test(mr), 'D58g 计时器按房挂键: 两个房先后失效不得互相顶掉退避')
  assert(!/\.cancel\(\)/.test(rc) && (rc.match(/clearTimeout/g) || []).length >= 4, 'D58h 计时器一律 clearTimeout 撤(本仓库 TS lib 的 NodeJS.Timeout 没有 .cancel), 撤不掉的退避就是幽灵起录')
  assert(/if \(this\.shuttingDown\) return[\s\S]{0,200}void this\.start\(/.test(mr), 'D58i 到点那一下再问一次"还在关机流程里吗"(stopAll 与在飞退避之间有窗口)')
  assert(/if \(!opt\.auto\) \{[\s\S]{0,140}clearTimeout\(pend\)/.test(seg(/async start\(opt: StartRecOptions\)/)), 'D58j 用户手动接管 = 这条房不再欠一次自动续录(否则定时器会在手动任务收尾后再自作主张开录)')
  assert(/for \(const t of this\.retryTimers\.values\(\)\) clearTimeout\(t\)/.test(seg(/async stopAll\(\)/)), 'D58k 退出流程清空所有在等退避的计时器')
}
{
  const wt = fs.readFileSync(R('src', 'main', 'services', 'watcher.ts'), 'utf8')
  const mi = fs.readFileSync(R('src', 'main', 'index.ts'), 'utf8')
  const seg = (decl) => {
    const i = wt.indexOf(decl)
    if (i < 0) return ''
    const j = bodyEnd(wt, i)
    return wt.slice(i, j < 0 ? undefined : j)
  }
  const hp = seg('private async harvestPages(')
  const rd = seg('async refreshDiscovery(')
  const rl = seg('private async roundByList(')
  assert(
    (wt.match(/api\.fetchLivePage\(/g) || []).length === 1 && hp.indexOf('api.fetchLivePage(') >= 0,
    'D59a 全站榜翻页在 watcher 里只有一处实现(㊓④): 轮询兜底与大厅刷新各写一遍是同一条链的两次四页'
  )
  assert(/if \(this\.pageHarvest\) return this\.pageHarvest/.test(hp) && /if \(this\.pageHarvest === p\) this\.pageHarvest = null/.test(hp), 'D59b 在飞锁: 先来者翻页, 后来者合流; 撒锁按身份比(不许把下一批也并进上一批的尾巴)')
  assert(/return \{ liveMap, loginInfo, err: e \}/.test(hp) && /if \(err\) throw err/.test(rl), 'D59c 同一发请求两种吃法: 错不抛而是连着已翻到的部分带回, 由调用方决定"沿用旧快照"(大厅)还是"本轮失败"(轮次 —— 部分页不许冒充成功)')
  assert(/if \(err\) logger\.warn\('watcher', `大厅刷新失败, 沿用上一份快照/.test(rd) && /if \(liveMap\.size\) this\.publishDiscovery\(liveMap\)/.test(rd), 'D59d 大厅失败不空表也不改钟(读到多少算多少, 一页都没有就原样留着)')
  assert(/if \(r\.loginInfo\) loginInfo = r\.loginInfo/.test(hp), 'D59e 会话证据取"最后一个非空"的那页(旧写法取最后一页: 末页没带就等于没带)')
  const bm = seg('private async roundByBookmark(')
  assert(/private static LOGIN_PROBE_COOL_MS = 5 \* 60_000/.test(wt) && bm.includes('Date.now() < this.pandaProbeUntil') && bm.includes('await api.checkLoginInfo()') && bm.indexOf('Date.now() < this.pandaProbeUntil') < bm.indexOf('await api.checkLoginInfo()'), 'D59f 判死态下那一问有 5 分钟退避, 且门在发问上游(㊓⑤: login_info 自己 30 秒缓存短于轮询间隔 = 每轮白付一发)')
  assert(/if \(!info\.netFail\) this\.pandaProbeUntil = Date\.now\(\) \+ Watcher\.LOGIN_PROBE_COOL_MS/.test(bm), 'D59g 只有服务端明确"没登录"才武装退避: netFail(断网/风控)是读不到, 不是判死, 下一轮照问')
  assert(/this\.pandaProbeUntil = 0[\s\S]{0,160}for \(const p of PLATS\) this\.schedule\(p, 300\)/.test(seg('start(): void {')), 'D59h 重启监控即撤退避(冷启动第一轮照旧问一次, ㊑⑤ 那道门不因 ㊓⑤ 而退)')
  const tk = seg('tick(platform?: Platform)')
  assert(/private static TICK_MIN_MS = 8_000/.test(wt) && /if \(L\.lastAt && since < Watcher\.TICK_MIN_MS\)/.test(tk), 'D59i 「立即刷新」有每平台 8 秒下限(㊓⑥): 正常态一轮=一发整站列表, 连点即人手放大请求面; 刚落地一轮时再点本来也读不到新东西')
  assert(
    /if \(L\.lastAt && since < Watcher\.TICK_MIN_MS\) \{[\s\S]{0,240}?continue\s*\}/.test(tk) && /立即刷新节流/.test(tk),
    'D59j 被挡下的那一下有出声(节流不能长成"按钮坏了"), 且挡下即从节流那一格里 continue, 不再排程'
  )
  const ps = seg('private prewarmSweep(platform: Platform)')
  assert(/const cached = new Set\(sourceFor\(platform\)\.cachedSourceIds\(\)\)/.test(ps) && /if \(cached\.has\(roomKey\(platform, a\.userId\)\)\) continue/.test(ps), 'D59k 补扫跳过手上已有有效源的房(事实源就是卡片徽标那一枚, 不另立一本账)')
  assert(/if \(!store\.getSettings\(\)\.monitor\[platform\]\.prefetchStream\) return/.test(ps) && /!a\.isLive \|\| this\.isGone\(a\)/.test(ps), 'D59l 补扫读的是本平台那一格, 且只认真值: 库里 isLive 而本轮已判离线/查无此人的房一枚不排(㊓⑦ 开机群发那一段就是这么废掉的)')
  assert(!/prewarmNow\(a\.platform/.test(mi), 'D59m index.ts 里那段"按库态逐个 prewarm"已连循环一起撤(改由首轮后的补扫做), 不留第二处开机预取')
}
{
  const rc = fs.readFileSync(R('src', 'main', 'services', 'recorder.ts'), 'utf8')
  const st = fs.readFileSync(R('src', 'main', 'services', 'store.ts'), 'utf8')
  assert(
    /const LOOPBACK_RE = \/\^https\?:\\\/\\\/\(127\\\.0\\\.0\\\.1\|localhost\|\\\[::1\\\]\)\(:\|\\\/\)\/i/.test(rc) &&
      /if \(cfg\.proxyUrl && !LOOPBACK_RE\.test\(m3u8\)\) args\.push\('-http_proxy', cfg\.proxyUrl\)/.test(rc),
    'D60a 录制取的是本机 HLS 代理地址时绝不走用户代理: 回环地址若被 -http_proxy 接走, 分片会绕外网再绕回来(轻则断流重则整段坏包)'
  )
  {
    const i = st.indexOf('for (const k of [')
    const j = st.indexOf('])', i)
    const keys = st.slice(i, j).split(/[\r\n]+/).map((l) => (l.match(/^\s*'(\w+)'/) || [])[1]).filter(Boolean)
    assert(
      keys.join(',') === 'notifySystem,notifySound,tgLive,tgOffline,tgRecord,tgError,pollIntervalSec,requestGapMs,prefetchStream',
      'D60b 旧全局键的删除清单逐键锁死(㊍ 展开进矩阵后顶层必须删净, 否则 setSettings 浅合并把这些死键永久留在 db.json): 加键要理由, 减键更要',
      keys.join(',')
    )
  }
  assert(
    /settings: migrateSettings\(j\.settings\)/.test(st) && (st.match(/migrateSettings\(/g) || []).length === 2,
    'D60c 旧库形状只在读这一道收敛(load 里逐格迁移 + 删死键, 全库一处调用): 写侧再兜等于同时供着两套形状, 死键也就永远删不净',
    `调用点数=${(st.match(/migrateSettings\(/g) || []).length}`
  )
}

// ============================================================================
// D61~D65 第 23 轮(㊔): 请求面收口 —— 三个"没人要的请求"与两处"方向反了的复用"
//   这一轮的真值来自实测, 不是推理: master 令牌 exp=取源+585s, 而 5 条变体地址在**整轮无心跳**
//   的情况下 27.1 分钟仍 5/5 全活 —— 变体不靠心跳续命, 15s 一轮全档齐养(≈11.5 万发/天)是把自己当播放器。
//     R9  保活泵按 15s 无差别养所有缓存源(含已下播/已取关的): 周期与"该不该养"都要改
//     R10 SOOP 每多解一档多 2 发(预取 8~10 发链), 而预取的产出只是徽标亮一下: 后台不该要全档菜单
//     R11 风控信号只在 Panda 有账, SOOP 撞 403/429/HTML 后各泵照每轮重打: 越抖越打
//     R12 门槛类回执(付费/成人/粉丝/道具/本场已断)每次进房都重打整链, 换回同一句话
//     R13 代理端每个播放器请求各自打一次上游, 播放器+保活泵撞同一 target 即双份
//   行为侧由 verify-follows H/I/J、verify-playcache T34/T34b/T35、verify-p1 G5、verify-keepalive S13~S15 数实发请求。
// ============================================================================
{
  const pa = fs.readFileSync(R('src', 'main', 'services', 'pandalive.ts'), 'utf8')
  const segPa = (decl) => {
    const i = pa.indexOf(decl)
    if (i < 0) return ''
    const j = bodyEnd(pa, i)
    return pa.slice(i, j < 0 ? undefined : j)
  }
  assert(/private static KEEPALIVE_MS = 300_000/.test(pa) && !/KEEPALIVE_MS = (15_000|60_000)/.test(pa), 'D61a 泵周期 60s→5 分钟(㊗ C3): 心跳在这里不是续命手段而是"尽早发现真死"—— 实测无心跳 27 分钟变体全活 + 现场一天只有 1 次「保活连续真死」, 判死要 2 次连击 ⇒ 最坏 10 分钟收尸仍远在水位线之前')
  assert(/const wait = Math\.min\(900_000, Math\.max\(PandaApi\.KEEPALIVE_MS, this\.playCache\.size \* 2000\)\)/.test(pa) && /setTimeout\(\(\) => void loop\(\), wait\)/.test(pa), 'D61b 间隔随缓存规模自适应(㊗ C3: 每源 +2s, 封顶 900s)且真作用在重排上 —— 只在首轮用基准值; 300 源以内恒为 5 分钟基准, 更大规模时全场心跳之和不再随源数线性增长')
  assert(/private static KEEPALIVE_OFFLINE_TTL_MS = 30 \* 60_000/.test(pa) && /private static KEEPALIVE_GUEST_TTL_MS = 10 \* 60_000/.test(pa), 'D61c 源缓存有两道活性时限: 已下播 30 分钟 / 不在关注表 10 分钟(缓存不再是"取到就永久算有源")')
  const tk = segPa('private async keepaliveTick(')
  assert(/const anchors = new Map\(store\.listAnchors\(\)\.map\(\(a\) => \[roomKey\(a\.platform, a\.userId\), a\]\)\)/.test(tk), 'D61d 关注表按复合键建(playCache 是裸 userId, 直接拿裸号建表会让同号 SOOP 关注覆盖 Panda 的 isLive)')
  // 离线分支到"在播才入队"那一行之间 = 下播房能做的事的全集: 这一段里出现 queue.push 就是给已知下播的房发心跳
  const off = tk.slice(tk.indexOf('if (!a.isLive) {'), tk.lastIndexOf('queue.push([userId, pack])'))
  assert(off.length > 0 && !/queue\.push/.test(off) && /age > PandaApi\.KEEPALIVE_OFFLINE_TTL_MS/.test(off) && /this\.invalidatePlay\(userId\)/.test(off) && /\r?\n {10}continue/.test(off), 'D61e 已知下播: 一次心跳都不发(老纪律不动), 时限只管收尸让「秒开」徽标说实话 —— 从这一格到在播入队那行之间不许长出 queue.push')
  assert(/if \(age <= PandaApi\.KEEPALIVE_GUEST_TTL_MS\) queue\.push\(\[userId, pack\]\)/.test(tk) && /不在关注表且已过宽限, 源出队/.test(tk), 'D61f 未关注源(临时进房回访)给 10 分钟宽限照常养, 到期收手并出声 —— 不静默蒸发')
  assert((tk.match(/queue\.push/g) || []).length === 2, 'D61f2 整个 tick 只有两个入队点(宽限期内的未关注源 + 在播的关注源): 「只在关注且在播的源入队」是靠结构成立的, 不是靠日志说的', `实数=${(tk.match(/queue\.push/g) || []).length}`)
  assert(!/this\.playCache\.delete\(userId\)/.test(tk) && (tk.match(/this\.invalidatePlay\(userId\)/g) || []).length === 2, 'D61g 收手一律走 invalidatePlay(纪元 +1 + 在飞摘净 + 徽标广播), 不许绕过纪元门直接删缓存条目', `实数=${(tk.match(/this\.invalidatePlay\(userId\)/g) || []).length}`)
  assert(/const age = pack\.fetchedAt \? Date\.now\(\) - pack\.fetchedAt : 0/.test(tk) && /if \(!pack\.ok \|\| pack\.vod\) continue/.test(tk), 'D61h 无 fetchedAt 算 0 岁: 不是经缓存写入路径来的源不收手(宁漏一次清理也不误杀); 回放是静态分片, 无会话活性概念')
  const ks = segPa('private async keepaliveSource(')
  assert(/const primary = pack\.variants\?\.\[0\]\?\.url \|\| ''/.test(ks) && !/pack\.m3u8/.test(ks), 'D61i 心跳只读主档(㊕ 改口轮23 那条"全档齐养"): 两轮实测 —— 变体静置 15/27 分钟全活, 而 master 的 IVS 令牌 exp=取源+600s 到点按令牌语义过期(那一发 403 无自然样本), 副档不靠心跳续命, master 进这一轮等于每 10 分钟误收一次尸')
  assert(/if \(st === 403 \|\| st === 404\) primaryDead = true/.test(ks) && (ks.match(/primaryDead = true/g) || []).length === 1, 'D61j 判死只有一处赋值、只认主档的 403/404: 网络层失败一个都不计, 否则断网恢复瞬间全量误杀+对瘫痪 API 群重铸', `赋值点数=${(ks.match(/primaryDead = true/g) || []).length}`)
  assert(/源保活泵已启动\(基准 \$\{PandaApi\.KEEPALIVE_MS \/ 1000\}s[^\n]*只在关注且在播的源入队\)/.test(pa), 'D61k 启动那一行把新口径念出来(周期 + 自适应 + 入队门), 真机一眼能认出泵是哪一版')
  // 规模仿真里那枚公式是抄来的, 不是import 来的 —— 源改了它不改, 下一次拿它说话的量级就是上一版的(本轮 C3 正是靠这张表定的档)
  const simKa = fs.readFileSync(R('scripts', 'sim-keepalive-scale.mjs'), 'utf8')
  assert(/Math\.min\(900_000, Math\.max\(300_000, N \* 2000\)\)/.test(simKa), 'D61l 仿真的自适应间隔与 startKeepalive 同一枚公式(300s/2s/900s 三个常数一字不差): 它漂移一天, 依据它写下的结论就作废一天')
}
{
  const so = fs.readFileSync(R('src', 'main', 'services', 'soop.ts'), 'utf8')
  const pa = fs.readFileSync(R('src', 'main', 'services', 'pandalive.ts'), 'utf8')
  const si = fs.readFileSync(R('src', 'main', 'services', 'source.ts'), 'utf8')
  const ipc = fs.readFileSync(R('src', 'main', 'ipc.ts'), 'utf8')
  const wt = fs.readFileSync(R('src', 'main', 'services', 'watcher.ts'), 'utf8')
  const seg = (s, decl) => {
    const i = s.indexOf(decl)
    if (i < 0) return ''
    const j = bodyEnd(s, i)
    return s.slice(i, j < 0 ? undefined : j)
  }
  assert(/const want = fullVariants \? allPresets : allPresets\.slice\(0, 1\)\s*\r?\n\s*const presets = want\.filter\(\(p\) => !reuse\.some\(\(b\) => b\.name === p\.name\)\)/.test(so) && (so.match(/allPresets\.slice\(/g) || []).length === 1, 'D62a 档位扇出只有一个闸口(菜单一次读全, 请求按档发): 别处再 slice 一次就是第二条取流链。㊙(R29-4) 闸口后面只减"同一场已经买过的档", 不许再开第二个 slice')
  assert(/partial: allPresets\.length > 1 && variants\.length < allPresets\.length/.test(so), 'D62b partial 只在"真的还有档没解"时成立: 单档房的那份源是完整菜单, 不该被满档 caller 判成残缺而白重打整链。㊙(R29-4) 判据从此看"到手档数 vs 菜单档数"而不是看 caller 要哪一档 —— 接了复用账之后"其余档全买失败"不再会让整包为空, 旧写法会把缺档的包写成满档')
  assert(/档位=\$\{variants\.length\}\$\{fullVariants \? '' : '\(只解最高档\)'\}/.test(so), 'D62c 拉源日志带档位与档级(真机一眼分得清预取那一发与进房那一发)')
  const fp = seg(so, "async fetchPlay(channel: string, password = '', fullVariants = true)")
  assert(fp.includes('this.runPlayChain(channel, password, m, fullVariants)') && fp.includes('this.runPlayChain(channel, password, meta, fullVariants)'), 'D62d fullVariants 沿 fetchPlay 的两条重打分支一路传到底: 在 bno 复用那一跳上把它丢了, 预取就又变成整链')
  assert(/async getPlayCached\(channel: string, password = '', forceFresh = false, fullVariants = false\)/.test(so) && /getPlayCached\(id: string, password\?: string, forceFresh\?: boolean, fullVariants\?: boolean\)/.test(si), 'D62e 契约与实现对齐, 默认值是 false: 后台默认省档, 要全档必须明说(默认给全档 = 这个旋钮白装)')
  assert(!/getPlayCached\(userId: string, password = '', forceFresh = false, fullVariants/.test(pa), 'D62f Panda 不装这个旋钮: 它的取源是一发 play + 一次 master(变体免费), 省档省不下任何请求, 加了只会让人以为两边同形')
  assert(/sourceFor\(platform\)\.getPlayCached\(userId, safePwd\(password\), freshNow, true\)/.test(ipc), 'D62g 播放器那一条(唯一的用户意图取源入口)显式要全档 —— 清晰度菜单缺档比多 4 发更糟; 第三参自 ㊗C7 起是收敛过的 freshNow(不是裸 !!fresh), 全档那一参不许跟着一起被闸掉')
  assert(/await sourceFor\(platform\)\.getPlayCached\(uid\)\.catch/.test(wt) && (wt.match(/getPlayCached\([^)]*,[^)]*,[^)]*,/g) || []).length === 0, 'D62h watcher 里所有预取都走默认档级(只解最高档), 一处都不许自己传全档', `四处参数调用=${(wt.match(/getPlayCached\([^)]*,[^)]*,[^)]*,/g) || []).length}`)
}
{
  const so = fs.readFileSync(R('src', 'main', 'services', 'soop.ts'), 'utf8')
  const gp = (() => {
    const i = so.indexOf('async getPlayCached(channel: string, password = ', 0)
    const j = bodyEnd(so, i)
    return so.slice(i, j < 0 ? undefined : j)
  })()
  assert(/const key = `\$\{channel\}\$\{password \? '#pw' : ''\}\$\{fullVariants \? '' : '#top'\}`/.test(gp), 'D63a 在途键同时表达密码槽与档级: 把"要全档"的 caller 合进一条只解最高档的在途链 = 塞给它一份残缺菜单')
  // 注意: 这里匹配的是源码里的逻辑或, 必须写成 \|\| —— 裸 || 在正则里是"空交替", 恒真(= 契约不站岗)
  assert(/if \(c && c\.ok && \(!fullVariants \|\| !c\.partial\)\) return c/.test(gp), 'D63b 命中方向(本轮反过一次, 锁死): 只要最高档的那方, 手里这份满不满档都够用; 要满档的那方绝不能接一份只解最高档的包')
  assert(!/if \(c && c\.ok && \(!c\.partial \|\| fullVariants\)\)/.test(gp), 'D63c 反写的命中式不许回来(它同时犯两个错: 满档 caller 拿到残缺包, 预取 caller 白重打整链)')
  assert(/const r = await this\.fetchPlay\(channel, password, fullVariants\)/.test(gp), 'D63d 在途链自己按档级发, 结果按 e0 纪元门落缓存(与 D57 同一条门, 省档不省掉作废语义)')
  assert(/this\.playInflight\.set\(key, p\)/.test(gp) && /this\.playInflight\.delete\(key\)/.test(gp), 'D63e 在飞按 key 装/摘(四种形状各一条), 摘在 finally 里 —— 失败的那一发不许把键留在表上挡后来者')
}
{
  const so = fs.readFileSync(R('src', 'main', 'services', 'soop.ts'), 'utf8')
  const wt = fs.readFileSync(R('src', 'main', 'services', 'watcher.ts'), 'utf8')
  const rc = fs.readFileSync(R('src', 'main', 'services', 'recorder.ts'), 'utf8')
  const ipc = fs.readFileSync(R('src', 'main', 'ipc.ts'), 'utf8')
  const seg = (s, decl) => {
    const i = s.indexOf(decl)
    if (i < 0) return ''
    const j = bodyEnd(s, i)
    return s.slice(i, j < 0 ? undefined : j)
  }
  const nr = seg(so, 'private noteRisk(url: string, status: number, text: string): void {')
  assert(/const isPage = url\.startsWith\(`\$\{SOOP_ORIGIN\}\/`\)/.test(nr) && /const htmlOnApi = !isPage && text\.trimStart\(\)\.startsWith\('<'\)/.test(nr), 'D64a "接口回了 HTML"这条只在接口上算数: 播放页本来就是一篇 HTML(第一版拿整页当风控, 读一次页就冷却五分钟 = 自断)')
  assert(/const httpHit = status === 403 \|\| status === 429 \|\| \(status >= 500 && status !== 515\)/.test(nr), 'D64b 5xx 里 515 排除在外(那是 Cloudflare "区域被屏蔽"的固定返回码, 每次必中 = 永久冷却)')
  assert(!/throw/.test(nr) && /this\.riskUntil = Date\.now\(\) \+ SoopApi\.RISK_COOL_MS/.test(nr), 'D64c 记账只写表, 绝不抛(抛=把风控算成用户那一条链的失败); 判据与抬时间戳同函数内完成, 不给"看到了却没记"留缝')
  assert(/if \(!this\.riskCooling\(\)\) logger\.warn/.test(nr), 'D64d 同一个冷却窗口只出声一次(每发都 warn = 日志里全是重复, 反而看不出风控开始的那一刻)')
  assert(/private static RISK_COOL_MS = 5 \* 60_000/.test(so) && /riskCooling\(\): boolean \{\s*return Date\.now\(\) < this\.riskUntil/.test(so), 'D64e 冷却 5 分钟与读取口径(读时间戳, 不自减计数)')
  assert((wt.match(/soopApi\.riskCooling\(\)/g) || []).length === 2, 'D64f watcher 里恰好两处消费(探针整批收手 + 预取泵整条收手): 一处都不许多, 消费点多了就等于把同一个闸门装在不同的路上', `实数=${(wt.match(/soopApi\.riskCooling\(\)/g) || []).length}`)
  assert(!/riskCooling/.test(ipc) && !/riskCooling/.test(rc) && !/riskCooling/.test(seg(so, 'async getPlayCached(')), 'D64g 冷却只归后台的泵消费: 用户点开播/播放器起录/取源本身一律不看它 —— 冷却期把用户意图也挡下是拿时效换安全, 而这道交易没谈过')
  const cool = /if \(soopApi\.riskCooling\(\) && sent\.length\) \{[\s\S]*?\n {4}\}/.exec(wt)
  assert(!!cool && /sent = \[\]/.test(cool[0]) && !/fail\+\+|fail \+=|roundFailed \+=/.test(cool[0]), 'D64h 收手那格只做一件事: 把 sent 清空(这些房留在 probe 里由"被预算挡下"那一格统一计数)。两处都记会把同一批房数两遍')
  assert(/const allFail = anchors\.length > 0 && covered === 0 && \(sent\.length > 0 \? fail === sent\.length : probe\.length > 0\)/.test(wt), 'D64i 失明判据把"冷却收手"当成全灭而非"没瞎": sent 被清空 ≠ 读到 0 失败, 冷却期正好把连坐提醒绕过去是最糟的组合')
  assert(/this\.riskUntil = 0/.test(seg(so, 'clearPlayCache(): void {')), 'D64j 换号即撤冷却: 上一号的风控静默不该闷住新账号的泵(与 Panda 熔断随换号撤退同语义)')
}
{
  const hp = fs.readFileSync(R('src', 'main', 'services', 'hlsProxy.ts'), 'utf8')
  const pa = fs.readFileSync(R('src', 'main', 'services', 'pandalive.ts'), 'utf8')
  const wt = fs.readFileSync(R('src', 'main', 'services', 'watcher.ts'), 'utf8')
  const seg = (s, decl) => {
    const i = s.indexOf(decl)
    if (i < 0) return ''
    const j = bodyEnd(s, i)
    return s.slice(i, j < 0 ? undefined : j)
  }
  assert(/private inflightReads = new Map<string, Promise<ProxyRead>>\(\)/.test(hp) && (hp.match(/this\.readUpstream\(/g) || []).length === 2, 'D65a 清单与分片共用一条在飞表, 且上游只有 readUpstream 这一个读取入口(两个调用点): 各写一遍 fetchUpstream = 播放器与保活泵撞同一 target 时打两份')
  assert(/const flying = this\.inflightReads\.get\(target\)\s*if \(flying\) \{\s*this\.noteMerge\(kind\)\s*return flying\s*\}/.test(hp), 'D65b 合流按上游 target 认(令牌/签名已在 URL 里), 不按客户端认: 命中在飞只做一笔记账再共用, 不多发一发')
  assert(/if \(this\.inflightReads\.get\(target\) === p\) this\.inflightReads\.delete\(target\)/.test(hp), 'D65c 撒锁按身份比: 后到的 finally 不许把下一批的键摘掉')
  assert(!/inflightReads\.set\([^,]+,[\s\S]{0,40}Date\.now/.test(hp) && /只合流、不加 TTL 缓存/.test(hp), 'D65d 只合流不缓存: 直播清单每一轮都要新的, 把读满进内存的日子留着就是新段读成旧段')
  assert(/private static GATE_CODES = \['needAdult', 'needFan', 'needUnlimitItem', 'needCoinPurchase', 'castEnd'\]/.test(pa) && /private static GATE_TTL_MS = 15 \* 60_000/.test(pa), 'D65e 门槛账只收这五个"不会自己好"的码, 15 分钟: 密码类与登录态类一个都不记账(用户下一次可能就把密码改对了)')
  assert(/if \(PandaApi\.GATE_CODES\.includes\(code\)\) this\.gates\.set\(userId, \{ until: Date\.now\(\) \+ PandaApi\.GATE_TTL_MS, pack: gate \}\)/.test(pa), 'D65f 记账点唯一且在受限码分支内: 门外的失败(网络/满员)混进账里 = 把可重试的当不可重试的挡 15 分钟')
  assert(/if \(g && g\.until > Date\.now\(\) && !password\) return \{ \.\.\.g\.pack \}/.test(pa), 'D65g 短路三条件(有账 + 没过期 + 没带密码)且返回的是拷贝: 复用的那句不许被调用方改一处就污染整本账')
  assert(/this\.gates\.delete\(userId\)/.test(seg(pa, 'invalidatePlay(userId: string): void {')) && /this\.gates\.clear\(\)/.test(seg(pa, 'clearPlayCache(): void {')), 'D65h 门槛账跟着事件走: 开播/作废清这一房, 换号清整本 —— 上一个账号的"爱心余额不足"对这一个账号毫无意义')
  const ep = seg(wt, 'private enqueuePrewarm(platform: Platform, userId: string): boolean {')
  assert(/if \(a\?\.tags\?\.isPw\) return false/.test(ep) && ep.indexOf('isPw) return false') < ep.indexOf('q.push(userId)'), 'D65i 密码房不进预取队列(门在入队上游): 预取这一路永远没有密码, 这一发注定换回一句"要密码" —— SOOP 那句"要密码"背后是整条取源链')
}

// ============================================================================
// D66 验证脚本自己的体检: 恒真的正则 = 不站岗的契约
//   正则字面量里裸写 || 是"空交替"—— 那个空分支能匹配空串, 于是 .test() 恒真, 正断言永远绿。
//   本轮 D63b 刚写下 (\(!fullVariants OROR !c\.partial\)) 时忘了转义逻辑或, 把源码改坏它照样报 PASS,
//   而且报得理直气壮。这类失效不会自己出声(它长得就像"通过"), 只能由一条元契约扫全部验证脚本。
//   判据两条: (a) 字面量里有不转义的连续两竖; (b) 字面量匹配空串(长度阈值 14, 放过 /\s*/ 这一类真短的)。
//   2026-10-02 实测: 十条验证脚本按这两条扫 = 0 命中(修掉 D63b 之后), 所以阈值可以直接钉死。
// ============================================================================
{
  const START = /[(!&|?,=:]\s*$/
  const literal = (s, i) => {
    let j = i + 1
    let body = ''
    while (j < s.length) {
      const ch = s[j]
      if (ch === '\\') {
        body += ch + (s[j + 1] || '')
        j += 2
        continue
      }
      if (ch === '[') {
        let k = j
        while (k < s.length && s[k] !== ']') {
          if (s[k] === '\\') k++
          k++
        }
        body += s.slice(j, k + 1)
        j = k + 1
        continue
      }
      if (ch === '/') return body.length ? { body, end: j } : null
      if (ch === '\n') return null
      body += ch
      j++
    }
    return null
  }
  const bad = []
  const files = fs.readdirSync(R('scripts')).filter((n) => /^verify-.+\.mjs$/.test(n))
  for (const f of files) {
    const s = fs.readFileSync(R('scripts', f), 'utf8')
    for (let i = 0; i < s.length; i++) {
      if (s[i] !== '/') continue
      if (!START.test(s.slice(Math.max(0, i - 14), i))) continue
      const lit = literal(s, i)
      if (!lit) continue
      i = lit.end
      let inCls = false
      for (let k = 0; k < lit.body.length - 1; k++) {
        const c = lit.body[k]
        if (c === '\\') {
          k++
          continue
        }
        if (c === '[') inCls = true
        else if (c === ']') inCls = false
        else if (c === '|' && !inCls && lit.body[k + 1] === '|') {
          bad.push(`${f}: 裸逻辑或 /${lit.body}/`)
          break
        }
      }
      let re = null
      try {
        re = new RegExp(lit.body)
      } catch {
        re = null
      }
      if (re && lit.body.length >= 14 && re.test('')) bad.push(`${f}: 匹配空串 /${lit.body}/`)
    }
  }
  assert(files.length >= 11 && bad.length === 0, 'D66a 十一条验证脚本里没有一个恒真的正则字面量(扫描本身也要跑到: 文件数不足同样判失败)', `脚本数=${files.length} 命中=${bad.slice(0, 8).join(' | ')}`)
}

{
  // ㊕ 第二十四轮(P1-2 按站车道): 审出来的形状不是"某条循环发得太快" —— 每条后台循环自己都有节流,
  // 漏的是"跨条": 探针 ‖ 预取 ‖ 保活重铸 ‖ 登录探针在同一站上各发各的, 瞬时速率是它们的和。
  const ng = fs.readFileSync(R('src', 'main', 'services', 'netGate.ts'), 'utf8')
  const so = fs.readFileSync(R('src', 'main', 'services', 'soop.ts'), 'utf8')
  const pd = fs.readFileSync(R('src', 'main', 'services', 'pandalive.ts'), 'utf8')
  const hp = fs.readFileSync(R('src', 'main', 'services', 'hlsProxy.ts'), 'utf8')
  const wt = fs.readFileSync(R('src', 'main', 'services', 'watcher.ts'), 'utf8')
  const rc = fs.readFileSync(R('src', 'main', 'services', 'recorder.ts'), 'utf8')
  const ipcf = fs.readFileSync(R('src', 'main', 'ipc.ts'), 'utf8')
  const pkg = fs.readFileSync(R('package.json'), 'utf8')
  const seg = (s, decl) => {
    const i = s.indexOf(decl)
    if (i < 0) return ''
    const j = bodyEnd(s, i)
    return s.slice(i, j < 0 ? undefined : j)
  }
  assert(
    /const prev = lane\.tail/.test(ng) && /lane\.tail = new Promise<void>/.test(ng) && /^\s+await prev$/m.test(ng) && /finally \{\s*release\(\)/.test(ng),
    'D67a 一站一条道, 串行靠链不靠计数: 后来者排在上一发的落定之后, 异常路径也不会把计数留在"还在飞"'
  )
  assert(
    /return laneRun\(hostOf\(url\), store\.getSettings\(\)\.monitor\.soop\.requestGapMs, \(\) => this\.sendReq\(url, init, timeoutMs\)\)/.test(so) &&
      /return laneRun\(hostOf\(API\), store\.getSettings\(\)\.monitor\.pandalive\.requestGapMs/.test(pd),
    'D67b 间隔取自本平台那一格 requestGapMs(两平台各读各的, 与轮询分家同口径), 车道不另发明第二个节流数'
  )
  assert((so.match(/laneRun\(/g) || []).length === 1 && (pd.match(/laneRun\(/g) || []).length === 1, 'D67c 每个服务只有最下端那一处进车道: 中间层再包一遍 = 同一次请求被罚两遍(间隔翻倍 = 时效掉), 各层各包 = 谁也数不清一共等多久', `SOOP=${(so.match(/laneRun\(/g) || []).length} Panda=${(pd.match(/laneRun\(/g) || []).length}`)
  assert(!/laneRun/.test(seg(pd, 'private async fetchText(')) && !/netGate/.test(hp) && /只管 API 站, 不管媒体\/CDN/.test(ng), 'D67d 媒体/CDN 面豁免且豁免理由在案: 播放在看的分片不能被排队, 保活泵一轮也要跑完全部在播源, 串成一条会把源饿死 —— 那正是要避免的重铸风暴')
  assert(/const MAX_WAIT_MS = 8_000/.test(ng) && /Math\.min\(Math\.max\(want, 0\), MAX_WAIT_MS\)/.test(ng), 'D67e 排队有 8 秒上限且是 clamp(不是丢弃): 时效性是这一层的第一目标, 挤不过去也要发出去 —— 让预取队列整体滞后是最坏结果')
  assert(/\* \(0\.9 \+ Math\.random\(\) \* 0\.2\)/.test(ng) && !/Math\.random\(\)/.test(ng.replace(/\* \(0\.9 \+ Math\.random\(\) \* 0\.2\)/, '')), 'D67f 抖动 ±10% 一处且只这一处: 固定间隔本身就是可识别的机器形状, 两处抖动会叠成猜不出的总时长')
  // 数的是真调用点 `asUser(() => ...)` 而不是 `asUser(` —— 后者会被注释里那句"asUser(越过车道)"骗到(本轮实测)
  const uIpc = (ipcf.match(/asUser\(\(\) =>/g) || []).length
  const uRec = (rc.match(/asUser\(\(\) =>/g) || []).length
  assert(/return userMark\.getStore\(\) === true/.test(ng) && uIpc === 1 && uRec === 1 && !/asUser/.test(wt), 'D67g 默认后台、用户显式: 忘了标记的后果是"照旧各发各的"(安全默认), 而不是把后台请求伪装成用户意图; 标记只有两处(播放器取流 + 手动录制首发)', `ipc=${uIpc} rec=${uRec} watcher=${/asUser/.test(wt)}`)
  assert(/if \(isUserCall\(\)\) \{[\s\S]{0,80}stamp\(lane\)[\s\S]{0,80}finally \{[\s\S]{0,40}stamp\(lane\)/.test(ng), 'D67h 用户那一发不等, 但起跑与落定都落笔: 否则"用户点一下 + 后台 17 发"会在同一瞬时刻叠成同一瞬时的 18 发')
  assert(/new AsyncLocalStorage<boolean>\(\)/.test(ng), 'D67i 标记沿异步链传递(不是逐层加参数): 快速道要覆盖的是整条链, 而 fetchPlay → runPlayChain → fetchAid → req 中间隔着四个私有函数')
  assert(/verify-netgate\.mjs/.test(pkg), 'D67j 车道套在 npm run verify 链里: 不在链里的脚本等于没写(它会与实现悄悄分家)')
}
{
  // ㊕ P3-1 大厅 force 下限 + P3-2 关注列表在飞合并
  const wt = fs.readFileSync(R('src', 'main', 'services', 'watcher.ts'), 'utf8')
  const so = fs.readFileSync(R('src', 'main', 'services', 'soop.ts'), 'utf8')
  const seg = (s, decl) => {
    const i = s.indexOf(decl)
    if (i < 0) return ''
    const j = bodyEnd(s, i)
    return s.slice(i, j < 0 ? undefined : j)
  }
  const rd = seg(wt, 'async refreshDiscovery(')
  assert(/if \(force && since < Watcher\.TICK_MIN_MS\) \{[\s\S]{0,160}return this\.discovery/.test(rd) && /大厅刷新节流/.test(rd), 'D68a force 只豁免 60 秒复用窗口, 8 秒下限照管并留痕: 渲染层那 2.5 秒冷却管的是按钮自身, 连点仍会每 2.5 秒打四到五页整表(刚拉过一屏时再点也读不到新东西)')
  assert(!/if \(force && since < \d/.test(rd) && (wt.match(/TICK_MIN_MS = 8_000/g) || []).length === 1, 'D68b 与 tick() 同一条下限、同一个常量: 两处各写一个 8000 就是第二份真相, 改一处忘另一处不会报错')
  const fw = seg(so, 'async fetchFavorites(')
  assert(/if \(this\.favInflight\) return this\.favInflight/.test(fw) && /if \(this\.favInflight === p\) this\.favInflight = null/.test(fw) && !/this\.req\(/.test(fw), 'D68c 关注列表这一发有在飞合并且按身份撒锁: 轮询那一发与"同步关注"撞在同一瞬时时合并发, 失败/异常都不把键留在表上挡后来者')
  assert((seg(so, 'private async readFavorites(').match(/this\.req\(/g) || []).length === 1, 'D68d 真请求只在 readFavorites 一处: 合并层自己不许再发一发, 否则"合了个寂寞"')
}
{
  // ㊕ A2 预取泵让路 + 停轮清队
  const wt = fs.readFileSync(R('src', 'main', 'services', 'watcher.ts'), 'utf8')
  const seg = (s, decl) => {
    const i = s.indexOf(decl)
    if (i < 0) return ''
    const j = bodyEnd(s, i)
    return s.slice(i, j < 0 ? undefined : j)
  }
  assert(/if \(!this\.running \|\| this\.loop\[platform\]\.inFlight\) break/.test(seg(wt, 'private async pumpPrewarm(')), 'D69a 预取泵与轮次让路(㊕): 停轮即不再发预取、一轮正在打整表时先不发 —— 旧写法只挡 Panda 熔断, 于是关掉监控以后这条泵仍按 1.2s 一发逐房拉源')
  const st = seg(wt, 'stop(): void {')
  assert(/this\.prewarmQueue\[p\] = \[\]/.test(st) && /this\.idleQueue = \[\]/.test(st), 'D69b 停轮把两条队列一起清掉: 只清定时器等于把"下一发要发真请求"的待办留在手里, 泵自己还会排空')
  assert(/void this\.pumpPrewarm\(platform\)/.test(wt) && !/this\.prewarmQueue\[platform\] = \[\]/.test(seg(wt, 'private async pumpPrewarm(')), 'D69c 让路是 break 不是清队: 轮次落地由 runRound 的 finally 重新点泵, 排在后面的房照旧秒开(清队会把时效赔进去)')
}
{
  // ㊕ A3 源缓存年龄收手: 两平台同规约, 且不再被保活开关关掉
  const so = fs.readFileSync(R('src', 'main', 'services', 'soop.ts'), 'utf8')
  const pd = fs.readFileSync(R('src', 'main', 'services', 'pandalive.ts'), 'utf8')
  const mi = fs.readFileSync(R('src', 'main', 'index.ts'), 'utf8')
  const seg = (s, decl) => {
    const i = s.indexOf(decl)
    if (i < 0) return ''
    const j = bodyEnd(s, i)
    return s.slice(i, j < 0 ? undefined : j)
  }
  const sweep = seg(so, 'sweepPlayCache(): number {')
  assert(/private static CACHE_GUEST_TTL = 10 \* 60_000/.test(so) && /private static CACHE_OFFLINE_TTL = 30 \* 60_000/.test(so) && /if \(a\.isLive \|\| age <= SoopApi\.CACHE_OFFLINE_TTL\) continue/.test(sweep), 'D69d SOOP 的时限抄 Panda 那两档(回访客 10 分钟 / 已下播 30 分钟), 在播且仍在关注表的不限年龄: 时限再掐长场次只会多打一条整链')
  assert(!/this\.req\(|ses\.fetch|nodeHttpRequest/.test(sweep), 'D69e 年龄收手只扫内存、零网络: 这一趟的存在理由是"徽标别谎报", 不是"顺手复查一下"')
  assert(/if \(!pack\.fetchedAt\) continue/.test(sweep), 'D69f 没有年龄读数的不收手: 宁漏一次清理也不误杀(与 D61h 同口径)')
  assert(/if \(this\.cacheSweepTimer\) return/.test(seg(so, 'startCacheSweep(): void {')) && /setTimeout\(loop, 60_000\)/.test(so) && /soopApi\.startCacheSweep\(\)/.test(mi), 'D69g 清扫由启动挂上且幂等(重复调用不长出第二个定时器): 60 秒自续, 关掉保活也照跑')
  const kt = seg(pd, 'private async keepaliveTick(')
  assert(kt.indexOf('if (!store.getSettings().keepaliveStream) return') > kt.indexOf('KEEPALIVE_OFFLINE_TTL_MS') && kt.indexOf('if (!store.getSettings().keepaliveStream) return') < kt.indexOf('KEEPALIVE_LANES'), 'D69h 闸门只关心跳、不关记账(位置断言): 年龄收手全靠扫描那一趟落地, 把它压在开关后面 = 关掉保活就不再收尸')
}
{
  // ㊕ B 观测面: 重发、合流、页面来源三处过去都是无声的
  const so = fs.readFileSync(R('src', 'main', 'services', 'soop.ts'), 'utf8')
  const pd = fs.readFileSync(R('src', 'main', 'services', 'pandalive.ts'), 'utf8')
  const hp = fs.readFileSync(R('src', 'main', 'services', 'hlsProxy.ts'), 'utf8')
  const wt = fs.readFileSync(R('src', 'main', 'services', 'watcher.ts'), 'utf8')
  const ipcf = fs.readFileSync(R('src', 'main', 'ipc.ts'), 'utf8')
  assert(/this\.fallbackLogUntil = now \+ 60_000/.test(so) && /this\.fallbackLogUntil = now \+ 60_000/.test(pd), 'D70a 兜底重发只在 60 秒窗口出声一次、把窗口内的次数一起报: 逐条写会在断网/DNS 黑洞期把日志刷成计数器(那一形态每请求都触发)')
  assert((so.match(/this\.noteFallback\(/g) || []).length === 1 && (pd.match(/this\.noteFallback\(/g) || []).length === 2, 'D70b 三个"同一个请求打了第二遍"的现场全部留痕(SOOP req 一处 + Panda json 与 fetchText 两处), 一个都不许多也不许少: HTTP 状态码错误按 M3 绝不重发, 给它们记账会把纪律读歪', `soop=${(so.match(/this\.noteFallback\(/g) || []).length} panda=${(pd.match(/this\.noteFallback\(/g) || []).length}`)
  assert(/if \(flying\) \{\s*this\.noteMerge\(kind\)/.test(hp) && /上游在途合流/.test(hp), 'D70c 代理合流要出声: 省下的请求数是这一项唯一的成果, 没有读数就没人知道它有没有在工作(同样 60 秒一句、按清单/分片分开计)')
  assert(/async fetchPageMeta\(channel: string, quiet = false, fresh = false, why = '取流'\)/.test(so) && /页面元信息\(来源=\$\{why\}\)/.test(so), 'D70d 页面读那一发的日志带来源标签: 探针/取流/添加/录制取名四种形状混在同一句里, 审计就只能靠猜(默认值 = 取流, 漏标不会新增读数面)')
  assert(/soopApi\.fetchPageMeta\(a\.userId, true, true, '探针'\)/.test(wt) && /soopApi\.fetchPageMeta\(userId, false, false, '添加'\)/.test(ipcf) && /soopApi\.fetchPageMeta\(userId, true, false, '录制取名'\)/.test(ipcf) && /this\.fetchPageMeta\(channel, false, false, '取流复查'\)/.test(so), 'D70e 四个调用点各自带标签: 一处漏标就少一种可分派的形状, 而"谁在读这一页"正是请求面审计要回答的第一问。㊘(R28-2) 复查那一格从 fresh 改为吃微缓存 —— 标签不变, 变的只有"它要不要一个新读数"')
}

// ============================================================================
// D71 轮24 D(㊕): 保活扇出收口 —— 每源一轮一发主档
//   这一条不是"少发为快"的偏好, 是被两轮实测推着改口的: 轮23 已经把周期从 15s 放到 60s,
//   却仍以"副档不养会饿死"为由留着全档齐养(D61i 旧文)。轮24 复量(杀掉实例、静置、逐分钟 curl):
//   3 房 × 5 档 = 15 条变体清单在 +1/+3/+5/+10/+15 分钟全部 200 且清单持续变长,
//   而同批 master 的 JWT payload 现场解出 exp = 签发 +600/601/602s(到点必过期; 那一发 403 今天没有自然样本, 台账 ㊕⑧ 记为量不到) ——
//   会死的那一个(按令牌语义)从来不在心跳里, 不会死实测的那五个每轮各读一发。
//   行为侧由 verify-keepalive S1/S5-3/S7/S10/S12/S15-3/S17 数实发请求。
// ============================================================================
{
  const pd = fs.readFileSync(R('src', 'main', 'services', 'pandalive.ts'), 'utf8')
  const segD = (decl) => {
    const i = pd.indexOf(decl)
    if (i < 0) return ''
    const j = bodyEnd(pd, i)
    return pd.slice(i, j < 0 ? undefined : j)
  }
  const ks = segD('private async keepaliveSource(')
  assert((ks.match(/for \(/g) || []).length === 0 && !/const urls = \[/.test(ks), 'D71a 心跳里没有档循环: 结构上只剩一发, 想再齐养必须先把循环长回来(旧写法是 for + Set, 变异只需删掉一行就"看起来仍然养全档")')
  assert(
    /this\.keepaliveInfo\.set\(userId, \{ at: Date\.now\(\), ok: !primaryDead, variants: pack\.variants\?\.length \|\| 1 \}\)/.test(ks),
    'D71b 投影那格报的是"档在手"而不是心跳发数: 播放页侧栏说用户手上几份清晰度, 减发不许把读数改成"1 档"骗人'
  )
  assert(
    /变体地址不靠心跳续命/.test(pd) && /exp = 取源 \+585~600s/.test(pd) && !/只要会话被持续请求养着, 旧源就能一直看/.test(pd),
    'D71c 实测依据写在泵抬头而不是只写在报告里: 这一层的周期与覆盖面两格都靠它, 后人调参时要能看见数(旧的"会话被持续请求养着"是猜测, 已删净)'
  )
  const zh = fs.readFileSync(R('src', 'renderer', 'src', 'i18n', 'locales', 'zh-CN.ts'), 'utf8')
  const en = fs.readFileSync(R('src', 'renderer', 'src', 'i18n', 'locales', 'en-US.ts'), 'utf8')
  assert(/kaOn: '[^']*主档心跳 \{s\} 秒前'/.test(zh) && /kaOn: '[^']*primary beat \{s\}s ago'/.test(en) && !/档齐养/.test(zh) && !/tiers ·/.test(en), 'D71d 读数跟着行为改口(双语一起): 「N档齐养」已经是过去式, 留着它就是把"每轮只点主档"这件事对用户藏起来', `zh=${/主档心跳/.test(zh)} en=${/primary beat/.test(en)}`)
  const kt = segD('private async keepaliveTick(')
  assert(
    (kt.match(/queue\.push/g) || []).length === 2 && /if \(!a\.isLive\)/.test(kt) && /KEEPALIVE_OFFLINE_TTL_MS/.test(kt),
    'D71e 减的是档不是纪律: 入队两格、下播零心跳、两道活性时限原样不动(㊔ 那三条边界不因本改动松动)'
  )
  assert(/if \(n < 2\) return/.test(ks) && /this\.invalidatePlay\(userId\)/.test(ks) && /this\.enqueueRemint\(userId\)/.test(ks), 'D71f 判死仍是"连续两发 + 收尸 + 在播且开预取才重铸": 一发换窄了也不许顺手把两连击改成一击(单次 403 误杀正是 S4 锁的那一条)')
}

// ============================================================================
// D72~D76 轮25(㊖): 请求面审计落地的四条 + 撤销的一条
//   这一轮的起点是一张"有没有大批量/重重请求"的问句, 落下来的东西分两类:
//   加闸门(D73/D74/D75)与加可见性(D72/D76)。D76 那一条原本是"减发", 复核时发现自己的修法
//   会踩掉 ㊒② 锁死的检测路径, 因此撤销了减发那半、只留留痕 —— 撤销也要站岗, 否则同一形状会被人再写回来。
//   行为侧取证: verify-playcache T37(留痕只在该出声时出声)、T38(两道新泵闸)、T39(游标轮换),
//   verify-keepalive S18(风控账只认形状不认发起方)。
// ============================================================================
{
  const wt = fs.readFileSync(R('src', 'main', 'services', 'watcher.ts'), 'utf8')
  const seg = (decl) => {
    const i = wt.indexOf(decl)
    if (i < 0) return ''
    const j = bodyEnd(wt, i)
    return wt.slice(i, j < 0 ? undefined : j)
  }
  const sq = seg('private setIdleQueue(rest: Anchor[]): void {')
  const pi = seg('private async pumpIdle(): Promise<void> {')
  assert(/this\.idleCursor = n \? \(this\.idleCursor \+ this\.idleDrained\) % n : 0/.test(sq), 'D72a 续扫游标按"这一窗口实际消费了几发"续算并取模: 快照长度每轮都在变, 不取模的游标会把下一批排到数组外面')
  assert(/\[\.\.\.rest\.slice\(this\.idleCursor\), \.\.\.rest\.slice\(0, this\.idleCursor\)\]/.test(sq), 'D72b 轮换的是同一批房、只换起点(与 SOOP 探针游标同一环形规约): 队尾饿死的根因是"每轮都从 r0 起排", 不是"扫得慢"')
  assert(/const n = rest\.length/.test(sq) && /this\.idleQueue = n > 1 \?/.test(sq), 'D72c 长度 0/1 的快照走原路: 只有一间时不必复制一遍数组, 空批更要游标归零(不留指向不存在位置的游标)')
  assert((wt.match(/this\.setIdleQueue\(/g) || []).length === 2 && (wt.match(/private setIdleQueue\(/g) || []).length === 1, 'D72d 两处轮次快照都走这一扇门 + 定义一处: 谁再直接赋 idleQueue 谁就绕过续扫(T10b 那种"看着还在跑其实没接线"的变异)', `调用=${(wt.match(/this\.setIdleQueue\(/g) || []).length}`)
  assert(!/this\.idleQueue = (?:missing|rest|queue)/.test(wt), 'D72e 旧写法"新快照整批替换"不许回来(它把队首重扫、队尾一次都扫不到写进了结构里; stop/per-anchor 那两处的清空是作废队列, 不是换快照)')
  assert((pi.match(/this\.idleDrained\+\+/g) || []).length === 1, 'D72f 每间房只计一次消费: 双计会让游标一次跳两间, 等于一半关注永远轮不到(这条泵的存在理由恰恰是"列表此刻不可用")')
}
{
  const wt = fs.readFileSync(R('src', 'main', 'services', 'watcher.ts'), 'utf8')
  const i = wt.indexOf('private async pumpPrewarm(platform: Platform): Promise<void> {')
  const pp = wt.slice(i, i < 0 ? undefined : i + 4200)
  assert(/const a = store\.listAnchors\(\)\.find\(\(x\) => x\.platform === platform && x\.userId === uid\)/.test(pp) && /if \(!a \|\| !a\.isLive\) continue/.test(pp), 'D73a 出队时按当下真值重判(还在表里吗 + 还在播吗)在同一次查找里办完: 队列是首轮落地那一刻的快照, 而排空要几分钟 —— 秒开只对在播房有意义')
  assert(!/if \(!this\.stillMonitored\(platform, uid\)\) continue/.test(pp), 'D73b 旧的"只查取关"那一行不许回来: 它旁边再补一条 isLive 会变成两次查找、两个答案来源(同一件事不该有两处真值)')
  assert(/if \(!a \|\| !a\.isLive\) continue(?![\s\S]{0,60}q\.length = 0)/.test(pp), 'D73c 跳过只针对掉线者, 不许顺手清队(清队 = 把排在后面的在播房一起牺牲掉)')
  assert(/22 发整页 HTML/.test(pp) && /103 个房/.test(pp), 'D73d 实测依据写在改动处而不是只写在报告里: 这一格的量级(22/22 全回 offline = 100% 白付)只能从现场来, 后人调它时要能看见数')
}
{
  const pd = fs.readFileSync(R('src', 'main', 'services', 'pandalive.ts'), 'utf8')
  const wt = fs.readFileSync(R('src', 'main', 'services', 'watcher.ts'), 'utf8')
  const ipc = fs.readFileSync(R('src', 'main', 'ipc.ts'), 'utf8')
  const segP = (decl) => {
    const i = pd.indexOf(decl)
    if (i < 0) return ''
    const j = bodyEnd(pd, i)
    return pd.slice(i, j < 0 ? undefined : j)
  }
  assert(/private riskUntil = 0/.test(pd) && /private static RISK_COOL_MS = 5 \* 60_000/.test(pd) && /riskCooling\(\): boolean \{\s*return Date\.now\(\) < this\.riskUntil/.test(pd), 'D74a Panda 那本账与 SOOP 同语义同长度(读时间戳, 不自减计数): 两边各造一种冷却, 后台泵就要读两面钟')
  assert((pd.match(/this\.noteRisk\(/g) || []).length === 8, 'D74b 八种风控形状全部记账(403/429、≥500、接口回 HTML、不回 JSON、整表 result=false, ㊙R29-1 再加 bj/关注列表/play 三处业务码里的限流话术): 漏一种就等于那条路上泵照旧失明 —— 旧写法正是只认 403 抛错、不认账, 而现场那句「너무 많은 요청」配的正是 HTTP 200', `实数=${(pd.match(/this\.noteRisk\(/g) || []).length}`)
  assert((pd.match(/this\.noteRisk\([^)]*\)\s*\n\s*throw new RiskError/g) || []).length === 6, 'D74c 记账不许代替判决: 六处抛错型的都在 noteRisk 之后照旧抛出 RiskError(熔断/轮次失败语义靠它, 只记不抛会把风控读成"没事"); 另外两处(关注列表降级/play 回包)按各自契约只记不抛 —— 它们要把"读不到"还给调用方, 抛出会把降级轮变成崩轮', `成对数=${(pd.match(/this\.noteRisk\([^)]*\)\s*\n\s*throw new RiskError/g) || []).length}`)
  assert(/if \(PandaApi\.isRateLimitMsg\(j\.message \|\| ''\)\) this\.noteRisk\(/.test(segP('async fetchBj(')) && segP('async fetchBj(').indexOf('throw new BjNotFoundError') < segP('async fetchBj(').indexOf('isRateLimitMsg'), 'D74d 业务错误只在"限流话术"这一格记账(㊙R29-1 改判): bj 的 result=false 里"查无此人/无权限"那一类仍一条不记 —— 把它们记进冷却会让一个查无此人的房闷掉全部后台泵 5 分钟; 判据先走 BjNotFoundError 那条早退, 才轮到限流话术')
  assert((wt.match(/api\.riskCooling\(\)/g) || []).length === 1 && (wt.match(/api\.oracleRiskCooling\(\)/g) || []).length === 2 && !/\.noteRisk\(/.test(wt), 'D74e watcher 里 Panda 那两格钟的分工(㊙R29-1): 总账只被预取泵读(它买的是秒开, 没有人在等), 整表那一格被轮次扇出面与间隙泵读(两条检测路要收一起收) —— 且 watcher 一处记账都不写', `总账=${(wt.match(/api\.riskCooling\(\)/g) || []).length} 整表格=${(wt.match(/api\.oracleRiskCooling\(\)/g) || []).length}`)
  assert(/if \(platform === 'pandalive' && api\.riskCooling\(\)\) \{\s*q\.length = 0\s*break\s*\}/.test(wt), 'D74f 预取泵看 Panda 的账整条收手且清队: 预取买的是 2~6 发链, 正是冷却期最不该重发的形状(与 SOOP 那一条同规约)')
  const er = segP('private enqueueRemint(userId: string): void {')
  assert(/if \(this\.riskCooling\(\)\) \{/.test(er) && /this\.remintTail = this\.remintTail\.then\(async \(\) => \{\s*\/\/ 链步内二次检查[\s\S]{0,80}if \(!this\.riskCooling\(\)\) \{/.test(er), 'D74g 重铸链头一道 + 链步内二次检查: 前序步刚把冷却立起来时, 已经排在链上的后续步也不许发问("冷却期零重铸"是结构保证, 不是时序运气)')
  assert(!/riskCooling/.test(ipc) && !/riskCooling/.test(segP('async getPlayCached(')), 'D74h 冷却只归后台的泵消费: 用户进房、手动拉源、播放器起录一律不看它 —— 冷却期把用户意图也挡下是拿时效换安全, 这笔交易没谈过')
  assert(/this\.riskUntil = 0/.test(segP('clearPlayCache(): void {')), 'D74i 换号即撤账: 上一号的风控静默不该闷住新账号的泵(与 SOOP/D64j 同语义)')
}
{
  const hp = fs.readFileSync(R('src', 'renderer', 'src', 'components', 'HlsPlayer.vue'), 'utf8')
  assert(/const NET_RETRY_MAX = 3/.test(hp) && /let netRetry = 0/.test(hp), 'D75a 网络类致命错误的重试有上限且计数住在 load() 里(每条 src 一份): 上限存在的意义是让循环有终点')
  assert(/hls\.on\(Hls\.Events\.MANIFEST_PARSED, \(_e, data\) => \{\s*netRetry = 0/.test(hp), 'D75b 清单解析成功即重新给满预算: 播得动就不算重试, 否则一次断流后的第一发正常片段也会被后来的抖动打死')
  assert(/\} else if \(netRetry < NET_RETRY_MAX\) \{\s*netRetry\+\+\s*hls\?\.startLoad\(\)/.test(hp), 'D75c 有预算才 startLoad: startLoad() 每次调用都把 hls.js 自己的重试计数重新武装一遍, 无脑调用等于一条没有终点的循环')
  assert((hp.match(/hls\?\.startLoad\(\)/g) || []).length === 1, 'D75d 全文件只有一处真调用 startLoad: 第二处就是第二条没有计数的重连路', `实数=${(hp.match(/hls\?\.startLoad\(\)/g) || []).length}`)
  assert(/网络重试满 \$\{NET_RETRY_MAX\} 次: 上抛换源/.test(hp), 'D75e 满次数要出声并上抛 url-dead(不是静默停止): 停在"重试完"与停在"源死了"在日志里必须分得开')
  const pv = fs.readFileSync(R('src', 'renderer', 'src', 'views', 'PlayerView.vue'), 'utf8')
  assert(/function onUrlDead\(\) \{[\s\S]{0,400}m3u8\.value = ''/.test(pv) && /<HlsPlayer v-if="m3u8"[\s\S]{0,120}@url-dead="onUrlDead"/.test(pv), 'D75f 终点真的存在: 上层收 url-dead 后清空 m3u8 → v-if 卸载组件 → onUnmounted destroy。没有这一环, 上限 3 次只是把无限循环改成每 3 次重挂载的循环')
}
{
  const wt = fs.readFileSync(R('src', 'main', 'services', 'watcher.ts'), 'utf8')
  const i = wt.indexOf('private async roundSoop(')
  const rs = wt.slice(i, bodyEnd(wt, i))
  assert(!/soopProbeSkipUntil|SOOP_BLIND_MAX_MS|probeHeld/.test(wt), 'D76a 撤销要撤干净: 退避终点、封顶常量、让路标志三枚死字段一律不在(留着它们比留着 bug 更坏 —— 下一轮审计会照着它们再写一遍占空比)')
  assert(!/if \([^)]*soopBlindStreak/.test(rs), 'D76b 失明轮数只喂日志, 不参与任何判定: 它一旦进了 if, 这条逐房整页就开始被压节奏, 而 covered===0 时它就是检测路径(全站榜对 SOOP 不存在, 站内列表又读不到)')
  assert(/if \(sent\.length && covered === 0 && fail < sent\.length\)/.test(rs), 'D76c 留痕只在"列表失明且探针读得动"那一格出声: 常态轮它是噪声(列表覆盖时 probe 是个位数), 全灭轮那句 warn 已经在报同一件事(两句=重复读数面)。㊙(R29-3) 判据 rows===null → covered===0: "整表读通了但我的关注一个都不在里面"也是失明')
  assert(/降级探针回执: \$\{sent\.length\}\/\$\{probe\.length\} 发整页/.test(rs) && /关注列表已连续 \$\{this\.soopBlindStreak\} 轮没覆盖到我的关注/.test(rs), 'D76d 回执报的是这一轮的账(发数/在播/下播/失败)并带连续失明轮数: 探针那一发走 quiet, 不写这一句就没人知道最贵的一发烧了多少。㊙(R29-3) 那句话改口成"没覆盖到我的关注" —— 说"不可用"会在整表明明读通时撒谎')
  assert(/为什么不做占空比/.test(rs) && /要再减, 得先由用户认下时效那笔账/.test(rs), 'D76e 不改的理由写在代码里: 没有它, 下一份审计报告会把同一个"5.76 万发/天"再判一次, 而这一次的结论是"减发需授权"')
  assert(/const allFail = anchors\.length > 0 && covered === 0 && \(sent\.length > 0 \? fail === sent\.length : probe\.length > 0\)/.test(rs), 'D76f 失明判据与 ㊒② 一字不差(留痕不改变任何判据): 这一轮的改动只加了一句日志, 冷却/连败/提醒的触发条件全部原样')
  assert(!/sent = \[\]/.test(rs.slice(rs.indexOf('let fail = 0'), rs.indexOf('const allFail'))), 'D76g 探针循环与失明判据之间不许再出现"把 sent 清空"那一格(只有风控冷却那一格有权这么做, 而它由 D64h 站岗)。㊙(R29-3) 地标从 const covered 换成 const allFail —— covered 那一行上移到了探针之前, 再拿它当终点会切出一个空区间, 断言就变成白过')
}

// ============================================================================
// D77~D84 轮26(㊗): 按"主播状态优先, 其余尽量省"重排的那一版请求面
//   这一轮的三条改判同样要站岗(撤销过的东西最容易在下一份报告里被原样再写一遍), 所以 D78/D84 是负断言。
// ============================================================================
{
  const wt = fs.readFileSync(R('src', 'main', 'services', 'watcher.ts'), 'utf8')
  const fl = fs.readFileSync(R('src', 'main', 'ipc.ts'), 'utf8')
  const rp = (() => {
    const i = wt.indexOf('private async roundPanda(')
    const j = bodyEnd(wt, i)
    return wt.slice(i, j < 0 ? undefined : j)
  })()
  const bm = (() => {
    const i = wt.indexOf('private async roundByBookmark(')
    const j = bodyEnd(wt, i)
    return wt.slice(i, j < 0 ? undefined : j)
  })()
  // ---- D77 C1: 冷却期停的是扇出面, 不停那一发预言机 ----
  assert(/private cooldownOracleAt = 0/.test(wt) && /private static COOLDOWN_ORACLE_MS = 5 \* 60_000/.test(wt), 'D77a 冷却期那一发预言机有自己的再问时刻(5 分钟): 熔断期 30 秒一跳的旧写法一个探针都没发出去过, intervalFor 那句"压到 30s 是为了早点探到恢复"因此是句空话')
  assert(/this\.running = true[\s\S]{0,200}this\.cooldownOracleAt = 0/.test(wt), 'D77b 重启即作废这一次问闸(与 D55d 同规约): 新会话第一次撞冷却就该立刻问, 不许继承上一场的那次时间戳')
  assert(/this\.cooldownOracleAt = Date\.now\(\)[\s\S]{0,80}const found = await this\.roundByBookmark\(anchors, true\)/.test(rp), 'D77c 先落时间戳再发问: 这一发要是抛了(风控高压下的常态), 没落账就是 30 秒后再撞一次 —— 5 分钟节奏必须由时间戳而不是由结果守住')
  assert(/if \(found !== null\) \{[\s\S]{0,300}sent = true/.test(rp) && (rp.match(/sent = true/g) || []).length === 2, 'D77d "读到"才算这一轮真发了请求: roundByBookmark 回 null 的那几条支路(没罐/探针节流)整轮零网络, 顶栏「上次拉取」不许被这种空转刷成刚刚(第二处 sent 是正常轮)', `实数=${(rp.match(/sent = true/g) || []).length}`)
  assert(/if \(found !== null\) \{[\s\S]{0,400}this\.cooldownUntil = 0[\s\S]{0,120}this\.errorStreak = 0/.test(rp), 'D77e 读通即当场解除退避: 冷却买的是"别再打了", 不是"打死也不听" —— 平台已经答话了还继续静默 1~15 分钟, 那段时间是白瞎的 158 个关注')
  assert(/const found = await this\.roundByBookmark\(anchors, true\)[\s\S]{0,400}this\.pandaLiveFound = found/.test(rp), 'D77f 在播数必须在 return 之前落到 pandaLiveFound: finally 那句 P.liveFound 读的就是这一枚, 漏了它顶栏就显示上一场的数(而且是"刚刚拉的"那一枚时钟下的上一场)')
  assert((bm.match(/if \(!oracleOnly\) this\.pandaOracle = 'list'/g) || []).length === 3 && /this\.pandaOracle = 'bookmark'/.test(bm), 'D77g 冷却探针不许把预言机记成 list: 那一轮根本没打过全站榜, 写了就是一个假读数(轮次摘要与顶栏都拿它说话)。' + "'bookmark' 那一支不加闸是故意的 —— 冷却轮真读到了整表", `三处闸=${(bm.match(/if \(!oracleOnly\) this\.pandaOracle = 'list'/g) || []).length}`)
  // 锚在"闸 + 它第一眼"上: 这个函数里 !oracleOnly 的块状写法有两处(上面 rows===null 那一处也长这样), 只认紧接着 const urgent 的那一处
  const fanIdx = bm.search(/if \(!oracleOnly\) \{\s*\r?\n\s*const urgent = missing\.filter/)
  const sessIdx = bm.indexOf('if (api.hasSession()) {')
  const fanout = bm.slice(fanIdx, sessIdx)
  assert(fanIdx > 0 && sessIdx > fanIdx && /this\.setIdleQueue\(missing/.test(fanout) && !/this\.pandaOracle/.test(fanout), 'D77h 扇出面(逐房 member/bj + 间隙泵快照)整块在 !oracleOnly 闸内, 而会话存续记账(sessionDeadStreak/cookieValid)两边都跑: 那一发 result:true 的整表就是活会话证据, 冷却轮没理由不为它记账', `闸=${fanIdx} 记账=${sessIdx}`)
  assert(!/if \(oracleOnly\) \{[\s\S]{0,120}return /.test(bm), 'D77i 早退式写法(if (oracleOnly) \{ pushAnchors; return \})不许回来: 它看着更干净, 但会把会话存续记账一起跳掉 —— 冷却轮读到整表却不再为"罐还活着"落笔, cookieValid 那一格就被这一轮自己说成没证据')
  // ---- D78 C2: 只落地零关注早退, 大厅年龄闸一笔撤销 ----
  assert(/if \(!anchors\.length\) \{[\s\S]{0,300}this\.cooldownUntil = 0[\s\S]{0,200}return/.test(rp), 'D78a 零关注 Panda 也早退(SOOP 那一条的孪生): 没有东西可失明, 连退避时间戳一起作废, 也不为一间不存在的房翻五页全站榜')
  assert(!/hallFetchedAt|lastListScanAt|listScanAge/.test(wt), 'D78b 大厅回落的"年龄闸"是本轮撤销的一笔, 不许回来: 复核改判 —— 子间隔重读(用户立即刷新)可能真的携带新开播, 给回落加缓存买到的是漏检而不是省发(报告 B1 那句"零检测成本"判错了)')
  // ---- D79 C4: 刚添加的离线房当场进间隙泵 ----
  const ti = (() => {
    const i = wt.indexOf('trackIdle(platform: Platform, userId: string): void {')
    const j = bodyEnd(wt, i)
    return wt.slice(i, j < 0 ? undefined : j)
  })()
  assert(ti.length > 0 && /if \(platform !== 'pandalive'\) return/.test(ti) && /if \(!a \|\| a\.isLive \|\| this\.isGone\(a\)\) return/.test(ti), 'D79a 间隙泵补队按当下真值收口: 不在表里/已在播/查无此人一律不排, SOOP 那一侧根本没有这条泵(它的逐房探针每轮按游标重切整表)')
  assert(/this\.idleQueue\.some\([\s\S]{0,120}\)\)\s*return[\s\S]{0,120}this\.idleQueue\.unshift\(a\)/.test(ti), 'D79b 去重在排入之前、排的是队首: 这一间是用户刚点"添加"的, 与续扫游标那套"防尾部饿死"的公平账不冲突(游标只服务整批快照轮换)')
  assert(/watcher\.trackIdle\(plat, userId\)/.test(fl) && /else \{\s*\r?\n\s*\/\/ ㊗\(C4\)/.test(fl), 'D79c 手工添加那一条接线: 在播走预取泵, 离线走间隙泵 —— 旧写法它要等下一轮才被 setIdleQueue 收进快照, 之后再排到几百间长的队尾')
  // ---- D80 C5: 自动录制不借用户快速道 ----
  const rc2 = fs.readFileSync(R('src', 'main', 'services', 'recorder.ts'), 'utf8')
  assert(/const play = this\.auto\s*\r?\n\s*\? await sourceFor\(this\.platform\)\.getPlayCached\(this\.userId, this\.password\)\s*\r?\n\s*: await asUser\(/.test(rc2), 'D80a 首发取源按发起者分流: 手动那一条 asUser, 自动那一条走后台车道 —— 机器一开播批量起录时全员盖 userMark = 集体绕开按站节流, 恰在平台刚说"这人开播了"的时刻叠速')
  assert((rc2.match(/asUser\(\(\) =>/g) || []).length === 1, 'D80b 录制文件里用户级标记只有一处(首发), 判活与续录一律后台级: 第二处就是第二条插队路', `实数=${(rc2.match(/asUser\(\(\) =>/g) || []).length}`)
  // ---- D81 C7a: 强制刷新有 8 秒下限, 且只有真成功才落账 ----
  assert(/const PLAY_FRESH_MIN_MS = 8_000/.test(fl) && /const freshNow = !!fresh && !freshThrottled\(roomKeyStr\)/.test(fl), 'D81a 取流那一发补上下限(与 tick() 同一条 8 秒纪律): 它同时拿着 force、fullVariants、asUser 三重特权, 连点 N 下 = N 条完整取源链同时插队(SOOP 单链实测 8~10 发)')
  assert(/if \(!r\.ok\) \{[\s\S]{0,200}return[\s\S]{0,120}if \(freshNow\) markFreshTaken\(roomKeyStr\)/.test(fl), 'D81b 落账在失败早退之后、且只认"真强制取到源"那一发: 失败绝不闸掉下一次重试(源真死了再点一次永远照发), 而进房那一发(非强制)也不落账 —— 免得把手动刷新那个按钮闸成哑的')
  assert(/function markFreshTaken\(key: string\): void \{[\s\S]{0,300}freshTakenAt\.set\(key, Date\.now\(\)\)/.test(fl) && (fl.match(/freshTakenAt\.set\(/g) || []).length === 1, 'D81c 落账函数真的写那一笔且只有这一扇门: 本条抓的是本轮初稿 —— 当时它只做"超过 256 条就清扫", 一次 set 都没写, 于是节流永远读不到东西、整个 C7 是台空转的闸', `写入点=${(fl.match(/freshTakenAt\.set\(/g) || []).length}`)
  // ---- D82 C7b: 播放器那三枚死旋钮 ----
  const hp2 = fs.readFileSync(R('src', 'renderer', 'src', 'components', 'HlsPlayer.vue'), 'utf8')
  assert(!/manifestLoadingMaxRetry|levelLoadingMaxRetry|fragLoadingMaxRetry/.test(hp2), 'D82a 三枚 *LoadingMaxRetry 已从配置里删掉: hls.js 1.7.1 只在默认值表里留着这些旧名, 真正的预算来自 loadPolicy(清单 2 发/分片 4~6 发) —— 写在这里不生效, 只会骗到下一个人')
  assert(/loadPolicy/.test(hp2) && /const NET_RETRY_MAX = 3/.test(hp2), 'D82b 死字段撤了, 但"本层只管外层循环"这件事留在注释里, 且 NET_RETRY_MAX 那条真计数还在: 别让下一次审计再来装一遍这三个旋钮')
  // ---- D83 C8: 自录房排到预取队首 ----
  const ep2 = (() => {
    const i = wt.indexOf('private enqueuePrewarm(platform: Platform, userId: string): boolean {')
    const j = bodyEnd(wt, i)
    return wt.slice(i, j < 0 ? undefined : j)
  })()
  assert(/if \(a\?\.autoRecord\) q\.unshift\(userId\)\s*\r?\n\s*else q\.push\(userId\)/.test(ep2), 'D83a 自录房排队首: 队列排空要几分钟(实测 103 个房 ≈12 分钟), 排在尾巴上等于让录制自己等一整轮泵 —— 请求数一字不减, 只是把同一批发出的活排得更早(这是优先级调整, 不是减量)')
  // ---- D84 C6: 撤销的那一笔倒计时不许回来 ----
  assert(!/soopCooling/.test(wt) && !/watcher\.soopCooling/.test(fs.readFileSync(R('src', 'main', 'i18n.ts'), 'utf8')), 'D84a SOOP 冷却倒计时是本轮撤销的第二笔(改判), key 与调用点一起不留: 退避只由 soopFailStreak>=2 武装, 武装那一轮写的 message 本就是 watcher.soopDown, 冷却整轮跳过 ⇒ 那句原样留在顶栏 —— 盲区不静默, 补一句只是把它说两遍(D55e 站的就是这一格)')
}

// ============================================================================
// D85~D90 轮28(㊘): 四张账各自到位之后, 把"同一件事打两遍"的剩下四处钉住
//   这一轮没有新的判据, 只有把判据落到代码上: 主播状态读数该发的一发不少, 而"为已经拿到手的答案再买一遍"
//   (加房的 bj 两发)、"为十秒内刚读过的页面再买一整页"(取流复查)、"被拦下时反而换更贵的问法"(Panda 扇出面)、
//   "为没人等的秒开买整页"(SOOP 失明期预取) 四处各自收口, 外加一处完全隐形的读数面补留痕。
//   D86b 是负断言: 本轮自己写过又撤掉的一笔(bnoCache 的第三个写入点), 不许在下一份报告里被当成缺陷再装一遍。
// ============================================================================
{
  const wt = fs.readFileSync(R('src', 'main', 'services', 'watcher.ts'), 'utf8')
  const fl = fs.readFileSync(R('src', 'main', 'ipc.ts'), 'utf8')
  const so = fs.readFileSync(R('src', 'main', 'services', 'soop.ts'), 'utf8')
  const pd = fs.readFileSync(R('src', 'main', 'services', 'pandalive.ts'), 'utf8')
  const seg = (src, decl) => {
    const i = src.indexOf(decl)
    if (i < 0) return ''
    const j = bodyEnd(src, i)
    return src.slice(i, j < 0 ? undefined : j)
  }
  const add = seg(fl, 'ipcMain.handle(CH.anchorsAdd,')
  // ---- D85 R28-1: 加房那一发 member/bj 的 media 真值当场用掉 ----
  assert(/import \{ api, LiveItem, SESSION_PARTITION/.test(fl), 'D85a LiveItem 走类型导入而不是现场重新描述形状: media 那三格的判据必须与 applyBj 读同一份类型, 抄一份字段名就是给下一次改版留一处对不上的地方')
  assert(/const info = await api\.fetchBj\(userId\)[\s\S]{0,400}if \(info\.media\?\.isLive\) bjLive = info\.media/.test(add), 'D85b fetchBj 那一发顺带回来的整包在播读数被留下(旧写法只取 nick/userIdx/userImg 三格、把 media 整包丢掉)')
  assert(/isLive: isLive \|\| !!disc \|\| !!bjLive/.test(add) && /lastSeenAt: disc \|\| bjLive \? Date\.now\(\) : 0/.test(add), 'D85c 卡片按真值落库: 已在播的新房不再"离线落库 + 1.2 秒后对同一 userId 再发同一端点" —— 那第二发买的答案第一发已经拿在手里')
  assert(/if \(anchor\.isLive && cfg\.monitor\[anchor\.platform\]\.prefetchStream\)[\s\S]{0,200}else \{[\s\S]{0,300}watcher\.trackIdle\(plat, userId\)/.test(add), 'D85d trackIdle 只在"真没有数据"时走: 分支读的是落库后的 anchor.isLive, 不是那句 fetchBj 之前的局部量(补洞的条件跟着真值走, 不跟着猜测走)')
  assert((add.match(/api\.fetchBj\(/g) || []).length === 1, 'D85e 加房这一条链上 member/bj 只有一个调用点: 第二处就是那条重复本身', `实数=${(add.match(/api\.fetchBj\(/g) || []).length}`)
  // ---- D86 R28-2: 复查那一页不再重买 + 场次号账本只有一个写入点 ----
  assert(!/seedBroadNo/.test(so) && !/seedBroadNo/.test(wt), 'D86a 本轮初稿写过、随即撤掉的第三个写入点不许回来: 探针那条路本来就走 readPageMeta, 号已经入账了 —— 再补一处是同一件事两处真值(改判)')
  assert((so.match(/this\.bnoCache\.set\(/g) || []).length === 2, 'D86b 场次号账本恰好两处写入(列表整表 + 任何一次真读到的页面): 少一处会漏掉一条来路, 多一处就是有两处各说各话', `实数=${(so.match(/this\.bnoCache\.set\(/g) || []).length}`)
  assert(/const m = await this\.fetchPageMeta\(channel, false, false, '取流复查'\)/.test(seg(so, 'async fetchPlay(')), 'D86c 取流复查吃微缓存: 它要的三个判据(在播/号码变没变/页面那句话)一页 HTML 里都齐, 而十秒内刚读过的那一页就是最新读数 —— fresh 把微缓存与在途合并一并绕过, 于是探针几秒前买过的那一页在这里被原样重买')
  // ---- D87 R28-3: 风控账管到轮次扇出面 + 那一面从此有留痕 ----
  assert(/this\.pandaBlindStreak\+\+[\s\S]{0,200}风控冷却中: 本轮只发站内关注那一发/.test(seg(wt, 'private async roundPanda(')), 'D87a 冷却期读不到整表 = 收手而不是换问法, 且这一句必须出声: "被拦下"这件事在日志里过去完全隐形, 事后无人能解释那一轮为什么只有 1 发')
  assert(/降级轮留痕: 站内关注列表连续 \$\{this\.pandaBlindStreak\} 轮不可用, 本轮逐房复查 \$\{this\.pandaUrgentCnt\} 发 \+ 间隙泵快照 \$\{this\.idleQueue\.length\} 间在排队/.test(wt), 'D87b 降级轮的扇出面有数可核(连续轮数 + 两个扇出面的量): 口径抄 ㊖ 那句 SOOP 降级探针回执 —— 只留痕不减发, 减发要先谈时效那笔账')
  assert((wt.match(/this\.pandaUrgentCnt = urgent\.length/g) || []).length === 2, 'D87c 两条逐房复查路(bookmark 的 rest / roundByList)都落这一个数: 只写一处会让留痕报"0 发"而实际吃满 —— 留痕报错了比不报更坏', `实数=${(wt.match(/this\.pandaUrgentCnt = urgent\.length/g) || []).length}`)
  assert(/if \(api\.oracleRiskCooling\(\)\) break\s*\r?\n\s*const a = this\.idleQueue\.shift\(\)!/.test(wt), 'D87d 间隙泵收手但不清队列: 熔断那一条清(它等的是整轮重排), 风控这一条等的只是 5 分钟, 把快照丢掉等于让恢复后的第一轮重新等一轮轮询。㊙(R29-1) 它读的是整表那一格 —— 与轮次扇出同一把闸, 两条检测路要停一起停, 后台拉源撞的限流不许把它们闷掉')
  // ---- D88 R28-4: SOOP 失明期的预取不为"没有号"买整页 ----
  const pp4 = seg(wt, 'private async pumpPrewarm(')
  assert(/if \(platform === 'soop' && this\.soopBlindStreak >= 3 && !soopApi\.hasBroadNo\(uid\)\) \{\s*q\.push\(uid\)/.test(pp4), 'D88a 门槛是"连续 3 轮整表失明"而不是"这一轮读不到": 一轮抖动就把预取关掉, 秒开要为它变慢一整场。跳过的写法是排回队尾(不作废)—— 检测面(每轮 ≤40 发整页)一发不少, 预取只是晚一场拿到号')
  assert(/if \(\+\+skippedNoBno >= q\.length\) break/.test(pp4), 'D88b 整条队列都是这一形状时出泵而不是原地空转: 泵拿的是入队那一刻的数组引用, 一直 shift/push 会把这一趟变成死循环')
  assert(/private soopBlindStreak = 0/.test(wt), 'D88c 失明连败计数住在 watcher(与 ㊖ 留痕共用一本账), 不在 SoopApi 里再造一个: 两处计数会各报各的轮数')
  // ---- D89 R28-5: SOOP 门槛回执账 ----
  assert(/private gates = new Map<string, \{ until: number; pack: PlayResult \}>\(\)/.test(so) && /private static GATE_TTL_MS = 15 \* 60_000/.test(so) && /private static GATE_TTL_MS = 15 \* 60_000/.test(pd), 'D89a 两站各有一本门槛账、同一档 TTL: ㊔ 台账当时写的是"两站同规约"而实现只有 Panda 一侧(勘误), 这一轮补齐 —— 补齐后这句话才第一次是真的')
  assert((so.match(/this\.noteGate\(/g) || []).length === 2, 'D89b 只记两类不会自己好的回答("要登录且没托管账密" / "要密码而这一路没密码"): 密码不对下次可能改对、托管账号 60 秒后可能自愈, 把它们记账等于把可自愈的读数锁死在墙上', `实数=${(so.match(/this\.noteGate\(/g) || []).length}`)
  assert(/if \(!this\.canAutoRelogin\(\)\) this\.noteGate\(channel, pack\)/.test(so) && /private canAutoRelogin\(\): boolean \{\s*return Boolean\(secrets\.get\(CRED_USER\) && secrets\.get\(CRED_PASS\)\)/.test(so), 'D89c 托管账密在不在, 决定"要登录"是不是一条终局: 判据必须是这一个而不是"这次失败了几回"')
  const gp = seg(so, 'async getPlayCached(')
  const gateIdx = gp.indexOf('this.gates.get(channel)')
  const flyIdx = gp.indexOf('this.playInflight.get(key)')
  assert(gateIdx > 0 && flyIdx > gateIdx && /if \(g && g\.until > Date\.now\(\) && !password\) return \{ \.\.\.g\.pack \}/.test(gp), 'D89d 短路放在在途合并之前、且带密码来与手动强刷一律绕开: 排在后面的房该立刻拿到那一句"这房要密码", 而不是再去撞一条注定被拒的 9~10 发链(改一次密码就重新问一次平台)')
  assert(/this\.dropGate\(channel\)/.test(seg(so, 'invalidatePlay(')) && /this\.gates\.clear\(\)/.test(seg(so, 'clearPlayCache(): void {')), 'D89e 事件解除两条都在: 开播/作废/换号各自把账抹掉 —— 门槛账只许活到下一个事件, 否则"他刚开播"会被上一场的"取不到源"遮掉')
}

// ============================================================================
// ㊙ 轮29(R29-1~R29-5): 风控账收下业务码那句限流 · 账分两格 · 预取认"正在判下播" · 失明改口 covered===0 · 降级轮在界面上持续说话
// ============================================================================
{
  const wt = fs.readFileSync(R('src', 'main', 'services', 'watcher.ts'), 'utf8')
  const so = fs.readFileSync(R('src', 'main', 'services', 'soop.ts'), 'utf8')
  const pd = fs.readFileSync(R('src', 'main', 'services', 'pandalive.ts'), 'utf8')
  const ty = fs.readFileSync(R('src', 'shared', 'types.ts'), 'utf8')
  const tn = fs.readFileSync(R('src', 'renderer', 'src', 'components', 'TopNav.vue'), 'utf8')
  const seg = (src, decl) => {
    const i = src.indexOf(decl)
    if (i < 0) return ''
    const j = bodyEnd(src, i)
    return src.slice(i, j < 0 ? undefined : j)
  }
  const segP2 = (decl) => seg(pd, decl)
  // ---- D90 R29-1: 那句「请求太多」进门, 但只让它自己那一格说话 ----
  assert(/private static isRateLimitMsg\(msg: string\): boolean/.test(pd) && (pd.match(/PandaApi\.isRateLimitMsg\(/g) || []).length === 3, 'D90a 限流话术的判据只定义一处、消费三处(bj / 关注列表 / play 三个 result=false 出口): 判据散开写就会有一处漏掉某种语言', `实数=${(pd.match(/PandaApi\.isRateLimitMsg\(/g) || []).length}`)
  assert(/너무 많은 요청\|too many requests\|rate\.\?limit\|请求过多\|请求太频繁\|слишком много запросов/.test(pd), 'D90b 词表按现场样本起步并覆盖四语(韩/英/中/俄): 现场那句「너무 많은 요청이 발생했습니다」配的正是 HTTP 200, 旧账本只读状态码 ⇒ 平台亲口喊停的这一刻一条都不记')
  assert(/private oracleRiskUntil = 0/.test(pd) && /oracleRiskCooling\(\): boolean \{\s*return Date\.now\(\) < this\.oracleRiskUntil/.test(pd) && /if \(PandaApi\.isOraclePath\(path\)\) this\.oracleRiskUntil = Date\.now\(\) \+ PandaApi\.RISK_COOL_MS/.test(segP2('private noteRisk(')), 'D90c 账分两格(㊙R29-1 的核心): 总账抬时间戳, 只有整表那一发的路径才顺带抬整表格 —— 一轮记账把两条检测路一起闷掉, 正是用户 2026-10-03 那笔拍板拒绝的那笔交易(「只把账说出来, 不减发」)')
  assert(/return path === '\/v1\/live\/bookmark' \|\| path === '\/v1\/live' \|\| path\.startsWith\('\/v1\/live\?'\)/.test(pd), 'D90d 整表路径族的判据是三条精确式而不是 /v1/live 前缀: 前缀会把 /v1/live/play(逐房拉源)一起圈进来 —— 那正是这一格必须放过的那一发')
  assert((pd.match(/this\.noteRisk\([^)]*\)\s*\n\s*throw new RiskError/g) || []).length === 6 && /if \(PandaApi\.isRateLimitMsg\(j\.message \|\| ''\)\) this\.noteRisk\(`关注列表限流话术/.test(segP2('async fetchBookmarks(')) && /if \(PandaApi\.isRateLimitMsg\(msg\)\) this\.noteRisk\(`拉源限流话术/.test(segP2('async fetchPlay(')), 'D90e 两处"降级而不抛"的出口(play 回一句话 / 关注列表回 null)也记账, 但各自仍按原契约返回: 记账不许改变调用方看到的东西 —— 关注列表那句连未登录都不记(死会话期的逐房复查是检测路径本身), 只有那句限流才记')
  assert(/this\.riskUntil = 0/.test(segP2('clearPlayCache(): void {')) && /this\.oracleRiskUntil = 0/.test(segP2('clearPlayCache(): void {')), 'D90f 换号两格一起撤: 上一号的风控静默与"整表那一发被拒"对这一个账号都毫无意义(与 SOOP/D74i 同语义)')
  assert(/if \(platform === 'pandalive' && api\.riskCooling\(\)\) \{\s*q\.length = 0/.test(seg(wt, 'private async pumpPrewarm(')), 'D90g 总账的消费端没被搬走: 预取泵(买 2~6 发链换"秒开", 没有人在等)继续读总账 —— 分家只把两条检测路挪去读整表格, 后台的便利面一格都没松')
  // ---- D91 R29-2: 预取泵认"正在判下播"那张表 ----
  assert(/private awaitingOffline\(platform: Platform, userId: string\): boolean \{\s*const key = roomKey\(platform, userId\)\s*return platform === 'soop' \? this\.soopOfflineStreak\.has\(key\) : this\.pandaOfflineStreak\.has\(key\)/.test(wt), 'D91a 判据直接借用两轮确认那两张既有的表, 不新造第三本账: 那两张表已经写着"平台这一轮说这一场散了", 预取要读的正是这一句')
  assert((wt.match(/this\.awaitingOffline\(/g) || []).length === 2 && !/awaitingOffline/.test(seg(wt, 'private async pumpIdle(')) && !/awaitingOffline/.test(seg(wt, 'private async roundSoop(')), 'D91b 这一格只挡预取那两条(入队 + 出队), 检测面一处都不读: 间隙泵与探针要的就是"第二轮那发读数", 挡它等于把下播判定本身压慢一轮', `实数=${(wt.match(/this\.awaitingOffline\(/g) || []).length}`)
  assert(/if \(this\.awaitingOffline\(platform, uid\)\) \{\s*q\.push\(uid\)[\s\S]{0,120}if \(\+\+skippedPending >= q\.length\) break/.test(seg(wt, 'private async pumpPrewarm(')), 'D91c 出队那一头是排回队尾而不是作废(与 D88a 同规约) + 独立计数出泵: 第二轮若真读回在播(瞬回离线的抖动), streak 一清下一趟泵照买 —— 秒开只是晚一场, 不会被一次抖动永久摘掉')
  assert(/if \(this\.enqueuePrewarm\(platform, a\.userId\)\) queued\+\+/.test(seg(wt, 'private prewarmSweep(')), 'D91d 补扫那句「N 个在播房排队」按入队返回值计数: 上一版是无条件 ++, 于是被密码房/重复项挡下的也算进去了 —— 留痕报错了比不报更坏')
  // ---- D92 R29-3: 失明判据从 rows===null 改口 covered===0 ----
  assert((wt.match(/const covered = anchors\.length - probe\.length/g) || []).length === 1 && seg(wt, 'private async roundSoop(').indexOf('const covered =') < seg(wt, 'private async roundSoop(').indexOf('let fail = 0'), 'D92a covered 只算一次且早于探针循环: 失明判据、留痕、allFail 三处读同一个数 —— 两处各算一遍就是两本账(实数=' + (wt.match(/const covered = anchors\.length - probe\.length/g) || []).length + ')')
  assert(/this\.soopBlindStreak = covered === 0 && anchors\.length/.test(wt), 'D92b 失明计数的判据换的是"列表对我覆盖了几房", 不是"接口有没有回东西": 现场那个形状(整表读通、我的关注一个不在)过去永远不记, 于是 ㊘(R28-4) 那道闸门从不落地')
  assert(/const allFail = anchors\.length > 0 && covered === 0/.test(wt) && /if \(this\.soopFailStreak >= 2\) this\.soopCooldownUntil = Date\.now\(\) \+ Watcher\.SOOP_COOLDOWN_MS/.test(wt) && (wt.match(/rows === null/g) || []).length === 1, 'D92c 只改判据不碰收手面: allFail/连败/冷却三条一条没动, 而 SOOP 那两处 rows===null 都改了口(整本只剩 Panda 侧 roundByBookmark 那一处"有没有列表"的原始语义) —— 这一笔买到的不是减量, 是让 R28-4 那道既有闸门第一次真落地', `残留=${(wt.match(/rows === null/g) || []).length}`)
  // ---- D93 R29-4: 已买档位的复用账 ----
  assert(/private partialBuy = new Map<string, \{ bno: string; bought: \{ name: string; variant: VariantInfo \}\[\] \}>\(\)/.test(so) && (so.match(/this\.partialBuy\.set\(/g) || []).length === 1, 'D93a 复用账只有一个写入点(省发型链成功那一处), 且带密码的那一条不记: 预取泵永远没有密码, 而这一格按频道记账 —— 密码不同就是不同的房', `写入=${(so.match(/this\.partialBuy\.set\(/g) || []).length}`)
  assert(/const e = this\.partialBuy\.get\(channel\)\s*\r?\n\s*if \(e && e\.bno === info\.broadNo\)/.test(so) && /if \(allPresets\.findIndex\(\(p\) => p\.name === b\.name\) !== reuse\.length\) break/.test(so), 'D93b 复用判据是场次而不是时间, 且只对"前缀对得上"的那一段负责: aid/签名地址在同一场内本来就长效(与 playCache"只认显式作废"同规约); 平台中途换菜单名字时对不上的那档就当没买过、照买')
  assert(/if \(!fullVariants && !password && allPresets\.length > 1\) this\.partialBuy\.set\(channel, \{ bno: info\.broadNo, bought \}\)/.test(so) && /if \(fullVariants\) this\.partialBuy\.delete\(channel\)/.test(so), 'D93c 记账只记"真省下来的那几发", 满档链落地即摘账: 留着它下一场对不上号是必然, 而缓存此时已经不缺档 —— 一本只增不减的账早晚会骗人')
  assert(/this\.partialBuy\.delete\(channel\)/.test(seg(so, 'invalidatePlay(')) && /this\.partialBuy\.clear\(\)/.test(seg(so, 'clearPlayCache(): void {')), 'D93d 事件解除两条都在(与门槛账 D89e 同规约): 开播/作废/收尸抹这一房, 换号抹整本 —— 上一号买过的档对这一个账号不成立')
  assert(/const variants: VariantInfo\[\] = reuse\.map\(\(b\) => b\.variant\)/.test(so) && (so.match(/reuse\.length \? ` 复用已买档=/g) || []).length === 1, 'D93e 复用那份从数组头接起(菜单顺序即档位顺序, variants[0] 恒为最高档), 且省下的发数要写进成功日志: 事后数包的人必须能一眼看出"这一条链少打了 2 发"')
  // ---- D94 R29-5: 降级轮在界面上持续说话(只报账, 不减发) ----
  assert(/private pandaDegradeWhy\(\): string \{\s*if \(!api\.hasSession\(\)\) return mt\('watcher\.degradeNoLogin'\)\s*if \(!api\.cookieValid\) return mt\('watcher\.degradeSessionDead'\)/.test(wt) && !/await|this\.json|fetch/.test(seg(wt, 'private pandaDegradeWhy(')), 'D94a 归因三条各说一句(未登录 / 会话被服务端作废 / 风控·改版)且判据全是客户端已有的读数: 现场那句「cookie=30 枚 会话=有 官方校验=未登录」正是中间这一条 —— 为归因再发一发就是新增请求面')
  assert(/degradeMsg = mt\('watcher\.degraded', \{[\s\S]{0,240}r: this\.pandaUrgentCnt,[\s\S]{0,60}q: this\.idleQueue\.length/.test(seg(wt, 'private async roundPanda(')) && /P\.message = degradeMsg/.test(wt), 'D94b 界面上那一行报的是刚刚这一轮的账(连续轮数 + 归因 + 两个扇出面的量): 日志里那句留痕只有翻日志的人看得见, 而这一面在现场挂了 40 分钟无人知情')
  assert(/P\.degraded = Boolean\(degradeMsg\)/.test(wt) && /P\.degraded = true/.test(wt) && /P\.degraded = false/.test(wt), 'D94c 降级旗与那一行同一个来源(每轮重算 + 预言机读通当场摘): 顶栏那一格若停在上一场的状态, 就是"绿点骗人"的另一种写法')
  assert(/degraded: boolean/.test(ty) && /w\.degraded\) return \{ tone: 'warn', text: t\('nav\.wDegraded'\)/.test(tn), 'D94d 读数面一条都不新增: 复用平台状态里那一个 message 字段所在的两处既有承载(工作区横幅 + 顶栏胶囊), 胶囊只为它换一个不撒谎的词(「本轮失败」是读不到的口径, 降级轮读得到)')
}

// ============================================================================
console.log('\n' + '─'.repeat(72))
console.log(`设计契约: 通过 ${PASS} / 失败 ${FAIL}`)
if (FAIL) {
  console.log('\n失败项:')
  for (const f of fails) console.log(`  · ${f}`)
  process.exit(1)
}
