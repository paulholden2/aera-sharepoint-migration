const async = require('async');
const fs = require('fs');
const path = require('path');
const csvjson = require('csvjson');
const _ = require('lodash');

class Application {
  constructor(sequelize, models, sharepoint, program, options) {
    this.sequelize = sequelize;
    this.models = models;
    this.sharepoint = sharepoint;
    this.program = program;
    this.options = options;
  }

  run() {
    this.log('Executing Aera SharePoint upload agent');
    this.log('======================================');
    this.log(`Output directory: ${this.options.outputDirectory}`);
    const baseDir = this.options.outputDirectory;
    let action = {};
    let promise = new Promise((resolve, reject) => {
      action.resolve = resolve;
      action.reject = reject;
    });
    fs.readdir(baseDir, (err, files) => {
      if (err) {
        return action.reject(err);
      }
      // Get canonical paths of directories only
      const dirs = files.map(file => path.join(baseDir, file)).filter(file => {
        const stat = fs.statSync(file);
        return stat.isDirectory();
      });
      async.eachSeries(dirs, (dir, callback) => {
        this.processDeliveryDir(dir).then(callback).catch(callback);
      }, (err) => {
        if (err) {
          action.reject(err);
        } else {
          action.resolve();
        }
      });
    });
    return promise;
  }

  getDeliveryLoadFile(dir) {

  }

  async createApiDocumentSet(field, well) {
    const api = well.API;
    if (api.length !== 10 || !api.startsWith('04')) {
      return Promise.reject(`Invalid/unexpected API number ${api}`);
    }
    let wellInfoContentType = await this.sharepoint.getContentType('Well Information');
    let wellFolder = await this.sharepoint.getFolder(`/${field}/${api}`);
    // If doesn't exist, returns { ListItemAllFields: null }, so check
    if (!wellFolder.GUID) {
      let folder = await this.sharepoint.createListItem(field, api, wellInfoContentType[0].StringId);
      wellFolder = await this.sharepoint.getListItemById(field, folder.Id);
      await this.sharepoint.setProperties(wellFolder, {
        'API': api,
        'Field_x0020_Name': field,
        'Section': well.Section,
        'Township': well.Township,
        'Range': well.Range,
        'Well_x0020_Name': well['Well Name']
      });
      this.log(`Created document set for ${field}/${api}`);
    } else {
      this.log(`Found existing document set for ${field}/${api} (${wellFolder.GUID})`);
    }
    return Promise.resolve(wellFolder);
  }

  // Create API document sets that will need to exist to deliver data
  // Returns hash: keys are field names, values are arrays of
  // created/existing API sets
  async createFieldApiSets(data) {
    let actions = {};
    let promise = new Promise((resolve, reject) => {
      actions.resolve = resolve;
      actions.reject = reject;
    });

    const wellData = _.uniqBy(data.map(entry => {
      let h = Object.assign({}, entry);
      delete h.Filename;
      delete h['Document Type'];
      delete h.Date;
      return h;
    }), item => JSON.stringify(item));

    const apis = wellData.map(well => well.API);
    if (apis.length !== _.uniq(apis).length) {
      return actions.reject('Varying well data found');
    }

    const fields = _.uniq(data.map(entry => entry['Field Name']));
    const fieldWells = fields.reduce((h, field) => {
      h[field] = _.uniq(wellData.filter(entry => entry['Field Name'] === field));
      return h;
    }, {});

    let result = {};

    async.eachSeries(fields, (field, callback) => {
      this.sharepoint.getList(field).then(() => {
        result[field] = [];
        async.eachLimit(fieldWells[field], this.options.parallelize || 5, (well, callback) => {
          this.createApiDocumentSet(field, well).then(() => {
            result[field].push(well.API);
            callback();
          }).catch(callback);
        }, callback);
      }).catch(err => {
        callback(`Unable to retrieve list for ${field}, will not deliver content`);
      });
    }, (err) => {
      if (err) {
        actions.reject(err);
      } else {
        actions.resolve(result);
      }
    });

    return promise;
  }

  processEntries(resources, dir, data) {
    let hadErrors = false;
    let action = {}
    let promise = new Promise((resolve, reject) => {
      action.resolve = resolve;
      action.reject = reject;
    });
    const canProcess = data.filter(entry => {
      const fieldName = entry['Field Name'];
      const field = resources[fieldName];
      return field && field.indexOf(entry['API']) > -1;
    });
    this.log(`Can process ${canProcess.length} documents`);
    async.eachLimit(canProcess, this.options.parallelize || 5, (entry, callback) => {
      this.processDeliveryEntry(dir, entry).then(res => {
        // If we actually did anything, entry info will be returned as res
        if (res) {
          this.models.Migration.upsert({
            'File Path': res.filePath,
            'Uploaded Bytes': res.fileSize,
            'File Size In Bytes': res.fileSize,
            'Upload Status Description': res.description,
            'Successful': res.success
          }).then((migration, created) => {
            callback();
          }).catch(callback);
        } else {
          callback();
        }
      }).catch(err => {
        this.log(`ERROR: ${err}`);
        hadErrors = true;
        const filePath = path.join(dir, entry.Filename);
        this.models.Migration.upsert({
          'File Path': filePath,
          'Upload Status Description': err.toString(),
          'Successful': 'N'
        }).then((migration, created) => {
          callback();
        }).catch(callback);
      });
    }, (err) => {
      if (err) {
        action.reject(err);
      } else {
        action.resolve(hadErrors);
      }
    });
    return promise;
  }

  processDeliveryDir(dir) {
    let action = {}
    let promise = new Promise((resolve, reject) => {
      action.resolve = resolve;
      action.reject = reject;
    });
    if (!dir.endsWith(this.options.deliveryTriggerSuffix) && !this.options.ignoreDeliveryTriggerSuffix) {
      this.log(`INFO: Skipping ${dir}, delivery trigger suffix not found.`);
      return Promise.resolve();
    }
    this.log(`Processing ${dir}`);
    fs.readdir(dir, (err, contents) => {
      if (err) {
        return action.reject(err);
      }
      const files = contents.map(file => path.join(dir, file)).filter(file => {
        const stat = fs.statSync(file);
        return !stat.isDirectory();
      });
      const loads = files.filter(file => file.endsWith('.csv'));
      if (loads.length === 0) {
        return action.reject(`No CSV load file found for ${dir}`);
      } else if (loads.length > 1) {
        return action.reject(`Multiple CSV load files found for ${dir}`);
      }
      const data = csvjson.toObject(fs.readFileSync(loads[0]).toString(), {
        quote: '"',
        delimiter: ','
      });
      this.createFieldApiSets(data).then(resources => {
        return this.processEntries(resources, dir, data);
      }).then(hadErrors => {
        if (!this.options.skipUploads && !hadErrors && !this.options.ignoreDeliveryTriggerSuffix) {
          fs.renameSync(dir, `${dir.slice(0, -this.options.deliveryTriggerSuffix.length)}_Delivered`);
        }
        if (hadErrors) {
          this.log(`Processed with errors: ${dir}!`);
        } else {
          this.log(`Successfully processed ${dir}!`);
        }
        action.resolve();
      }).catch(err => {
        this.log(`ERROR: Error processing ${dir} - ${err}`);
        action.resolve();
      });
    });

    return promise;
  }

  getBinaryData(filePath) {
    const base64 = fs.readFileSync(filePath, { encoding: 'base64' });
    const encoded = base64.replace(/^data:+[a-z]+\/+[a-z]+;base64,/, '');
    return Buffer.from(encoded, 'base64');
  }

  async processDeliveryEntry(dir, entry) {
    const headers = [
      'Filename',
      'API',
      'Document Type',
      'Date',
      'Well Name',
      'Field Name',
      'Township',
      'Range',
      'Section'
    ];
    for (var i = 0; i < headers.length; ++i) {
      const h = headers[i];
      if (!entry.hasOwnProperty(h)) {
        return Promise.reject('Missing header ' + h);
      }
    }
    const filePath = path.join(dir, entry.Filename);
    let sourceFilePath = filePath;
    // The path we use when logging to DB
    let baseDir = dir;
    if (baseDir.endsWith('_Delivered')) {
      baseDir = baseDir.slice(0, -('_Delivered').length);
    }
    let filePathNoDeliverySuffix = path.join(baseDir, entry.Filename);
    if (!this.options.ignoreDeliveryTriggerSuffix) {
      filePathNoDeliverySuffix = path.join(baseDir.slice(0, -this.options.deliveryTriggerSuffix.length), entry.Filename);
    }
    if (this.options.stubFiles) {
      sourceFilePath = './stub.txt';
    }
    let migration = await this.models.Migration.findOne({
      where: {
        'File Path': filePathNoDeliverySuffix
      }
    });
    if (migration && migration['Successful'] !== 'Y' && !this.options.retryFailed) {
      this.log(`INFO: Skipping ${filePath}; already migrated on ${migration['Created At']}`);
      return Promise.resolve();
    }
    if (this.options.skipUploads) {
      this.log(`INFO: Skipping ${filePath}; all file uploads are being skipped`);
      return Promise.resolve();
    }
    if (!fs.existsSync(filePath)) {
      return Promise.reject(`"${filePath}" does not exist and will not be migrated`);
    }
    const { size } = fs.statSync(sourceFilePath);
    const destPath = `/${entry['Field Name'].replace(' ', '')}/${entry.API}`;
    const chunkThreshold = 1048576;
    let res = {
      fileSize: size,
      filePath: filePathNoDeliverySuffix
    };
    try {
      if (!this.options.forceUploads) {
        const existing = await this.sharepoint.getDocument(`/${entry['Field Name'].replace(' ', '')}/${entry['API']}/${entry['Filename']}`);
        this.log(`INFO: Skipping ${filePath}, already uploaded`);
        res.success = 'Y';
        res.description = 'Already uploaded';
        return Promise.resolve(res);
      }
    } catch (err) {
      // Ok
    }
    this.log(`Uploading ${entry.Filename} to ${destPath}`);
    if (size > chunkThreshold) {
      await this.sharepoint.createFileChunked({
        path: destPath,
        fileName: entry.Filename,
        fileSize: size,
        chunkSize: 1048576,
        stream: fs.createReadStream(sourceFilePath, { highWaterMark: 1048576}),
        onProgress: (sent) => {
        }
      });
    } else {
      await this.sharepoint.createFile({
        path: destPath,
        fileName: entry.Filename,
        data: this.getBinaryData(sourceFilePath)
      });
    }
    const doc = await this.sharepoint.getDocument(`/${entry['Field Name'].replace(' ', '')}/${entry['API']}/${entry['Filename']}`);
    this.log(`Applying metadata to ${destPath}/${entry.Filename}`);
    const fields = await this.sharepoint.getListFields(entry['Field Name']);
    let dateField;
    if (fields.indexOf('Date') > -1) {
      dateField = 'Date';
    } else if (fields.indexOf('Date1') > -1) {
      dateField = 'Date1';
    } else if (fields.indexOf('Date11') > -1) {
      dateField = 'Date11';
    } else {
      res.success = 'N';
      res.description = 'Unable to detect Date field property';
      return Promise.resolve(res);
    }
    const date = entry['Date'];
    let props = {
      'Document_x0020_Type': entry['Document Type']
    };
    props[dateField] = date === '09-09-9999' ? '' : date;
    await this.sharepoint.setProperties(doc, props);
    res.success = 'Y';
    res.description = 'Successful migration';
    return Promise.resolve(res);
  }

  log(...args) {
    if (this.program.debug) {
      console.log(...args);
    }
  }
}

module.exports = Application;
