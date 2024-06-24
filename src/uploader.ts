import * as vscode from 'vscode'
import COS from 'cos-nodejs-sdk-v5'
import OSS from 'ali-oss'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import qiniu from 'qiniu'
import crypto from 'crypto'
import path from 'path'
import fs from 'fs'
import mime from 'mime-types'
import { Defer } from './utils'

const qiniuZone = {
  z0: qiniu.zone.Zone_z0, // 华东-浙江
  z1: qiniu.zone.Zone_z1, // 华北-河北
  z2: qiniu.zone.Zone_z2, // 华南-广东
  na0: qiniu.zone.Zone_na0, // 北美-洛杉矶
  'cn-east-2': qiniu.zone.Zone_cn_east_2, // 华东-浙江2
  as0: qiniu.zone.Zone_as0, // 亚太-新加坡
}

class Uploader {
  accessKeyId?: string
  accessKeySecret?: string
  bucket?: string
  region?: string
  accountId?: string
  customDomain?: string
  uploadPath: string
  type: string
  constructor() {
    const config = vscode.workspace.getConfiguration('pic-fly')
    this.accessKeyId = config.get('accessKeyId')
    this.accessKeySecret = config.get('accessKeySecret')
    this.bucket = config.get('bucket')
    this.region = config.get('regionId')
    this.accountId = config.get('accountId')
    this.customDomain = config.get('customDomain')
    this.uploadPath = config.get('uploadPath') || 'pic-fly/{filename}-{timestamp}{ext}'
    this.type = config.get('type') || '腾讯云 COS'
  }

  private resolvePath(filePath: string): string {
    const template = this.uploadPath
    const now = new Date()
    const placeholders = {
      year: now.getFullYear().toString(),
      month: (now.getMonth() + 1).toString().padStart(2, '0'),
      day: now.getDate().toString().padStart(2, '0'),
      hour: now.getHours().toString().padStart(2, '0'),
      minute: now.getMinutes().toString().padStart(2, '0'),
      second: now.getSeconds().toString().padStart(2, '0'),
      timestamp: now.getTime().toString(),
      random: Math.floor(Math.random() * 10e12).toString(36),
      uuid: crypto.randomUUID(),
    }

    return template
      .replace(/{filename}/g, path.basename(filePath).replace(path.extname(filePath), ''))
      .replace(/{ext}/g, path.extname(filePath))
      .replace(/{timestamp}/g, placeholders.timestamp)
      .replace(/{date}/g, `${placeholders.year}-${placeholders.month}-${placeholders.day}`)
      .replace(/{time}/g, `${placeholders.hour}-${placeholders.minute}-${placeholders.second}`)
      .replace(/{year}/g, placeholders.year)
      .replace(/{month}/g, placeholders.month)
      .replace(/{day}/g, placeholders.day)
      .replace(/{hour}/g, placeholders.hour)
      .replace(/{minute}/g, placeholders.minute)
      .replace(/{second}/g, placeholders.second)
      .replace(/{random}/g, placeholders.random)
      .replace(/{uuid}/g, placeholders.uuid)
  }

  // 本地路径上传到腾讯云 COS
  private uploadImageToCOS(filePath: string = '', content: string = '') {
    const deferred = new Defer<string>()
    if (!this.accessKeyId || !this.accessKeySecret || !this.bucket || !this.region) {
      deferred.reject({
        message: '请先配置 accessKeyId, accessKeySecret, bucket, region',
      })
      return deferred.promise
    }
    if (filePath && !fs.existsSync(filePath)) {
      deferred.reject({
        message: `文件不存在：${filePath}`,
      })
      return deferred.promise
    }

    const cos = new COS({
      SecretId: this.accessKeyId,
      SecretKey: this.accessKeySecret,
    })

    let fileObj = Object.create(null)
    if (filePath) {
      fileObj.Body = fs.createReadStream(filePath)
    } else {
      fileObj.Body = Buffer.from(content, 'base64')
    }

    const key = this.resolvePath(filePath || 'image.png')
    cos.putObject(
      {
        Bucket: this.bucket as string,
        Region: this.region as string,
        Key: key,
        ...fileObj,
      },
      (err, data) => {
        if (err) {
          console.log(err)
          return deferred.reject(err)
        }
        if (this.customDomain) {
          return deferred.resolve(new URL(key, this.customDomain).toString())
        }
        deferred.resolve('https://' + data.Location)
      }
    )

    return deferred.promise
  }

  // 本地路径上传到阿里云 OSS
  private uploadImageToOSS(filePath: string = '', content: string = '') {
    const deferred = new Defer<string>()
    if (!this.accessKeyId || !this.accessKeySecret || !this.bucket || !this.region) {
      deferred.reject({
        message: '请先配置 accessKeyId, accessKeySecret, bucket, region',
      })
      return deferred.promise
    }
    if (filePath && !fs.existsSync(filePath)) {
      deferred.reject({
        message: `文件不存在：${filePath}`,
      })
      return deferred.promise
    }

    const client = new OSS({
      region: this.region,
      accessKeyId: this.accessKeyId,
      accessKeySecret: this.accessKeySecret,
      bucket: this.bucket,
    })

    client
      .put(this.resolvePath(filePath || 'image.png'), filePath || Buffer.from(content, 'base64'))
      .then((result) => {
        if (this.customDomain) {
          return deferred.resolve(new URL(result.name, this.customDomain).toString())
        }
        deferred.resolve(result.url)
      })
      .catch((err: any) => {
        deferred.reject(err)
      })

    return deferred.promise
  }

  private uploadImageToQiniu(filePath: string = '', content: string = '') {
    const deferred = new Defer<string>()
    if (!this.accessKeyId || !this.accessKeySecret || !this.bucket || !this.region || !this.customDomain) {
      deferred.reject({
        message: '请先配置 accessKeyId, accessKeySecret, bucket, region, customDomain',
      })
      return deferred.promise
    }
    if (filePath && !fs.existsSync(filePath)) {
      deferred.reject({
        message: `文件不存在：${filePath}`,
      })
      return deferred.promise
    }

    const mac = new qiniu.auth.digest.Mac(this.accessKeyId, this.accessKeySecret)
    const options = {
      scope: this.bucket,
      expires: 7200,
    }
    const putPolicy = new qiniu.rs.PutPolicy(options)
    const uploadToken = putPolicy.uploadToken(mac)

    const config = new qiniu.conf.Config()
    config.zone = qiniuZone[this.region as keyof typeof qiniuZone]

    if (!config.zone) {
      deferred.reject({
        message: '存储区域配置无效',
      })
      return deferred.promise
    }

    const formUploader = new qiniu.form_up.FormUploader(config)
    const putExtra = new qiniu.form_up.PutExtra()

    const callback = (err: any, body: any, info: any) => {
      if (err) {
        console.log(err)
        return deferred.reject(err)
      }
      if (info.statusCode === 200) {
        deferred.resolve(new URL(body.key, this.customDomain).toString())
      } else {
        console.log(info)
        deferred.reject({
          message: '上传失败：' + info.data.error,
        })
      }
    }

    if (filePath) {
      formUploader.putFile(uploadToken, this.resolvePath(filePath), filePath, putExtra, callback)
    } else {
      formUploader.put(uploadToken, this.resolvePath('image.png'), Buffer.from(content, 'base64'), putExtra, callback)
    }

    return deferred.promise
  }

  private uploadImageToR2(filePath: string = '', content: string = '') {
    const deferred = new Defer<string>()
    if (!this.accessKeyId || !this.accessKeySecret || !this.accountId || !this.customDomain) {
      deferred.reject({
        message: '请先配置 accessKeyId, accessKeySecret, accountId, customDomain',
      })
      return deferred.promise
    }
    if (filePath && !fs.existsSync(filePath)) {
      deferred.reject({
        message: `文件不存在：${filePath}`,
      })
      return deferred.promise
    }

    const S3 = new S3Client({
      region: 'auto',
      endpoint: `https://${this.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.accessKeySecret,
      },
    })

    const key = this.resolvePath(filePath || 'image.png')
    S3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: filePath ? fs.createReadStream(filePath) : Buffer.from(content, 'base64'),
        ContentType: filePath ? mime.lookup(filePath) || 'application/octet-stream' : 'image/png',
      })
    )
      .then((result) => {
        deferred.resolve(new URL(key, this.customDomain).toString())
      })
      .catch((err: any) => {
        deferred.reject(err)
      })

    return deferred.promise
  }

  uploadImage(filePath: string) {
    switch (this.type) {
      case '腾讯云 COS':
        return this.uploadImageToCOS(filePath)
      case '阿里云 OSS':
        return this.uploadImageToOSS(filePath)
      case '七牛云 Kodo':
        return this.uploadImageToQiniu(filePath)
      case 'Cloudflare R2':
        return this.uploadImageToR2(filePath)
      default:
        return Promise.reject({
          message: '未知的上传类型',
        })
    }
  }

  uploadBase64(file: string) {
    switch (this.type) {
      case '腾讯云 COS':
        return this.uploadImageToCOS('', file)
      case '阿里云 OSS':
        return this.uploadImageToOSS('', file)
      case '七牛云 Kodo':
        return this.uploadImageToQiniu('', file)
      case 'Cloudflare R2':
        return this.uploadImageToR2('', file)
      default:
        return Promise.reject({
          message: '未知的上传类型',
        })
    }
  }
}

export default Uploader
