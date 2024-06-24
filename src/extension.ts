import * as vscode from 'vscode'
import path from 'path'
import fs from 'fs'
import os from 'os'
import Uploader from './uploader'
import clipboardEx from 'electron-clipboard-ex'
import { limitConcurrency } from './utils'

export function activate(context: vscode.ExtensionContext) {
  const selectionUpload = vscode.commands.registerTextEditorCommand('pic-fly.selection-upload', (editor) => {
    const document = editor.document
    const selections = editor.selections
    const uploader = new Uploader()

    // 创建一个任务队列
    const queue = selections.map((selection) => async () => {
      const selectedText = document.getText(selection).trim()
      const currentFileDir = document.uri.fsPath
      const basePath = currentFileDir.substring(0, currentFileDir.lastIndexOf('/'))
      const absolutePath = path.join(basePath, selectedText)
      try {
        const url = await uploader.uploadImage(absolutePath)
        await editor.edit((editBuilder) => {
          editBuilder.replace(selection, url)
        })
      } catch (err: any) {
        vscode.window.showErrorMessage(err.message)
      }
    })

    limitConcurrency(queue, 3)
  })
  context.subscriptions.push(selectionUpload)

  // 剪贴板上传
  const clipboardUpload = vscode.commands.registerCommand('pic-fly.clipboard-upload', async () => {
    // let clipboardPath = ''
    // switch (process.platform) {
    //   case 'darwin':
    //     clipboardPath = path.join(__dirname, '../image-clipboard/clipboard-mac')
    //     break
    //   case 'win32':
    //     clipboardPath = path.join(__dirname, '../image-clipboard/clipboard.exe')
    //     break
    //   default:
    //     clipboardPath = path.join(__dirname, '../image-clipboard/clipboard-linux')
    //     break
    // }
    const uploader = new Uploader()
    try {
      // const imports = await import('execa')
      // const { stdout } = imports.execaSync(clipboardPath)
      // if (!stdout) {
      //   return vscode.window.showErrorMessage('剪贴板图片不存在')
      // }
      if (!clipboardEx.hasImage()) {
        return vscode.window.showErrorMessage('剪贴板图片不存在')
      }
      const name = Math.floor(Math.random() * 10e12).toString(36) + '.png'
      const fsPath = path.join(os.tmpdir(), name)
      await clipboardEx.saveImageAsPng(fsPath)
      // const base64 = fs.readFileSync(fsPath, {
      //   encoding: 'base64',
      // })
      const url = await uploader.uploadImage(fsPath)
      await vscode.env.clipboard.writeText(url)
      fs.unlinkSync(fsPath)
      vscode.window.showInformationMessage('上传成功！链接已复制到剪贴板~')
    } catch (err: any) {
      vscode.window.showErrorMessage(err?.message || err)
    }
  })
  context.subscriptions.push(clipboardUpload)

  // 打开选择框
  const openDialogUpload = vscode.commands.registerCommand('pic-fly.open-dialog-upload', async () => {
    const fileUris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      title: '选取文件',
      // filters: { images: ['png', 'jpg', 'jpeg', 'gif', 'bmp'] },
    })
    if (!fileUris) {
      return
    }
    const uploader = new Uploader()
    try {
      const url = await uploader.uploadImage(fileUris[0].fsPath)
      await vscode.env.clipboard.writeText(url)
      vscode.window.showInformationMessage('上传成功！链接已复制到剪贴板~')
    } catch (err: any) {
      vscode.window.showErrorMessage(err.message)
    }
  })
  context.subscriptions.push(openDialogUpload)

  // 工作区文件选择上传
  const explorerFileUpload = vscode.commands.registerCommand(
    'pic-fly.explorer-file-upload',
    async (uri: vscode.Uri) => {
      console.log(uri)
      if (uri && uri.fsPath) {
        const filePath = uri.fsPath
        // 判断是否是文件
        const stats = fs.statSync(filePath)
        if (stats.isFile()) {
          const uploader = new Uploader()
          try {
            const url = await uploader.uploadImage(uri.fsPath)
            await vscode.env.clipboard.writeText(url)
            vscode.window.showInformationMessage('上传成功！链接已复制到剪贴板~')
          } catch (err: any) {
            vscode.window.showErrorMessage(err.message)
          }
        } else {
          vscode.window.showErrorMessage('暂不支持文件夹上传')
        }
      } else {
        vscode.window.showErrorMessage('未选择文件')
      }
    }
  )
  context.subscriptions.push(explorerFileUpload)
}

export function deactivate() {}
