// electron-builder afterPack 钩子: 对 mac 产物做 ad-hoc 深签名(codesign --sign -)
// 背景: CI 以 CSC_IDENTITY_AUTO_DISCOVERY=false 完全跳过签名(electron-builder 25 无 ad-hoc 回退,
// 见 app-builder-lib/out/macPackager.js sign() 首行 isSignAllowed 短路), 产出的 .app bundle 层
// 完全无签名 —— 浏览器下载的包带 com.apple.quarantine 隔离属性, Gatekeeper 对"完全无签名"的
// app 直接判"已损坏, 无法打开"(而非"身份不明的开发者")。ad-hoc 签名让 bundle 签名自洽,
// 免 Apple 开发者账号即可把"损坏"降级为标准安全提示(仍要打开/xattr 可过)。
// 必须用根级 afterPack(mac.* 的 schema 不含 afterPack); 非 darwin 平台直接跳过。
const path = require('path')
const { execFileSync } = require('child_process')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  )
  console.log(`[adhoc-sign] codesign --force --deep --sign - "${appPath}"`)
  // --force: 覆盖 Electron 上游二进制自带的 ad-hoc 签名, 重铸整包含 Resources 的自洽封签
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
  // 自检: 签名无效直接令构建失败, 不让坏包流到 Release
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' })
  console.log('[adhoc-sign] ok')
}
