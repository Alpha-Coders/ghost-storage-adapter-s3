import AWS from 'aws-sdk'
import BaseStore from 'ghost-storage-base'
import { join } from 'path'
import { readFile } from 'fs'

const readFileAsync = fp => new Promise((resolve, reject) => readFile(fp, (err, data) => err ? reject(err) : resolve(data)))
const stripLeadingSlash = s => s.indexOf('/') === 0 ? s.substring(1) : s
const stripEndingSlash = s => s.indexOf('/') === (s.length - 1) ? s.substring(0, s.length - 1) : s

class Store extends BaseStore {
  constructor (config = {}) {
    super(config)

    const {
      secretAccessKey,
      accessKeyId,
      assetHost,
      bucket,
      region
    } = config

    // Compatible with the aws-sdk's default environment variables
    this.accessKeyId = accessKeyId
    this.secretAccessKey = secretAccessKey
    this.region = region
    this.bucket = bucket
  }

  delete (fileName, targetDir) {
    const directory = targetDir || this.getTargetDir('')

    return new Promise((resolve, reject) => {
      this.s3()
        .deleteObject({
          Bucket: this.bucket,
          Key: stripLeadingSlash(join(directory, fileName))
        }, (err) => err ? resolve(false) : resolve(true))
    })
  }

  exists (fileName, targetDir) {
    return new Promise((resolve, reject) => {
      this.s3()
        .getObject({
          Bucket: this.bucket,
          Key: stripLeadingSlash(join(targetDir, fileName))
        }, (err) => err ? resolve(false) : resolve(true))
    })
  }

  s3 () {
    const options = {
      bucket: this.bucket,
      region: this.region,
      signatureVersion: 'v4',
      s3ForcePathStyle: false
    }
    options.credentials = new AWS.Credentials(this.accessKeyId, this.secretAccessKey)
    return new AWS.S3(options)
  }

  save (image, targetDir) {
    const directory = targetDir || this.getTargetDir('')

    return new Promise((resolve, reject) => {
      Promise.all([
        this.getUniqueFileName(image, directory),
        readFileAsync(image.path)
      ]).then(([ fileName, file ]) => {
        let config = {
          ACL: 'private',
          Body: file,
          Bucket: this.bucket,
          CacheControl: `max-age=${30 * 24 * 60 * 60}`,
          ContentType: image.type,
          Key: stripLeadingSlash(fileName)
        }

        this.s3()
          .putObject(config, (err, data) => err ? reject(err) : resolve(`/content/images/${fileName}`))
      })
      .catch(err => reject(err))
    })
  }

  serve () {
    return (req, res, next) =>
      this.s3()
        .getObject({
          Bucket: this.bucket,
          Key: stripLeadingSlash(req.path)
        })
        .on('httpHeaders', (statusCode, headers, response) => {
			res.set(headers)
		})
        .createReadStream()
        .on('error', err => {
          res.status(404)
          next(err)
        })
        .pipe(res)
  }

  read (options) {
    options = options || {}


    return new Promise((resolve, reject) => {
      // remove trailing slashes
      let path = (options.path || '').replace(/\/$|\\$/, '')

      // check if path is stored in s3 handled by us
      if (!path.startsWith('/content/images/')) {
        reject(new Error(`${path} is not stored in s3`))
      }
      path = path.substring('/content/images/'.length)

      this.s3()
        .getObject({
          Bucket: this.bucket,
          Key: stripLeadingSlash(path)
        }, (err, data) => err ? reject(err) : resolve(data.Body))
    })
  }
}

export default Store
