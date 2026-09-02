// window.api 的安全封装: 开发期浏览器预览时给出友好降级
export const api: Window['api'] =
  typeof window !== 'undefined' && window.api
    ? window.api
    : (new Proxy(
        {},
        {
          get: () => () => Promise.reject(new Error('仅在 Electron 环境中可用'))
        }
      ) as unknown as Window['api'])
