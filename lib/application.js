const async = require('async');
const fs = require('fs');
const path = require('path');
const csvjson = require('csvjson');
const _ = require('lodash');

class Application {
  constructor(sequelize, sharepoint, program, options) {
    this.sequelize = sequelize;
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
        this.log(`Processing ${dir}`);
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
    let wellInfoContentType = await this.sharepoint.getContentType('Well Information');
    let wellSet = await this.sharepoint.getListItem(field, api);
    if (wellSet.length > 1) {
      return Promise.reject(`More than one existing document set found for ${api}.`);
    } else if (wellSet.length === 0) {
      wellSet = await this.sharepoint.createListItem(field, api, wellInfoContentType[0].StringId);
      const folder = await this.sharepoint.getFolder(`/${field.replace(' ', '')}/${api}`);
      await this.sharepoint.setProperties(folder, {
        'API': api,
        'Field_x0020_Name': field,
        'Section': well.Section,
        'Township': well.Township,
        'Range': well.Range,
        'WellName': well['Well Name']
      });
      this.log(`Created document set for ${field}/${api}`);
    } else {
      wellSet = wellSet[0];
      this.log(`Found existing document set for ${field}/${api} (${wellSet.GUID})`);
    }
    return Promise.resolve(wellSet);
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
      delete h['Document Name'];
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
        async.eachSeries(fieldWells[field], (well, callback) => {
          this.createApiDocumentSet(field, well).then(() => {
            result[field].push(well.API);
            callback();
          }).catch(callback);
        }, callback);
      }).catch(err => {
        this.log(`WARN: Unable to retrieve list for ${field}, will not deliver content`);
        callback();
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
    async.eachSeries(canProcess, (entry, callback) => {
      this.processDeliveryEntry(dir, entry).then(callback).catch(callback);
    }, (err) => {
      if (err) {
        action.reject(err);
      } else {
        action.resolve();
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
      const data = csvjson.toObject(fs.readFileSync(loads[0]).toString());
      this.createFieldApiSets(data).then(resources => {
        return this.processEntries(resources, dir, data);
      }).then(action.resolve).catch(action.reject);
    });

    return promise;
  }

  async processDeliveryEntry(dir, entry) {
    const filePath = path.join(dir, entry.Filename);
    if (!fs.existsSync(filePath)) {
      if (this.options.warnMissing) {
        this.log(`WARN: "${filePath}" does not exist and will not be migrated`);
      }
      return Promise.resolve();
    }
    try {
      const existing = await this.sharepoint.getDocument(`/${entry['Field Name'].replace(' ', '')}/${entry['API']}/${entry['Filename']}`);
      if (!this.options.forceUploads) {
        this.log(`INFO: Skipping ${filePath}, already uploaded`);
        return Promise.resolve();
      }
    } catch (err) {
      // Ok
    }
    const { size } = fs.statSync(filePath)
    const destPath = `/${entry['Field Name'].replace(' ', '')}/${entry.API}`;
    this.log(`Uploading ${entry.Filename} to ${destPath}`);
    await this.sharepoint.createFileChunked({
      path: destPath,
      fileName: entry.Filename,
      fileSize: size,
      chunkSize: 1048576,
      stream: fs.createReadStream(filePath, { highWaterMark: 1048576}),
      onProgress: (sent) => {
      }
    });
    const doc = await this.sharepoint.getDocument(`/${entry['Field Name'].replace(' ', '')}/${entry['API']}/${entry['Filename']}`);
    this.log(`Applying metadata to ${destPath}/${entry.Filename}`);
    await this.sharepoint.setProperties(doc, {
      'Document_x0020_Type': entry['Document Name'],
      'Date1': entry['Date']
    });
    return Promise.resolve();
  }

  log(...args) {
    if (this.program.debug) {
      console.log(...args)
    }
  }
}

module.exports = Application;
