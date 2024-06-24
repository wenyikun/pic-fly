export class Defer<T = any> {
  promise: Promise<T>
  resolve: any
  reject: any

  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
  }
}

// 并发限制为3的上传器
export const limitConcurrency = async (tasks: (() => Promise<any>)[], maxConcurrent: number) => {
  const results = []
  const executing: Promise<any>[] = []

  for (const task of tasks) {
    const p = task().then((result) => {
      // 移除已完成任务
      executing.splice(executing.indexOf(p), 1)
      return result
    })
    results.push(p)
    executing.push(p)

    // 当执行中的任务数量达到上限时，等待最早的一个任务完成
    if (executing.length >= maxConcurrent) {
      await Promise.race(executing)
    }
  }
  // 等待所有任务完成
  return Promise.all(results)
}
